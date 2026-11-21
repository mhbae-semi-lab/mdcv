// Rough speed check: rule classification and mbox parsing on this machine (node scripts/bench.mjs).
import { readFileSync } from "node:fs";
import { RuleClassifier } from "../packages/engine/classifier.ts";
import { parseMailFile } from "../packages/engine/importers.ts";

const mails = JSON.parse(readFileSync(new URL("../packages/shared/samples/fab-dev-30.json", import.meta.url), "utf8"));
const many = Array.from({ length: 1000 }, (_, i) => ({ ...mails[i % mails.length], id: "b" + i }));
const clf = new RuleClassifier();
clf.classify(many[0]);
let t = performance.now();
for (const m of many) clf.classify(m);
const classifyMs = performance.now() - t;
const box = readFileSync(new URL("../packages/shared/samples/files/fab-week-30.mbox", import.meta.url));
const big = Buffer.concat(Array.from({ length: 33 }, () => box)); // ~990 mails, ~0.9 MB
t = performance.now();
const r = parseMailFile("big.mbox", new Uint8Array(big));
const parseMs = performance.now() - t;
console.log(JSON.stringify({ classify1000Ms: Math.round(classifyMs), perMailMs: +(classifyMs / 1000).toFixed(2),
  mboxMails: r.mails.length, mboxBytes: big.length, mboxParseMs: Math.round(parseMs), node: process.version }));
