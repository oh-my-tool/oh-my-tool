import { describe, expect, test } from "bun:test";
import type { ExecutionOk } from "../src/runtime/result";

describe("AI-friendly CLI output", () => {
  test("renders mysql rows without a separate column-name row", async () => {
    const module = await import("../src/cli/output").catch(() => ({ formatAiResult: undefined }));
    expect(typeof module.formatAiResult).toBe("function");
    if (typeof module.formatAiResult !== "function") return;

    const output = module.formatAiResult({
      ok: true,
      toolId: "mysql.query",
      output: { columns: ["id", "name", "age"], rows: [[1, "Alice", 18], [2, "Bob", 20]] },
      meta: { returnedRows: 2, connection: "iot-test" },
    } satisfies ExecutionOk);

    expect(output).toBe([
      "status: ok",
      "tool: mysql.query",
      "rows:",
      "[1, \"Alice\", 18]",
      "[2, \"Bob\", 20]",
      "row_count: 2",
      "connection: \"iot-test\"",
    ].join("\n"));
  });

  test("renders generic successful results without formatted JSON", async () => {
    const module = await import("../src/cli/output").catch(() => ({ formatAiResult: undefined }));
    expect(typeof module.formatAiResult).toBe("function");
    if (typeof module.formatAiResult !== "function") return;

    const output = module.formatAiResult({
      ok: true,
      toolId: "redis.instances",
      output: { instances: [{ name: "iot-test", host: "redis.local" }], count: 1 },
      meta: { connectionType: "redis" },
    } satisfies ExecutionOk);

    expect(output).toContain("status: ok");
    expect(output).toContain("instances:");
    expect(output).toContain("- name: \"iot-test\"");
    expect(output).not.toContain('"instances":');
  });

  test("renders an empty object inside a generic array without throwing", async () => {
    const output = (await import("../src/cli/output")).formatAiResult({
      ok: true,
      toolId: "test.result",
      output: { items: [{}] },
      meta: {},
    });

    expect(output).toContain("items:");
    expect(output).toContain("- {}");
  });

  test("serializes BigInt safely for JSON output", async () => {
    const module = await import("../src/cli/output");
    expect(module.formatJson({ value: 1n })).toBe('{\n  "value": "1"\n}');
  });

  test("renders row results as CSV", async () => {
    const module = await import("../src/cli/output");
    expect(module.formatOutput({
      ok: true,
      toolId: "mysql.query",
      output: { columns: ["id", "name"], rows: [[1, "Alice"]] },
      meta: {},
    }, "csv")).toBe("id,name\n1,Alice");
  });
});
