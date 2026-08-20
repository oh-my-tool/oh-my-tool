import { describe, expect, test } from "bun:test";
import { defineExtension, OMT_API_VERSION } from "../src/index";

describe("OMT_API_VERSION", () => {
  test("is a non-empty semver string", () => {
    expect(typeof OMT_API_VERSION).toBe("string");
    expect(OMT_API_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("defineExtension", () => {
  test("returns the definition unchanged (no magic)", () => {
    const def = {
      handlers: {
        "mysql.query": async () => ({ data: [] }),
      },
    };
    expect(defineExtension(def)).toBe(def);
  });

  test("preserves multiple handlers", () => {
    const def = {
      handlers: {
        "mysql.query": async () => ({ data: [] }),
        "mysql.schema": async () => ({ data: [] }),
      },
    };
    const out = defineExtension(def);
    expect(Object.keys(out.handlers)).toEqual(["mysql.query", "mysql.schema"]);
  });
});