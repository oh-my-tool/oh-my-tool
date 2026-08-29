import type { ExecutionResult } from "../runtime/result";

export type OutputFormat = "text" | "json" | "table" | "csv";

export function formatAiResult(result: ExecutionResult): string {
  const lines = [`status: ${result.ok ? "ok" : "error"}`, `tool: ${result.toolId}`];
  if (!result.ok) {
    lines.push("error:");
    appendObject(lines, result.error, 2);
    return lines.join("\n");
  }

  if (isRowsResult(result.output)) {
    lines.push("rows:");
    for (const row of result.output.rows) lines.push(formatRow(row));
    lines.push(`row_count: ${result.output.rows.length}`);
    if (result.output.truncated === true) lines.push("truncated: true");
    appendMeta(lines, result.meta, new Set(["returnedRows"]), false);
  } else {
    lines.push("data:");
    appendValue(lines, result.output, 2);
    appendMeta(lines, result.meta);
  }
  return lines.join("\n");
}

export function formatJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, entry) => {
    if (typeof entry === "bigint") return String(entry);
    if (entry !== null && typeof entry === "object") {
      if (seen.has(entry)) return "[Circular]";
      seen.add(entry);
    }
    return entry;
  }, 2) ?? "null";
}

export function formatOutput(result: ExecutionResult, format: OutputFormat): string {
  if (format === "json") return formatJson(result);
  if (format === "csv" || format === "table") return formatDelimited(result, format === "csv" ? "," : "\t");
  return formatAiResult(result);
}

function formatDelimited(result: ExecutionResult, delimiter: string): string {
  if (!result.ok) return formatAiResult(result);
  const rows = isRowsResult(result.output)
    ? { columns: result.output.columns, rows: result.output.rows }
    : findObjectArray(result.output);
  if (!rows) return formatAiResult(result);
  return [rows.columns, ...rows.rows].map((row) => row.map((value) => quoteDelimited(value, delimiter)).join(delimiter)).join("\n");
}

function findObjectArray(value: unknown): { columns: unknown[]; rows: unknown[][] } | undefined {
  if (!isRecord(value)) return undefined;
  for (const entry of Object.values(value)) {
    if (!Array.isArray(entry) || !entry.every(isRecord)) continue;
    const columns = [...new Set(entry.flatMap((item) => Object.keys(item)))];
    return { columns, rows: entry.map((item) => columns.map((column) => item[column] ?? null)) };
  }
  return undefined;
}

function quoteDelimited(value: unknown, delimiter: string): string {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : formatInline(value);
  return delimiter === "," && /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

interface RowsResult {
  columns: unknown[];
  rows: unknown[][];
  truncated?: boolean;
}

function isRowsResult(value: unknown): value is RowsResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { columns?: unknown; rows?: unknown };
  return Array.isArray(candidate.columns) && Array.isArray(candidate.rows) && candidate.rows.every(Array.isArray);
}

function appendMeta(
  lines: string[],
  meta: Record<string, unknown> | undefined,
  skip = new Set<string>(),
  grouped = true,
): void {
  const entries = Object.entries(meta ?? {}).filter(([key]) => !skip.has(key));
  if (entries.length === 0) return;
  if (grouped) lines.push("meta:");
  for (const [key, value] of entries) appendField(lines, key, value, grouped ? 2 : 0);
}

function appendValue(lines: string[], value: unknown, indent: number): void {
  if (isRecord(value)) {
    appendObject(lines, value, indent);
    return;
  }
  lines.push(`${spaces(indent)}${formatInline(value)}`);
}

function appendObject(lines: string[], value: Record<string, unknown>, indent: number): void {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    lines.push(`${spaces(indent)}{}`);
    return;
  }
  for (const [key, entry] of entries) appendField(lines, key, entry, indent);
}

function appendField(lines: string[], key: string, value: unknown, indent: number): void {
  const prefix = `${spaces(indent)}${key}:`;
  if (isRecord(value)) {
    lines.push(prefix);
    appendObject(lines, value, indent + 2);
    return;
  }
  if (Array.isArray(value) && value.every(isRecord)) {
    lines.push(prefix);
    if (value.length === 0) {
      lines.push(`${spaces(indent + 2)}[]`);
      return;
    }
    for (const item of value) {
      const entries = Object.entries(item);
      if (entries.length === 0) {
        lines.push(`${spaces(indent + 2)}- {}`);
        continue;
      }
      const [firstKey, firstValue] = entries[0];
      if (isRecord(firstValue)) {
        lines.push(`${spaces(indent + 2)}- ${firstKey}:`);
        appendObject(lines, firstValue, indent + 4);
      } else {
        lines.push(`${spaces(indent + 2)}- ${firstKey}: ${formatInline(firstValue)}`);
      }
      for (const [itemKey, itemValue] of entries.slice(1)) appendField(lines, itemKey, itemValue, indent + 4);
    }
    return;
  }
  lines.push(`${prefix} ${formatInline(value)}`);
}

function formatRow(row: unknown[], header = false): string {
  return `[${row.map((value) => header && typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)
    ? value
    : formatInline(value)).join(", ")}]`;
}

function formatInline(value: unknown): string {
  if (value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value);
  if (value !== null && typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function spaces(count: number): string {
  return " ".repeat(count);
}
