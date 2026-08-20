import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillMetadata {
  name: string;
  description: string;
}

export function bundledSkillPath(): string {
  return fileURLToPath(new URL("../../assets/skills/oh-my-tool", import.meta.url));
}

export function validateSkill(directory: string): SkillMetadata {
  const skillFile = join(directory, "SKILL.md");
  if (!existsSync(skillFile)) throw new Error(`Skill is missing SKILL.md: ${directory}`);
  const content = readFileSync(skillFile, "utf8");
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) throw new Error("Skill SKILL.md is missing YAML frontmatter");
  const name = frontmatter[1].match(/^name:\s*(.+?)\s*$/m)?.[1];
  const description = frontmatter[1].match(/^description:\s*(.+?)\s*$/m)?.[1];
  if (!name || !description) throw new Error("Skill frontmatter requires name and description");
  if (name !== "oh-my-tool") throw new Error(`Unexpected bundled skill name: ${name}`);
  return { name, description };
}

function filesUnder(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export function skillDigest(directory: string): string {
  const hash = createHash("sha256");
  for (const file of filesUnder(directory)) {
    hash.update(relative(directory, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function stageCanonicalSkill(
  omtHome: string,
  source: string,
  version: string,
): { path: string; digest: string } {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid skill version: ${version}`);
  }
  validateSkill(source);
  const digest = skillDigest(source);
  const canonicalRoot = resolve(omtHome, "integrations", "skills", "oh-my-tool");
  const target = resolve(canonicalRoot, version);
  if (dirname(target) !== canonicalRoot) throw new Error(`Invalid skill version path: ${version}`);
  if (existsSync(target)) {
    validateSkill(target);
    if (skillDigest(target) !== digest) {
      throw new Error(`Immutable skill version ${version} already exists with different content`);
    }
    return { path: target, digest };
  }
  mkdirSync(dirname(target), { recursive: true });
  const staging = `${target}.tmp-${process.pid}-${Date.now()}`;
  if (existsSync(staging)) throw new Error(`Skill staging path already exists: ${staging}`);
  cpSync(source, staging, { recursive: true, errorOnExist: true });
  validateSkill(staging);
  if (statSync(staging).isDirectory()) renameSync(staging, target);
  return { path: target, digest };
}
