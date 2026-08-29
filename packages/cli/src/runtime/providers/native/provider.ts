import { discoverExtensions, type InstalledExtension } from "../../../extension/discovery";
import { loadExtension } from "../../../extension/loader";
import type { OhMyToolPaths } from "../../../paths";
import type { ExecutionContext, ToolDescriptor, ToolProvider } from "../../provider";
import type { ToolResult } from "../../result";

export class NativeExtensionProvider implements ToolProvider {
  readonly id = "native";
  readonly kind = "native";

  private readonly discover: (home: string) => InstalledExtension[];
  private snapshot?: { extensions: InstalledExtension[]; routes: Map<string, InstalledExtension> };

  constructor(
    private readonly homeOrPaths: string | Pick<OhMyToolPaths, "home">,
    discover: (home: string) => InstalledExtension[] = discoverExtensions,
  ) {
    this.discover = discover;
  }

  private home(): string {
    return typeof this.homeOrPaths === "string" ? this.homeOrPaths : this.homeOrPaths.home;
  }

  async listTools(): Promise<readonly ToolDescriptor[]> {
    const descriptors: ToolDescriptor[] = [];
    for (const extension of this.getSnapshot().extensions) {
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
    const extension = this.getSnapshot().routes.get(toolId);
    if (!extension) throw new Error(`unknown native tool '${toolId}'`);
    const definition = await loadExtension(extension);
    const handler = definition.handlers[toolId];
    if (!handler) throw new Error(`no handler for ${toolId}`);
    return handler({ toolName: toolId, logger: context.logger, config: context.config, secrets: context.secrets }, input);
  }

  async hasTool(toolId: string): Promise<boolean> {
    return this.getSnapshot().routes.has(toolId);
  }

  private getSnapshot(): { extensions: InstalledExtension[]; routes: Map<string, InstalledExtension> } {
    if (this.snapshot) return this.snapshot;
    const extensions = this.discover(this.home());
    const routes = new Map<string, InstalledExtension>();
    for (const extension of extensions) {
      for (const tool of extension.manifest.tools) routes.set(tool.name, extension);
    }
    this.snapshot = { extensions, routes };
    return this.snapshot;
  }
}
