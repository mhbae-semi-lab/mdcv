// Lists every t("...") string in the web app that has no English entry (and English entries nobody uses).
// Usage: node scripts/i18n-check.mjs [--json]   exit 1 when something is missing
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../apps/web/app/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|mjs)$/.test(f) && !f.startsWith("i18n-en")) files.push(p);
  }
})(root);

const used = new Set();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) used.add(JSON.parse(`"${m[1]}"`));
  // labels passed through t() indirectly (arrays of [key, "label"], RULE_TYPES, FAQ, step titles)
  for (const m of src.matchAll(/\[\s*"[a-z_]+"\s*,\s*"((?:[^"\\]|\\.)*[가-힣](?:[^"\\]|\\.)*)"/g)) used.add(JSON.parse(`"${m[1]}"`));
  for (const m of src.matchAll(/^\s*\["((?:[^"\\]|\\.)*[가-힣](?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\]/gm)) { used.add(JSON.parse(`"${m[1]}"`)); used.add(JSON.parse(`"${m[2]}"`)); }
  for (const m of src.matchAll(/:\s*"((?:[^"\\]|\\.)*[가-힣](?:[^"\\]|\\.)*)"\s*[,}]/g)) used.add(JSON.parse(`"${m[1]}"`));
}
const { EN } = await import(new URL("../apps/web/app/lib/i18n-en.ts", import.meta.url));
const missing = [...used].filter((k) => /[가-힣]/.test(k) && !(k in EN)).sort();
if (process.argv.includes("--json")) console.log(JSON.stringify(missing, null, 1));
else {
  for (const k of missing) console.log("missing:", k);
  console.log(`${used.size} strings, ${missing.length} without English`);
}
process.exit(missing.length ? 1 : 0);
