import type { McpServerConfig } from "../../../config/config";
import { RuntimeError } from "../../errors";

export function redactMcpText(message: string, secretValues: readonly string[]): string {
  return secretValues.reduce(
    (result, value) => value.length === 0 ? result : result.split(value).join("[REDACTED]"),
    message,
  );
}

function sdkDetails(cause: unknown, secretValues: readonly string[]): string {
  if (!(cause instanceof Error)) return "unknown MCP error";
  const error = cause as Error & { code?: unknown };
  const code = typeof error.code === "string" ? ` (${error.code})` : "";
  return `${code} ${redactMcpText(cause.message, secretValues)}`.trim();
}

export function configuredMcpValues(config: McpServerConfig): string[] {
  const runtimeConfig = config as unknown as { env?: unknown; headers?: unknown };
  return [runtimeConfig.env, runtimeConfig.headers].flatMap((values) => {
    if (values === null || typeof values !== "object" || Array.isArray(values)) return [];
    return Object.values(values).filter((value): value is string => typeof value === "string");
  });
}

export function mcpConnectionError(
  serverId: string,
  cause: unknown,
  secretValues: readonly string[] = [],
): RuntimeError {
  return new RuntimeError(
    "MCP_CONNECTION_FAILED",
    `MCP server '${serverId}' connection failed: ${sdkDetails(cause, secretValues)}`,
    undefined,
    { cause },
  );
}

export function mcpRequestError(
  serverId: string,
  operation: "tools/list" | "tools/call",
  cause: unknown,
  secretValues: readonly string[] = [],
): RuntimeError {
  const code = operation === "tools/list" ? "MCP_LIST_TOOLS_FAILED" : "MCP_CALL_FAILED";
  return new RuntimeError(
    code,
    `MCP server '${serverId}' ${operation} failed: ${sdkDetails(cause, secretValues)}`,
    undefined,
    { cause },
  );
}

export function normalizeMcpError(
  serverId: string,
  cause: unknown,
  secretValues: readonly string[] = [],
): RuntimeError {
  if (!(cause instanceof RuntimeError)) return mcpConnectionError(serverId, cause, secretValues);
  const message = redactMcpText(cause.message, secretValues);
  if (message === cause.message) return cause;
  return new RuntimeError(cause.code, message, cause.details, { cause: cause.cause ?? cause });
}
