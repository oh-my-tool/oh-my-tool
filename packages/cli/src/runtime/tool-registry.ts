import type { ToolDescriptor, ToolSearchOptions, ToolSearchResult } from "./provider";
import { RuntimeError } from "./errors";

const NAME_WEIGHT = 3;
const KEYWORD_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;
const EXACT_BOOST = 4;
const PREFIX_BOOST = 2;
const MAX_SEARCH_RESULTS = 100;

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

  search(query: string, options: ToolSearchOptions = {}): ToolSearchResult[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    return [...this.tools.values()]
      .filter((descriptor) => options.provider === undefined || descriptor.provider.id === options.provider)
      .filter((descriptor) => options.source === undefined || descriptor.source.id === options.source)
      .filter((descriptor) => options.risk === undefined || descriptor.risk === options.risk)
      .map((descriptor) => ({ descriptor, score: this.score(descriptor, tokens) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.descriptor.id.localeCompare(b.descriptor.id))
      .slice(0, Math.min(Math.max(Math.trunc(options.limit ?? MAX_SEARCH_RESULTS), 1), MAX_SEARCH_RESULTS))
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
      const idScore = matchWeight(id, token, NAME_WEIGHT);
      if (idScore > 0) return score + idScore;
      const keywordScore = Math.max(0, ...keywords.map((keyword) => matchWeight(keyword, token, KEYWORD_WEIGHT)));
      if (keywordScore > 0) return score + keywordScore;
      const descriptionScore = matchWeight(description, token, DESCRIPTION_WEIGHT);
      if (descriptionScore > 0) return score + descriptionScore;
      return score;
    }, 0);
  }
}

function matchWeight(value: string, token: string, base: number): number {
  if (value === token) return base + EXACT_BOOST;
  if (value.startsWith(token)) return base + PREFIX_BOOST;
  if (value.includes(token) || token.includes(value)) return base;
  return 0;
}
