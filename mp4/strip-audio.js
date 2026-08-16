#!/usr/bin/env node
/**
 * Remove non-video tracks from an MP4 without re-encoding.
 *
 *   node mp4/strip-audio.js input.mp4 output.mp4
 *
 * This is a REMUX, not a transcode. Video sample bytes are copied verbatim, so
 * the picture is bit-identical to the source and the whole thing runs at about
 * the speed of a file copy. Verify it with mp4/verify-video-identical.js rather
 * than taking that claim on trust.
 *
 * ## Why this is not just "delete the audio boxes"
 *
 * `stco` holds ABSOLUTE file offsets for each chunk of samples. Removing a
 * track changes the layout of `mdat`, so every one of those offsets is wrong
 * afterwards. They have to be recomputed, which means the file has to be
 * rebuilt rather than edited in place.
 *
 * The output is written as `ftyp + moov + mdat`, with `moov` BEFORE the media
 * data — this is what `-movflags +faststart` does in ffmpeg, and it lets a
 * player begin before the whole file has arrived. Since `moov` contains the
 * offsets that depend on where `moov` ends, its length is measured first and
 * the offsets filled in afterwards. That is safe because the number of entries
 * — and therefore the size of the box — does not depend on the values.
 *
 * Samples are written one per chunk, which makes `stsc` a single entry and
 * `stco` a straight list. The source's interleaving existed to serve playback
 * of the audio track being removed, so there is nothing to preserve.
 */
const fs = require("fs");
const { parse, find, findAll, path, handlerOf, sampleTable } = require("./boxes");

function stripToVideo(inputPath, outputPath) {
  const src = fs.readFileSync(inputPath);
  const top = parse(src);

  const ftyp = find(top, "ftyp");
  const moov = find(top, "moov");
  if (!moov) throw new Error("no moov box — not an MP4, or truncated");

  const traks = findAll(moov.children, "trak");
  const video = traks.find((t) => handlerOf(t) === "vide");
  if (!video) throw new Error("no video track to keep");

  const dropped = traks.filter((t) => t !== video);
  if (dropped.length === 0) {
    throw new Error("nothing to remove — this file already has only a video track");
  }

  const table = sampleTable(video);
  if (!table) throw new Error("could not read the video sample table");
  if (!table.complete) {
    throw new Error(
      `sample table mismatch: mapped ${table.samples.length} of ${table.declaredCount} samples`
    );
  }

  /* --- rewrite the video track's chunk boxes ----------------------------- */

  const stbl = path(video, "mdia", "minf", "stbl");
  const stscBox = find(stbl.children, "stsc");
  const stcoBox = find(stbl.children, "stco") || find(stbl.children, "co64");

  // One sample per chunk: a single stsc entry describes the whole track.
  const stsc = Buffer.alloc(20);
  stsc.writeUInt32BE(0, 0); // version + flags
  stsc.writeUInt32BE(1, 4); // entry count
  stsc.writeUInt32BE(1, 8); // first_chunk
  stsc.writeUInt32BE(1, 12); // samples_per_chunk
  stsc.writeUInt32BE(table.descriptionIndex, 16);
  stscBox.override = stsc;

  // Sized now, values filled once we know where mdat starts.
  const count = table.samples.length;
  const stco = Buffer.alloc(8 + count * 4);
  stco.writeUInt32BE(0, 0);
  stco.writeUInt32BE(count, 4);
  stcoBox.override = stco;
  // 32-bit offsets are ample here; a co64 source is downgraded deliberately.
  stcoBox.type = "stco";

  moov.children = moov.children.filter((c) => !dropped.includes(c));

  /* --- serialise ---------------------------------------------------------- */

  const serialise = (node) => {
    const payload = node.children
      ? Buffer.concat(node.children.map(serialise))
      : node.override !== undefined
        ? node.override
        : node.body;
    const head = Buffer.alloc(8);
    head.writeUInt32BE(payload.length + 8, 0);
    head.write(node.type, 4, "latin1");
    return Buffer.concat([head, payload]);
  };

  const ftypBuf = ftyp ? serialise(ftyp) : Buffer.alloc(0);
  // Measure moov with placeholder offsets — its LENGTH does not depend on the
  // offset values, only on how many there are.
  let moovBuf = serialise(moov);
  const mdatStart = ftypBuf.length + moovBuf.length + 8; // +8 = mdat header

  let cursor = mdatStart;
  for (let i = 0; i < count; i++) {
    stco.writeUInt32BE(cursor, 8 + i * 4);
    cursor += table.samples[i].size;
  }
  moovBuf = serialise(moov); // re-serialise with the real offsets

  const media = Buffer.concat(
    table.samples.map((s) => src.slice(s.offset, s.offset + s.size))
  );
  const mdatHead = Buffer.alloc(8);
  mdatHead.writeUInt32BE(media.length + 8, 0);
  mdatHead.write("mdat", 4, "latin1");

  const out = Buffer.concat([ftypBuf, moovBuf, mdatHead, media]);
  fs.writeFileSync(outputPath, out);

  return {
    input: src.length,
    output: out.length,
    saved: src.length - out.length,
    savedPercent: +(((src.length - out.length) / src.length) * 100).toFixed(1),
    videoSamples: count,
    videoBytes: media.length,
    tracksRemoved: dropped.map((t) => handlerOf(t)),
    moovBeforeMdat: true,
  };
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node mp4/strip-audio.js <input.mp4> <output.mp4>");
  process.exit(1);
}
if (require("path").resolve(input) === require("path").resolve(output)) {
  console.error("refusing to overwrite the input in place — choose a different output path");
  process.exit(1);
}

try {
  const r = stripToVideo(input, output);
  console.log(JSON.stringify(r, null, 1));
  console.log(
    `\nVerify the picture is untouched:\n` +
      `  node mp4/verify-video-identical.js "${input}" "${output}"\n`
  );
} catch (err) {
  console.error(`${input}: ${err.message}`);
  process.exit(1);
}
