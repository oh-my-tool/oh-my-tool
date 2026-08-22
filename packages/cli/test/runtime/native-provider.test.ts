import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NativeExtensionProvider } from "../../src/runtime/providers/native/provider";

const homes: string[] = [];

function fixture(poison: boolean): string {
  const home = join(tmpdir(), `omt-native-${Date.now()}-${Math.random()}`);
  homes.push(home);
  const dir = join(home, "extensions", "test", "0.1.0");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "omt.manifest.json"), JSON.stringify({
    id: "test",
    name: "Test",
    version: "0.1.0",
    sdkVersion: "^0.1.0",
    description: "test extension",
    tools: [{ name: "test.echo", description: "echo", keywords: ["echo"], risk: "read", inputSchema: { type: "object" } }],
  }), "utf8");
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "omt-test",
    type: "module",
    omt: { entry: "./src/index.ts" },
  }), "utf8");
  writeFileSync(join(dir, "src", "index.ts"), poison
    ? 'throw new Error("HANDLER_IMPORTED");'
    : 'export default { handlers: { "test.echo": async (_ctx, input) => ({ data: input }) } };', "utf8");
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("NativeExtensionProvider", () => {
  test("lists static descriptors without importing a poison handler", async () => {
    const provider = new NativeExtensionProvider(fixture(true));
    const descriptors = await provider.listTools();
    expect(provider.id).toBe("native");
    expect(provider.kind).toBe("native");
    expect(descriptors[0]).toMatchObject({
      id: "test.echo",
      provider: { id: "native", kind: "native" },
      source: { id: "omt-test", kind: "extension" },
    });
    expect(descriptors[0].inputSchema).toBeDefined();
  });

  test("loads the handler only during execute", async () => {
    const provider = new NativeExtensionProvider(fixture(false));
    await provider.listTools();
    const result = await provider.execute("test.echo", { value: "hello" }, {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      config: {},
      secrets: { async get() { return undefined; }, async set() {}, async delete() {} },
    });
    expect(result.data).toEqual({ value: "hello" });
  });
});
