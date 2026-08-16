#!/usr/bin/env node
/**
 * Where are this file's bytes actually going?
 *
 *   node mp4/track-sizes.js clip.mp4
 *
 * Sums each track's sample table and reports its share of the file. Container
 * overhead is whatever is left over.
 *
 * This is the script that found a `<video muted>` background clip spending 51%
 * of its bytes on an audio track no visitor could ever hear. That is the sort
 * of thing you do not go looking for — it only shows up if you measure.
 */
const fs = require("fs");
const { parse, find, findAll, handlerOf, sampleTable } = require("./boxes");

const LABELS = { vide: "video", soun: "audio", text: "text", sbtl: "subtitle" };

function report(file) {
  const buf = fs.readFileSync(file);
  const moov = find(parse(buf), "moov");
  if (!moov) throw new Error("no moov box — not an MP4, or truncated");

  const rows = [];
  let accounted = 0;

  for (const trak of findAll(moov.children, "trak")) {
    const kind = handlerOf(trak);
    const table = sampleTable(trak);
    if (!table) continue;

    const bytes = table.samples.reduce((sum, s) => sum + s.size, 0);
    accounted += bytes;
    rows.push({
      track: LABELS[kind] || kind || "unknown",
      samples: table.samples.length,
      bytes,
      share: (bytes / buf.length) * 100,
      complete: table.complete,
    });
  }

  console.log(`\n${require("path").basename(file)} — ${buf.length.toLocaleString()} bytes\n`);
  for (const r of rows) {
    console.log(
      `  ${r.track.padEnd(9)} ${String(r.samples).padStart(6)} samples  ` +
        `${r.bytes.toLocaleString().padStart(12)} B  ${r.share.toFixed(1).padStart(5)}%` +
        (r.complete ? "" : "   (sample table incomplete)")
    );
  }

  const overhead = buf.length - accounted;
  console.log(
    `  ${"container".padEnd(9)} ${"".padStart(6)}          ` +
      `${overhead.toLocaleString().padStart(12)} B  ` +
      `${((overhead / buf.length) * 100).toFixed(1).padStart(5)}%`
  );

  const audio = rows.find((r) => r.track === "audio");
  if (audio) {
    console.log(
      `\n  Removing the audio track would save ~${Math.round(audio.bytes / 1024)} KB ` +
        `(${audio.share.toFixed(1)}% of the file).` +
        `\n  If this is a muted background video, see mp4/strip-audio.js.\n`
    );
  } else {
    console.log("\n  No audio track.\n");
  }
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node mp4/track-sizes.js <file.mp4> [more.mp4 …]");
  process.exit(1);
}
for (const f of files) {
  try {
    report(f);
  } catch (err) {
    console.error(`${f}: ${err.message}`);
    process.exitCode = 1;
  }
}
