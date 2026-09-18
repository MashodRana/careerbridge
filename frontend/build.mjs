#!/usr/bin/env node
// Minifies widget.js/reset.css and version-stamps the output into dist/.
//
// Produces two copies of each build:
//   dist/<version>/   immutable — never overwritten once published, safe to
//                      cache forever (Cache-Control: immutable)
//   dist/v<major>/     the "alias" — overwritten on every semver-compatible
//                      release, cached briefly. This is what embed snippets
//                      should point at by default (see DEPLOYMENT.md).
//
// A bad release only needs the alias re-pointed at the previous version's
// files, not every customer site updated individually.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
const version = pkg.version;
const majorAlias = `v${version.split(".")[0]}`;

const versionedDir = path.join(rootDir, "dist", version);
const aliasDir = path.join(rootDir, "dist", majorAlias);

rmSync(versionedDir, { recursive: true, force: true });
mkdirSync(versionedDir, { recursive: true });

await build({
  entryPoints: [path.join(rootDir, "widget.js")],
  bundle: false, // widget.js is already a self-contained IIFE, nothing to bundle
  minify: true,
  target: ["es2020"],
  outfile: path.join(versionedDir, "widget.js"),
  banner: { js: `/* CareerBridge widget v${version} */` },
  logLevel: "info",
});

await build({
  entryPoints: [path.join(rootDir, "reset.css")],
  minify: true,
  outfile: path.join(versionedDir, "reset.css"),
  logLevel: "info",
});

// index.html references widget.js/reset.css with plain relative src/href, so
// copying it unchanged into the same versioned directory just works.
cpSync(path.join(rootDir, "index.html"), path.join(versionedDir, "index.html"));

// The alias is a full copy, not a symlink — S3 has no concept of a symlink,
// and this keeps "upload dist/ to S3" a single dumb recursive copy either way.
rmSync(aliasDir, { recursive: true, force: true });
cpSync(versionedDir, aliasDir, { recursive: true });

const sizeOf = (p) => `${(readFileSync(p).length / 1024).toFixed(1)}KB`;
console.log(`\nBuilt version ${version}:`);
console.log(`  dist/${version}/widget.js   ${sizeOf(path.join(versionedDir, "widget.js"))}`);
console.log(`  dist/${version}/reset.css   ${sizeOf(path.join(versionedDir, "reset.css"))}`);
console.log(`  dist/${version}/index.html  ${sizeOf(path.join(versionedDir, "index.html"))}`);
console.log(`  mirrored to dist/${majorAlias}/ (the alias embed snippets should use)`);
