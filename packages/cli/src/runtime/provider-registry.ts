import type { ToolProvider } from "./provider";
import { RuntimeError } from "./errors";

export class ProviderRegistry {
  private readonly providers = new Map<string, ToolProvider>();

  register(provider: ToolProvider): void {
    if (this.providers.has(provider.id)) {
      throw new RuntimeError("DUPLICATE_PROVIDER_ID", `duplicate provider '${provider.id}'`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): ToolProvider | undefined {
    return this.providers.get(id);
  }

  require(id: string): ToolProvider {
    const provider = this.get(id);
    if (!provider) throw new RuntimeError("PROVIDER_NOT_FOUND", `provider '${id}' was not found`);
    return provider;
  }
}
