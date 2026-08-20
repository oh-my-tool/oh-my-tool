import { discoverExtensions } from "../../extension/discovery";
import { createRegistry, resolveTool } from "../../core/registry";
import { homeDir } from "../context";

export interface DescribedTool {
  name: string;
  description: string;
  risk: string;
  inputSchema: Record<string, unknown> | undefined;
  extension: string;
  extensionVersion: string;
}

export async function runDescribe(toolName: string): Promise<DescribedTool> {
  const reg = createRegistry(discoverExtensions(homeDir()));
  const { tool, extension } = resolveTool(reg, toolName);
  return {
    name: tool.name,
    description: tool.description,
    risk: tool.risk ?? "read",
    inputSchema: tool.inputSchema,
    extension: extension.id,
    extensionVersion: extension.version,
  };
}

