#!/usr/bin/env node
/**
 * Tests. Zero dependencies, like everything else here.
 *
 *   node test/run.js
 *
 * Exits non-zero on failure, so it works as a CI step or a pre-push hook.
 *
 * ## What is actually being protected
 *
 * Two bugs were found by hand-checking a fixture during development, and both
 * produced code that STILL COMPILED — which is exactly why they need tests
 * rather than a careful reading:
 *
 *   1. Whitespace tidying ran across the whole tag, turning
 *      `${dark ? "a>b" : "c"}` into `${dark ?"a>b":"c"}` and flattening the
 *      indentation of multi-line tags.
 *   2. The first-token pattern lacked a trailing word boundary, so removing
 *      `font-bold` turned `"font-bolder …"` into `"er …"`.
 *
 * Neither would fail a typecheck. Both are asserted below.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { findOpeningTags, removeClasses, endOfOpeningTag } = require("../css/jsx-tags");
const { luminance, ratio, verdict } = require("../css/contrast");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`         ${err.message}`);
  }
}

/* ---------------------------------------------------------------- jsx-tags */

console.log("\njsx-tags");

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "headings.tsx"),
  "utf8"
);

test("stops at the `>` that closes the tag, not one inside a template literal", () => {
  const src = '<h2 className={`a ${d ? "x>y" : "z"}`}>text</h2>';
  const end = endOfOpeningTag(src, 0);
  assert.strictEqual(src[end], ">");
  // The tag span must swallow the decoy `>` and end just before the content.
  assert.ok(src.slice(0, end).includes('"x>y"'), "stopped at the decoy > inside the literal");
  assert.strictEqual(src.slice(end + 1, end + 5), "text");
});

test("finds every heading in the fixture and no more", () => {
  const tags = findOpeningTags(FIXTURE, ["h1", "h2", "h3", "h4", "h5", "h6"]);
  assert.strictEqual(tags.length, 5, `expected 5 headings, found ${tags.length}`);
});

test("does not match a tag name that merely starts the same", () => {
  const src = '<h1Wrapper className="font-black">x</h1Wrapper>';
  assert.strictEqual(findOpeningTags(src, ["h1"]).length, 0);
});

test("removes a class from the middle of a string", () => {
  const out = removeClasses('className="text-3xl font-black text-white"', ["font-black"]);
  assert.strictEqual(out, 'className="text-3xl text-white"');
});

test("removes a class that is the first token", () => {
  const out = removeClasses('className="font-black text-sm"', ["font-black"]);
  assert.strictEqual(out, 'className="text-sm"');
});

test("removes a class that is the only token", () => {
  const out = removeClasses('className="font-black"', ["font-black"]);
  assert.strictEqual(out, 'className=""');
});

test("REGRESSION: font-bold does not match inside font-bolder", () => {
  const out = removeClasses('className="font-bolder tracking-tight"', ["font-bold"]);
  assert.strictEqual(
    out,
    'className="font-bolder tracking-tight"',
    "a prefix match corrupted the class list"
  );
});

test("REGRESSION: spacing inside a ternary is left alone", () => {
  const input = 'className={`text-xl font-bold ${dark ? "a>b" : "c"} tracking-tight`}';
  const out = removeClasses(input, ["font-bold"]);
  assert.ok(
    out.includes('${dark ? "a>b" : "c"}'),
    `expression spacing was rewritten: ${out}`
  );
});

test("REGRESSION: indentation of a multi-line tag survives", () => {
  const tags = findOpeningTags(FIXTURE, ["h2"]);
  const original = FIXTURE.slice(tags[0].start, tags[0].end);
  const out = removeClasses(original, ["font-bold"]);
  assert.ok(out.includes("\n        className="), "leading indentation was collapsed");
});

/* ---------------------------------------------------------------- contrast */

console.log("\ncontrast");

test("white on white is 1:1", () => {
  assert.strictEqual(+ratio("#ffffff", "#ffffff").toFixed(2), 1);
});

test("black on white is 21:1", () => {
  assert.strictEqual(+ratio("#000000", "#ffffff").toFixed(0), 21);
});

test("shorthand hex is expanded", () => {
  assert.strictEqual(ratio("#fff", "#000"), ratio("#ffffff", "#000000"));
});

test("order does not matter", () => {
  assert.strictEqual(ratio("#16a08d", "#ffffff"), ratio("#ffffff", "#16a08d"));
});

test("the pair this tool was written for still fails AA", () => {
  const v = verdict(ratio("#ffffff", "#16a08d"));
  assert.strictEqual(v.ratio, 3.26);
  assert.strictEqual(v.aaNormal, false);
  assert.strictEqual(v.aaLarge, true, "should still clear the 3:1 large-text bar");
});

test("navy ink on the same teal passes AA", () => {
  const v = verdict(ratio("#021a36", "#16a08d"));
  assert.strictEqual(v.ratio, 5.36);
  assert.strictEqual(v.aaNormal, true);
});

test("rejects a value that is not a hex colour", () => {
  assert.throws(() => luminance("teal"), /not a hex colour/);
});

/* ------------------------------------------------- codemod, end to end */

console.log("\nstrip-class (end to end)");

test("applies to a real file and leaves non-headings untouched", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-surgery-"));
  const file = path.join(dir, "headings.tsx");
  fs.writeFileSync(file, FIXTURE);

  const { execFileSync } = require("child_process");
  execFileSync(
    process.execPath,
    [
      path.join(__dirname, "..", "css", "strip-class.js"),
      dir,
      "--tags", "h1,h2,h3,h4,h5,h6",
      "--classes", "font-black,font-bold,font-extrabold",
      "--apply",
    ],
    { stdio: "pipe" }
  );

  const out = fs.readFileSync(file, "utf8");
  assert.ok(!/(<h[1-6][^>]*font-black)/s.test(out), "a heading kept font-black");
  assert.ok(out.includes('<p className="font-black">'), "the <p> was modified");
  assert.ok(out.includes('className="font-bolder'), "font-bolder was corrupted");
  assert.ok(out.includes('${dark ? "a>b" : "c"}'), "ternary spacing was rewritten");

  fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ done */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
