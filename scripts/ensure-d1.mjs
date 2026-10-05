#!/usr/bin/env node
/**
 * Ensure the D1 database declared in wrangler.toml exists in the current
 * account, and that the config carries its real `database_id`.
 *
 * Why this exists
 * ---------------
 * The repository ships a placeholder `database_id`. Cloudflare's "Deploy to
 * Cloudflare" wizard replaces it with a real id *inside the copy it clones*,
 * but a repository connected to **Workers Builds** is used exactly as pushed.
 * `wrangler deploy` therefore gets whatever is committed, and fails with:
 *
 *   D1 binding 'DB' references database '<id>' which was not found. [code: 10181]
 *   binding DB of type d1 must have a valid `database_id` specified [code: 10021]
 *
 * This script closes that gap. It runs before every remote deploy — from
 * `pnpm deploy`, from `pnpm db:ensure`, and (via the `build` script) inside
 * Cloudflare's build runner.
 *
 * Resolution order
 * ----------------
 *   1. `database_id` resolves in this account   -> nothing to do
 *   2. a database named `database_name` exists  -> bind it
 *   3. neither                                  -> create it, then bind it
 *
 * The shape of the committed id is deliberately **not** trusted. An id that
 * merely looks like a UUID — for example one copied from an upstream fork's
 * wrangler.toml — is still treated as missing whenever this account cannot
 * resolve it. Treating "looks like a UUID" as "is configured" is what made
 * `code: 10181` survive an earlier version of this script.
 *
 * Flags
 * -----
 *   --if-ci   Do nothing unless running inside Cloudflare Workers Builds. Used
 *             by the `build` script, so the default Workers Builds deploy
 *             command needs no extra wiring.
 *   --check   Report the decision, change nothing (no create, no rewrite).
 *
 * Environment
 * -----------
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
 *             Standard Wrangler authentication. Required in CI; only needed
 *             locally when the token can reach more than one account.
 *   VPS_DOG_D1_NO_CREATE=1
 *             Refuse to create a database (step 3 becomes a hard error).
 *   VPS_DOG_D1_CONFIG
 *             Override the config path (defaults to `<repo>/wrangler.toml`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = process.env.VPS_DOG_D1_CONFIG
  ? resolve(process.env.VPS_DOG_D1_CONFIG)
  : join(root, "wrangler.toml");

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const ifCi = flags.has("--if-ci");
const checkOnly = flags.has("--check");

const tag = "[vps-dog]";
const log = (message) => console.log(`${tag} ${message}`);
const warn = (message) => console.warn(`${tag} ${message}`);

/** Cloudflare's build runner exports these; a plain local shell does not. */
function inWorkersBuilds() {
  return Boolean(
    process.env.WORKERS_CI ||
      process.env.WORKERS_CI_BUILD_UUID ||
      process.env.WORKERS_CI_COMMIT_SHA,
  );
}

