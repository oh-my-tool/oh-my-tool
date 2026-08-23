import type { Logger, SecretStore } from "@oh-my-tool/sdk";
import type { ToolDescriptor, ToolProvider } from "./provider";
import type { ExecutionContext } from "./provider";
import type { ExecutionResult } from "./result";
import { validateInput } from "./schema";

export interface PolicyPreflight {
  preflight(descriptor: ToolDescriptor, input: Record<string, unknown>): void | Promise<void>;
}

export type CreateExecutionContext = (
  descriptor: ToolDescriptor,
  input: Record<string, unknown>,
) => ExecutionContext | Promise<ExecutionContext>;

export interface RuntimeExecutionDeps {
  descriptor: ToolDescriptor;
  provider: ToolProvider;
  policy: PolicyPreflight;
  createExecutionContext: CreateExecutionContext;
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const emptySecrets: SecretStore = {
  async get() { return undefined; },
  async set() {},
  async delete() {},
};

export async function executeRuntimeTool(
  deps: RuntimeExecutionDeps,
  rawInput: Record<string, unknown>,
): Promise<ExecutionResult> {
  try {
    const input = validateInput(deps.descriptor.inputSchema as any, rawInput, {
      applyDefaults: deps.descriptor.provider.kind !== "mcp",
    });
    await deps.policy.preflight(deps.descriptor, input);
    const context = await deps.createExecutionContext(deps.descriptor, input);
    const result = await deps.provider.execute(deps.descriptor.id, input, context);
    return {
      ok: true,
      toolId: deps.descriptor.id,
      output: result.data,
      meta: result.meta ?? {},
    };
  } catch (error) {
    const typed = error as { code?: string; message?: string };
    return {
      ok: false,
      toolId: deps.descriptor.id,
      error: {
        code: typed.code ?? "EXECUTION_FAILED",
        message: typed.message ?? String(error),
        ...("details" in (typed as object) && (typed as { details?: unknown }).details !== undefined
          ? { details: (typed as { details: unknown }).details }
          : {}),
      },
    };
  }
}

export function defaultExecutionContext(): ExecutionContext {
  return { logger: noopLogger, config: {}, secrets: emptySecrets };
}
