import { describe, expect, test } from "bun:test";
import { parseArgs, coerceInput } from "../src/cli/parseArgs";

describe("parseArgs", () => {
  test("splits key=value, flags and positionals", () => {
    const a = parseArgs(["call", "mysql.query", "connection=iot-test", "sql=SELECT 1", "--stdin"]);
    expect(a.positional).toEqual(["call", "mysql.query"]);
    expect(a.keyValues).toEqual({ connection: "iot-test", sql: "SELECT 1" });
    expect(a.flags).toEqual(["stdin"]);
  });

  test("handles no key values", () => {
    const a = parseArgs(["list"]);
    expect(a.positional).toEqual(["list"]);
    expect(a.keyValues).toEqual({});
  });

  test("parses long options with values", () => {
    const a = parseArgs(["integrate", "--agents=codex,omp", "--yes", "--force"]);
    expect(a.options).toEqual({ agents: "codex,omp" });
    expect(a.flags).toEqual(["yes", "force"]);
  });
});

describe("coerceInput", () => {
  test("coerces numeric strings to numbers and keeps strings", () => {
    const out = coerceInput({ maxRows: "50", sql: "SELECT 1", timeoutMs: "3000" });
    expect(out.maxRows).toBe(50);
    expect(out.timeoutMs).toBe(3000);
    expect(out.sql).toBe("SELECT 1");
  });

  test("leaves booleans and arrays as-is", () => {
    const out = coerceInput({ tls: "true", params: [1, 2] });
    expect(out.tls).toBe("true");
    expect(out.params).toEqual([1, 2]);
  });
});
