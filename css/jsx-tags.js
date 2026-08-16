/**
 * Finding JSX opening tags safely — the shared piece behind the codemods here.
 *
 * ## Why a scanner and not a regular expression
 *
 * The obvious approach is to match from `<h2` to the first `>`. It is wrong,
 * and it is wrong in a way that silently corrupts source files:
 *
 *     <h2 className={`text-xl ${dark ? "a>b" : "c"}`}>
 *
 * That `>` inside the template literal ends the match early, so a rewrite
 * truncates the tag and produces a file that no longer parses. Opening tags
 * also routinely span many lines, which rules out line-based matching too.
 *
 * So: walk the characters, track whether we are inside a string or inside
 * braces, and stop only at a `>` that is genuinely at depth zero and unquoted.
 *
 * This was written after a sweep across 69 files. It agreed exactly with an
 * independent count, which is the only reason it was trusted.
 */

/**
 * Index of the `>` that closes the opening tag beginning at `start`.
 * Returns -1 if the tag is unterminated.
 */
function endOfOpeningTag(src, start) {
  let i = start;
  let quote = null; // ' " or `
  let braces = 0;

  while (i < src.length) {
    const c = src[i];

    if (quote) {
      if (c === "\\") {
        i += 2; // skip the escaped character whatever it is
        continue;
      }
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === "`") {
      quote = c;
    } else if (c === "{") {
      braces++;
    } else if (c === "}") {
      braces--;
    } else if (c === ">" && braces === 0) {
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Every opening tag for the given tag names, as { start, end } offsets.
 * `tags` is a list like ["h1","h2"]; matching is exact, so "h1" never matches
 * "h1Wrapper".
 */
function findOpeningTags(src, tags) {
  const pattern = new RegExp(`<(?:${tags.join("|")})(?=[\\s/>])`, "g");
  const out = [];
  let m;
  while ((m = pattern.exec(src))) {
    const end = endOfOpeningTag(src, m.index);
    if (end !== -1) out.push({ start: m.index, end });
  }
  return out;
}

/**
 * Remove whole class tokens from a class string.
 *
 * Whole tokens only: removing `font-bold` must never touch `font-bolder`, and
 * must not fire on a substring inside another word. The lookbehind/lookahead
 * pair restricts matches to tokens bounded by whitespace or a string delimiter.
 */
function removeClasses(fragment, classes) {
  let out = fragment;

  for (const cls of classes) {
    const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    /* `(?![\w-])` is what keeps `font-bold` from matching the first eight
       characters of `font-bolder`. Both patterns need it: an earlier version
       had the guard on the first only, and turned `"font-bolder …"` into
       `"er …"` — a corruption that still compiles. */

    // Usual case: the class has whitespace before it. Take that whitespace with
    // it, so no double space is left behind and nothing else has to be tidied.
    out = out.replace(new RegExp(`[ \\t]+${escaped}(?![\\w-])`, "g"), "");

    // First token in the string or expression: no leading whitespace to take,
    // so take the trailing whitespace instead.
    out = out.replace(new RegExp(`(?<=["'\`{])${escaped}(?![\\w-])[ \\t]*`, "g"), "");
  }

  return out;
}
/*
 * Note on what deliberately does NOT happen here.
 *
 * An earlier version removed the class and then tidied whitespace across the
 * whole tag: collapse double spaces, drop spaces next to quotes. It produced
 * valid code and mangled everything else in the tag —
 *
 *     ${dark ? "a>b" : "c"}   became   ${dark ?"a>b":"c"}
 *
 * and multi-line tags lost their indentation. A codemod that reformats code it
 * was not asked to touch buries the real change in noise, so removal now takes
 * exactly one adjacent run of spaces and nothing else is rewritten.
 */

module.exports = { endOfOpeningTag, findOpeningTags, removeClasses };
