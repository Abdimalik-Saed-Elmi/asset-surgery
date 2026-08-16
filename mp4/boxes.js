/**
 * Minimal MP4 (ISO BMFF) box reader, shared by the scripts in this folder.
 *
 * An MP4 is a tree of length-prefixed boxes:
 *
 *   [4 bytes size][4 bytes type][payload …]
 *
 * `size` counts the header itself. Two special cases matter in practice:
 * a size of 1 means the real 64-bit size follows the type, and a size of 0
 * means "runs to the end of the file" — which `mdat` sometimes uses.
 *
 * Only the containers we actually descend into are treated as containers.
 * Everything else is left as an opaque payload, which keeps this short and
 * avoids guessing at boxes we have no business interpreting.
 */

const CONTAINERS = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "edts",
  "udta",
]);

/** Parse the boxes between two offsets. Returns a flat list of siblings. */
function parse(buf, start = 0, end = buf.length) {
  const out = [];
  let offset = start;

  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    let header = 8;

    if (size === 1) {
      size = Number(buf.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    // A malformed or truncated box: stop rather than read past it.
    if (size < header || offset + size > end) break;

    const node = {
      type,
      start: offset,
      header,
      end: offset + size,
      /** Payload only — excludes the box header. */
      body: buf.slice(offset + header, offset + size),
    };

    if (CONTAINERS.has(type)) {
      node.children = parse(buf, offset + header, offset + size);
    }

    out.push(node);
    offset += size;
  }

  return out;
}

const findAll = (nodes, type) => (nodes || []).filter((n) => n.type === type);
const find = (nodes, type) => findAll(nodes, type)[0];

/** Descend a path of box types, e.g. path(trak, "mdia", "minf", "stbl"). */
function path(node, ...types) {
  let current = node;
  for (const t of types) {
    current = find(current?.children, t);
    if (!current) return undefined;
  }
  return current;
}

/** "vide", "soun", "text" … — read from a track's `hdlr`. */
function handlerOf(trak) {
  const hdlr = path(trak, "mdia")?.children?.find((n) => n.type === "hdlr");
  if (!hdlr) return null;
  // hdlr: version+flags (4), pre_defined (4), handler_type (4)
  return hdlr.body.toString("latin1", 8, 12);
}

/**
 * Every sample's absolute offset and size for one track.
 *
 * This is the fiddly part of the format. Sizes come from `stsz`, chunk offsets
 * from `stco` (or `co64` for large files), and the mapping from chunks to
 * samples from `stsc` — which is run-length encoded, listing only the chunks
 * where the samples-per-chunk value changes.
 */
function sampleTable(trak) {
  const stbl = path(trak, "mdia", "minf", "stbl");
  if (!stbl) return null;

  const get = (t) => find(stbl.children, t)?.body;
  const stsz = get("stsz");
  const stsc = get("stsc");
  const stco = get("stco");
  const co64 = get("co64");
  const offsets64 = !stco && !!co64;
  const chunks = stco || co64;
  if (!stsz || !stsc || !chunks) return null;

  // stsz: version+flags (4), uniform_size (4), count (4), [sizes …]
  const uniform = stsz.readUInt32BE(4);
  const count = stsz.readUInt32BE(8);
  const sizes = [];
  for (let i = 0; i < count; i++) {
    sizes.push(uniform > 0 ? uniform : stsz.readUInt32BE(12 + i * 4));
  }

  const chunkCount = chunks.readUInt32BE(4);
  const chunkOffsets = [];
  for (let i = 0; i < chunkCount; i++) {
    chunkOffsets.push(
      offsets64
        ? Number(chunks.readBigUInt64BE(8 + i * 8))
        : chunks.readUInt32BE(8 + i * 4)
    );
  }

  const entryCount = stsc.readUInt32BE(4);
  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    const o = 8 + i * 12;
    entries.push({
      firstChunk: stsc.readUInt32BE(o),
      samplesPerChunk: stsc.readUInt32BE(o + 4),
      descriptionIndex: stsc.readUInt32BE(o + 8),
    });
  }

  const samples = [];
  let index = 0;
  for (let c = 0; c < chunkCount && index < count; c++) {
    // Walk the run-length entries to find this chunk's samples-per-chunk.
    let perChunk = entries[0]?.samplesPerChunk ?? 1;
    for (const e of entries) if (c + 1 >= e.firstChunk) perChunk = e.samplesPerChunk;

    let offset = chunkOffsets[c];
    for (let s = 0; s < perChunk && index < count; s++) {
      samples.push({ offset, size: sizes[index] });
      offset += sizes[index];
      index++;
    }
  }

  return {
    samples,
    declaredCount: count,
    descriptionIndex: entries[0]?.descriptionIndex ?? 1,
    complete: samples.length === count,
  };
}

module.exports = { parse, find, findAll, path, handlerOf, sampleTable };
