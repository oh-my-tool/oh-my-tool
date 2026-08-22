import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IntegrationConflictError,
  assertSafeAgentTarget,
  createIntegrationManager,
  detectAgents,
  validateSkill,
} from "../src/integration";

let root: string;
let omtHome: string;
let userHome: string;
let skillSource: string;

beforeEach(() => {
  root = join(tmpdir(), `omt-integration-${Date.now()}-${Math.random()}`);
  omtHome = join(root, ".omt");
  userHome = join(root, "user");
  skillSource = join(root, "skill-source");
  mkdirSync(skillSource, { recursive: true });
  writeFileSync(
    join(skillSource, "SKILL.md"),
    "---\nname: oh-my-tool\ndescription: Discover and invoke capabilities through OMT.\n---\n\n# Oh My Tool\n",
    "utf8",
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const fakeCommands = (...names: string[]) => async (candidates: string[]) =>
  candidates.find((name) => names.includes(name));

describe("agent integration", () => {
  test("bundled Skill documents the canonical ohmytool search-describe-run protocol", () => {
    const skill = readFileSync(join(import.meta.dir, "../assets/skills/oh-my-tool/SKILL.md"), "utf8");
    expect(skill).toContain("ohmytool search");
    expect(skill).toContain("ohmytool describe");
    expect(skill).toContain("ohmytool run");
    expect(skill).not.toMatch(/^\s*(?:[-*]\s*)?omt\s/m);
    expect(skill).not.toContain("omt call");
  });

  test("validates required skill frontmatter", () => {
    expect(validateSkill(skillSource).name).toBe("oh-my-tool");
    writeFileSync(join(skillSource, "SKILL.md"), "# missing metadata\n", "utf8");
    expect(() => validateSkill(skillSource)).toThrow(/frontmatter/i);
  });

  test("detects agents and resolves their user-level skill targets", async () => {
    const found = await detectAgents({ userHome, findCommand: fakeCommands("codex", "omp", "qoderclicn") });
    expect(found.map((agent) => agent.id)).toEqual(["codex", "omp", "qoder"]);
    expect(found[0].target).toBe(join(userHome, ".agents", "skills", "oh-my-tool"));
    expect(found[1].target).toBe(join(userHome, ".omp", "agent", "skills", "oh-my-tool"));
    expect(found[2].target).toBe(join(userHome, ".qoder-cn", "skills", "oh-my-tool"));
  });

  test("detects pi, cursor and claude with their targets", async () => {
    const found = await detectAgents({
      userHome,
      findCommand: fakeCommands("codex", "pi", "cursor", "claude"),
    });
    expect(found.map((agent) => agent.id)).toEqual(["codex", "pi", "cursor", "claude"]);
    expect(found[1].target).toBe(join(userHome, ".agents", "skills", "oh-my-tool"));
    expect(found[2].target).toBe(join(userHome, ".agents", "skills", "oh-my-tool"));
    expect(found[3].target).toBe(join(userHome, ".claude", "skills", "oh-my-tool"));
  });

  test("installs one canonical skill and links every selected agent", async () => {
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex", "omp", "qoder"),
    });

    const result = await manager.install(["codex", "omp", "qoder"]);
    expect(result.every((item) => item.status === "installed")).toBe(true);
    const canonical = join(omtHome, "integrations", "skills", "oh-my-tool", "0.1.0");
    expect(existsSync(join(canonical, "SKILL.md"))).toBe(true);
    for (const item of result) {
      expect(lstatSync(item.target).isSymbolicLink()).toBe(true);
      expect(realpathSync(item.target)).toBe(realpathSync(canonical));
    }
  });

  test("repeated install is idempotent", async () => {
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex"),
    });
    await manager.install(["codex"]);
    const again = await manager.install(["codex"]);
    expect(again[0].status).toBe("current");
  });

  test("never overwrites an unmanaged same-name directory", async () => {
    const target = join(userHome, ".agents", "skills", "oh-my-tool");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "user.txt"), "keep", "utf8");
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex"),
    });
    await expect(manager.install(["codex"])).rejects.toThrow(IntegrationConflictError);
    expect(readFileSync(join(target, "user.txt"), "utf8")).toBe("keep");
  });

  test("status reports broken links and repair recreates them", async () => {
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex"),
    });
    const [installed] = await manager.install(["codex"]);
    rmSync(installed.target, { recursive: true, force: true });
    const [broken] = await manager.status();
    expect(broken.status).toBe("broken");
    expect(broken.detail).toMatch(/repair/i);
    expect((await manager.repair(["codex"]))[0].status).toBe("repaired");
    expect(existsSync(join(installed.target, "SKILL.md"))).toBe(true);
  });

  test("status distinguishes not-installed and unmanaged conflict", async () => {
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex"),
    });
    const [notInstalled] = await manager.status();
    expect(notInstalled.status).toBe("not-installed");
    expect(notInstalled.detail).toMatch(/install/i);

    const target = join(userHome, ".agents", "skills", "oh-my-tool");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "user.txt"), "keep", "utf8");
    const [conflict] = await manager.status();
    expect(conflict.status).toBe("conflict");
    expect(conflict.detail).toMatch(/not managed by OMT/i);
  });

  test("status reports update-available for an older recorded version", async () => {
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex"),
    });
    await manager.install(["codex"]);
    const statePath = join(omtHome, "integrations", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.skills["oh-my-tool"].agents.codex.version = "0.0.9";
    writeFileSync(statePath, JSON.stringify(state), "utf8");
    const [result] = await manager.status();
    expect(result.status).toBe("update-available");
    expect(result.detail).toMatch(/0\.1\.0/);
  });

  test("shared target: uninstall keeps link while another agent references it", async () => {
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex", "pi"),
    });
    const installed = await manager.install(["codex", "pi"]);
    expect(installed[0].target).toBe(installed[1].target);
    expect(lstatSync(installed[0].target).isSymbolicLink()).toBe(true);

    await manager.uninstall(["codex"]);
    expect(existsSync(installed[0].target)).toBe(true);
    expect(existsSync(join(installed[0].target, "SKILL.md"))).toBe(true);

    await manager.uninstall(["pi"]);
    expect(existsSync(installed[0].target)).toBe(false);
  });

  test("shared target: backup ownership migrates to remaining agent", async () => {
    const target = join(userHome, ".agents", "skills", "oh-my-tool");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "user.txt"), "keep", "utf8");
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex", "pi"),
      now: () => new Date("2026-08-20T07:30:00.000Z"),
    });
    await manager.install(["codex"], { force: true });
    await manager.install(["pi"]);
    await manager.uninstall(["codex"]);
    expect(existsSync(join(target, "SKILL.md"))).toBe(true);
    await manager.uninstall(["pi"]);
    expect(readFileSync(join(target, "user.txt"), "utf8")).toBe("keep");
  });

  test("claude integrates into ~/.claude/skills", async () => {
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("claude"),
    });
    const [installed] = await manager.install(["claude"]);
    expect(installed.status).toBe("installed");
    expect(installed.target).toBe(join(userHome, ".claude", "skills", "oh-my-tool"));
    expect(lstatSync(installed.target).isSymbolicLink()).toBe(true);
    await manager.uninstall(["claude"]);
    expect(existsSync(installed.target)).toBe(false);
  });

  test("uninstall removes only OMT-managed links", async () => {
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex"),
    });
    const [installed] = await manager.install(["codex"]);
    expect((await manager.uninstall(["codex"]))[0].status).toBe("uninstalled");
    expect(existsSync(installed.target)).toBe(false);
    expect(existsSync(join(userHome, ".agents"))).toBe(true);
    expect(existsSync(join(userHome, ".agents", "skills"))).toBe(true);
  });

  test("rejects deleting an agent root or skill root", () => {
    const base = { id: "codex" as const, displayName: "Codex", command: "codex" };
    expect(() =>
      assertSafeAgentTarget({ ...base, target: join(userHome, ".agents") }, userHome),
    ).toThrow(/unsafe agent skill target/i);
    expect(() =>
      assertSafeAgentTarget({ ...base, target: join(userHome, ".agents", "skills") }, userHome),
    ).toThrow(/unsafe agent skill target/i);
  });

  test("uninstall refuses a real directory that replaced the managed link", async () => {
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex"),
    });
    const [installed] = await manager.install(["codex"]);
    unlinkSync(installed.target);
    mkdirSync(installed.target, { recursive: true });
    writeFileSync(join(installed.target, "user.txt"), "keep", "utf8");
    await expect(manager.uninstall(["codex"])).rejects.toThrow(IntegrationConflictError);
    expect(readFileSync(join(installed.target, "user.txt"), "utf8")).toBe("keep");
  });

  test("uninstall rejects a tampered backup path before removing the link", async () => {
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex"),
    });
    const [installed] = await manager.install(["codex"]);
    const statePath = join(omtHome, "integrations", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.skills["oh-my-tool"].agents.codex.backup = join(userHome, ".agents");
    writeFileSync(statePath, JSON.stringify(state), "utf8");

    await expect(manager.uninstall(["codex"])).rejects.toThrow(/unsafe managed backup/i);
    expect(existsSync(installed.target)).toBe(true);
    expect(existsSync(join(userHome, ".agents"))).toBe(true);
  });

  test("rejects a skill version that can escape the canonical directory", async () => {
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "..\\..\\.agents",
      findCommand: fakeCommands("codex"),
    });
    await expect(manager.install(["codex"])).rejects.toThrow(/invalid skill version/i);
  });

  test("force backs up an unmanaged directory and uninstall restores it", async () => {
    const target = join(userHome, ".agents", "skills", "oh-my-tool");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "user.txt"), "keep", "utf8");
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex"),
      now: () => new Date("2026-08-20T07:30:00.000Z"),
    });
    await manager.install(["codex"], { force: true });
    expect(existsSync(join(target, "SKILL.md"))).toBe(true);
    await manager.uninstall(["codex"]);
    expect(readFileSync(join(target, "user.txt"), "utf8")).toBe("keep");
  });

  test("rolls back earlier agent links when a later link creation fails", async () => {
    const codexTarget = join(userHome, ".agents", "skills", "oh-my-tool");
    mkdirSync(codexTarget, { recursive: true });
    writeFileSync(join(codexTarget, "user.txt"), "keep", "utf8");
    let calls = 0;
    const manager = createIntegrationManager({
      omtHome,
      userHome,
      skillSource,
      skillVersion: "0.1.0",
      findCommand: fakeCommands("codex", "omp"),
      linkDirectory: (source, target, platform) => {
        calls++;
        if (calls === 2) throw new Error("simulated link failure");
        symlinkSync(source, target, platform === "win32" ? "junction" : "dir");
      },
    });
    await expect(manager.install(["codex", "omp"], { force: true })).rejects.toThrow(/simulated/);
    expect(readFileSync(join(codexTarget, "user.txt"), "utf8")).toBe("keep");
    expect(existsSync(join(userHome, ".omp", "agent", "skills", "oh-my-tool"))).toBe(false);
  });
});
