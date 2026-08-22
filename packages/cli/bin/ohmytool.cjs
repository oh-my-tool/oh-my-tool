#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const result = spawnSync("bun", [join(__dirname, "ohmytool.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  console.error("ohmytool requires Bun 1.4 or newer. Install it from https://bun.sh.");
  process.exit(1);
}

process.exit(result.status ?? 1);
