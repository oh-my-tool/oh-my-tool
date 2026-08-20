import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIntegrate } from "../src/cli/commands/integrate";
import { createIntegrationManager } from "../src/integration";

let root: string;
let manager: ReturnType<typeof createIntegrationManager>;

beforeEach(() => {
  root = join(tmpdir(), `omt-integrate-command-${Date.now()}-${Math.random()}`);
  const source = join(root, "source");
  mkdirSync(source, { recursive: true });
  writeFileSync(
    join(source, "SKILL.md"),
    "---\nname: oh-my-tool\ndescription: Use OMT capabilities.\n---\n# OMT\n",
    "utf8",
  );
  manager = createIntegrationManager({
    omtHome: join(root, ".omt"),
    userHome: join(root, "user"),
    skillSource: source,
    skillVersion: "0.1.0",
    findCommand: async (commands) => commands.find((name) => ["codex", "omp"].includes(name)),
  });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("runIntegrate", () => {
  test("installs selected detected agents", async () => {
    const output = await runIntegrate({ action: "install", agents: ["codex"] }, manager);
    expect(output.detected.map((agent) => agent.id)).toEqual(["codex", "omp"]);
    expect(output.results).toMatchObject([{ agent: "codex", status: "installed" }]);
  });

  test("dry-run never writes integration state", async () => {
    const output = await runIntegrate({ action: "install", dryRun: true }, manager);
    expect(output.dryRun).toBe(true);
    expect(output.selected).toEqual(["codex", "omp"]);
    expect(existsSync(join(root, ".omt", "integrations", "state.json"))).toBe(false);
  });

  test("rejects an unknown agent id", async () => {
    await expect(runIntegrate({ action: "install", agents: ["unknown" as never] }, manager)).rejects.toThrow(
      /unknown agent/i,
    );
  });

  test("rejects a known agent that is not detected", async () => {
    await expect(runIntegrate({ action: "install", agents: ["claude"] }, manager)).rejects.toThrow(
      /not detected/i,
    );
  });
});
