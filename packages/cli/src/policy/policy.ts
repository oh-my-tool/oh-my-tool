import type { Config } from "../config/config";
import { getConnectionConfig } from "../config/config";

export class PolicyError extends Error {
  readonly code = "POLICY_VIOLATION";
}

const FORBIDDEN = /(?:^|[^a-z_])(insert|update|delete|drop|alter|create|truncate|rename|grant|revoke|replace|call|set|commit|rollback|load\s+data|lock\s+tables|unlock\s+tables|create\s+database|drop\s+database)(?:[^a-z_]|$)/i;

function stripLiteralsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    // line comments
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "#") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    // block comments
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // string literals
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < n) {
        if (sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function countStatements(sql: string): number {
  const cleaned = stripLiteralsAndComments(sql);
  const parts = cleaned
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length;
}

export function assertReadOnly(sql: string): void {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    throw new PolicyError("sql must be a non-empty string");
  }
  if (countStatements(sql) > 1) {
    throw new PolicyError("only a single read-only statement is allowed");
  }
  const cleaned = stripLiteralsAndComments(sql);
  if (FORBIDDEN.test(cleaned)) {
    throw new PolicyError("sql contains a non read-only statement");
  }
}

const FORBIDDEN_INPUT = new Set([
  "host",
  "username",
  "password",
  "port",
  "database",
  "secret",
  "tls",
]);

export function validateConnectionInput(
  input: Record<string, unknown>,
  config: Config,
  extensionId: string,
): void {
  for (const key of FORBIDDEN_INPUT) {
    if (key in input && input[key] !== undefined && input[key] !== null) {
      throw new PolicyError(`agent input must not contain '${key}'`);
    }
  }
  const connection = input["connection"];
  if (typeof connection !== "string" || connection.length === 0) {
    throw new PolicyError("input must specify a configured 'connection' name");
  }
  if (!getConnectionConfig(config, extensionId, connection)) {
    throw new PolicyError(`unknown connection '${connection}' for extension '${extensionId}'`);
  }
}

export interface Limits {
  maxRows: number;
  timeoutMs: number;
}

export const DEFAULT_MAX_ROWS = 100;
export const MAX_MAX_ROWS = 1000;
export const DEFAULT_TIMEOUT_MS = 5000;
export const MAX_TIMEOUT_MS = 30000;

export function applyLimits(input: Record<string, unknown>): Limits {
  const maxRows = clamp(
    typeof input.maxRows === "number" ? input.maxRows : DEFAULT_MAX_ROWS,
    1,
    MAX_MAX_ROWS,
  );
  const timeoutMs = clamp(
    typeof input.timeoutMs === "number" ? input.timeoutMs : DEFAULT_TIMEOUT_MS,
    1,
    MAX_TIMEOUT_MS,
  );
  return { maxRows, timeoutMs };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

