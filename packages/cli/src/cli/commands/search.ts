import { withRuntime } from "../context";

export async function runSearch(query: string): Promise<{ tools: Array<Record<string, unknown>> }> {
  return withRuntime(async (runtime) => {
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
  });
}

