import type { Logger, SecretStore, ToolContext, ToolResult } from "@oh-my-tool/sdk";
import { ToolError } from "@oh-my-tool/sdk";
import type { Config } from "../config/config";
import { getConnectionConfig } from "../config/config";
import { resolveTool, OmtError, type Registry } from "./registry";
import { validateInput, type Schema } from "./schema";
import { validateConnectionInput, applyLimits, PolicyError } from "../policy/policy";
import { loadExtension } from "../extension/loader";
import type { OmtResult } from "./result";

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface ExecutorDeps {
  registry: Registry;
  config: Config;
  secrets: SecretStore;
  logger?: Logger;
}

function hasConnection(schema: Schema | undefined): boolean {
  return Boolean(schema?.properties && "connection" in schema.properties);
}

export async function executeTool(
  deps: ExecutorDeps,
  toolName: string,
  rawInput: Record<string, unknown>,
): Promise<OmtResult> {
  const started = Date.now();
  try {
    const { extension, tool } = resolveTool(deps.registry, toolName);
    const schema = tool.inputSchema as Schema | undefined;

    const limits = applyLimits(rawInput);
    const normalized = { ...rawInput, maxRows: limits.maxRows, timeoutMs: limits.timeoutMs };

    const needsConnection = hasConnection(schema) || "connection" in normalized;
    if (needsConnection) {
      validateConnectionInput(normalized, deps.config, extension.id);
    }

    const input = validateInput(schema, normalized);

    const connectionCfg = needsConnection
      ? getConnectionConfig(deps.config, extension.id, String(input.connection))
      : undefined;

    const ctx: ToolContext = {
      toolName,
      logger: deps.logger ?? noopLogger,
      config: (connectionCfg ?? {}) as Record<string, unknown>,
      secrets: deps.secrets,
    };

    const def = await loadExtension(extension);
    const handler = def.handlers[toolName];
    if (!handler) {
      throw new OmtError("HANDLER_MISSING", `no handler for ${toolName}`);
    }

    const result: ToolResult = await handler(ctx, input);
    const durationMs = Date.now() - started;
    return {
      ok: true,
      tool: toolName,
      data: result.data,
      meta: { durationMs, ...(result.meta ?? {}) },
    };
  } catch (e) {
    const durationMs = Date.now() - started;
    if (e instanceof PolicyError) {
      return { ok: false, tool: toolName, error: { code: "POLICY_VIOLATION", message: e.message } };
    }
    if (e instanceof ToolError) {
      return { ok: false, tool: toolName, error: { code: e.code, message: e.message } };
    }
    if (e instanceof OmtError) {
      return { ok: false, tool: toolName, error: { code: e.code, message: e.message } };
    }
    return {
      ok: false,
      tool: toolName,
      error: { code: "EXECUTION_FAILED", message: e instanceof Error ? e.message : String(e) },
    };
  }
}

