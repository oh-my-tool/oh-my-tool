import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { main } from "../src/cli/index";
import { createFakeExtension } from "./helpers";

let home: string;
let prev: string | undefined;
const logs: string[] = [];
const origLog = console.log;
const origError = console.error;

beforeEach(() => {
  home = join(tmpdir(), `omt-e2e-${Date.now()}-${Math.random()}`);
  mkdirSync(home, { recursive: true });
  prev = process.env.OMT_HOME;
  process.env.OMT_HOME = home;
  logs.length = 0;
  console.log = (v: unknown) => logs.push(typeof v === "string" ? v : JSON.stringify(v));
  console.error = (v: unknown) => logs.push(typeof v === "string" ? v : JSON.stringify(v));
  writeFileSync(join(home, "config.toml"), "[extensions.mysql.connections.iot-test]\nhost=\"h\"\nport=3306\ndatabase=\"iot\"\nusername=\"u\"\nsecret=\"s\"\ntls=true\n", "utf8");
});
afterEach(() => {
  console.log = origLog;
  console.error = origError;
  if (prev === undefined) delete process.env.OMT_HOME;
  else process.env.OMT_HOME = prev;
  rmSync(home, { recursive: true, force: true });
});

describe("omt cli e2e", () => {
  test("--version prints version", async () => {
    const code = await main(["--version"]);
    expect(code).toBe(0);
    expect(logs[0]).toContain("0.1.0");
  });

  test("search prints tools", async () => {
    createFakeExtension(home, { id: "mysql" });
    const code = await main(["search", "查询 mysql 数据"]);
    expect(code).toBe(0);
    expect(logs[0]).toContain("mysql.query");
  });

  test("describe prints the schema", async () => {
    createFakeExtension(home, { id: "mysql" });
    const code = await main(["describe", "mysql.query"]);
    expect(code).toBe(0);
    expect(logs[0]).toContain("inputSchema");
  });

  test("call executes and prints a structured result", async () => {
    createFakeExtension(home, { id: "mysql" });
    const code = await main(["call", "mysql.query", "connection=iot-test", "sql=SELECT 1"]);
    expect(code).toBe(0);
    expect(logs[0]).toContain('"ok": true');
  });

  test("call rejects an unknown connection with a non-zero exit", async () => {
    createFakeExtension(home, { id: "mysql" });
    const code = await main(["call", "mysql.query", "connection=nope"]);
    expect(code).toBe(1);
    expect(logs[0]).toContain("POLICY_VIOLATION");
  });

  test("extension list prints installed", async () => {
    createFakeExtension(home, { id: "mysql" });
    const code = await main(["extension", "list"]);
    expect(code).toBe(0);
    expect(logs[0]).toContain("mysql");
  });
});
