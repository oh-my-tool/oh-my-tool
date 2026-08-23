import type {
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type { SecretStore } from "@oh-my-tool/sdk";
import { RuntimeError } from "../../errors";

export interface McpOAuthStore {
  tokens(): Promise<StoredOAuthTokens | undefined>;
  saveTokens(tokens: StoredOAuthTokens): Promise<void>;
  clientInformation(): Promise<StoredOAuthClientInformation | undefined>;
  saveClientInformation(info: StoredOAuthClientInformation): Promise<void>;
  codeVerifier(): Promise<string | undefined>;
  saveCodeVerifier(value: string): Promise<void>;
  discoveryState(): Promise<OAuthDiscoveryState | undefined>;
  saveDiscoveryState(value: OAuthDiscoveryState): Promise<void>;
  clearVerifier(): Promise<void>;
  clearAll(): Promise<void>;
}

type CredentialScope = "tokens" | "client" | "verifier" | "discovery";

function credentialNames(serverId: string): Record<CredentialScope, string> {
  const prefix = `mcp:${serverId}:oauth`;
  return {
    tokens: `${prefix}:tokens`,
    client: `${prefix}:client`,
    verifier: `${prefix}:verifier`,
    discovery: `${prefix}:discovery`,
  };
}

export class SecretMcpOAuthStore implements McpOAuthStore {
  private readonly names: Record<CredentialScope, string>;

  constructor(
    private readonly serverId: string,
    private readonly secrets: SecretStore,
  ) {
    this.names = credentialNames(serverId);
  }

  private async object<T extends object>(scope: CredentialScope): Promise<T | undefined> {
    const stored = await this.secrets.get(this.names[scope]);
    if (stored === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(stored);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      return parsed as T;
    } catch {
      throw new RuntimeError(
        "MCP_OAUTH_CREDENTIALS_INVALID",
        `Stored OAuth ${scope} credentials for MCP server '${this.serverId}' are invalid`,
      );
    }
  }

  tokens(): Promise<StoredOAuthTokens | undefined> {
    return this.object<StoredOAuthTokens>("tokens");
  }

  saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    return this.secrets.set(this.names.tokens, JSON.stringify(tokens));
  }

  clientInformation(): Promise<StoredOAuthClientInformation | undefined> {
    return this.object<StoredOAuthClientInformation>("client");
  }

  saveClientInformation(info: StoredOAuthClientInformation): Promise<void> {
    return this.secrets.set(this.names.client, JSON.stringify(info));
  }

  codeVerifier(): Promise<string | undefined> {
    return this.secrets.get(this.names.verifier);
  }

  saveCodeVerifier(value: string): Promise<void> {
    return this.secrets.set(this.names.verifier, value);
  }

  discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return this.object<OAuthDiscoveryState>("discovery");
  }

  saveDiscoveryState(value: OAuthDiscoveryState): Promise<void> {
    return this.secrets.set(this.names.discovery, JSON.stringify(value));
  }

  clear(scope: CredentialScope): Promise<void> {
    return this.secrets.delete(this.names[scope]);
  }

  clearVerifier(): Promise<void> {
    return this.clear("verifier");
  }

  async clearAll(): Promise<void> {
    await Promise.all(Object.values(this.names).map((name) => this.secrets.delete(name)));
  }
}

export function createMcpOAuthStore(serverId: string, secrets: SecretStore): SecretMcpOAuthStore {
  return new SecretMcpOAuthStore(serverId, secrets);
}
