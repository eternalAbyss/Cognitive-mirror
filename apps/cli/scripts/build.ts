import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";

/**
 * Build the publishable `cognitive-mirror` package.
 *
 * The whole monorepo collapses into one npm package:
 *
 *  - Each service is bundled with its `@cm/*` workspace dependencies inlined
 *    (`noExternal`), so nothing else has to be published and the installed
 *    package has zero runtime dependencies.
 *  - The visualiser ships as a Next standalone build.
 *  - `docker-compose.yml` is copied into `assets/` so an installed CLI can
 *    bring up the data plane without a checkout.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(here, "..");
const repoRoot = resolve(cliRoot, "..", "..");
const dist = join(cliRoot, "dist");

/** Entry name → source file. The name is what `servicePath()` looks up. */
const SERVICES: Record<string, string> = {
  "graph-core": "apps/graph-core/src/index.ts",
  ingestion: "apps/ingestion/src/index.ts",
  "mcp-server": "apps/mcp-server/src/index.ts",
  "reasoning-daemon": "apps/reasoning-daemon/src/index.ts",
  // One-shot entrypoints driven by CLI subcommands.
  "mcp-stdio": "apps/mcp-server/src/stdio.ts",
  "graph-core-reset": "apps/graph-core/src/reset.ts",
  seed: "apps/ingestion/src/seed.ts",
  "import-kindle": "apps/ingestion/src/import-kindle.ts",
  "import-repos": "apps/ingestion/src/import-repos.ts",
};

/**
 * tsup strips the `node:` prefix from builtin imports by default, for
 * compatibility with bundlers that predate it. That is actively wrong for
 * `node:sqlite`: the bare `sqlite` specifier resolves to nothing, and the
 * ingestion service dies at startup with "Cannot find package 'sqlite'".
 * The prefix is mandatory for that module, so keep it everywhere.
 */
const KEEP_NODE_PROTOCOL = { removeNodeProtocol: false } as const;

/**
 * Third-party packages are left as real imports, not bundled.
 *
 * Only the `@cm/*` workspace packages need inlining — they are never published,
 * so a bare import of them would be unresolvable. Everything else stays
 * external and is installed by npm.
 *
 * Bundling them instead is tempting (zero install-time dependencies) and does
 * not work. esbuild has to wrap each CJS module to make it importable from ESM,
 * and that wrapper is not transparent: `@js-temporal/polyfill`, reached through
 * `falkordb`, ends up calling `e.BigInt` on a shimmed global and dies with
 * "e.BigInt is not a function" the moment graph-core starts. Other packages
 * fail differently, with `require()` at runtime. None of it shows up until the
 * service actually boots from an installed package.
 */
