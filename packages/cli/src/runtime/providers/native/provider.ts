import { discoverExtensions, type InstalledExtension } from "../../../extension/discovery";
import { loadExtension } from "../../../extension/loader";
import type { OhMyToolPaths } from "../../../paths";
import type { ExecutionContext, ToolDescriptor, ToolProvider } from "../../provider";
import type { ToolResult } from "../../result";

export class NativeExtensionProvider implements ToolProvider {
  readonly id = "native";
  readonly kind = "native";

  constructor(private readonly homeOrPaths: string | Pick<OhMyToolPaths, "home">) {}

  private home(): string {
    return typeof this.homeOrPaths === "string" ? this.homeOrPaths : this.homeOrPaths.home;
  }

  async listTools(): Promise<readonly ToolDescriptor[]> {
    const descriptors: ToolDescriptor[] = [];
    for (const extension of discoverExtensions(this.home())) {
      for (const tool of extension.manifest.tools) {
        descriptors.push({
          id: tool.name,
          description: tool.description,
          // Preserve extension-level discovery terms from the legacy search
          // contract while keeping ToolRegistry independent of manifests.
          keywords: [...new Set([
            ...(tool.keywords ?? []),
            extension.manifest.id,
            extension.manifest.name,
            ...(extension.manifest.keywords ?? []),
          ])],
          risk: tool.risk ?? "read",
          inputSchema: tool.inputSchema,
          provider: { id: this.id, kind: this.kind },
          source: { id: extension.manifest.id, kind: "extension", version: extension.manifest.version },
        });
      }
    }
    return descriptors;
  }

  async execute(toolId: string, input: unknown, context: ExecutionContext): Promise<ToolResult> {
    const extension = this.findExtension(toolId);
    const definition = await loadExtension(extension);
    const handler = definition.handlers[toolId];
    if (!handler) throw new Error(`no handler for ${toolId}`);
    return handler({ toolName: toolId, logger: context.logger, config: context.config, secrets: context.secrets }, input);
  }

  private findExtension(toolId: string): InstalledExtension {
    const extension = discoverExtensions(this.home()).find((candidate) =>
      candidate.manifest.tools.some((tool) => tool.name === toolId),
    );
    if (!extension) throw new Error(`unknown native tool '${toolId}'`);
    return extension;
  }
}
