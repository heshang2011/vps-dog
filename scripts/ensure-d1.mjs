#!/usr/bin/env node
/**
 * Ensure the D1 database referenced by wrangler.toml exists and that the config
 * carries its real `database_id`.
 *
 * Cloudflare's Workers Builds does NOT provision D1 bindings — only the
 * "Deploy to Cloudflare" wizard does, and it does so in a cloned copy of the
 * repository. Connecting an existing repository to Workers Builds therefore
 * fails with:
 *
 *   binding DB of type d1 must have a valid `database_id` specified [code: 10021]
 *
 * This script closes that gap. It runs before deploy and:
 *
 *   1. reads `database_name` / `database_id` out of wrangler.toml
 *   2. lists the account's D1 databases
 *   3. uses the matching database, or creates it when absent
 *   4. rewrites `database_id` in wrangler.toml so the subsequent
 *      `d1 migrations apply` and `deploy` calls bind to the right database
 *
 * It is idempotent: once the database exists, later runs are a lookup only.
 *
 * The account is whatever the environment resolves — Workers Builds injects
 * `CLOUDFLARE_ACCOUNT_ID`, and locally you can export it or pass `-c` through
 * `WRANGLER_ARGS`. No account id is ever written to the repository.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "wrangler.toml");

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
  const block = config.slice(config.indexOf("[[d1_databases]]"));
  if (!block) throw new Error("no [[d1_databases]] block in wrangler.toml");
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

function main() {
  if (!existsSync(configPath)) throw new Error(`${configPath} not found`);

  const config = readFileSync(configPath, "utf8");
  const databaseName = readBinding(config, "database_name");
  const databaseId = readBinding(config, "database_id");
  if (!databaseName) throw new Error("[[d1_databases]] has no database_name");

  const isPlaceholder = !databaseId || databaseId === databaseName ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId);

  const databases = JSON.parse(wrangler(["d1", "list", "--json"]));
  const existing = databases.find((db) => db.name === databaseName || db.uuid === databaseId);

  if (existing) {
    if (existing.uuid === databaseId && !isPlaceholder) {
      console.log(`[vps-dog] D1 "${databaseName}" already configured (${databaseId})`);
      return;
    }
    console.log(`[vps-dog] found existing D1 "${databaseName}" (${existing.uuid}); binding it`);
    writeFileSync(configPath, writeDatabaseId(config, existing.uuid));
    return;
  }

  if (!isPlaceholder) {
    // The config points at a specific database that this account cannot see —
    // creating a new one here would silently orphan the configured one.
    throw new Error(
      `D1 "${databaseName}" (id ${databaseId}) is not visible in this account. ` +
      "Check CLOUDFLARE_ACCOUNT_ID, or clear database_id to let this script create it.",
    );
  }

  console.log(`[vps-dog] no D1 named "${databaseName}"; creating it`);
  wrangler(["d1", "create", databaseName]);
  // Re-list rather than scraping `create` output, which is not stable JSON.
  const created = JSON.parse(wrangler(["d1", "list", "--json"]))
    .find((db) => db.name === databaseName);
  if (!created) throw new Error(`created D1 "${databaseName}" but could not read its id`);

  console.log(`[vps-dog] created D1 "${databaseName}" (${created.uuid}); binding it`);
  writeFileSync(configPath, writeDatabaseId(config, created.uuid));
}

try {
  main();
} catch (error) {
  console.error(`[vps-dog] ensure-d1 failed: ${error.message}`);
  process.exit(1);
}
