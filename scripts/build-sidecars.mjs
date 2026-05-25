#!/usr/bin/env node
// Build the Tauri sidecar binaries (echomind-server + echomind-wechat-bot)
// for the host target triple. Tauri's externalBin requires the file naming
// convention `<name>-<target-triple>[.exe]`, so this script handles the rename
// after the underlying compilers spit out their default outputs.
//
// Idempotent: if the sidecar output already exists and is newer than its
// sources, the rebuild is skipped (so `pnpm tauri dev` doesn't pay the cost on
// every launch). Force a rebuild by deleting `src-tauri/binaries/`.
//
// CI passes --target=<triple> to build cross-arch (mac universal needs both).

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN_DIR = join(ROOT, "src-tauri", "binaries");
const SERVER_CRATE_DIR = join(ROOT, "src-tauri");
const BOT_DIR = join(ROOT, "echomind-wechat");
const BUN_BIN =
  process.env.BUN_BIN ||
  (platform() === "win32"
    ? join(process.env.USERPROFILE || "", ".bun", "bin", "bun.exe")
    : "bun");

function hostTriple() {
  if (process.env.TARGET_TRIPLE) return process.env.TARGET_TRIPLE;
  const out = execSync("rustc -vV", { encoding: "utf8" });
  const m = out.match(/^host:\s*(\S+)$/m);
  if (!m) throw new Error("rustc -vV missing host line");
  return m[1];
}

// Tauri's --target universal-apple-darwin looks for a single fat binary at
// binaries/<name>-universal-apple-darwin. Neither cargo nor bun --compile
// produces one — we build each arch and lipo them together.
const UNIVERSAL_MAC = "universal-apple-darwin";
const UNIVERSAL_SUB_TRIPLES = ["x86_64-apple-darwin", "aarch64-apple-darwin"];

function bunTargetFor(triple) {
  const map = {
    "x86_64-pc-windows-msvc": "bun-windows-x64",
    "x86_64-apple-darwin": "bun-darwin-x64",
    "aarch64-apple-darwin": "bun-darwin-arm64",
    "x86_64-unknown-linux-gnu": "bun-linux-x64",
    "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  };
  if (!map[triple]) throw new Error(`No bun target for triple: ${triple}`);
  return map[triple];
}

function exeSuffix(triple) {
  return triple.includes("windows") ? ".exe" : "";
}

function newest(dir) {
  let m = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const p = join(dir, entry.name);
    const st = statSync(p);
    if (st.isDirectory()) {
      m = Math.max(m, newest(p));
    } else {
      m = Math.max(m, st.mtimeMs);
    }
  }
  return m;
}

function buildServer(triple) {
  const ext = exeSuffix(triple);
  const outName = `echomind-server-${triple}${ext}`;
  const outPath = join(BIN_DIR, outName);

  const srcDir = join(SERVER_CRATE_DIR, "echomind-server", "src");
  if (existsSync(outPath) && statSync(outPath).mtimeMs > newest(srcDir)) {
    console.log(`✓ ${outName} up to date — skip`);
    return;
  }

  const targetArg = process.env.TARGET_TRIPLE ? ` --target ${triple}` : "";
  console.log(`▶ cargo build -p echomind-server --release${targetArg}`);
  execSync(`cargo build -p echomind-server --release${targetArg}`, {
    cwd: SERVER_CRATE_DIR,
    stdio: "inherit",
  });

  const builtPath = process.env.TARGET_TRIPLE
    ? join(SERVER_CRATE_DIR, "target", triple, "release", `echomind-server${ext}`)
    : join(SERVER_CRATE_DIR, "target", "release", `echomind-server${ext}`);

  mkdirSync(BIN_DIR, { recursive: true });
  copyFileSync(builtPath, outPath);
  console.log(`✓ ${outName}`);
}

function ensureBotDeps() {
  // bun --compile needs qrcode resolvable on disk; CI only runs `pnpm install`
  // at the workspace root, which doesn't install this sub-project's deps.
  const qrcodeDir = join(BOT_DIR, "node_modules", "qrcode");
  if (existsSync(qrcodeDir)) return;
  const npmCmd = platform() === "win32" ? "npm.cmd" : "npm";
  const hasLock = existsSync(join(BOT_DIR, "package-lock.json"));
  const cmd = hasLock ? `${npmCmd} ci` : `${npmCmd} install`;
  console.log(`▶ ${cmd} (in echomind-wechat — first run only)`);
  execSync(cmd, { cwd: BOT_DIR, stdio: "inherit" });
}

function buildBot(triple) {
  const ext = exeSuffix(triple);
  const outName = `echomind-wechat-bot-${triple}${ext}`;
  const outPath = join(BIN_DIR, outName);

  const srcDir = join(BOT_DIR, "src");
  if (existsSync(outPath) && statSync(outPath).mtimeMs > newest(srcDir)) {
    console.log(`✓ ${outName} up to date — skip`);
    return;
  }

  ensureBotDeps();

  const bunTarget = bunTargetFor(triple);
  console.log(`▶ bun build --compile --target=${bunTarget} src/main.ts → ${outName}`);
  mkdirSync(BIN_DIR, { recursive: true });
  execSync(
    `"${BUN_BIN}" build --compile --target=${bunTarget} src/main.ts --outfile "${outPath}"`,
    { cwd: BOT_DIR, stdio: "inherit" }
  );
  console.log(`✓ ${outName}`);
}

function lipoMerge(name) {
  const outPath = join(BIN_DIR, `${name}-${UNIVERSAL_MAC}`);
  const inputs = UNIVERSAL_SUB_TRIPLES.map((t) => join(BIN_DIR, `${name}-${t}`));
  for (const p of inputs) {
    if (!existsSync(p)) throw new Error(`lipo input missing: ${p}`);
  }
  console.log(`▶ lipo -create → ${name}-${UNIVERSAL_MAC}`);
  execSync(`lipo -create -output "${outPath}" "${inputs.join('" "')}"`, {
    stdio: "inherit",
  });
  console.log(`✓ ${name}-${UNIVERSAL_MAC}`);
}

function buildOne(triple) {
  console.log(`Target triple: ${triple}`);
  buildServer(triple);
  buildBot(triple);
}

const triple = hostTriple();

if (triple === UNIVERSAL_MAC) {
  if (platform() !== "darwin") {
    throw new Error("universal-apple-darwin builds require running on macOS (needs lipo + rustc apple targets)");
  }
  for (const sub of UNIVERSAL_SUB_TRIPLES) {
    process.env.TARGET_TRIPLE = sub;
    buildOne(sub);
  }
  process.env.TARGET_TRIPLE = UNIVERSAL_MAC;
  lipoMerge("echomind-server");
  lipoMerge("echomind-wechat-bot");
} else {
  buildOne(triple);
}

console.log("All sidecars built into", BIN_DIR);
