import { describe, expect, test } from "bun:test";
import {
  assertReadOnly,
  validateConnectionInput,
  applyLimits,
  PolicyError,
} from "../src/policy/policy";
import type { Config } from "../src/config/config";

const config: Config = {
  mcp: { servers: {} },
  extensions: {
    mysql: {
      connections: {
        "iot-test": {
          environment: "test",
          settings: { host: "h", port: 3306, database: "iot", username: "u", tls: true },
          secrets: { password: "mysql:iot-test" },
        },
      },
    },
  },
};

describe("assertReadOnly", () => {
  test("allows a plain SELECT", () => {
    expect(() => assertReadOnly("SELECT id FROM device")).not.toThrow();
  });

  test("allows EXPLAIN / SHOW / WITH", () => {
    expect(() => assertReadOnly("EXPLAIN SELECT * FROM device")).not.toThrow();
    expect(() => assertReadOnly("SHOW TABLES")).not.toThrow();
    expect(() => assertReadOnly("WITH t AS (SELECT 1) SELECT * FROM t")).not.toThrow();
  });

  test("rejects DELETE", () => {
    expect(() => assertReadOnly("DELETE FROM device WHERE id=1")).toThrow(PolicyError);
  });

  test("rejects INSERT / UPDATE / DROP / ALTER", () => {
    for (const sql of [
      "INSERT INTO device VALUES (1)",
      "UPDATE device SET status='x'",
      "DROP TABLE device",
      "ALTER TABLE device ADD COLUMN x INT",
      "CREATE TABLE t (id INT)",
      "TRUNCATE TABLE device",
    ]) {
      expect(() => assertReadOnly(sql), sql).toThrow(PolicyError);
    }
  });

  test("allows forbidden words that only appear inside string literals", () => {
    expect(() => assertReadOnly("SELECT * FROM log WHERE msg = 'DELETE FROM x'")).not.toThrow();
  });

  test("rejects multiple statements", () => {
    expect(() => assertReadOnly("SELECT 1; SELECT 2")).toThrow(PolicyError);
  });

  test("rejects non-read statement heads and locking reads", () => {
    for (const sql of ["USE app", "ANALYZE TABLE device", "SELECT * FROM device FOR UPDATE", "SELECT * INTO OUTFILE '/tmp/x' FROM device"]) {
      expect(() => assertReadOnly(sql), sql).toThrow(PolicyError);
    }
  });
});

describe("validateConnectionInput", () => {
  test("accepts a known connection name", () => {
    expect(() => validateConnectionInput({ connection: "iot-test" }, config, "mysql")).not.toThrow();
  });

  test("rejects an unknown connection", () => {
    expect(() => validateConnectionInput({ connection: "nope" }, config, "mysql")).toThrow(PolicyError);
  });

  test("rejects missing connection", () => {
    expect(() => validateConnectionInput({}, config, "mysql")).toThrow(PolicyError);
  });

  test("rejects agent-supplied host", () => {
    expect(() =>
      validateConnectionInput({ connection: "iot-test", host: "10.0.0.1" }, config, "mysql"),
    ).toThrow(/host/i);
  });

  test("rejects agent-supplied password", () => {
    expect(() =>
      validateConnectionInput({ connection: "iot-test", password: "x" }, config, "mysql"),
    ).toThrow(/password/i);
  });

  test("rejects agent-supplied generic connection records", () => {
    for (const key of ["settings", "secrets"]) {
      expect(() => validateConnectionInput({ connection: "iot-test", [key]: {} }, config, "mysql")).toThrow(key);
    }
  });
});

describe("applyLimits", () => {
  test("applies defaults when absent", () => {
    const out = applyLimits({});
    expect(out.maxRows).toBe(100);
    expect(out.timeoutMs).toBe(5000);
  });

  test("caps maxRows and timeoutMs", () => {
    const out = applyLimits({ maxRows: 5000, timeoutMs: 60000 });
    expect(out.maxRows).toBe(1000);
    expect(out.timeoutMs).toBe(30000);
  });

  test("preserves values within bounds", () => {
    const out = applyLimits({ maxRows: 50, timeoutMs: 3000 });
    expect(out.maxRows).toBe(50);
    expect(out.timeoutMs).toBe(3000);
  });
});
