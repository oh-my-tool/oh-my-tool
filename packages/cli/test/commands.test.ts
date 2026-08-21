import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createFakeExtension } from "./helpers";
import {
  runSearch,
  runDescribe,
  runCall,
  runExtensionList,
  runExtensionInstall,
  runSecretSet,
  runSecretList,
  parseSecretNamesFromCmdkey,
} from "../src/cli/commands";
import { memoryStore } from "../src/secrets/secrets";
import { homeDir } from "../src/cli/context";

let home: string;
let prev: string | undefined;
beforeEach(() => {
  home = join(tmpdir(), `omt-cli-${Date.now()}-${Math.random()}`);
  mkdirSync(home, { recursive: true });
  prev = process.env.OMT_HOME;
  process.env.OMT_HOME = home;
  writeFileSync(join(home, "config.toml"), "[extensions.mysql.connections.iot-test]\nhost=\"h\"\nport=3306\ndatabase=\"iot\"\nusername=\"u\"\nsecret=\"s\"\ntls=true\n", "utf8");
});
afterEach(() => {
  if (prev === undefined) delete process.env.OMT_HOME;
  else process.env.OMT_HOME = prev;
  rmSync(home, { recursive: true, force: true });
});

describe("cli commands", () => {
  test("homeDir honours OMT_HOME", () => {
    expect(homeDir()).toBe(home);
  });

  test("search returns matching tools without inputSchema", async () => {
    createFakeExtension(home, { id: "mysql" });
    const out = await runSearch("查询 mysql 数据");
    expect(out.tools.length).toBeGreaterThan(0);
    expect(out.tools[0].name).toBe("mysql.query");
    expect(out.tools[0]).not.toHaveProperty("inputSchema");
  });

  test("describe returns the tool schema", async () => {
    createFakeExtension(home, { id: "mysql" });
    const out = await runDescribe("mysql.query");
    expect(out.name).toBe("mysql.query");
    expect(out.inputSchema).toBeDefined();
  });

  test("describe throws for an unknown tool", async () => {
    createFakeExtension(home, { id: "mysql" });
    await expect(runDescribe("mysql.nope")).rejects.toThrow(/unknown tool/i);
  });

  test("call executes a tool and returns a structured result", async () => {
    createFakeExtension(home, { id: "mysql" });
    const res = await runCall("mysql.query", { connection: "iot-test", sql: "SELECT 1" }, false);
    expect(res.ok).toBe(true);
  });

  test("extension list returns installed extensions", async () => {
    createFakeExtension(home, { id: "mysql" });
    const list = await runExtensionList();
    expect(list.map((e) => e.id)).toContain("mysql");
  });

  test("secret set writes to the store", async () => {
    const store = memoryStore();
    const res = await runSecretSet("mysql:prod", "pw", store);
    expect(res.ok).toBe(true);
    expect(await store.get("mysql:prod")).toBe("pw");
  });

  test("parseSecretNamesFromCmdkey extracts unique oh-my-tool names", () => {
    const out = [
      "目标: LegacyGeneric:target=oh-my-tool/mysql:aiot-test",
      "目标: LegacyGeneric:target=oh-my-tool/redis:iot-test",
      "目标: LegacyGeneric:target=git:http://gitlab.transsion-os.com",
      "目标: LegacyGeneric:target=oh-my-tool/mysql:calendar",
      "目标: LegacyGeneric:target=oh-my-tool/mysql:calendar",
    ].join("\r\n");
    expect(parseSecretNamesFromCmdkey(out)).toEqual([
      "mysql:aiot-test",
      "mysql:calendar",
      "redis:iot-test",
    ]);
  });

  test("runSecretList uses injected cmdkey exec without exposing values", async () => {
    const exec = async () =>
      "目标: LegacyGeneric:target=oh-my-tool/redis:iot-test\r\n目标: LegacyGeneric:target=oh-my-tool/mysql:aiot-test\r\n";
    const res = await runSecretList(exec);
    // 测试环境为 Windows 时走 cmdkey 分支；非 Windows 恒 supported=false
    if (process.platform === "win32") {
      expect(res.supported).toBe(true);
      expect(res.names).toEqual(["mysql:aiot-test", "redis:iot-test"]);
    } else {
      expect(res.supported).toBe(false);
      expect(res.names).toEqual([]);
    }
  });

  test("extension install installs a local dir", async () => {
    const src = join(tmpdir(), `omt-src-${Date.now()}`);
    mkdirSync(join(src, "src"), { recursive: true });
    writeFileSync(join(src, "omt.manifest.json"), JSON.stringify({ id: "redis", name: "Redis", version: "0.1.0", sdkVersion: "^0.1.0", description: "d", tools: [{ name: "redis.get", description: "g" }] }), "utf8");
    writeFileSync(join(src, "src", "index.ts"), "export default { handlers: { \"redis.get\": async () => ({ data: {} }) } };", "utf8");
    const ref = await runExtensionInstall(src);
    expect(ref.id).toBe("redis");
    expect((await runExtensionList()).map((e) => e.id)).toContain("redis");
    rmSync(src, { recursive: true, force: true });
  });
});

