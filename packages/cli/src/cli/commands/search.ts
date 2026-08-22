import { createRuntime } from "../context";

export async function runSearch(query: string): Promise<{ tools: Array<Record<string, unknown>> }> {
  const runtime = await createRuntime();
  const descriptors = await runtime.search(query);
  return {
    tools: descriptors.map((descriptor) => ({
      name: descriptor.id,
      description: descriptor.description,
      extension: descriptor.source.id,
      risk: descriptor.risk,
      provider: descriptor.provider,
    })),
  };
}

