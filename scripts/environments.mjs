// Prints the name of every named environment in wrangler.jsonc, one per line.
// CI uses it to bundle-check each configured deployment without hard-coding
// the list, so adding an environment needs no CI change.
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../wrangler.jsonc", import.meta.url),
  "utf8",
);
const json = source
  // Drop comments, but never inside a string literal: the alternation matches
  // whole strings first so their contents are handed back untouched.
  .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match) =>
    match.startsWith('"') ? match : "",
  )
  .replace(/,(\s*[}\]])/g, "$1");

const names = Object.keys(JSON.parse(json).env ?? {});
if (names.length > 0) console.log(names.join("\n"));
