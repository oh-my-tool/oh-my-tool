import { describe, expect, test } from "bun:test";
import { searchTools } from "../src/search/search";

const manifests = [
  {
    id: "mysql",
    name: "MySQL",
    version: "0.1.0",
    description: "Query and inspect MySQL databases",
    keywords: ["mysql", "sql", "数据库", "查数据"],
    tools: [
      {
        name: "mysql.query",
        description: "Execute a read-only SQL query",
        keywords: ["query", "select", "查询", "查数据库"],
        risk: "read",
      },
      {
        name: "mysql.schema",
        description: "Inspect tables and columns",
        keywords: ["schema", "table", "表结构"],
        risk: "read",
      },
    ],
  },
  {
    id: "redis",
    name: "Redis",
    version: "0.1.0",
    description: "Redis key operations",
    keywords: ["redis", "cache"],
    tools: [
      {
        name: "redis.get",
        description: "Get a key value",
        keywords: ["get", "key", "缓存"],
        risk: "read",
      },
    ],
  },
];

describe("searchTools", () => {
  test("returns matching tools ranked by score", () => {
    const results = searchTools("查询 mysql 设备数据", manifests);
    expect(results.length).toBeGreaterThan(0);
    const top = results[0];
    expect(top.name).toBe("mysql.query");
    expect(top.extension).toBe("mysql");
    expect(top.score).toBeGreaterThan(0);
  });

  test("mysql.query outranks mysql.schema for a query intent", () => {
    const results = searchTools("查询 mysql 数据表", manifests);
    const q = results.find((r) => r.name === "mysql.query");
    const s = results.find((r) => r.name === "mysql.schema");
    expect(q!.score).toBeGreaterThan(s!.score);
  });

  test("returns tools from the right extension", () => {
    const results = searchTools("redis 缓存", manifests);
    expect(results.some((r) => r.extension === "redis")).toBe(true);
    expect(results.every((r) => r.extension === "redis")).toBe(true);
  });

  test("empty or irrelevant query returns no tools", () => {
    const results = searchTools("", manifests);
    expect(results).toHaveLength(0);
    const irrelevant = searchTools("zzzzyyyyqqqq", manifests);
    expect(irrelevant).toHaveLength(0);
  });

  test("results do not include inputSchema", () => {
    const results = searchTools("查询", manifests);
    for (const r of results) {
      expect(r).not.toHaveProperty("inputSchema");
    }
  });
});

