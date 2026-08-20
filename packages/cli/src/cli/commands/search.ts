import { discoverExtensions } from "../../extension/discovery";
import { searchTools, type SearchHit } from "../../search/search";
import { homeDir } from "../context";

export async function runSearch(query: string): Promise<{ tools: SearchHit[] }> {
  const installed = discoverExtensions(homeDir());
  return { tools: searchTools(query, installed.map((e) => e.manifest)) };
}

