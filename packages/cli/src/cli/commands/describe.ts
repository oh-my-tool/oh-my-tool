import { createRuntime } from "../context";

export interface DescribedTool {
  name: string;
  description: string;
  risk: string;
  inputSchema: Record<string, unknown> | undefined;
  extension: string;
  extensionVersion: string;
}

export async function runDescribe(toolName: string): Promise<DescribedTool> {
  const runtime = await createRuntime();
  const descriptor = await runtime.describe(toolName);
  return {
    name: descriptor.id,
    description: descriptor.description,
    risk: descriptor.risk,
    inputSchema: descriptor.inputSchema,
    extension: descriptor.source.id,
    extensionVersion: "unknown",
  };
}

