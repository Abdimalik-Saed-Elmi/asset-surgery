#!/usr/bin/env node
/**
 * What is this MP4?
 *
 *   node mp4/probe.js clip.mp4 [more.mp4 …]
 *
 * Dimensions, duration, codecs, track handlers and bitrate — enough to answer
 * "is this actually 1080p, and does it carry audio I do not want?"
 */
const fs = require("fs");
const { parse, find, findAll, path, handlerOf } = require("./boxes");

function probe(file) {
  const buf = fs.readFileSync(file);
  const top = parse(buf);

  const ftyp = find(top, "ftyp");
  const moov = find(top, "moov");
  if (!moov) throw new Error("no moov box — not an MP4, or truncated");

  const result = {
    file: require("path").basename(file),
    bytes: buf.length,
    brand: ftyp ? ftyp.body.toString("latin1", 0, 4) : null,
    duration: null,
    tracks: [],
  };

  // mvhd: version(1) flags(3) creation modification timescale duration
  const mvhd = find(moov.children, "mvhd");
  if (mvhd) {
    const version = mvhd.body[0];
    const base = 4;
    if (version === 0) {
      const timescale = mvhd.body.readUInt32BE(base + 8);
      const duration = mvhd.body.readUInt32BE(base + 12);
      if (timescale) result.duration = +(duration / timescale).toFixed(2);
    } else {
      const timescale = mvhd.body.readUInt32BE(base + 16);
      const duration = Number(mvhd.body.readBigUInt64BE(base + 20));
      if (timescale) result.duration = +(duration / timescale).toFixed(2);
    }
  }

  for (const trak of findAll(moov.children, "trak")) {
    const kind = handlerOf(trak);
    const track = { kind, codec: null, width: null, height: null };

    // tkhd carries the display size as 16.16 fixed point in its last 8 bytes.
    const tkhd = find(trak.children, "tkhd");
    if (tkhd && kind === "vide") {
      const w = tkhd.body.readUInt32BE(tkhd.body.length - 8) / 65536;
      const h = tkhd.body.readUInt32BE(tkhd.body.length - 4) / 65536;
      if (w > 0 && h > 0) {
        track.width = Math.round(w);
        track.height = Math.round(h);
      }
    }

    // stsd: version+flags(4) entry_count(4) then [size(4)][format(4)] …
    const stsd = find(path(trak, "mdia", "minf", "stbl")?.children || [], "stsd");
    if (stsd) track.codec = stsd.body.toString("latin1", 12, 16);

    result.tracks.push(track);
  }

  if (result.duration) {
    result.bitrateKbps = Math.round((buf.length * 8) / result.duration / 1000);
  }
  return result;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node mp4/probe.js <file.mp4> [more.mp4 …]");
  process.exit(1);
}

for (const file of files) {
  try {
    const r = probe(file);
    const video = r.tracks.find((t) => t.kind === "vide");
    const hasAudio = r.tracks.some((t) => t.kind === "soun");
    console.log(
      [
        r.file.padEnd(24),
        `${(r.bytes / 1024).toFixed(0).padStart(7)} KB`,
        video && video.width ? `${video.width}x${video.height}`.padStart(10) : "        — ",
        r.duration ? `${String(r.duration).padStart(6)}s` : "      —",
        r.bitrateKbps ? `${String(r.bitrateKbps).padStart(5)} kbps` : "          ",
        r.tracks.map((t) => t.codec || t.kind).join("+").padEnd(12),
        hasAudio ? "HAS AUDIO" : "",
      ].join("  ")
    );
  } catch (err) {
    console.error(`${file}: ${err.message}`);
    process.exitCode = 1;
  }
}
