import type { ExecutionContext, ProviderStatus, ToolDescriptor, ToolProvider, ToolSearchOptions, ToolSearchResult } from "./provider";
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
  private closePromise?: Promise<void>;
  private readonly discovery = new Map<string, Promise<void>>();
  private readonly statuses = new Map<string, ProviderStatus>();
  private readonly closedProviders = new Set<string>();

  constructor(private readonly state: RuntimeState, private readonly registeredProviders: readonly ToolProvider[] = []) {}

  async search(query: string, options?: ToolSearchOptions): Promise<ToolSearchResult[]> {
    await this.discoverAll();
    return this.state.tools.search(query, options);
  }

  async describe(toolId: string): Promise<ToolDescriptor> {
    await this.discoverForTarget(toolId);
    const descriptor = this.state.tools.get(toolId);
    if (!descriptor) throw this.targetError(toolId);
    return descriptor;
  }

  async run(toolId: string, input: unknown): Promise<ExecutionResult> {
    await this.discoverForTarget(toolId);
    const descriptor = this.state.tools.get(toolId);
    if (!descriptor) {
      const error = this.targetError(toolId);
      return { ok: false, toolId, error: { code: error.code, message: error.message } };
    }
    const provider = this.state.providers.require(descriptor.provider.id);
    return executeRuntimeTool({
      descriptor,
      provider,
      policy: this.state.policy,
      createExecutionContext: this.state.createExecutionContext,
    }, (input ?? {}) as Record<string, unknown>);
  }

  providerStatuses(): readonly ProviderStatus[] {
    return [...this.statuses.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      const errors: unknown[] = [];
      for (const provider of [...this.registeredProviders].reverse()) {
        try { await this.closeProvider(provider); } catch (error) { errors.push(error); }
      }
      if (errors.length > 0) throw errors[0];
    })();
    return this.closePromise;
  }

  private async discoverAll(): Promise<void> {
    await Promise.all(this.registeredProviders.map((provider) => this.discoverProvider(provider)));
  }

  private async discoverForTarget(toolId: string): Promise<void> {
    const nativeProviders = this.registeredProviders.filter((provider) => provider.kind === "native");
    await Promise.all(nativeProviders.map((provider) => this.discoverProvider(provider)));
    if (this.state.tools.get(toolId)) return;
    await Promise.all(this.registeredProviders
      .filter((provider) => provider.kind !== "native")
      .map((provider) => this.discoverProvider(provider)));
  }

  private discoverProvider(provider: ToolProvider): Promise<void> {
    const current = this.discovery.get(provider.id);
    if (current) return current;
    const promise = this.discoverProviderOnce(provider);
    this.discovery.set(provider.id, promise);
    return promise;
  }

  private async discoverProviderOnce(provider: ToolProvider): Promise<void> {
    try {
      const descriptors = await provider.listTools();
      for (const descriptor of descriptors) {
        if (descriptor.provider.id !== provider.id || descriptor.provider.kind !== provider.kind) {
          throw new RuntimeError(
            "PROVIDER_DESCRIPTOR_MISMATCH",
            `tool '${descriptor.id}' does not identify provider '${provider.id}/${provider.kind}'`,
          );
        }
      }
      this.state.tools.register(descriptors);
      this.statuses.set(provider.id, {
        id: provider.id,
        kind: provider.kind,
        status: "available",
        ...("namespace" in provider && typeof provider.namespace === "string" ? { namespace: provider.namespace } : {}),
      });
    } catch (error) {
      if (provider.kind !== "mcp") throw error;
      const typed = error as { code?: unknown; message?: unknown };
      this.statuses.set(provider.id, {
        id: provider.id,
        kind: provider.kind,
        status: "unavailable",
        ...("namespace" in provider && typeof provider.namespace === "string" ? { namespace: provider.namespace } : {}),
        code: typeof typed.code === "string" ? typed.code : "PROVIDER_UNAVAILABLE",
        message: typeof typed.message === "string" ? typed.message : "provider discovery failed",
      });
      try { await this.closeProvider(provider); } catch { /* preserve discovery status */ }
    }
  }

  private targetError(toolId: string): RuntimeError {
    const unavailable = this.providerStatuses().find((status) =>
      status.status === "unavailable" && status.namespace !== undefined && toolId.startsWith(`${status.namespace}.`));
    if (unavailable) return new RuntimeError("PROVIDER_UNAVAILABLE", `provider '${unavailable.id}' is unavailable`);
    return new RuntimeError("TOOL_NOT_FOUND", `unknown tool '${toolId}'`);
  }

  private async closeProvider(provider: ToolProvider): Promise<void> {
    if (!provider.close || this.closedProviders.has(provider.id)) return;
    this.closedProviders.add(provider.id);
    await provider.close();
  }
}

export async function createToolRuntime(options: ToolRuntimeOptions): Promise<ToolRuntime> {
  const providers = new ProviderRegistry();
  const tools = new ToolRegistry();
  for (const provider of options.providers) providers.register(provider);
  return new ToolRuntime({
    providers,
    tools,
    policy: options.policy,
    createExecutionContext: options.createExecutionContext,
  }, options.providers);
}
