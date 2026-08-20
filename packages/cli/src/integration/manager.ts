import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { bundledSkillPath, stageCanonicalSkill } from "./skill";
import { detectAgents, type FindCommand } from "./adapters";
import type {
  AgentDetection,
  AgentId,
  IntegrationResult,
  IntegrationState,
  ManagedAgentState,
} from "./types";

export class IntegrationConflictError extends Error {
  constructor(target: string) {
    super(`Integration target already exists and is not managed by OMT: ${target}`);
    this.name = "IntegrationConflictError";
  }
}

export interface IntegrationManagerOptions {
  omtHome: string;
  userHome?: string;
  skillSource?: string;
  skillVersion: string;
  findCommand?: FindCommand;
  platform?: NodeJS.Platform;
  now?: () => Date;
  linkDirectory?: (source: string, target: string, platform: NodeJS.Platform) => void;
}

export interface InstallOptions {
  force?: boolean;
}

interface LinkOperation {
  target: string;
  previous?: string;
  created: boolean;
}

function emptyState(): IntegrationState {
  return { schemaVersion: 1, skills: {} };
}

function safeRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function pathPresent(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isManagedLink(path: string, canonical: string): boolean {
  if (!isLink(path)) return false;
  const actual = safeRealpath(path);
  const expected = safeRealpath(canonical);
  if (actual && expected) return actual === expected;
  try {
    const linked = readlinkSync(path);
    return resolve(dirname(path), linked) === resolve(canonical);
  } catch {
    return false;
  }
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function assertSafeAgentTarget(
  agent: AgentDetection,
  userHome: string,
  platform: NodeJS.Platform = process.platform,
): void {
  const agentsSkills = join(userHome, ".agents", "skills");
  const allowedParents: Record<AgentId, string[]> = {
    codex: [agentsSkills],
    omp: [join(userHome, ".omp", "agent", "skills")],
    qoder: [join(userHome, ".qoder", "skills"), join(userHome, ".qoder-cn", "skills")],
    pi: [agentsSkills],
    cursor: [agentsSkills],
    claude: [join(userHome, ".claude", "skills")],
  };
  const target = resolve(agent.target);
  const parentAllowed = allowedParents[agent.id].some((parent) => samePath(dirname(target), parent, platform));
  if (basename(target) !== "oh-my-tool" || !parentAllowed) {
    throw new Error(`Unsafe agent skill target: ${agent.target}`);
  }
}

function unlinkOnly(path: string): void {
  if (!pathPresent(path)) return;
  if (!isLink(path)) throw new Error(`Refusing to delete non-link path: ${path}`);
  unlinkSync(path);
}

function assertSafeManagedState(
  agent: AgentDetection,
  recorded: ManagedAgentState,
  omtHome: string,
  platform: NodeJS.Platform,
): void {
  if (!samePath(recorded.target, agent.target, platform)) {
    throw new Error(`Unsafe managed target in state: ${recorded.target}`);
  }
  const canonicalRoot = resolve(omtHome, "integrations", "skills", "oh-my-tool");
  if (!samePath(dirname(recorded.canonical), canonicalRoot, platform)) {
    throw new Error(`Unsafe managed canonical path: ${recorded.canonical}`);
  }
  if (recorded.backup) {
    const backup = resolve(recorded.backup);
    const expectedPrefix = `${resolve(agent.target)}.backup-`;
    const prefixMatches = platform === "win32"
      ? backup.toLowerCase().startsWith(expectedPrefix.toLowerCase())
      : backup.startsWith(expectedPrefix);
    if (!prefixMatches || !samePath(dirname(backup), dirname(agent.target), platform)) {
      throw new Error(`Unsafe managed backup path: ${recorded.backup}`);
    }
  }
}

export function createIntegrationManager(options: IntegrationManagerOptions) {
  const userHome = options.userHome ?? homedir();
  const source = options.skillSource ?? bundledSkillPath();
  const statePath = join(options.omtHome, "integrations", "state.json");
  const platform = options.platform ?? process.platform;
  const now = options.now ?? (() => new Date());

  function loadState(): IntegrationState {
    if (!existsSync(statePath)) return emptyState();
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as IntegrationState;
    return parsed.schemaVersion === 1 ? parsed : emptyState();
  }

  function saveState(state: IntegrationState): void {
    mkdirSync(dirname(statePath), { recursive: true });
    const staging = `${statePath}.tmp-${process.pid}`;
    writeFileSync(staging, JSON.stringify(state, null, 2) + "\n", "utf8");
    renameSync(staging, statePath);
  }

  async function detections(): Promise<AgentDetection[]> {
    const found = await detectAgents({ userHome, findCommand: options.findCommand });
    for (const agent of found) assertSafeAgentTarget(agent, userHome, platform);
    return found;
  }

  async function selected(ids?: AgentId[]): Promise<AgentDetection[]> {
    const found = await detections();
    if (!ids?.length) return found;
    const byId = new Map(found.map((agent) => [agent.id, agent]));
    return ids.map((id) => {
      const agent = byId.get(id);
      if (!agent) throw new Error(`Agent is not detected: ${id}`);
      return agent;
    });
  }

  function createManagedLink(canonical: string, target: string): void {
    mkdirSync(dirname(target), { recursive: true });
    const staging = `${target}.omt-tmp-${process.pid}-${Date.now()}`;
    if (pathPresent(staging)) throw new Error(`Refusing to replace existing staging path: ${staging}`);
    try {
      if (options.linkDirectory) options.linkDirectory(canonical, staging, platform);
      else symlinkSync(canonical, staging, platform === "win32" ? "junction" : "dir");
      renameSync(staging, target);
    } catch (error) {
      if (isLink(staging)) unlinkSync(staging);
      throw error;
    }
  }

  async function install(ids?: AgentId[], installOptions: InstallOptions = {}): Promise<IntegrationResult[]> {
    const agents = await selected(ids);
    if (!agents.length) return [];
    const canonical = stageCanonicalSkill(options.omtHome, source, options.skillVersion);
    const state = loadState();
    const skillState = state.skills["oh-my-tool"] ?? {
      version: options.skillVersion,
      digest: canonical.digest,
      agents: {},
    };
    const operations: LinkOperation[] = [];
    const results: IntegrationResult[] = [];

    try {
      for (const agent of agents) {
        const recorded = skillState.agents[agent.id];
        if (recorded) assertSafeManagedState(agent, recorded, options.omtHome, platform);
        const targetRealpath = safeRealpath(agent.target);
        const canonicalRealpath = realpathSync(canonical.path);
        if (targetRealpath === canonicalRealpath && isLink(agent.target)) {
          skillState.agents[agent.id] = managedState(agent.target, canonical.path, canonical.digest);
          results.push(result(agent, "current"));
          continue;
        }

        let previous: string | undefined;
        let backup: string | undefined;
        if (pathPresent(agent.target)) {
          const isRecordedLink = recorded && isManagedLink(agent.target, recorded.canonical);
          if (!isRecordedLink && !installOptions.force) throw new IntegrationConflictError(agent.target);
          backup = installOptions.force && !isRecordedLink
            ? `${agent.target}.backup-${timestamp(now())}`
            : `${agent.target}.omt-old-${process.pid}-${Date.now()}`;
          renameSync(agent.target, backup);
          previous = backup;
        }

        const operation: LinkOperation = { target: agent.target, previous, created: false };
        operations.push(operation);
        createManagedLink(canonical.path, agent.target);
        operation.created = true;
        const managed = managedState(agent.target, canonical.path, canonical.digest);
        if (installOptions.force && previous && !previous.includes(".omt-old-")) managed.backup = previous;
        skillState.agents[agent.id] = managed;
        results.push(result(agent, "installed"));
      }
      skillState.version = options.skillVersion;
      skillState.digest = canonical.digest;
      state.skills["oh-my-tool"] = skillState;
      saveState(state);
      for (const operation of operations) {
        if (operation.previous?.includes(".omt-old-") && pathPresent(operation.previous)) {
          unlinkOnly(operation.previous);
        }
      }
      return results;
    } catch (error) {
      for (const operation of operations.reverse()) {
        if (operation.created) unlinkOnly(operation.target);
        if (operation.previous && pathPresent(operation.previous)) renameSync(operation.previous, operation.target);
      }
      throw error;
    }
  }

  async function status(): Promise<IntegrationResult[]> {
    const agents = await detections();
    const state = loadState();
    const records = state.skills["oh-my-tool"]?.agents ?? {};
    return agents.map((agent) => {
      const recorded = records[agent.id];
      if (!recorded) {
        if (!pathPresent(agent.target)) {
          return result(agent, "not-installed", "not installed; run `omt integrate` to install");
        }
        return result(agent, "conflict", "target exists but is not managed by OMT");
      }
      try {
        assertSafeManagedState(agent, recorded, options.omtHome, platform);
      } catch {
        return result(agent, "conflict", "recorded state is unsafe; run `omt integrate repair`");
      }
      if (!pathPresent(agent.target) || !safeRealpath(agent.target)) {
        return result(agent, "broken", "link is missing; run `omt integrate repair`");
      }
      if (!isManagedLink(agent.target, recorded.canonical)) {
        return result(agent, "conflict", "target was replaced by unmanaged content");
      }
      if (recorded.version === options.skillVersion) {
        return result(agent, "current");
      }
      return result(agent, "update-available", `new version ${options.skillVersion} available; run \`omt integrate\``);
    });
  }

  async function repair(ids?: AgentId[]): Promise<IntegrationResult[]> {
    const state = loadState();
    const records = state.skills["oh-my-tool"]?.agents ?? {};
    for (const agent of await selected(ids)) {
      const recorded = records[agent.id];
      if (recorded) assertSafeManagedState(agent, recorded, options.omtHome, platform);
      if (pathPresent(agent.target) && (!recorded || !isManagedLink(agent.target, recorded.canonical))) {
        throw new IntegrationConflictError(agent.target);
      }
    }
    const installed = await install(ids);
    return installed.map((item) => ({ ...item, status: item.status === "installed" ? "repaired" : item.status }));
  }

  async function uninstall(ids?: AgentId[]): Promise<IntegrationResult[]> {
    const agents = await selected(ids);
    const state = loadState();
    const skillState = state.skills["oh-my-tool"];
    const results: IntegrationResult[] = [];
    for (const agent of agents) {
      const recorded = skillState?.agents[agent.id];
      if (!recorded) {
        results.push(result(agent, "not-installed"));
        continue;
      }
      assertSafeManagedState(agent, recorded, options.omtHome, platform);
      const remaining = Object.entries(skillState!.agents).filter(
        ([id, other]) => id !== agent.id && other && samePath(other.target, agent.target, platform),
      );
      if (remaining.length) {
        if (recorded.backup) remaining[0][1]!.backup = recorded.backup;
      } else {
        if (pathPresent(agent.target)) {
          if (!isManagedLink(agent.target, recorded.canonical)) {
            throw new IntegrationConflictError(agent.target);
          }
          unlinkOnly(agent.target);
        }
        if (recorded.backup && existsSync(recorded.backup)) renameSync(recorded.backup, agent.target);
      }
      delete skillState!.agents[agent.id];
      results.push(result(agent, "uninstalled"));
    }
    saveState(state);
    return results;
  }

  return { detect: detections, install, status, repair, uninstall };

  function managedState(target: string, canonical: string, digest: string): ManagedAgentState {
    return {
      target,
      canonical,
      version: options.skillVersion,
      digest,
      mode: platform === "win32" ? "junction" : "symlink",
    };
  }
}

function result(
  agent: AgentDetection,
  status: IntegrationResult["status"],
  detail?: string,
): IntegrationResult {
  return {
    agent: agent.id,
    displayName: agent.variant ?? agent.displayName,
    target: agent.target,
    status,
    detail,
  };
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
