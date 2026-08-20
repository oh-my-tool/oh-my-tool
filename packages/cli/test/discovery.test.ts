import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { discoverExtensions } from "../src/extension/discovery";
import { createRegistry, resolveTool } from "../src/core/registry";
import { createFakeExtension } from "./helpers";

let home: string;
beforeEach(() => {
  home = join(tmpdir(), `omt-test-disc-${Date.now()}-${Math.random()}`);
  mkdirSync(home, { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("discoverExtensions", () => {
  test("discovers installed extensions with manifests", () => {
    const mysql = createFakeExtension(home, { id: "mysql" });
    const redis = createFakeExtension(home, { id: "redis" });
    const found = discoverExtensions(home);
    expect(found.map((e) => e.id).sort()).toEqual(["mysql", "redis"]);
    expect(found.find((e) => e.id === "mysql")!.entry).toContain("index.ts");
  });

  test("skips directories without a manifest", () => {
    createFakeExtension(home, { id: "mysql" });
    mkdirSync(join(home, "extensions", "not-an-ext", "0.1.0"), { recursive: true });
    const found = discoverExtensions(home);
    expect(found.map((e) => e.id)).toEqual(["mysql"]);
  });

  test("returns empty when no extensions dir exists", () => {
    expect(discoverExtensions(home)).toEqual([]);
  });
});

describe("registry", () => {
  test("maps each tool name to its extension", () => {
    createFakeExtension(home, { id: "mysql", tools: [{ name: "mysql.query", description: "q" }] });
    createFakeExtension(home, {
      id: "redis",
      tools: [{ name: "redis.get", description: "g" }],
    });
    const installed = discoverExtensions(home);
    const reg = createRegistry(installed);
    expect(resolveTool(reg, "mysql.query").extension.id).toBe("mysql");
    expect(resolveTool(reg, "redis.get").extension.id).toBe("redis");
  });

  test("resolveTool throws on unknown tool", () => {
    createFakeExtension(home, { id: "mysql", tools: [{ name: "mysql.query", description: "q" }] });
    const reg = createRegistry(discoverExtensions(home));
    expect(() => resolveTool(reg, "mysql.nope")).toThrow(/unknown tool/i);
  });
});
