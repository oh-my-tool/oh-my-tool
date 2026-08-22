import type { ExtensionManifest } from "@oh-my-tool/sdk";
import type { InstalledExtension } from "../extension/discovery";

import { RuntimeError as OmtError } from "../runtime/errors";
export { OmtError };

export interface Registry {
  byTool: Map<string, { extension: InstalledExtension; tool: ExtensionManifest["tools"][number] }>;
  byId: Map<string, InstalledExtension>;
}

export function createRegistry(installed: InstalledExtension[]): Registry {
  const byTool = new Map();
  const byId = new Map();
  for (const ext of installed) {
    byId.set(ext.id, ext);
    for (const tool of ext.manifest.tools) {
      byTool.set(tool.name, { extension: ext, tool });
    }
  }
  return { byTool, byId };
}

export function resolveTool(
  reg: Registry,
  toolName: string,
): { extension: InstalledExtension; tool: ExtensionManifest["tools"][number] } {
  const hit = reg.byTool.get(toolName);
  if (!hit) {
    throw new OmtError("UNKNOWN_TOOL", `unknown tool '${toolName}'`);
  }
  return hit;
}
