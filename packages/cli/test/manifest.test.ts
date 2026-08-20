import { describe, expect, test } from "bun:test";
import { parseManifest, validateManifest, validateHandlers, checkSdkCompatibility } from "../src/extension/manifest";

const validManifest = {
  id: "mysql",
  name: "MySQL",
  version: "0.1.0",
  sdkVersion: "^0.1.0",
  description: "query mysql",
  keywords: ["mysql", "sql"],
  tools: [
    { name: "mysql.query", description: "run a query", risk: "read" },
    { name: "mysql.schema", description: "inspect schema", risk: "read" },
  ],
};

describe("parseManifest", () => {
  test("parses a valid manifest", () => {
    const m = parseManifest(JSON.stringify(validManifest));
    expect(m.id).toBe("mysql");
    expect(m.tools).toHaveLength(2);
  });

  test("throws on missing id", () => {
    const bad = { ...validManifest };
    delete (bad as any).id;
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/id/);
  });

  test("throws on missing tools", () => {
    const bad = { ...validManifest, tools: undefined };
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/tools/);
  });
});

describe("validateManifest", () => {
  test("accepts a well-formed manifest", () => {
    expect(() => validateManifest(validManifest)).not.toThrow();
  });

  test("rejects a manifest without sdkVersion", () => {
    const bad = { ...validManifest } as Record<string, unknown>;
    delete bad.sdkVersion;
    expect(() => validateManifest(bad as any)).toThrow(/sdkVersion/);
  });

  test("rejects duplicate tool names", () => {
    const dup = {
      ...validManifest,
      tools: [
        { name: "mysql.query", description: "a" },
        { name: "mysql.query", description: "b" },
      ],
    };
    expect(() => validateManifest(dup)).toThrow(/duplicate/i);
  });

  test("rejects a tool name not prefixed by extension id", () => {
    const bad = {
      ...validManifest,
      tools: [
        { name: "redis.query", description: "not mysql" },
      ],
    };
    expect(() => validateManifest(bad)).toThrow(/prefix/i);
  });
});

describe("checkSdkCompatibility", () => {
  test("accepts a matching sdk range", () => {
    expect(() => checkSdkCompatibility("^0.1.0")).not.toThrow();
    expect(() => checkSdkCompatibility("0.1.0")).not.toThrow();
  });

  test("rejects an incompatible sdk range", () => {
    expect(() => checkSdkCompatibility("^99.0.0")).toThrow(/requires sdk/);
    expect(() => checkSdkCompatibility("^0.2.0")).toThrow(/requires sdk/);
  });

  test("rejects a non-empty-but-malformed range", () => {
    expect(() => checkSdkCompatibility("not-a-version")).toThrow(/invalid sdkVersion/);
  });

  test("rejects an empty range", () => {
    expect(() => checkSdkCompatibility("")).toThrow(/sdkVersion/);
  });
});

describe("validateHandlers", () => {
  test("passes when manifest tools match runtime handlers exactly", () => {
    expect(() =>
      validateHandlers(validManifest, ["mysql.query", "mysql.schema"]),
    ).not.toThrow();
  });

  test("fails when a manifest tool has no runtime handler", () => {
    expect(() =>
      validateHandlers(validManifest, ["mysql.query"]),
    ).toThrow(/mysql\.schema/);
  });

  test("fails when runtime registers a tool not in the manifest", () => {
    expect(() =>
      validateHandlers(validManifest, ["mysql.query", "mysql.schema", "mysql.dropDatabase"]),
    ).toThrow(/dropDatabase/i);
  });
});