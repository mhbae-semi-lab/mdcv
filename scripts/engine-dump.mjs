// Prints the TypeScript engine's classification of every mail in the given JSON files (used by scripts/parity.py).
// Usage: node scripts/engine-dump.mjs tests/golden.json packages/shared/samples/fab-dev-30.json
import { readFileSync } from "node:fs";
import { RuleClassifier } from "../packages/engine/classifier.ts";

const clf = new RuleClassifier();
const out = {};
for (const file of process.argv.slice(2)) {
  for (const mail of JSON.parse(readFileSync(file, "utf8"))) out[mail.id] = clf.classify(mail);
}
process.stdout.write(JSON.stringify(out));
