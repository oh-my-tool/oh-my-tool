import { homedir } from "node:os";
import { basename, delimiter, extname, join } from "node:path";
import { existsSync } from "node:fs";
import type { AgentDetection, AgentId } from "./types";

export type FindCommand = (candidates: string[]) => Promise<string | undefined> | string | undefined;

export interface DetectionOptions {
  userHome?: string;
  findCommand?: FindCommand;
}

interface AdapterDefinition {
  id: AgentId;
  displayName: string;
  commands: string[];
  target(userHome: string, command: string): string;
  variant?(command: string): string | undefined;
}

const definitions: AdapterDefinition[] = [
  {
    id: "codex",
    displayName: "Codex",
    commands: ["codex"],
    target: (home) => join(home, ".agents", "skills", "oh-my-tool"),
  },
  {
    id: "omp",
    displayName: "OMP",
    commands: ["omp"],
    target: (home) => join(home, ".omp", "agent", "skills", "oh-my-tool"),
  },
  {
    id: "qoder",
    displayName: "Qoder",
    commands: ["qoderclicn", "qodercli", "qoder"],
    target: (home, command) =>
      commandName(command) === "qoderclicn"
        ? join(home, ".qoder-cn", "skills", "oh-my-tool")
        : join(home, ".qoder", "skills", "oh-my-tool"),
    variant: (command) => (commandName(command) === "qoderclicn" ? "Qoder CLI CN" : undefined),
  },
  {
    id: "pi",
    displayName: "Pi",
    commands: ["pi"],
    target: (home) => join(home, ".agents", "skills", "oh-my-tool"),
  },
  {
    id: "cursor",
    displayName: "Cursor",
    commands: ["cursor"],
    target: (home) => join(home, ".agents", "skills", "oh-my-tool"),
  },
  {
    id: "claude",
    displayName: "Claude Code",
    commands: ["claude"],
    target: (home) => join(home, ".claude", "skills", "oh-my-tool"),
  },
];

function commandName(command: string): string {
  return basename(command, extname(command)).toLowerCase();
}

export function findCommandOnPath(candidates: string[]): string | undefined {
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat", ".ps1", ""] : [""];
  for (const candidate of candidates) {
    for (const directory of pathEntries) {
      for (const suffix of suffixes) {
        const path = join(directory, candidate + suffix);
        if (existsSync(path)) return path;
      }
    }
  }
  return undefined;
}

export async function detectAgents(options: DetectionOptions = {}): Promise<AgentDetection[]> {
  const userHome = options.userHome ?? homedir();
  const findCommand = options.findCommand ?? findCommandOnPath;
  const detected: AgentDetection[] = [];
  for (const definition of definitions) {
    const command = await findCommand(definition.commands);
    if (!command) continue;
    detected.push({
      id: definition.id,
      displayName: definition.displayName,
      command,
      target: definition.target(userHome, command),
      variant: definition.variant?.(command),
    });
  }
  return detected;
}
