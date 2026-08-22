import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  throw new Error("usage: npm run version:release -- <semver>");
}

function updatePackage(relativePath, update) {
  const path = resolve(relativePath);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  update(pkg);
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

updatePackage("packages/sdk/package.json", (pkg) => {
  pkg.version = version;
});

updatePackage("packages/cli/package.json", (pkg) => {
  pkg.version = version;
  pkg.dependencies["@oh-my-tool/sdk"] = version;
});

console.log(`Prepared @oh-my-tool/sdk and @oh-my-tool/cli ${version}`);
