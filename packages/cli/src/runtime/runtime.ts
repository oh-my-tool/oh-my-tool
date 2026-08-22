import type { ExecutionContext, ToolDescriptor, ToolProvider, ToolSearchResult } from "./provider";
import type { ExecutionResult } from "./result";
import { executeRuntimeTool, type CreateExecutionContext, type PolicyPreflight } from "./executor";
import { RuntimeError } from "./errors";
import { ProviderRegistry } from "./provider-registry";
import { ToolRegistry } from "./tool-registry";

export interface ToolRuntimeOptions {
  readonly providers: readonly ToolProvider[];
  readonly policy: PolicyPreflight;
  readonly createExecutionContext: CreateExecutionContext;
}

interface RuntimeState {
  providers: ProviderRegistry;
  tools: ToolRegistry;
  policy: PolicyPreflight;
  createExecutionContext: CreateExecutionContext;
}

export class ToolRuntime {
  constructor(private readonly state: RuntimeState) {}

  search(query: string): Promise<ToolSearchResult[]> {
    return Promise.resolve(this.state.tools.search(query));
  }

  describe(toolId: string): Promise<ToolDescriptor> {
    const descriptor = this.state.tools.get(toolId);
    if (!descriptor) return Promise.reject(new RuntimeError("TOOL_NOT_FOUND", `unknown tool '${toolId}'`));
    return Promise.resolve(descriptor);
  }

  async run(toolId: string, input: unknown): Promise<ExecutionResult> {
    const descriptor = this.state.tools.get(toolId);
    if (!descriptor) {
      return { ok: false, toolId, error: { code: "TOOL_NOT_FOUND", message: `unknown tool '${toolId}'` } };
    }
    const provider = this.state.providers.require(descriptor.provider.id);
    return executeRuntimeTool({
      descriptor,
      provider,
      policy: this.state.policy,
      createExecutionContext: this.state.createExecutionContext,
    }, (input ?? {}) as Record<string, unknown>);
  }
}

export async function createToolRuntime(options: ToolRuntimeOptions): Promise<ToolRuntime> {
  const providers = new ProviderRegistry();
  const tools = new ToolRegistry();
  for (const provider of options.providers) {
    providers.register(provider);
    const descriptors = await provider.listTools();
    for (const descriptor of descriptors) {
      if (descriptor.provider.id !== provider.id || descriptor.provider.kind !== provider.kind) {
        throw new RuntimeError(
          "PROVIDER_DESCRIPTOR_MISMATCH",
          `tool '${descriptor.id}' does not identify provider '${provider.id}/${provider.kind}'`,
        );
      }
    }
    tools.register(descriptors);
  }
  return new ToolRuntime({
    providers,
    tools,
    policy: options.policy,
    createExecutionContext: options.createExecutionContext,
  });
}
