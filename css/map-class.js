#!/usr/bin/env node
/**
 * Collapse ad-hoc class values onto a named scale.
 *
 *   node css/map-class.js ./src --map map.json
 *   node css/map-class.js ./src --map map.json --apply
 *
 * map.json is a flat object of exact class → replacement:
 *
 *   {
 *     "tracking-[0.08em]": "tracking-label",
 *     "tracking-[0.1em]":  "tracking-label",
 *     "tracking-[0.16em]": "tracking-eyebrow",
 *     "tracking-[0.28em]": "tracking-display"
 *   }
 *
 * Dry run by default; nothing is written without --apply.
 *
 * ## What this is for
 *
 * Codebases accumulate arbitrary values. Ten different letter-spacings appear
 * where three would do, because each was chosen in isolation and none was ever
 * reconciled. This maps the accumulated set onto a deliberate scale in one
 * reviewable pass, and reports the tally per mapping so the result can be
 * sanity-checked before it is applied.
 *
 * Whole tokens only: `tracking-[0.1em]` never matches inside
 * `tracking-[0.16em]`, and the replacement is bounded the same way.
 */
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const opts = {
    root: null,
    map: null,
    exclude: ["node_modules", ".next", "dist", "build"],
    ext: [".tsx", ".jsx", ".ts", ".js", ".html"],
    apply: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") opts.apply = true;
    else if (a === "--map") opts.map = argv[++i];
    else if (a === "--exclude") opts.exclude.push(...argv[++i].split(",").map((s) => s.trim()));
    else if (a === "--ext") opts.ext = argv[++i].split(",").map((s) => s.trim());
    else rest.push(a);
  }
  opts.root = rest[0];
  return opts;
}

function walk(dir, opts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (opts.exclude.some((x) => full.includes(x))) continue;
    if (entry.isDirectory()) walk(full, opts, out);
    else if (opts.ext.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.root || !opts.map) {
  console.error(
    "usage: node css/map-class.js <dir> --map map.json [--apply]\n" +
      "       [--exclude a,b] [--ext .tsx,.jsx]"
  );
  process.exit(1);
}

let mapping;
try {
  mapping = JSON.parse(fs.readFileSync(opts.map, "utf8"));
} catch (err) {
  console.error(`could not read ${opts.map}: ${err.message}`);
  process.exit(1);
}

/* Longest keys first, so a shorter key can never shadow a longer one that
   shares its prefix. */
const keys = Object.keys(mapping).sort((a, b) => b.length - a.length);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const tally = {};
const touched = [];
let total = 0;

for (const file of walk(opts.root, opts)) {
  const src = fs.readFileSync(file, "utf8");
  let out = src;
  let hereCount = 0;

  for (const key of keys) {
    const re = new RegExp(`(?<=[\\s"'\`{])${escape(key)}(?=[\\s"'\`}])`, "g");
    const hits = (out.match(re) || []).length;
    if (!hits) continue;
    out = out.replace(re, mapping[key]);
    const label = `${key} -> ${mapping[key]}`;
    tally[label] = (tally[label] || 0) + hits;
    hereCount += hits;
  }

  if (out !== src) {
    touched.push({ file: path.relative(opts.root, file), count: hereCount });
    total += hereCount;
    if (opts.apply) fs.writeFileSync(file, out);
  }
}

console.log(
  `${opts.apply ? "APPLIED" : "DRY RUN"} — ${total} replacement${total === 1 ? "" : "s"} ` +
    `across ${touched.length} file${touched.length === 1 ? "" : "s"}`
);
for (const [label, n] of Object.entries(tally).sort()) {
  console.log(`  ${String(n).padStart(3)}  ${label}`);
}
if (!opts.apply && total > 0) {
  console.log("\nCheck those totals cover every value you expected, then re-run with --apply.");
}