/** Locate the wrangler CLI without depending on a shell or .cmd shims. */
function wranglerEntry() {
  const candidates = [
    join(root, "node_modules", "wrangler", "bin", "wrangler.js"),
    join(root, "node_modules", ".bin", "wrangler"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("wrangler not found — run `pnpm install` first");
}

/** Run wrangler and return stdout. Throws with the tail of stderr on failure. */
function wrangler(args) {
  const entry = wranglerEntry();
  const result = spawnSync(process.execPath, [entry, ...args], {
    encoding: "utf8",
    env: process.env,
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const tail = (result.stderr || result.stdout || "").trim().split("\n").slice(-12).join("\n");
    throw new Error(`wrangler ${args.join(" ")} failed (exit ${result.status}):\n${tail}`);
  }
  return result.stdout || "";
}

/** Pull a scalar string value out of the top-level `[[d1_databases]]` block. */
function readBinding(config, key) {
  const start = config.indexOf("[[d1_databases]]");
  if (start === -1) throw new Error("no [[d1_databases]] block in wrangler.toml");
  const block = config.slice(start);
  const match = block.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match ? match[1] : "";
}

/** Replace the `database_id` inside the `[[d1_databases]]` block only. */
function writeDatabaseId(config, id) {
  const start = config.indexOf("[[d1_databases]]");
  const nextSection = config.slice(start).search(/\n\[/);
  const end = nextSection === -1 ? config.length : start + nextSection;
  const head = config.slice(0, start);
  const block = config.slice(start, end);
  const tail = config.slice(end);
  const updated = block.replace(/^(\s*database_id\s*=\s*)"[^"]*"/m, `$1"${id}"`);
  if (updated === block) throw new Error("could not rewrite database_id in wrangler.toml");
  return head + updated + tail;
}

/**
 * `wrangler d1 list --json` prints a banner before the payload, so slice from
 * the first bracket instead of parsing stdout as-is.
 *
 * `VPS_DOG_D1_LIST_JSON` overrides the lookup with a canned database list so
 * the decision logic below can be exercised without spawning Wrangler — useful
 * for offline diagnosis and for sandboxes that block child processes. Never
 * set it during a real deploy.
 */
function listDatabases() {
  const injected = process.env.VPS_DOG_D1_LIST_JSON;
  const raw = injected === undefined ? wrangler(["d1", "list", "--json"]) : injected;
  const start = raw.indexOf("[");
  if (start === -1) {
    throw new Error(`unexpected \`wrangler d1 list --json\` output:\n${raw.trim().slice(0, 400)}`);
  }
  const parsed = JSON.parse(raw.slice(start));
  if (!Array.isArray(parsed)) throw new Error("`wrangler d1 list --json` did not return an array");
  return parsed;
}

function bind(databaseName, database, how) {
  if (checkOnly) {
    log(`would bind "${database.name}" (${database.uuid}) — ${how}`);
    return;
  }
  writeFileSync(configPath, writeDatabaseId(readFileSync(configPath, "utf8"), database.uuid));
  log(`${how} D1 "${databaseName}" (${database.uuid}); ${configPath} updated`);
}

function main() {
  if (ifCi && !inWorkersBuilds()) {
    log("not running in Cloudflare Workers Builds; skipping D1 provisioning");
    return;
  }
  if (!existsSync(configPath)) throw new Error(`${configPath} not found`);

  const config = readFileSync(configPath, "utf8");
  const databaseName = readBinding(config, "database_name");
  const databaseId = readBinding(config, "database_id");
  if (!databaseName) throw new Error("[[d1_databases]] has no database_name");

  const databases = listDatabases();

  // 1. The configured id is real. Note this is an identity check, not a
  //    format check — that distinction is the whole point of this script.
  if (databaseId && databases.some((db) => db.uuid === databaseId)) {
    log(`D1 "${databaseName}" already configured (${databaseId})`);
    return;
  }
  if (databaseId) {
    warn(`database_id "${databaseId}" is not visible in this account — repairing`);
  }

  // 2. Same name, different id: adopt it rather than creating a duplicate.
  const byName = databases.find((db) => db.name === databaseName);
  if (byName) {
    bind(databaseName, byName, "found existing");
    return;
  }

  // 3. Nothing to adopt: create it.
  if (process.env.VPS_DOG_D1_NO_CREATE === "1") {
    throw new Error(
      `D1 "${databaseName}" does not exist and VPS_DOG_D1_NO_CREATE=1 is set`,
    );
  }
  if (checkOnly) {
    log(`would create D1 "${databaseName}"`);
    return;
  }

  log(`no D1 named "${databaseName}" in this account; creating it`);
  wrangler(["d1", "create", databaseName]);
  // Re-list rather than scraping `create` output, which is not stable JSON.
  const created = listDatabases().find((db) => db.name === databaseName);
  if (!created) throw new Error(`created D1 "${databaseName}" but it is not listed yet`);
  bind(databaseName, created, "created");
}

const AUTH_HINT = [
  "  This account could not be selected or authenticated. Fix with one of:",
  "    - Cloudflare dashboard -> the Worker -> Settings -> Build -> Variables,",
  "      add CLOUDFLARE_ACCOUNT_ID (Workers Builds needs it when the token",
  "      can reach more than one account);",
  "    - locally: export CLOUDFLARE_ACCOUNT_ID=<id> (see `wrangler whoami`),",
  "      or export CLOUDFLARE_API_TOKEN=<token> with D1:Edit permission.",
].join("\n");

try {
  main();
} catch (error) {
  const message = error.message || String(error);
  if (ifCi) {
    // The `build` script uses this path. A build must not fail over optional
    // provisioning: `wrangler deploy` reports the authoritative error anyway.
    warn(`could not provision D1 automatically: ${message}`);
    warn("continuing — the deploy step will report the authoritative error");
    process.exit(0);
  }
  console.error(`${tag} ensure-d1 failed: ${message}`);
  if (/account|authenticat|10000|10023|403|Unauthorized|login/i.test(message)) {
    console.error(AUTH_HINT);
  }
  process.exit(1);
}
