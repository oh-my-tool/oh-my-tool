import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { cp as cpAsync } from "node:fs/promises";
import { installLocalExtension, installNpmExtension, normalizeNpmExtensionSpec } from "../src/extension/install";
import { discoverExtensions } from "../src/extension/discovery";
import { ManifestError } from "../src/extension/manifest";

let src: string;
let home: string;
beforeEach(() => {
  src = join(tmpdir(), `omt-src-${Date.now()}-${Math.random()}`);
  home = join(tmpdir(), `omt-home-${Date.now()}-${Math.random()}`);
  mkdirSync(join(src, "src"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(src, "omt.manifest.json"), JSON.stringify({ id: "mysql", name: "MySQL", version: "0.2.0", sdkVersion: "^0.1.0", description: "d", tools: [{ name: "mysql.query", description: "q" }] }), "utf8");
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "@oh-my-tool/mysql", version: "0.2.0", type: "module", omt: { entry: "./src/index.ts" } }), "utf8");
  writeFileSync(join(src, "src", "index.ts"), "export default { handlers: { \"mysql.query\": async () => ({ data: [] }) } };", "utf8");
});
afterEach(() => {
  rmSync(src, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("installLocalExtension", () => {
  test("copies the extension into the versioned layout", async () => {
    await installLocalExtension(home, src);
    expect(existsSync(join(home, "extensions", "mysql", "0.2.0", "omt.manifest.json"))).toBe(true);
    expect(existsSync(join(home, "extensions", "mysql", "0.2.0", "src", "index.ts"))).toBe(true);
  });

  test("the installed extension is discoverable", async () => {
    await installLocalExtension(home, src);
    const found = discoverExtensions(home);
    expect(found.map((e) => e.id)).toContain("mysql");
    expect(found.find((e) => e.id === "mysql")!.version).toBe("0.2.0");
  });

  test("reinstall overwrites previously installed files", async () => {
    await installLocalExtension(home, src);
    const installedPath = join(home, "extensions", "mysql", "0.2.0", "src", "index.ts");
    expect(readFileSync(installedPath, "utf8")).toContain("data: []");

    // 更新源文件后重装，目标必须跟随
    writeFileSync(
      join(src, "src", "index.ts"),
      'export default { handlers: { "mysql.query": async () => ({ data: { v: 2 } }) } };',
      "utf8",
    );
    await installLocalExtension(home, src);
    expect(readFileSync(installedPath, "utf8")).toContain("v: 2");
  });

  test("rejects an extension whose sdkVersion is incompatible", async () => {
    writeFileSync(join(src, "omt.manifest.json"), JSON.stringify({ id: "mysql", name: "MySQL", version: "0.2.0", sdkVersion: "^99.0.0", description: "d", tools: [{ name: "mysql.query", description: "q" }] }), "utf8");
    await expect(installLocalExtension(home, src)).rejects.toThrow(ManifestError);
    expect(existsSync(join(home, "extensions", "mysql", "0.2.0"))).toBe(false);
  });
});

describe("normalizeNpmExtensionSpec", () => {
  test("maps official shorthand and preserves an exact version", () => {
    expect(normalizeNpmExtensionSpec("redis")).toEqual({ packageName: "@oh-my-tool/redis", npmSpec: "@oh-my-tool/redis" });
    expect(normalizeNpmExtensionSpec("redis@0.3.1")).toEqual({ packageName: "@oh-my-tool/redis", npmSpec: "@oh-my-tool/redis@0.3.1", version: "0.3.1" });
    expect(normalizeNpmExtensionSpec("@oh-my-tool/redis@0.3.1")).toEqual({ packageName: "@oh-my-tool/redis", npmSpec: "@oh-my-tool/redis@0.3.1", version: "0.3.1" });
  });

  test("rejects non-official, malformed, and range package specs", () => {
    expect(normalizeNpmExtensionSpec("hbase")).toEqual({ packageName: "@oh-my-tool/hbase", npmSpec: "@oh-my-tool/hbase" });
    expect(() => normalizeNpmExtensionSpec("redis@^0.3.1")).toThrow(/exact/i);
    expect(() => normalizeNpmExtensionSpec("redis@")).toThrow(/exact/i);
    expect(() => normalizeNpmExtensionSpec("other/redis")).toThrow(/official/i);
    expect(() => normalizeNpmExtensionSpec("@other/redis")).toThrow(/official/i);
  });
});

describe("installNpmExtension", () => {
  test("validates and activates the package returned by npm", async () => {
    await installNpmExtension(home, "mysql@0.2.0", {
      install: async (_spec, tempDir) => {
        await cpAsync(src, join(tempDir, "node_modules", "@oh-my-tool", "mysql"), { recursive: true });
      },
    });
    expect(existsSync(join(home, "extensions", "mysql", "0.2.0", "omt.manifest.json"))).toBe(true);
  });

  test("rejects a package whose resolved version differs from the requested exact version", async () => {
    await expect(installNpmExtension(home, "mysql@0.3.1", {
      install: async (_spec, tempDir) => {
        await cpAsync(src, join(tempDir, "node_modules", "@oh-my-tool", "mysql"), { recursive: true });
      },
    })).rejects.toThrow(/unexpected version/i);
    expect(existsSync(join(home, "extensions", "mysql", "0.2.0"))).toBe(false);
  });
});
