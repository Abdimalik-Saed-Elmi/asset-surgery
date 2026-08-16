#!/usr/bin/env node
/**
 * Prove that two MP4s carry byte-identical video.
 *
 *   node mp4/verify-video-identical.js original.mp4 remuxed.mp4
 *
 * Extracts every video sample from each file, concatenates them in order, and
 * compares SHA-256. Container layout, chunk offsets, track order and any
 * removed audio are all irrelevant to the comparison — only the encoded picture
 * data is hashed.
 *
 * This exists because "the video is untouched" is a claim, and a remux is
 * exactly the kind of operation where a subtle off-by-one in the sample table
 * produces a file that still plays but is not what you started with. A hash is
 * evidence; playing the output and nodding is not.
 */
const fs = require("fs");
const crypto = require("crypto");
const { parse, find, findAll, handlerOf, sampleTable } = require("./boxes");

function videoBytes(file) {
  const buf = fs.readFileSync(file);
  const moov = find(parse(buf), "moov");
  if (!moov) throw new Error("no moov box — not an MP4, or truncated");

  const trak = findAll(moov.children, "trak").find((t) => handlerOf(t) === "vide");
  if (!trak) throw new Error("no video track");

  const table = sampleTable(trak);
  if (!table) throw new Error("could not read the video sample table");

  const chunks = table.samples.map((s) => buf.slice(s.offset, s.offset + s.size));
  return {
    count: table.samples.length,
    complete: table.complete,
    buffer: Buffer.concat(chunks),
  };
}

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error("usage: node mp4/verify-video-identical.js <a.mp4> <b.mp4>");
  process.exit(1);
}

try {
  const left = videoBytes(a);
  const right = videoBytes(b);
  const hash = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
  const hl = hash(left.buffer);
  const hr = hash(right.buffer);

  const line = (label, file, v, h) =>
    `${label}  ${require("path").basename(file).padEnd(22)} ` +
    `${String(v.count).padStart(5)} samples  ` +
    `${v.buffer.length.toLocaleString().padStart(12)} B  sha256=${h.slice(0, 32)}` +
    (v.complete ? "" : "  (INCOMPLETE SAMPLE TABLE)");

  console.log(line("a", a, left, hl));
  console.log(line("b", b, right, hr));

  if (hl === hr) {
    console.log("\nVIDEO DATA IS BIT-IDENTICAL\n");
  } else {
    console.log("\nMISMATCH — the encoded picture differs between these files\n");
    if (left.count !== right.count) {
      console.log(`  sample count differs: ${left.count} vs ${right.count}`);
    }
    if (left.buffer.length !== right.buffer.length) {
      console.log(`  byte count differs: ${left.buffer.length} vs ${right.buffer.length}`);
    }
    process.exit(2);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
