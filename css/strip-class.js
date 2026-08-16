#!/usr/bin/env node
/**
 * Remove utility classes from specific JSX elements.
 *
 *   node css/strip-class.js ./src --tags h1,h2,h3,h4,h5,h6 \
 *     --classes font-black,font-bold,font-extrabold
 *   node css/strip-class.js ./src --tags h1,h2 --classes font-black --apply
 *
 * Dry run by default. Nothing is written without --apply.
 *
 * ## What this is for
 *
 * Centralising a property that has been overridden everywhere. A base rule like
 *
 *     h1, h2, h3 { font-weight: 600 }
 *
 * governs nothing while individual headings carry their own weight class,
 * because a class selector outranks an element selector. Stripping those
 * classes is what makes the base rule the single source of truth — after which
 * changing every heading is a one-line edit rather than another sweep.
 *
 * ## Trust it only after cross-checking
 *
 * The count it reports should agree with an independent grep before you run it
 * with --apply, and the result should typecheck. Both were true on the sweep
 * this came from: 122 classes across 69 files, matching a separate count
 * exactly, with the type checker clean afterwards.
 */
const fs = require("fs");
const path = require("path");
const { findOpeningTags, removeClasses } = require("./jsx-tags");

function parseArgs(argv) {
  const opts = {
    root: null,
    tags: [],
    classes: [],
    exclude: ["node_modules", ".next", "dist", "build"],
    ext: [".tsx", ".jsx"],
    apply: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") opts.apply = true;
    else if (a === "--tags") opts.tags = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--classes") opts.classes = argv[++i].split(",").map((s) => s.trim());
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

function processFile(file, opts) {
  const src = fs.readFileSync(file, "utf8");
  const tags = findOpeningTags(src, opts.tags);
  if (tags.length === 0) return null;

  let out = "";
  let cursor = 0;
  let removed = 0;

  for (const { start, end } of tags) {
    const original = src.slice(start, end);
    const rewritten = removeClasses(original, opts.classes);
    if (rewritten !== original) {
      for (const cls of opts.classes) {
        const hits = original.split(new RegExp(`\\b${cls}\\b`)).length - 1;
        removed += hits;
      }
    }
    out += src.slice(cursor, start) + rewritten;
    cursor = end;
  }
  out += src.slice(cursor);

  return out === src ? null : { out, removed };
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.root || opts.tags.length === 0 || opts.classes.length === 0) {
  console.error(
    "usage: node css/strip-class.js <dir> --tags h1,h2 --classes font-black[,…] [--apply]\n" +
      "       [--exclude a,b] [--ext .tsx,.jsx]"
  );
  process.exit(1);
}
if (!fs.existsSync(opts.root)) {
  console.error(`no such directory: ${opts.root}`);
  process.exit(1);
}

const changed = [];
let total = 0;
for (const file of walk(opts.root, opts)) {
  const result = processFile(file, opts);
  if (!result) continue;
  changed.push({ file: path.relative(opts.root, file), removed: result.removed });
  total += result.removed;
  if (opts.apply) fs.writeFileSync(file, result.out);
}

console.log(
  `${opts.apply ? "APPLIED" : "DRY RUN"} — ${total} class${total === 1 ? "" : "es"} ` +
    `removed from ${changed.length} file${changed.length === 1 ? "" : "s"}`
);
for (const c of changed.slice(0, 20)) {
  console.log(`  ${String(c.removed).padStart(3)}  ${c.file}`);
}
if (changed.length > 20) console.log(`  … and ${changed.length - 20} more`);
if (!opts.apply && total > 0) {
  console.log("\nCross-check that count with grep, then re-run with --apply.");
}
