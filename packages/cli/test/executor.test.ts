import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { discoverExtensions } from "../src/extension/discovery";
import { createRegistry } from "../src/core/registry";
import { executeTool } from "../src/core/executor";
import { loadConfig } from "../src/config/config";
import { memoryStore } from "../src/secrets/secrets";
import { createFakeExtension } from "./helpers";

let home: string;
let configToml: string;
beforeEach(() => {
  home = join(tmpdir(), `omt-test-exec-${Date.now()}-${Math.random()}`);
  mkdirSync(home, { recursive: true });
  configToml = `
[extensions.mysql.connections.iot-test]
environment = "test"
host = "mysql-test.internal"
port = 3306
database = "iot"
username = "iot_readonly"
secret = "mysql:iot-test"
tls = true
`;
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function deps() {
  const config = loadConfig(home);
  const registry = createRegistry(discoverExtensions(home));
  const secrets = memoryStore({ "mysql:iot-test": "pw" });
  return { config, registry, secrets };
}

const schemaTool = {
  name: "mysql.query",
  description: "q",
  risk: "read",
  inputSchema: {
    type: "object",
    required: ["connection", "sql"],
    properties: {
      connection: { type: "string" },
      sql: { type: "string" },
      maxRows: { type: "integer", default: 100, maximum: 1000 },
      timeoutMs: { type: "integer", default: 5000, maximum: 30000 },
    },
  },
};

describe("executeTool", () => {
  test("runs an extension handler and returns a structured ok result", async () => {
    writeFileSync(join(home, "config.toml"), configToml, "utf8");
    createFakeExtension(home, { id: "mysql", tools: [schemaTool] });
    const d = deps();
    const res = await executeTool(d, "mysql.query", { connection: "iot-test", sql: "SELECT 1" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tool).toBe("mysql.query");
      expect(res.meta).toHaveProperty("durationMs");
    }
  });

  test("clamps maxRows and timeoutMs via policy", async () => {
    writeFileSync(join(home, "config.toml"), configToml, "utf8");
    createFakeExtension(home, { id: "mysql", tools: [schemaTool] });
    const d = deps();
    const res = await executeTool(d, "mysql.query", { connection: "iot-test", sql: "SELECT 1", maxRows: 99999, timeoutMs: 99999 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const echoed = (res.data as any).echoed;
      expect(echoed.maxRows).toBe(1000);
      expect(echoed.timeoutMs).toBe(30000);
    }
  });

  test("rejects an unknown connection", async () => {
    writeFileSync(join(home, "config.toml"), configToml, "utf8");
    createFakeExtension(home, { id: "mysql", tools: [{ name: "mysql.query", description: "q" }] });
    const res = await executeTool(deps(), "mysql.query", { connection: "nope" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("POLICY_VIOLATION");
  });

  test("rejects agent-supplied password", async () => {
    writeFileSync(join(home, "config.toml"), configToml, "utf8");
    createFakeExtension(home, { id: "mysql", tools: [{ name: "mysql.query", description: "q" }] });
    const res = await executeTool(deps(), "mysql.query", { connection: "iot-test", password: "hack" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("POLICY_VIOLATION");
  });

  test("returns INVALID_INPUT for a missing required field", async () => {
    writeFileSync(join(home, "config.toml"), configToml, "utf8");
    createFakeExtension(home, { id: "mysql", tools: [schemaTool] });
    const res = await executeTool(deps(), "mysql.query", { connection: "iot-test" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_INPUT");
  });

  test("returns UNKNOWN_TOOL for an unregistered tool", async () => {
    writeFileSync(join(home, "config.toml"), configToml, "utf8");
    createFakeExtension(home, { id: "mysql", tools: [{ name: "mysql.query", description: "q" }] });
    const res = await executeTool(deps(), "mysql.nope", { connection: "iot-test" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("UNKNOWN_TOOL");
  });

  test("returns EXECUTION_FAILED when the handler throws", async () => {
    writeFileSync(join(home, "config.toml"), configToml, "utf8");
    const { dir } = createFakeExtension(home, { id: "boom", tools: [{ name: "boom.x", description: "x" }] });
    writeFileSync(join(dir, "src", "index.ts"), `export default { handlers: { "boom.x": async () => { throw new Error("db down") } } };`, "utf8");
    const res = await executeTool(deps(), "boom.x", {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("EXECUTION_FAILED");
  });

  test("fails LOAD_FAILED when manifest tools do not match handlers", async () => {
    writeFileSync(join(home, "config.toml"), configToml, "utf8");
    const { dir } = createFakeExtension(home, { id: "mismatch", tools: [{ name: "mismatch.a", description: "a" }] });
    writeFileSync(join(dir, "src", "index.ts"), `export default { handlers: { "mismatch.a": async () => ({data:1}), "mismatch.secret": async () => ({data:2}) } };`, "utf8");
    const res = await executeTool(deps(), "mismatch.a", {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("LOAD_FAILED");
  });

  test("does not leak secrets into the result", async () => {
    writeFileSync(join(home, "config.toml"), configToml, "utf8");
    createFakeExtension(home, { id: "mysql", tools: [{ name: "mysql.query", description: "q" }] });
    const d = deps();
    const res = await executeTool(d, "mysql.query", { connection: "iot-test" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(JSON.stringify(res)).not.toContain("pw");
  });
});
