// Fails when what this MCP server tells agents disagrees with the live Kronos
// API: a tool's stated price, the asset slugs it accepts, an "N assets" count,
// a price or asset list in the README, or wording the API itself no longer uses.
//
// WHY THIS EXISTS
// 0.6.0 was published on 2026-07-04 and the API kept moving. By 2026-09-27 ten
// of its 22 tools quoted less than the route charges (get_forecast said $0.01,
// or $0.001 for doge/xrp/bnb, while the route charged $0.05). x402 pays whatever
// the 402 challenge asks, so an agent would pay up to 50x the price in the tool
// description. get_sample offered 16 assets when only btc/eth/sol have a sample,
// and get_forecast refused near and ada, which had forecasts since July.
//
// The reference is the API's free machine-readable catalog,
// <BASE_URL>/api/v1/catalog. tools/list is read from the BUILT server
// (dist/index.js), which is exactly what an agent sees. No paid tool is called.
//
// Run:  npm run build && npm run check:live   (prepublishOnly runs both)
// Needs network access to the live API. MCP_SERVER_JS and MCP_README point the
// check at another build or README (used to prove it catches the 0.6.0 drift).

import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = (process.env.BASE_URL ?? "https://kronossignals.com").replace(/\/+$/, "");
const SERVER = process.env.MCP_SERVER_JS ?? join(ROOT, "dist/index.js");
const README = process.env.MCP_README ?? join(ROOT, "README.md");
const SRC = join(ROOT, "src/index.ts");

const failures = [];
const fail = (msg) => failures.push(msg);
const fmt = (price) => (price === 0 ? "free" : `$${price}`);
const PRICE_RE = /\$(\d+(?:\.\d+)?)/g;
const COUNT_RE = /(\d+)\s+(?:tracked\s+)?(?:crypto\s+)?assets\b/g;

// ---- The live catalog --------------------------------------------------------

const res = await fetch(`${BASE_URL}/api/v1/catalog`);
if (!res.ok) throw new Error(`${BASE_URL}/api/v1/catalog answered HTTP ${res.status}`);
const catalog = await res.json();

/** "$0.02/call" -> 0.02, "FREE" -> 0 */
function parsePrice(text) {
  if (/^\s*free\s*$/i.test(String(text))) return 0;
  const m = String(text).match(/\$(\d+(?:\.\d+)?)/);
  if (!m) throw new Error(`catalog: unreadable price ${JSON.stringify(text)}`);
  return Number(m[1]);
}

const entries = catalog.tools.map((t) => ({
  // Not new URL(): it would percent-encode the {asset} placeholder.
  path: t.endpoint.replace(/^https?:\/\/[^/]+/, ""),
  price: parsePrice(t.price),
  assets: t.inputs?.asset?.enum ?? null,
}));
const allAssets = new Set(entries.flatMap((e) => e.assets ?? []));

/**
 * What the API sells at a path template such as /api/v1/forecast/{asset}: the
 * template's own entry plus any per-asset entries (/api/v1/forecast/doge).
 */
function expectedFor(template) {
  const hasAsset = template.includes("{asset}");
  const [prefix, suffix = ""] = template.split("{asset}");
  const prices = new Set();
  const assets = new Set();
  let hits = 0;
  for (const e of entries) {
    if (e.path === template) {
      hits++;
      prices.add(e.price);
      for (const a of e.assets ?? []) assets.add(a);
    } else if (hasAsset && e.path.startsWith(prefix) && e.path.endsWith(suffix)) {
      const slug = e.path.slice(prefix.length, e.path.length - suffix.length);
      if (!/^[a-z0-9]+$/.test(slug)) continue;
      hits++;
      prices.add(e.price);
      assets.add(slug);
    }
  }
  if (hits === 0) return null;
  return { prices: [...prices], assets: hasAsset ? assets : null };
}

function diffSets(label, got, want) {
  const missing = [...want].filter((a) => !got.has(a));
  const extra = [...got].filter((a) => !want.has(a));
  if (missing.length) fail(`${label}: missing ${missing.join(", ")}, which the route accepts`);
  if (extra.length) fail(`${label}: offers ${extra.join(", ")}, which the live catalog does not list for this route`);
}

/** Publish no fixed accuracy figures, and never call a forecast a signal. */
function lintWording(where, text) {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n/)) {
    const quote = sentence.trim().slice(0, 90);
    if (/\b\d+(?:\.\d+)?\s?%/.test(sentence) && /accura|hit|directional|in-range|win rate|correct/i.test(sentence)) {
      fail(`${where}: states an accuracy figure ("${quote}")`);
    }
    if ((/\bforecasts?\b/i.test(sentence) && /\bsignals?\b/i.test(sentence)) || /predictive signal/i.test(sentence)) {
      fail(`${where}: calls a forecast a signal ("${quote}")`);
    }
  }
}

// ---- Which /api/v1 path each tool calls, from the source ----------------------

const src = readFileSync(SRC, "utf8");
const pathOf = new Map();
for (const chunk of src.split("server.tool(").slice(1)) {
  const name = chunk.match(/^\s*"([a-z_]+)"/)?.[1];
  const path = chunk.match(/\$\{BASE_URL\}(\/api\/v1\/[a-z0-9\-/]*(?:\$\{asset\})?)/)?.[1];
  if (name) pathOf.set(name, path ? path.replace("${asset}", "{asset}") : null);
}

