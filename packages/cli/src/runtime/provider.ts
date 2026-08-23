import type { SecretStore, Logger } from "@oh-my-tool/sdk";
import type { ToolResult } from "./result";

export interface ToolDescriptor {
  id: string;
  description: string;
  keywords?: string[];
  risk: "read" | "write" | "admin";
  inputSchema?: Record<string, unknown>;
  provider: { id: string; kind: string };
  source: { id: string; kind: string };
}

export type ToolSearchResult = Omit<ToolDescriptor, "inputSchema">;

export interface ExecutionContext {
  logger: Logger;
  config: Record<string, unknown>;
  secrets: SecretStore;
}

export interface ToolProvider {
  readonly id: string;
  readonly kind: string;
  listTools(): Promise<readonly ToolDescriptor[]>;
  execute(toolId: string, input: unknown, context: ExecutionContext): Promise<ToolResult>;
  close?(): Promise<void>;
}

export type { ToolResult } from "./result";
