import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPaths } from "../src/paths";
import { migrateLegacyHome, prepareHome } from "../src/migration";

const tempHomes: string[] = [];

function tempHome(name: string): string {
  const path = join(tmpdir(), `omt-paths-${name}-${Date.now()}-${Math.random()}`);
  tempHomes.push(path);
  return path;
}

afterEach(() => {
  for (const path of tempHomes.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("createPaths", () => {
  test("uses OH_MY_TOOL_HOME as a custom home", () => {
    const paths = createPaths({
      env: { OH_MY_TOOL_HOME: "X:" },
      platform: "win32",
      userHome: "U:",
    });
    expect(paths.home).toBe("X:");
    expect(paths.isCustomHome).toBe(true);
  });

  test("derives default and legacy homes from injected userHome", () => {
    const paths = createPaths({
      env: {},
      platform: "linux",
      userHome: "/users/test",
    });
    expect(paths.home).toBe("/users/test/.oh-my-tool");
    expect(paths.legacyHome).toBe("/users/test/.omt");
    expect(paths.config).toBe("/users/test/.oh-my-tool/config.toml");
  });

  test("ignores the removed OMT_HOME override", () => {
    const paths = createPaths({
      env: { OMT_HOME: "/legacy-override" },
      platform: "linux",
      userHome: "/users/test",
    });
    expect(paths.home).toBe("/users/test/.oh-my-tool");
  });
});

describe("legacy migration", () => {
  test("copies known state and preserves the legacy home", async () => {
    const userHome = tempHome("default");
    const paths = createPaths({ env: {}, platform: "linux", userHome });
    mkdirSync(join(paths.legacyHome, "extensions"), { recursive: true });
    writeFileSync(join(paths.legacyHome, "config.toml"), "legacy = true", "utf8");
    writeFileSync(join(paths.legacyHome, "extensions", "marker.txt"), "keep", "utf8");

    const result = await migrateLegacyHome(paths);
    expect(result.status).toBe("migrated");
    expect(readFileSync(paths.config, "utf8")).toBe("legacy = true");
    expect(readFileSync(join(paths.extensions, "marker.txt"), "utf8")).toBe("keep");
    expect(existsSync(join(paths.legacyHome, "config.toml"))).toBe(true);
  });

  test("does not overwrite an existing destination home", async () => {
    const userHome = tempHome("existing");
    const paths = createPaths({ env: {}, platform: "linux", userHome });
    mkdirSync(paths.legacyHome, { recursive: true });
    mkdirSync(paths.home, { recursive: true });
    writeFileSync(join(paths.legacyHome, "config.toml"), "legacy", "utf8");
    writeFileSync(paths.config, "new", "utf8");

    const result = await migrateLegacyHome(paths);
    expect(result.status).toBe("skipped-destination-exists");
    expect(readFileSync(paths.config, "utf8")).toBe("new");
  });

  test("skips migration for an explicit custom home", async () => {
    const userHome = tempHome("custom");
    const customHome = join(userHome, "custom-home");
    const paths = createPaths({ env: { OH_MY_TOOL_HOME: customHome }, platform: "linux", userHome });
    mkdirSync(paths.legacyHome, { recursive: true });
    writeFileSync(join(paths.legacyHome, "config.toml"), "legacy", "utf8");

    const result = await migrateLegacyHome(paths);
    expect(result.status).toBe("skipped-custom-home");
    expect(existsSync(paths.home)).toBe(false);
  });

  test("migrates before prepareHome creates directories", async () => {
    const userHome = tempHome("ordering");
    const paths = createPaths({ env: {}, platform: "linux", userHome });
    mkdirSync(paths.legacyHome, { recursive: true });
    writeFileSync(join(paths.legacyHome, "config.toml"), "legacy", "utf8");

    const result = await prepareHome(paths);
    expect(result.status).toBe("migrated");
    expect(readFileSync(paths.config, "utf8")).toBe("legacy");
  });
});
