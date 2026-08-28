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
  prev = process.env.OH_MY_TOOL_HOME;
  process.env.OH_MY_TOOL_HOME = home;
  logs.length = 0;
  console.log = (v: unknown) => logs.push(typeof v === "string" ? v : JSON.stringify(v));
  console.error = (v: unknown) => logs.push(typeof v === "string" ? v : JSON.stringify(v));
  writeFileSync(join(home, "config.toml"), "[extensions.mysql.connections.iot-test]\nhost=\"h\"\nport=3306\ndatabase=\"iot\"\nusername=\"u\"\nsecret=\"s\"\ntls=true\n", "utf8");
});
afterEach(() => {
  console.log = origLog;
  console.error = origError;
  if (prev === undefined) delete process.env.OH_MY_TOOL_HOME;
  else process.env.OH_MY_TOOL_HOME = prev;
  rmSync(home, { recursive: true, force: true });
});

describe("ohmytool cli e2e", () => {
  test("package exposes only the ohmytool binary", async () => {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
    expect(pkg.bin).toEqual({ ohmytool: "bin/ohmytool.cjs" });
  });

  test("--version prints version", async () => {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
    const code = await main(["--version"]);
    expect(code).toBe(0);
    expect(logs[0]).toContain('"name": "ohmytool"');
    expect(logs[0]).toContain(pkg.version);
  });

  test("help advertises ohmytool run and not omt call", async () => {
    const code = await main(["--help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("ohmytool run");
    expect(logs.join("\n")).not.toContain("omt call");
    expect(logs.join("\n")).toContain("ohmytool mcp auth <server>");
    expect(logs.join("\n")).toContain("ohmytool mcp logout <server>");
    expect(logs.join("\n")).toContain("ohmytool mcp list");
    expect(logs.join("\n")).toContain("--json");
  });

  test("mcp list prints configured servers without secret values", async () => {
    writeFileSync(
      join(home, "config.toml"),
      "[mcp.servers.github]\ntransport=\"stdio\"\ncommand=\"npx\"\nargs=[\"-y\", \"server-github\"]\nsecretEnv={GITHUB_PERSONAL_ACCESS_TOKEN=\"mcp:github:pat\"}\n",
      "utf8",
    );

    const code = await main(["mcp", "list"]);

    expect(code).toBe(0);
    expect(logs[0]).toContain('"id": "github"');
    expect(logs[0]).toContain('"transport": "stdio"');
    expect(logs[0]).not.toContain("mcp:github:pat");
    expect(logs[0]).not.toContain("server-github");
  });

  test("dispatches MCP auth and logout commands with secret-free output", async () => {
    const authCode = await main(["mcp", "auth", "linear"], {
      runMcpAuth: async () => ({ serverId: "linear", authorized: true }),
      runMcpLogout: async () => ({ serverId: "linear", loggedOut: true }),
    });
    const logoutCode = await main(["mcp", "logout", "linear"], {
      runMcpAuth: async () => ({ serverId: "linear", authorized: true }),
      runMcpLogout: async () => ({ serverId: "linear", loggedOut: true }),
    });

    expect(authCode).toBe(0);
    expect(logoutCode).toBe(0);
    expect(logs.join("\n")).toContain('"authorized": true');
    expect(logs.join("\n")).toContain('"loggedOut": true');
    expect(logs.join("\n")).not.toContain("access_token");
    expect(logs.join("\n")).not.toContain("client_secret");
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

  test("run executes and prints a structured result", async () => {
    createFakeExtension(home, { id: "mysql" });
    const code = await main(["run", "mysql.query", "connection=iot-test", "sql=SELECT 1"]);
    expect(code).toBe(0);
    expect(logs[0]).toContain("status: ok");
    expect(logs[0]).not.toContain('"ok": true');
  });

  test("run --json keeps the machine-readable JSON result", async () => {
    createFakeExtension(home, { id: "mysql" });
    const code = await main(["run", "mysql.query", "connection=iot-test", "sql=SELECT 1", "--json"]);
    expect(code).toBe(0);
    expect(logs[0]).toContain('"ok": true');
  });

  test("run --format=json is equivalent to --json", async () => {
    createFakeExtension(home, { id: "mysql" });
    const code = await main(["run", "mysql.query", "connection=iot-test", "sql=SELECT 1", "--format=json"]);
    expect(code).toBe(0);
    expect(logs[0]).toContain('"ok": true');
  });

  test("connection list is available as a top-level diagnostic", async () => {
    const code = await main(["connection", "list"]);
    expect(code).toBe(0);
    expect(logs[0]).toContain("connections:");
    expect(logs[0]).toContain('name: "iot-test"');
    expect(logs[0]).not.toContain('secret:');
  });

  test("config check is available as a top-level diagnostic", async () => {
    const code = await main(["config", "check"]);
    expect(code).toBe(0);
    expect(logs[0]).toContain("valid: true");
  });

  test("call is no longer a canonical command", async () => {
    createFakeExtension(home, { id: "mysql" });
    const code = await main(["call", "mysql.query", "connection=iot-test", "sql=SELECT 1"]);
    expect(code).toBe(1);
    expect(logs.join("\n")).not.toContain('"ok": true');
  });

  test("extension list prints installed", async () => {
    createFakeExtension(home, { id: "mysql" });
    const code = await main(["extension", "list"]);
    expect(code).toBe(0);
    expect(logs[0]).toContain("mysql");
  });
});
