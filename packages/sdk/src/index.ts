export const OMT_API_VERSION = "0.1.0";

export interface ToolManifest {
  name: string;
  description: string;
  keywords?: string[];
  risk?: "read" | "write" | "admin";
  inputSchema?: Record<string, unknown>;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  sdkVersion: string;
  description: string;
  keywords?: string[];
  entry?: string;
  tools: ToolManifest[];
}

export interface ToolContext {
  toolName: string;
  logger: Logger;
  config: Record<string, unknown>;
  secrets: SecretStore;
}

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface SecretStore {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export interface ToolResult {
  data: unknown;
  meta?: Record<string, unknown>;
}

export type ToolHandler = (
  ctx: ToolContext,
  input: unknown,
) => Promise<ToolResult>;

export interface ExtensionDefinition {
  handlers: Record<string, ToolHandler>;
}

export function defineExtension(ext: ExtensionDefinition): ExtensionDefinition {
  return ext;
}

export class ToolError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}