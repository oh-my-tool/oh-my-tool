import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { loadConfig, getConnectionConfig, listConnections } from "../src/config/config";

let home: string;

beforeEach(() => {
  home = join(tmpdir(), `omt-test-config-${Date.now()}-${Math.random()}`);
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const toml = `
[extensions.mysql.connections.iot-test]
environment = "test"
host = "mysql-test.company.internal"
port = 3306
database = "iot"
username = "iot_readonly"
secret = "mysql:iot-test"
tls = true

[extensions.mysql.connections.prod]
environment = "prod"
host = "mysql-prod.company.internal"
port = 3306
database = "iot"
username = "iot_readonly"
secret = "mysql:prod"
tls = true
`;

describe("config", () => {
  test("loads connections from config.toml", () => {
    writeFileSync(join(home, "config.toml"), toml, "utf8");
    const cfg = loadConfig(home);
    expect(listConnections(cfg, "mysql")).toEqual(["iot-test", "prod"]);
  });

  test("getConnectionConfig returns a typed connection", () => {
    writeFileSync(join(home, "config.toml"), toml, "utf8");
    const cfg = loadConfig(home);
    const c = getConnectionConfig(cfg, "mysql", "iot-test");
    expect(c).toBeDefined();
    expect(c!.host).toBe("mysql-test.company.internal");
    expect(c!.database).toBe("iot");
    expect(c!.secret).toBe("mysql:iot-test");
  });

  test("unknown connection returns undefined", () => {
    writeFileSync(join(home, "config.toml"), toml, "utf8");
    const cfg = loadConfig(home);
    expect(getConnectionConfig(cfg, "mysql", "nope")).toBeUndefined();
  });

  test("missing config.toml yields empty config", () => {
    const cfg = loadConfig(home);
    expect(listConnections(cfg, "mysql")).toEqual([]);
    expect(getConnectionConfig(cfg, "mysql", "iot-test")).toBeUndefined();
  });

  test("agent-facing secret key is not exposed as a password", () => {
    writeFileSync(join(home, "config.toml"), toml, "utf8");
    const cfg = loadConfig(home);
    const c = getConnectionConfig(cfg, "mysql", "iot-test")!;
    expect(c).not.toHaveProperty("password");
    expect(c).toHaveProperty("secret");
  });
});
