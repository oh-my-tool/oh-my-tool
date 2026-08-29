import type { CallToolResult } from "@modelcontextprotocol/client";
import type { McpEnabledServerConfig } from "../../../config/config";
import type { SecretStore } from "@oh-my-tool/sdk";
import type { ExecutionContext, ToolDescriptor, ToolProvider } from "../../provider";
import type { ToolResult } from "../../result";
import { RuntimeError } from "../../errors";
import { createMcpSession, type McpSession, type McpSessionFactory } from "./session";
import { normalizeMcpTool } from "./normalize";

export interface McpProviderOptions {
  readonly serverId: string;
  readonly config: McpEnabledServerConfig;
  readonly secrets: SecretStore;
  readonly createSession?: McpSessionFactory;
}

export class McpProvider implements ToolProvider {
  readonly id: string;
  readonly kind = "mcp";
  readonly namespace: string;
  private session?: McpSession;
  private descriptors?: readonly ToolDescriptor[];
  private readonly routes = new Map<string, string>();
  private closePromise?: Promise<void>;

  constructor(private readonly options: McpProviderOptions) {
    this.id = `mcp:${options.serverId}`;
    this.namespace = options.config.namespace;
  }

  async listTools(): Promise<readonly ToolDescriptor[]> {
    if (this.descriptors) return this.descriptors;
    if (this.closePromise) await this.closePromise;
    const createSession = this.options.createSession ?? createMcpSession;
    const session = await createSession(this.options.serverId, this.options.config, this.options.secrets);
    try {
      const normalized: ToolDescriptor[] = [];
      const routes = new Map<string, string>();
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await session.listTools(cursor);
        for (const tool of page.tools) {
          const item = normalizeMcpTool(this.options.serverId, this.options.config.namespace, this.id, tool);
          if (routes.has(item.descriptor.id)) {
            throw new RuntimeError("MCP_DUPLICATE_TOOL_ID", `duplicate MCP tool '${item.descriptor.id}'`);
          }
          routes.set(item.descriptor.id, item.remoteName);
          normalized.push(item.descriptor);
        }
        if (page.nextCursor !== undefined) {
          if (seenCursors.has(page.nextCursor) || page.nextCursor === cursor) {
            throw new RuntimeError("MCP_PAGINATION_LOOP", `MCP server '${this.options.serverId}' returned a pagination loop`);
          }
          seenCursors.add(page.nextCursor);
        }
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      this.session = session;
      this.routes.clear();
      for (const [id, remote] of routes) this.routes.set(id, remote);
      this.descriptors = Object.freeze(normalized);
      return this.descriptors;
    } catch (error) {
      try { await session.close(); } catch { /* preserve discovery failure */ }
      throw error;
    }
  }

  async execute(toolId: string, input: unknown, _context: ExecutionContext): Promise<ToolResult> {
    if (!this.descriptors || !this.session) await this.listTools();
    const remoteName = this.routes.get(toolId);
    if (!remoteName || !this.session) {
      throw new RuntimeError("MCP_TOOL_NOT_FOUND", `MCP tool '${toolId}' was not discovered`);
    }
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new RuntimeError("INVALID_INPUT", `input for MCP tool '${toolId}' must be an object`);
    }
    const result = await this.session.callTool(remoteName, input as Record<string, unknown>);
    if (result.isError) {
      const details: Record<string, unknown> = { content: result.content };
      if (result.structuredContent !== undefined) details.structuredContent = result.structuredContent;
      throw new RuntimeError("MCP_TOOL_ERROR", `MCP tool '${toolId}' reported an error`, details);
    }
    const data: Record<string, unknown> = { content: result.content };
    if (result.structuredContent !== undefined) data.structuredContent = result.structuredContent;
    return { data, meta: { mcpServer: this.options.serverId, remoteTool: remoteName } };
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      const session = this.session;
      this.session = undefined;
      this.descriptors = undefined;
      this.routes.clear();
      if (session) await session.close();
    })();
    return this.closePromise;
  }
}
