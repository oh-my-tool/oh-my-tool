import type { ToolDescriptor, ToolSearchResult } from "./provider";
import { RuntimeError } from "./errors";

const NAME_WEIGHT = 3;
const KEYWORD_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDescriptor>();

  register(descriptors: readonly ToolDescriptor[]): void {
    const ids = new Set<string>();
    for (const descriptor of descriptors) {
      if (this.tools.has(descriptor.id) || ids.has(descriptor.id)) {
        throw new RuntimeError("DUPLICATE_TOOL_ID", `duplicate tool '${descriptor.id}'`);
      }
      ids.add(descriptor.id);
    }
    for (const descriptor of descriptors) {
      this.tools.set(descriptor.id, descriptor);
    }
  }

  get(toolId: string): ToolDescriptor | undefined {
    return this.tools.get(toolId);
  }

  search(query: string): ToolSearchResult[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    return [...this.tools.values()]
      .map((descriptor) => ({ descriptor, score: this.score(descriptor, tokens) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ descriptor }) => {
        const { inputSchema: _inputSchema, ...summary } = descriptor;
        return summary;
      });
  }

  private score(descriptor: ToolDescriptor, tokens: string[]): number {
    const id = descriptor.id.toLowerCase();
    const description = descriptor.description.toLowerCase();
    const keywords = (descriptor.keywords ?? []).map((keyword) => keyword.toLowerCase());
    return tokens.reduce((score, token) => {
      if (id.includes(token)) return score + NAME_WEIGHT;
      if (keywords.some((keyword) => keyword.includes(token) || token.includes(keyword))) {
        return score + KEYWORD_WEIGHT;
      }
      if (description.includes(token)) return score + DESCRIPTION_WEIGHT;
      return score;
    }, 0);
  }
}
