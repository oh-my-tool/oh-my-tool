import { describe, expect, test } from "bun:test";
import { validateInput } from "../src/core/schema";
import { OmtError } from "../src/core/registry";

const schema = {
  type: "object",
  required: ["connection", "sql"],
  properties: {
    connection: { type: "string" },
    sql: { type: "string" },
    maxRows: { type: "integer", default: 100, maximum: 1000 },
    timeoutMs: { type: "integer", default: 5000, maximum: 30000 },
  },
};

describe("validateInput", () => {
  test("passes valid input and applies defaults", () => {
    const out = validateInput(schema, { connection: "iot-test", sql: "SELECT 1" });
    expect(out.maxRows).toBe(100);
    expect(out.timeoutMs).toBe(5000);
  });

  test("preserves provided values within bounds", () => {
    const out = validateInput(schema, { connection: "iot-test", sql: "SELECT 1", maxRows: 5 });
    expect(out.maxRows).toBe(5);
  });

  test("rejects missing required field", () => {
    expect(() => validateInput(schema, { sql: "SELECT 1" })).toThrow(OmtError);
  });

  test("rejects wrong type", () => {
    expect(() =>
      validateInput(schema, { connection: 123, sql: "SELECT 1" }),
    ).toThrow(/connection/i);
  });

  test("rejects value exceeding maximum", () => {
    expect(() =>
      validateInput(schema, { connection: "c", sql: "SELECT 1", maxRows: 99999 }),
    ).toThrow(/maxRows/i);
  });

  test("returns empty object when no schema given", () => {
    expect(validateInput(undefined, { x: 1 })).toEqual({ x: 1 });
  });
});
