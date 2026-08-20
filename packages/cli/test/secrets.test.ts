import { describe, expect, test } from "bun:test";
import { memoryStore, SecretsManager } from "../src/secrets/secrets";

describe("memoryStore", () => {
  test("set/get roundtrip", async () => {
    const s = memoryStore();
    await s.set("mysql:iot-test", "s3cret");
    expect(await s.get("mysql:iot-test")).toBe("s3cret");
  });

  test("unknown secret returns undefined", async () => {
    const s = memoryStore();
    expect(await s.get("nope")).toBeUndefined();
  });

  test("delete removes a secret", async () => {
    const s = memoryStore({ "a:b": "v" });
    await s.delete("a:b");
    expect(await s.get("a:b")).toBeUndefined();
  });
});

describe("SecretsManager", () => {
  test("delegates to an injected store", async () => {
    const store = memoryStore();
    const mgr = new SecretsManager(store);
    await mgr.set("x", "y");
    expect(await mgr.get("x")).toBe("y");
    await mgr.delete("x");
    expect(await mgr.get("x")).toBeUndefined();
  });
});