// ---- tools/list from the built server ------------------------------------------

if (!existsSync(SERVER)) {
  console.error(`${SERVER} not found. Run npm run build first.`);
  process.exit(1);
}
if (!process.env.MCP_SERVER_JS && statSync(SERVER).mtimeMs < statSync(SRC).mtimeMs) {
  fail("dist/index.js is older than src/index.ts. Run npm run build first.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER],
  // The server loads dotenv from its working directory; keep it away from any
  // local .env and its BUYER_PRIVATE_KEY. (The env passed is the SDK's safe
  // default subset, which does not include BUYER_PRIVATE_KEY either.)
  cwd: tmpdir(),
  stderr: "ignore",
});
const client = new Client({ name: "check-live-drift", version: "1.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
await client.close();

// ---- Tool descriptions and input schemas ---------------------------------------

const expByName = new Map();
for (const tool of tools) {
  const path = pathOf.get(tool.name);
  if (!path) {
    fail(`${tool.name}: no \${BASE_URL}/api/v1/... call found for it in src/index.ts`);
    continue;
  }
  const exp = expectedFor(path);
  if (!exp) {
    fail(`${tool.name}: ${path} is not in the live catalog`);
    continue;
  }
  if (exp.prices.length > 1) {
    fail(`${tool.name}: the catalog prices ${path} at ${exp.prices.map(fmt).join(" and ")}; one description can't state both`);
    continue;
  }
  const price = exp.prices[0];
  expByName.set(tool.name, { price, assets: exp.assets });
  const description = tool.description ?? "";

  const stated = [...description.matchAll(PRICE_RE)].map((m) => Number(m[1]));
  if (price === 0) {
    if (stated.length) fail(`${tool.name}: the route is free, but the description quotes ${stated.map(fmt).join(", ")}`);
  } else if (stated.length === 0) {
    fail(`${tool.name}: the description quotes no price; the route charges ${fmt(price)}`);
  } else {
    for (const s of new Set(stated)) {
      if (s !== price) fail(`${tool.name}: the description says ${fmt(s)}; the route charges ${fmt(price)}`);
    }
  }

  if (exp.assets) {
    const offered = tool.inputSchema?.properties?.asset?.enum;
    if (!offered) fail(`${tool.name}: the route takes an asset, but the tool has no asset enum`);
    else diffSets(tool.name, new Set(offered), exp.assets);
  }

  const covered = exp.assets ? exp.assets.size : allAssets.size;
  for (const m of description.matchAll(COUNT_RE)) {
    if (Number(m[1]) !== covered) fail(`${tool.name}: the description says ${m[1]} assets; the route covers ${covered}`);
  }

  lintWording(`${tool.name} description`, description);
}
for (const name of pathOf.keys()) {
  if (!tools.some((t) => t.name === name)) {
    fail(`src/index.ts registers ${name}, but the built server does not. Run npm run build first.`);
  }
}

// ---- README ---------------------------------------------------------------------

const readme = readFileSync(README, "utf8");
const rowSeen = new Set();
for (const line of readme.split("\n")) {
  const row = line.match(/^\|\s*`(get_[a-z_]+)`\s*\|.*\|\s*([^|]+?)\s*\|\s*$/);
  if (row) {
    const [, name, cell] = row;
    rowSeen.add(name);
    const exp = expByName.get(name);
    if (!exp) {
      if (!pathOf.has(name)) fail(`README: a table row for ${name}, which the server does not register`);
    } else {
      const stated = [...cell.matchAll(PRICE_RE)].map((m) => Number(m[1]));
      const ok =
        exp.price === 0
          ? /free/i.test(cell) && stated.length === 0
          : stated.length > 0 && stated.every((s) => s === exp.price);
      if (!ok) fail(`README ${name}: says "${cell}"; the route is ${exp.price === 0 ? "free" : `${fmt(exp.price)}`}`);
    }
  }

  const coverage = line.match(/^- ((?:`get_[a-z_]+`(?:, )?)+)[^:]*:\s*(.+)$/);
  if (coverage) {
    const names = [...coverage[1].matchAll(/`(get_[a-z_]+)`/g)].map((m) => m[1]);
    const slugs = new Set([...coverage[2].matchAll(/`([a-z0-9]+)`/g)].map((m) => m[1]));
    for (const name of names) {
      const exp = expByName.get(name);
      if (!exp?.assets) fail(`README asset list names ${name}, which takes no asset`);
      else diffSets(`README asset list for ${name}`, slugs, exp.assets);
    }
  }

  lintWording("README", line);
}
for (const tool of tools) {
  if (!rowSeen.has(tool.name)) fail(`README: no table row for ${tool.name}`);
}
const paid = [...expByName.values()].map((e) => e.price).filter((p) => p > 0);
const from = readme.match(/Prices from \*\*\$(\d+(?:\.\d+)?)\*\*/);
if (from && paid.length && Number(from[1]) !== Math.min(...paid)) {
  fail(`README: "Prices from $${from[1]}"; the cheapest paid tool is ${fmt(Math.min(...paid))}`);
}

// ---- Report ---------------------------------------------------------------------

console.log(`Checked ${tools.length} tools and ${README.replace(ROOT + "/", "")} against ${BASE_URL}/api/v1/catalog (${entries.length} entries).`);
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("OK: prices, asset lists, counts and wording match the live API.");
