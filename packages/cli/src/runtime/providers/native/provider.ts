import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
      const sourceId = this.sourceId(extension);
      for (const tool of extension.manifest.tools) {
        descriptors.push({
          id: tool.name,
          description: tool.description,
          keywords: tool.keywords,
          risk: tool.risk ?? "read",
          inputSchema: tool.inputSchema,
          provider: { id: this.id, kind: this.kind },
          source: { id: sourceId, kind: "extension" },
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

  private sourceId(extension: InstalledExtension): string {
    const packagePath = join(extension.dir, "package.json");
    if (existsSync(packagePath)) {
      try {
        const name = (JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown }).name;
        if (typeof name === "string" && name) return name;
      } catch {
        // Manifest discovery remains authoritative when package metadata is malformed.
      }
    }
    return extension.id;
  }
}
