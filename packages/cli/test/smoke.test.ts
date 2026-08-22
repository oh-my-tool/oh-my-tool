import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { main } from "../src/cli/index";
import { createFakeExtension } from "./helpers";

let home: string;
let prev: string | undefined;
const logs: string[] = [];
const origLog = console.log;
const origError = console.error;

beforeEach(() => {
  // repo-internal temp home so installed extensions resolve @oh-my-tool/sdk
  // via the workspace node_modules at the repo root.
  home = join(resolve(process.cwd()), ".smoke-" + Date.now());
  mkdirSync(home, { recursive: true });
  prev = process.env.OH_MY_TOOL_HOME;
  process.env.OH_MY_TOOL_HOME = home;
  logs.length = 0;
  console.log = (v: unknown) => logs.push(typeof v === "string" ? v : JSON.stringify(v));
  console.error = (v: unknown) => logs.push(typeof v === "string" ? v : JSON.stringify(v));
});

afterEach(() => {
  console.log = origLog;
  console.error = origError;
  if (prev === undefined) delete process.env.OH_MY_TOOL_HOME;
  else process.env.OH_MY_TOOL_HOME = prev;
  rmSync(home, { recursive: true, force: true });
});

describe("smoke: fake mysql extension via CLI", () => {
  test("install -> search -> describe -> list", async () => {
    createFakeExtension(home, { id: "mysql" });

    const searchCode = await main(["search", "查询 mysql 数据库"]);
    expect(searchCode).toBe(0);
    expect(logs.join("\n")).toContain("mysql.query");

    const describeCode = await main(["describe", "mysql.query"]);
    expect(describeCode).toBe(0);
    expect(logs.join("\n")).toContain("inputSchema");

    const listCode = await main(["extension", "list"]);
    expect(listCode).toBe(0);
    expect(logs.join("\n")).toContain("mysql");

    const rejectCode = await main(["run", "mysql.query", "connection=nope"]);
    expect(rejectCode).toBe(1);
    expect(logs.join("\n")).toContain("POLICY_VIOLATION");
  });
});
