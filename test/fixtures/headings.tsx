/* Fixture for the JSX codemods. Every element here exists to pin one specific
   behaviour — see test/run.js for what each is asserting. Do not tidy this
   file; the awkward formatting is the point. */
export function Fixture({ dark }: { dark: boolean }) {
  return (
    <div>
      {/* plain case: weight in the middle of a class string */}
      <h1 className="text-3xl font-black tracking-[0.28em] text-white">Title</h1>

      {/* the case a regex cannot survive: a `>` inside a template literal,
          and an opening tag spanning three lines */}
      <h2
        className={`text-xl font-bold ${dark ? "a>b" : "c"} tracking-[0.1em]`}
      >
        Spans lines and hides a greater-than
      </h2>

      {/* prefix trap: font-bold must not match inside font-bolder */}
      <h3 className="font-bolder tracking-[0.16em]">not font-bold</h3>

      {/* weight is the only class present */}
      <h4 className="font-black">only class</h4>

      {/* weight is the first of several */}
      <h5 className="font-black text-sm">first of several</h5>

      {/* not a heading: must be left completely alone */}
      <p className="font-black">untouched</p>
    </div>
  );
}
