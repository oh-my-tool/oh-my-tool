import type { ExtensionManifest } from "@oh-my-tool/sdk";

export interface SearchHit {
  name: string;
  description: string;
  extension: string;
  risk: string;
  score: number;
}

interface Searchable {
  name: string;
  description: string;
  keywords: string[];
  risk: string;
  extension: string;
  extName: string;
}

const NAME_WEIGHT = 3;
const KEYWORD_WEIGHT = 2;
const DESC_WEIGHT = 1;

function toSearchable(ext: ExtensionManifest) {
  const out: Searchable[] = [];
  for (const tool of ext.tools) {
    out.push({
      name: tool.name.toLowerCase(),
      description: tool.description.toLowerCase(),
      keywords: (tool.keywords ?? []).map((k) => k.toLowerCase()),
      risk: tool.risk ?? "read",
      extension: ext.id,
      extName: ext.name.toLowerCase(),
    });
  }
  return out;
}

function bestWeight(s: Searchable, token: string): number {
  if (s.name.includes(token)) return NAME_WEIGHT;
  if (s.extName.includes(token)) return NAME_WEIGHT;
  if (s.keywords.some((k) => k.includes(token) || token.includes(k))) {
    return KEYWORD_WEIGHT;
  }
  if (s.description.includes(token)) return DESC_WEIGHT;
  return 0;
}

export function searchTools(query: string, manifests: ExtensionManifest[]): SearchHit[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const ext of manifests) {
    for (const s of toSearchable(ext)) {
      let score = 0;
      for (const token of tokens) {
        score += bestWeight(s, token);
      }
      if (score > 0) {
        hits.push({
          name: s.name,
          description: s.description,
          extension: s.extension,
          risk: s.risk,
          score,
        });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits;
}
