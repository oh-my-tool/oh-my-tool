import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

export interface FakeExtensionOpts {
  id?: string;
  version?: string;
  sdkVersion?: string;
  tools?: Array<Record<string, unknown>>;
  entry?: string;
  connectionSchema?: Record<string, unknown>;
  connectionCheckTool?: string;
}

/** Creates <home>/extensions/<id>/<version>/ with a manifest, package.json and entry. */
export function createFakeExtension(
  home: string,
  opts: FakeExtensionOpts = {},
): { id: string; version: string; dir: string; entry: string } {
  const id = opts.id ?? "mysql";
  const version = opts.version ?? "0.1.0";
  const sdkVersion = opts.sdkVersion ?? "^0.2.0";
  const dir = join(home, "extensions", id, version);
  mkdirSync(dir, { recursive: true });

  const tools = opts.tools ?? [
    {
      name: `${id}.query`,
      description: "run a query",
      keywords: ["query"],
      risk: "read",
      inputSchema: {
        type: "object",
        required: ["connection"],
        properties: {
          connection: { type: "string" },
          maxRows: { type: "integer", default: 100, maximum: 1000 },
        },
      },
    },
  ];

  const manifest = {
    id,
    name: id.toUpperCase(),
    version,
    sdkVersion,
    description: `fake ${id}`,
    keywords: [id, "sql"],
    ...(opts.connectionSchema === undefined ? {} : { connectionSchema: opts.connectionSchema }),
    ...(opts.connectionCheckTool === undefined ? {} : { connectionCheckTool: opts.connectionCheckTool }),
    tools,
  };

  const entryRel = opts.entry ?? "src/index.ts";
  const entryAbs = join(dir, entryRel);
  mkdirSync(join(dir, "src"), { recursive: true });

  writeFileSync(join(dir, "omt.manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: `@oh-my-tool/${id}`,
        version,
        type: "module",
        omt: { apiVersion: "1", manifest: "./omt.manifest.json", entry: `./${entryRel}` },
        exports: { ".": `./${entryRel}` },
      },
      null,
      2,
    ),
    "utf8",
  );

  writeFileSync(
    entryAbs,
    `
export default {
  handlers: {
    ${tools
      .map(
        (t) =>
          `"${t.name}": async (ctx, input) => ({ data: { echoed: input, conn: ctx.config }, meta: { ext: "${id}" } }),`,
      )
      .join(",\n")}
  }
};
`,
    "utf8",
  );

  return { id, version, dir, entry: entryAbs };
}