function externalDeps(): string[] {
  // The workspace packages count too: they are inlined into every service
  // bundle, so *their* dependencies (dotenv, pino, …) end up in the same
  // output and need the same treatment. Missing them is how the ingestion
  // service ended up throwing 'Dynamic require of "fs" is not supported'.
  const sources = [
    ...["graph-core", "ingestion", "mcp-server", "reasoning-daemon"].map((a) => join("apps", a)),
    ...["shared", "queue", "embeddings", "graph-client"].map((p) => join("packages", p)),
  ];
  const deps = new Set<string>();
  for (const rel of sources) {
    const pkg = JSON.parse(readFileSync(join(repoRoot, rel, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (!name.startsWith("@cm/")) deps.add(name);
    }
  }
  return [...deps].sort();
}

function run(cmd: string, args: string[], cwd: string): void {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
  }
}

async function main(): Promise<void> {
  // Keep a previous visualiser build when --skip-ui asks to reuse it; wiping
  // dist wholesale would delete the thing we're trying to skip rebuilding.
  const reuseUi = process.argv.includes("--skip-ui") && existsSync(join(dist, "visualiser"));
  if (reuseUi) {
    rmSync(join(dist, "cli.js"), { force: true });
    rmSync(join(dist, "services"), { recursive: true, force: true });
  } else {
    rmSync(dist, { recursive: true, force: true });
  }
  mkdirSync(dist, { recursive: true });

  console.log("→ bundling the CLI");
  await build({
    entry: { cli: join(cliRoot, "src/cli.ts") },
    outDir: dist,
    format: "esm",
    platform: "node",
    target: "node22",
    // @cm/* are workspace-only and never published, so they must be inlined
    // rather than left as bare imports the installed package can't resolve.
    // No `banner` here: tsup carries over the shebang already on src/cli.ts,
    // and adding one produces two, which Node rejects as a syntax error on the
    // second line.
    noExternal: [/^@cm\//],
    ...KEEP_NODE_PROTOCOL,
    silent: true,
  });

  const serviceDeps = externalDeps();
  assertDepsDeclared(serviceDeps, "backend services");

  console.log("→ bundling services");
  await build({
    entry: Object.fromEntries(
      Object.entries(SERVICES).map(([name, rel]) => [name, join(repoRoot, rel)]),
    ),
    outDir: join(dist, "services"),
    format: "esm",
    platform: "node",
    target: "node22",
    noExternal: [/^@cm\//],
    external: serviceDeps,
    ...KEEP_NODE_PROTOCOL,
    silent: true,
  });

  // `--skip-ui` reuses the previous Next build. It dominates the build time, so
  // skipping it makes iterating on the service bundles bearable. Never use it
  // for a release.
  if (reuseUi) {
    console.log("→ reusing the existing visualiser build (--skip-ui)");
    copyAssets();
    console.log("✓ built (visualiser reused)");
    return;
  }

  console.log("→ building the visualiser");
  const vis = join(repoRoot, "apps/visualiser");
  run("npx", ["next", "build"], vis);

  const standalone = join(vis, ".next/standalone");
  if (!existsSync(standalone)) {
    throw new Error(
      "next build produced no standalone output — check that output: 'standalone' is set in next.config.mjs",
    );
  }
  const uiOut = join(dist, "visualiser");
  // Copy the standalone tree WHOLE. It mirrors the monorepo — node_modules at
  // the root, server.js under apps/visualiser — and server.js resolves `next`
  // via `../../node_modules`. Flattening it breaks that with a bare
  // "Cannot find module 'next'".
  cpSync(standalone, uiOut, { recursive: true });
  // Static assets and public/ are deliberately excluded from standalone output.
  const uiApp = join(uiOut, "apps/visualiser");
  cpSync(join(vis, ".next/static"), join(uiApp, ".next/static"), { recursive: true });
  if (existsSync(join(vis, "public"))) {
    cpSync(join(vis, "public"), join(uiApp, "public"), { recursive: true });
  }

  dropBundledUiDeps(uiOut, vis);

  copyAssets();
  console.log("✓ built");
}

/**
 * Drop the copied `node_modules` and let npm supply the UI's runtime deps.
 *
 * Shipping them inside the tarball fails two ways at once. pnpm's layout is
 * symlinks into a content-addressed store and `npm pack` silently drops
 * symlinks, so an installed package gets a `node_modules` holding only `.pnpm`
 * and the UI dies on "Cannot find module 'next'". Materialising a real tree
 * instead fixes that but balloons the package past 90 MB — and bakes in
 * `@next/swc-darwin-arm64` and `@img/sharp-darwin-*`, which are built for
 * whichever machine cut the release and are wrong for everyone else.
 *
 * Declaring them as ordinary dependencies (see package.json) hands both
 * problems to npm: it installs them flat next to this package, where Node's
 * upward resolution from `dist/visualiser/apps/visualiser/server.js` finds
 * them, and it picks the optional platform binaries for the machine actually
 * installing. That check is what `assertUiDepsDeclared` enforces.
 */
function dropBundledUiDeps(uiOut: string, visSrc: string): void {
  console.log("→ dropping bundled UI node_modules (npm installs them instead)");
  rmSync(join(uiOut, "node_modules"), { recursive: true, force: true });
  const uiDeps = Object.keys(
    (
      JSON.parse(readFileSync(join(visSrc, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      }
    ).dependencies ?? {},
  );
  assertDepsDeclared(uiDeps, "visualiser");
}

/**
 * Fail the build when something the runtime needs isn't declared in
 * apps/cli/package.json.
 *
 * Every one of these gaps is invisible locally — pnpm's workspace links satisfy
 * the import from a checkout — and only appears as a module-not-found crash
 * after a real npm install. Catching it here keeps that failure at build time.
 */
function assertDepsDeclared(needed: string[], label: string): void {
  const declared = new Set(
    Object.keys(
      (
        JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8")) as {
          dependencies?: Record<string, string>;
        }
      ).dependencies ?? {},
    ),
  );
  const missing = needed.filter((d) => !declared.has(d));
  if (missing.length) {
    throw new Error(
      `apps/cli/package.json does not declare ${label} dependencies: ${missing.join(", ")}.\n  Add them there — they are resolved from the installed package's node_modules.`,
    );
  }
}

function copyAssets(): void {
  console.log("→ copying assets");
  const assets = join(cliRoot, "assets");
  mkdirSync(assets, { recursive: true });
  cpSync(join(repoRoot, "docker-compose.yml"), join(assets, "docker-compose.yml"));
  cpSync(join(repoRoot, "LICENSE"), join(cliRoot, "LICENSE"));
}

main().catch((err: unknown) => {
  console.error(`\n✗ build failed: ${String((err as Error)?.message ?? err)}\n`);
  process.exit(1);
});
