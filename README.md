# asset-surgery

Small, zero-dependency Node scripts for inspecting and rewriting front-end
assets — MP4 containers and CSS class usage.

No `npm install`. No `ffmpeg`. Every script is plain Node with nothing but the
standard library, because each one was written at a moment when the obvious tool
was unavailable and the job still had to happen.

## Why this exists

These came out of one afternoon's work on a marketing site, in the order the
problems appeared:

- A hero video was **half inaudible audio** — 156 KB of a 306 KB file, on a
  `<video muted>` element. `ffmpeg` would not install. Dropping a track turns out
  not to need a re-encode at all, only a rebuilt container.
- A stylesheet had **122 heading weight overrides across 69 files**, and a regex
  could not safely find them: JSX opening tags span lines and can contain `>`
  inside a template literal.
- Ten ad-hoc `letter-spacing` values had accumulated where three would do.
- Several colour pairs looked fine and measured badly.

Each script solves exactly one of those and nothing more.

## MP4 tools

Everything here parses the box tree directly. MP4 is a tree of length-prefixed
boxes; the useful metadata lives in `moov`, and sample locations live in
`stsz` / `stsc` / `stco` inside each track's `stbl`.

### `mp4/probe.js` — what is this file?

```bash
node mp4/probe.js clip.mp4
```

Dimensions, duration, codecs, track handlers, bitrate. Enough to answer "is this
actually 1080p, and does it have audio I do not want?"

### `mp4/track-sizes.js` — where are the bytes going?

```bash
node mp4/track-sizes.js clip.mp4
```

Sums the sample table per track and reports each one's share of the file. This
is the script that found a background video spending **51% of its bytes on an
audio track nobody could hear**.

### `mp4/strip-audio.js` — remove a track without re-encoding

```bash
node mp4/strip-audio.js input.mp4 output.mp4
```

Rebuilds the container as `ftyp + moov + mdat`, dropping non-video tracks.

**The video is not re-encoded.** Sample bytes are copied verbatim, so the picture
is bit-identical to the source — this is a remux, and it takes about as long as
a file copy.

Two details worth knowing:

- **`moov` is written before `mdat`**, which is what `-movflags +faststart`
  achieves in ffmpeg: playback can begin before the whole file has arrived.
- **Chunk offsets are recomputed.** `stco` holds absolute file offsets, so they
  cannot survive a layout change. The script writes one sample per chunk, which
  makes `stco` a straight list and removes any dependence on the source's
  interleaving — which existed to serve the audio track being removed.

Typical result on real footage: **−51%** on one clip, **−17%** on another whose
video bitrate was much higher. Measure; do not assume.

### `mp4/verify-video-identical.js` — prove the picture did not change

```bash
node mp4/verify-video-identical.js original.mp4 stripped.mp4
```

Extracts every video sample from both files, concatenates, and compares SHA-256.
Written because "the video should be untouched" is a claim, and a hash is
evidence. Use it after `strip-audio.js` rather than trusting the output.

## CSS tools

### `css/contrast.js` — WCAG contrast, from the command line

```bash
node css/contrast.js "#ffffff" "#16a08d"
node css/contrast.js --pairs pairs.json
```

Reports the ratio and whether it clears AA at normal and large sizes.

The pair that prompted it: white on a mid-teal measures **3.26:1**. It looks
perfectly fine. AA wants 4.5:1 for text that size, and swapping the *ink* to navy
rather than darkening the brand colour gives 5.36:1.

### `css/strip-class.js` — remove utility classes from specific JSX elements

```bash
node css/strip-class.js ./src --tags h1,h2,h3,h4,h5,h6 \
  --classes font-black,font-bold,font-extrabold
node css/strip-class.js ./src --tags h1,h2 --classes font-black --apply
```

Dry run by default; `--apply` writes.

**This is a scanner, not a regex**, and that is the entire point. A JSX opening
tag can span many lines and can contain `>` inside a template literal:

```jsx
<h2 className={`text-xl ${dark ? "a>b" : "c"}`}>
```

Matching to the first `>` corrupts that file. The scanner tracks quote and brace
state and stops at the `>` that actually closes the tag. It also only removes
whole class tokens, so `font-bold` never matches inside `font-bolder`.

### `css/map-class.js` — collapse ad-hoc values onto a scale

```bash
node css/map-class.js ./src --map map.json --apply
```

Where `map.json` is `{ "tracking-[0.28em]": "tracking-display", … }`.

For when a codebase has accumulated ten arbitrary values doing the work of
three, and you want the replacement to be reviewable rather than a find-and-
replace you have to trust.

## Tests

```bash
npm test        # or: node test/run.js
```

Zero dependencies here too — plain `assert`, exiting non-zero on failure.

The suite exists because of two bugs found by hand during development, **both of
which produced code that still compiled**: a whitespace tidy that rewrote
`${dark ? "a>b" : "c"}` into `${dark ?"a>b":"c"}`, and a missing word boundary
that turned `"font-bolder"` into `"er"`. Neither would fail a typecheck, so
neither would have been caught by anything except looking. They are pinned as
regression tests now.

## Conventions

- Every script **dry-runs by default**; writing requires `--apply`.
- Every script **reports what it changed**, and the counts are meant to be
  cross-checked against an independent `grep` before you trust them.
- No script takes a dependency, so any of them can be copied into a project on
  its own.

## Licence

MIT — see [LICENSE](LICENSE).
