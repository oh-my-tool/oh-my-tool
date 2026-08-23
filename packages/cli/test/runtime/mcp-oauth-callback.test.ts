import { afterEach, describe, expect, test } from "bun:test";
import {
  createOAuthCallback,
  type OAuthCallback,
} from "../../src/runtime/providers/mcp/oauth-callback";

const callbacks = new Set<OAuthCallback>();

async function callback(timeoutMs = 1_000): Promise<OAuthCallback> {
  const value = await createOAuthCallback(0, timeoutMs);
  callbacks.add(value);
  return value;
}

afterEach(async () => {
  await Promise.all([...callbacks].map((value) => value.close()));
  callbacks.clear();
});

function callbackUrl(value: OAuthCallback, query: string): string {
  return `${value.redirectUrl.toString()}?${query}`;
}

describe("MCP OAuth loopback callback", () => {
  test("binds an exact 127.0.0.1 callback and returns matching callback params once", async () => {
    const value = await callback();
    expect(value.redirectUrl.toString()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    const resultPromise = value.waitForResult("expected-state");

    const response = await fetch(callbackUrl(value, "code=authorization-code&state=expected-state&iss=https%3A%2F%2Fauth.example"));
    const params = await resultPromise;
    const second = await fetch(callbackUrl(value, "code=second&state=expected-state"));

    expect(response.status).toBe(200);
    expect(params.get("code")).toBe("authorization-code");
    expect(params.get("state")).toBe("expected-state");
    expect(params.get("iss")).toBe("https://auth.example");
    expect(second.status).toBe(409);
  });

  test("rejects a state mismatch without echoing callback data", async () => {
    const value = await callback();
    const resultPromise = value.waitForResult("expected-state");
    const rejection = resultPromise.catch((error: unknown) => error);

    const response = await fetch(callbackUrl(value, "code=secret-code&state=wrong-state&token=secret-token"));
    expect(await rejection).toMatchObject({ code: "MCP_OAUTH_STATE_MISMATCH" });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).not.toContain("secret-code");
    expect(body).not.toContain("wrong-state");
    expect(body).not.toContain("secret-token");
    expect(body).not.toContain("code=");
  });

  test("maps access denial to a stable error without echoing provider descriptions", async () => {
    const value = await callback();
    const resultPromise = value.waitForResult("expected-state");
    const rejection = resultPromise.catch((error: unknown) => error);

    const response = await fetch(callbackUrl(value, "error=access_denied&error_description=private-description&state=expected-state"));
    expect(await rejection).toMatchObject({ code: "MCP_OAUTH_ACCESS_DENIED" });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).not.toContain("private-description");
    expect(body).not.toContain("access_denied");
  });

  test("rejects a matching-state callback with neither code nor error", async () => {
    const value = await callback();
    const resultPromise = value.waitForResult("expected-state");
    const rejection = resultPromise.catch((error: unknown) => error);

    const response = await fetch(callbackUrl(value, "state=expected-state"));
    expect(await rejection).toMatchObject({ code: "MCP_OAUTH_AUTHORIZATION_FAILED" });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("<!doctype html><html><body><h1>Authorization failed</h1><p>Return to Oh My Tool for details.</p></body></html>");
  });

  test("keeps listening after a wrong path", async () => {
    const value = await callback();
    const resultPromise = value.waitForResult("expected-state");

    const wrong = await fetch(new URL("/wrong", value.redirectUrl));
    const valid = await fetch(callbackUrl(value, "code=valid&state=expected-state"));

    expect(wrong.status).toBe(404);
    expect(valid.status).toBe(200);
    expect((await resultPromise).get("code")).toBe("valid");
  });

  test("keeps listening after a non-GET callback", async () => {
    const value = await callback();
    const resultPromise = value.waitForResult("expected-state");

    const post = await fetch(value.redirectUrl, { method: "POST" });
    const valid = await fetch(callbackUrl(value, "code=valid&state=expected-state"));

    expect(post.status).toBe(405);
    expect(valid.status).toBe(200);
    expect((await resultPromise).get("code")).toBe("valid");
  });

  test("times out with a stable error", async () => {
    const value = await callback(10);
    await expect(value.waitForResult("expected-state")).rejects.toMatchObject({ code: "MCP_OAUTH_TIMEOUT" });
  });

  test("close before callback stops the listener", async () => {
    const value = await callback();
    const url = value.redirectUrl;
    const pending = value.waitForResult("expected-state");
    const rejection = pending.catch((error: unknown) => error);

    await value.close();
    callbacks.delete(value);

    expect(await rejection).toMatchObject({ code: "MCP_OAUTH_CALLBACK_CLOSED" });
    await expect(fetch(url)).rejects.toBeDefined();
  });
});
