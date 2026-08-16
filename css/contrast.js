#!/usr/bin/env node
/**
 * WCAG contrast ratio, from the command line.
 *
 *   node css/contrast.js "#ffffff" "#16a08d"
 *   node css/contrast.js --pairs pairs.json
 *
 * where pairs.json is [{ "fg": "#fff", "bg": "#16a08d", "label": "button" }, …]
 *
 * ## Why bother, when every design tool shows this
 *
 * Because the failures do not look like failures. White on a mid-teal measures
 * 3.26:1 — it reads as a perfectly ordinary button, and it is below the 4.5:1
 * that AA wants for text at normal size. The 3:1 allowance people half-remember
 * applies to LARGE text (18pt, or 14pt bold) and to non-text UI, not to a 12px
 * uppercase label.
 *
 * The useful move when a brand colour fails is usually to change the INK rather
 * than the brand: navy on that same teal is 5.36:1.
 */

/** Relative luminance per WCAG 2.x. */
function luminance(hex) {
  const clean = hex.replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex colour: ${hex}`);

  const [r, g, b] = full.match(/../g).map((pair) => {
    const channel = parseInt(pair, 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** AA is 4.5:1 for normal text, 3:1 for large text and non-text UI. */
function verdict(r) {
  return {
    ratio: +r.toFixed(2),
    aaNormal: r >= 4.5,
    aaLarge: r >= 3,
    aaaNormal: r >= 7,
  };
}

function report(fg, bg, label) {
  const v = verdict(ratio(fg, bg));
  const mark = v.aaNormal ? "PASS" : v.aaLarge ? "large/UI only" : "FAIL";
  console.log(
    `${String(v.ratio).padStart(6)}:1  ${mark.padEnd(15)} ` +
      `${fg} on ${bg}${label ? `  — ${label}` : ""}`
  );
  return v;
}

/* Only run the CLI when invoked directly. Without this guard, `require()`ing
   this file for its luminance/ratio helpers also executes the argument parsing
   and exits — which is exactly what happened the first time the tests imported
   it. */
if (require.main === module) main();

function main() {
const args = process.argv.slice(2);

try {
  if (args[0] === "--pairs") {
    const file = args[1];
    if (!file) throw new Error("--pairs needs a JSON file");
    const pairs = JSON.parse(require("fs").readFileSync(file, "utf8"));
    let failures = 0;
    for (const p of pairs) {
      const v = report(p.fg, p.bg, p.label);
      if (!v.aaNormal) failures++;
    }
    console.log(`\n${pairs.length} pairs, ${failures} below AA for normal text`);
    if (failures) process.exitCode = 2;
  } else if (args.length === 2) {
    const v = report(args[0], args[1]);
    if (!v.aaNormal) process.exitCode = 2;
  } else {
    console.error(
      "usage:\n" +
        "  node css/contrast.js <foreground> <background>\n" +
        "  node css/contrast.js --pairs pairs.json"
    );
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
}

module.exports = { luminance, ratio, verdict };
