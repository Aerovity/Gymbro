// Incremental extractor for a top-level-ish string value inside a growing (incomplete) JSON text.
// Browser-safe, no imports.

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/** Read a JSON string starting just after its opening quote. Stops cleanly at an incomplete escape. */
function readString(s: string, start: number): { value: string; end: number; closed: boolean } {
  let out = "";
  let i = start;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') return { value: out, end: i + 1, closed: true };
    if (ch === "\\") {
      if (i + 1 >= s.length) break; // incomplete escape
      const e = s[i + 1];
      if (e === "u") {
        const hex = s.slice(i + 2, i + 6);
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
          if (hex.length < 4 && /^[0-9a-fA-F]*$/.test(hex)) break; // incomplete \u escape
          out += hex; // malformed: be lenient
          i += 2 + hex.length;
          continue;
        }
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      out += SIMPLE_ESCAPES[e] ?? e;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return { value: out, end: i, closed: false };
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;

/**
 * Returns the (possibly partial) string value of `"key": "..."` from incomplete JSON.
 * Handles escapes (including \uXXXX and incomplete trailing escapes). Returns "" if the key or
 * its value has not appeared yet, or if the value is not a string.
 */
export function extractPartialString(partialJson: string, key: string): string {
  const s = partialJson;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch !== '"') {
      i++;
      continue;
    }
    const str = readString(s, i + 1);
    if (!str.closed) return "";
    i = str.end;
    // Is this string an object key?
    let j = i;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (s[j] !== ":") continue;
    if (str.value !== key) {
      i = j + 1;
      continue;
    }
    j++;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (j >= s.length || s[j] !== '"') return "";
    let value = readString(s, j + 1).value;
    if (value.length && isHighSurrogate(value.charCodeAt(value.length - 1))) value = value.slice(0, -1);
    return value;
  }
  return "";
}
