import { timingSafeEqual } from "node:crypto";
import { RuntimeError } from "../../errors";

export const DEFAULT_OAUTH_CALLBACK_TIMEOUT_MS = 300_000;

export interface OAuthCallback {
  readonly redirectUrl: URL;
  waitForResult(expectedState: string): Promise<URLSearchParams>;
  close(): Promise<void>;
}

const SUCCESS_PAGE = "<!doctype html><html><body><h1>Authorization complete</h1><p>You can close this window.</p></body></html>";
const ERROR_PAGE = "<!doctype html><html><body><h1>Authorization failed</h1><p>Return to Oh My Tool for details.</p></body></html>";
const RESPONSE_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };

function sameState(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const actualBytes = Buffer.from(actual, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export async function createOAuthCallback(
  port: number,
  timeoutMs = DEFAULT_OAUTH_CALLBACK_TIMEOUT_MS,
): Promise<OAuthCallback> {
  let expectedState: string | undefined;
  let result: PromiseWithResolvers<URLSearchParams> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let closed = false;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(rawRequest) {
      const request = rawRequest as unknown as { url: string; method: string };
      const url = new URL(request.url);
      if (url.pathname !== "/oauth/callback") return new Response("Not found", { status: 404 });
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      if (settled || result === undefined || expectedState === undefined) return new Response("Conflict", { status: 409 });

      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      if (!sameState(url.searchParams.get("state"), expectedState)) {
        result.reject(new RuntimeError("MCP_OAUTH_STATE_MISMATCH", "OAuth callback state did not match"));
        return new Response(ERROR_PAGE, { status: 400, headers: RESPONSE_HEADERS });
      }
      const oauthError = url.searchParams.get("error");
      if (oauthError !== null) {
        const code = oauthError === "access_denied" ? "MCP_OAUTH_ACCESS_DENIED" : "MCP_OAUTH_AUTHORIZATION_FAILED";
        result.reject(new RuntimeError(code, "OAuth authorization was not completed"));
        return new Response(ERROR_PAGE, { status: 400, headers: RESPONSE_HEADERS });
      }
      if (url.searchParams.get("code") === null) {
        result.reject(new RuntimeError("MCP_OAUTH_AUTHORIZATION_FAILED", "OAuth authorization was not completed"));
        return new Response(ERROR_PAGE, { status: 400, headers: RESPONSE_HEADERS });
      }
      result.resolve(new URLSearchParams(url.searchParams));
      return new Response(SUCCESS_PAGE, { status: 200, headers: RESPONSE_HEADERS });
    },
  });

  return {
    redirectUrl: new URL(`http://127.0.0.1:${server.port}/oauth/callback`),
    waitForResult(state) {
      if (result !== undefined) return result.promise;
      if (closed) {
        return Promise.reject(new RuntimeError("MCP_OAUTH_CALLBACK_CLOSED", "OAuth callback listener is closed"));
      }
      expectedState = state;
      result = Promise.withResolvers<URLSearchParams>();
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        result?.reject(new RuntimeError("MCP_OAUTH_TIMEOUT", "OAuth callback timed out"));
      }, timeoutMs);
      return result.promise;
    },
    async close() {
      if (closed) return;
      closed = true;
      if (timeout !== undefined) clearTimeout(timeout);
      if (!settled && result !== undefined) {
        settled = true;
        result.reject(new RuntimeError("MCP_OAUTH_CALLBACK_CLOSED", "OAuth callback listener is closed"));
      }
      await server.stop(true);
    },
  };
}
