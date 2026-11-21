// Screens for the manual and the work report (synthetic data only). Drives headless Chrome over the DevTools protocol.
//   1) cd apps/web && npm run build && python -m http.server 3106 --bind 127.0.0.1 --directory out
//   2) node docs/manual/capture.mjs [http://127.0.0.1:3106/]
// Output: docs/manual/shots/*.png (1280 x 800 CSS px, scale 1.5) and shots/marks.json (callout boxes, CSS px).
// The Shadow screens use a mock LLM answer (model "mock-demo") built from the sample labels: no API key, no network.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL0 = process.argv[2] || "http://127.0.0.1:3106/";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "shots");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9334;
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "mdcv-capture-"));
const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const labels = Object.fromEntries(JSON.parse(readFileSync(join(ROOT, "packages/shared/samples/fab-dev-30.json"), "utf8")).map((m) => [m.id, m.labels]));
const files = ["alarm-INSP-03.eml", "legacy-euckr.eml", "customer-request.msg", "broken-no-headers.eml", "broken-truncated.msg"]
  .map((name) => ({ name, b64: readFileSync(join(ROOT, "packages/shared/samples/files", name)).toString("base64") }));

let ws, seq = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === "page");
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch { /* still starting */ }
    await sleep(200);
  }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
  });
}
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function view(w, h, scheme = "light", mobile = false) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1.5, mobile });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
}
const MARKS = {};
// Captures the viewport; marks = selectors whose boxes become callout anchors (null when off screen).
async function shot(name, marks = [], scrollSel = null, offset = 60) {
  if (scrollSel) await js(`const el = document.querySelector(${JSON.stringify(scrollSel)}); const sc = el.closest(".page, .read, .rows") || document.scrollingElement; sc.scrollTop += el.getBoundingClientRect().top - ${offset};`);
  await sleep(300);
  MARKS[name] = await js(`return ${JSON.stringify(marks)}.map((m) => { const el = document.querySelector(m); if (!el) return null;
    const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || !r.width) return null;
    return [r.left, r.top, r.right, Math.min(r.bottom, innerHeight)].map(Math.round); });`);
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, name + ".png"), Buffer.from(r.data, "base64"));
  console.log("shot", name, MARKS[name].map((x) => (x ? "o" : "-")).join(""));
}
const clickText = (sel, text) => js(`const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.includes(${JSON.stringify(text)}));
  if (!el) throw new Error("no " + ${JSON.stringify(text)}); el.click();`);
const setValue = (sel, value) => js(`const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set;
  set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));`);
async function open(lang = "ko", theme = "light") {
  await js(`localStorage.setItem("mdcv.lang", "${lang}"); localStorage.setItem("mdcv.theme", "${theme}");`);
  await send("Page.navigate", { url: URL0 });
  await sleep(1600);
}
const selectMail = async (id) => { await js(`document.querySelector('[data-id="${id}"]').click()`); await sleep(400); };

// Writes corrections, three rule versions and mock shadow answers straight into IndexedDB (same shapes the app stores).
async function injectHistory() {
  await js(`const L = ${JSON.stringify(labels)};
    const db = await new Promise((res, rej) => { const q = indexedDB.open("mdcv", 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const tx = db.transaction(["mails", "kv"], "readwrite");
    const mails = await new Promise((r) => { const q = tx.objectStore("mails").getAll(); q.onsuccess = () => r(q.result); });
    const mid = { urgent: 88, important: 65, normal: 40, reference: 15 };
    const fix = { "dev-08": { level: "important" }, "dev-28": { needsReply: true }, "dev-13": { level: "normal" }, "dev-16": { level: "important" } };
    for (const m of mails) {
      const l = L[m.id];
      if (fix[m.id]) m.override = { ...fix[m.id], at: "2026-11-21T09:10", ruleVersion: 1 };
      if (l) m.shadow = { at: "2026-11-21T09:30", model: "mock-demo", promptVersion: "classify-v2", valid: true, errors: [],
        answer: { level: l.level, score: mid[l.level], needsReply: l.needsReply, reasons: ["(모의 LLM) 예시 라벨 기준 판단"], equipment: [], actionItems: [], summary: "" } };
      tx.objectStore("mails").put(m);
    }
    tx.objectStore("kv").put([
      { version: 1, at: "2026-11-20T08:00", note: "기본 규칙", rules: [] },
      { version: 2, at: "2026-11-20T17:30", note: "회의 메일 가중치 -20 (잘못된 변경)", rules: [{ id: 1, rule_type: "keyword", pattern: "회의", weight: -20 }] },
      { version: 3, at: "2026-11-21T09:20", note: "v1로 되돌린 뒤 '협의' +25", rules: [{ id: 2, rule_type: "keyword", pattern: "협의", weight: 25 }] },
    ], "ruleHistory");
    await new Promise((r) => { tx.oncomplete = r; });`);
}

try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await view(1280, 800);
  await send("Page.navigate", { url: URL0 });
  await sleep(1200);
  await js(`for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase("mdcv"); q.onsuccess = q.onerror = q.onblocked = r; });`);

  await open("ko");
  await shot("Welcome", [".welcome .btn.primary", ".welcome .actions .btn:nth-child(2)", ".tools .tbtn:first-child", ".rail"]);
  await clickText(".welcome .btn", "예시 세트"); await sleep(800);
  await selectMail("dev-01");
  await shot("Mailbox", [".tools .tbtn:first-child", ".rail .ritem:nth-of-type(2)", ".plates", ".row[aria-selected=true]", ".facts section:first-child ul", ".facts section:nth-child(3) .big"]);
  await selectMail("dev-14");
  await shot("Reader", [".facts section:first-child .big", ".facts section:first-child ul", "label.inline select", ".facts section:nth-child(3) .linkbtn", ".facts .kv", ".addtag"], ".facts", 40);
  await clickText(".actions .btn", "답장 초안"); await sleep(400);
  await shot("Draft", [".block.ok textarea", ".block.ok .head .btn.sp", ".block.ok .note:last-of-type"], ".block.ok", 40);

  // import: my files including broken ones
  await js(`const list = ${JSON.stringify(files)}; const dt = new DataTransfer();
    for (const f of list) { const bin = atob(f.b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); dt.items.add(new File([u], f.name)); }
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt })); window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, cancelable: true }));`);
  await sleep(1500);
  await shot("Import", [".importrep p", ".importrep li:nth-child(1)", ".importrep li:nth-child(2)", ".importrep li:last-child"]);
  await js(`document.querySelector('.importrep .btn.sp').click()`);

  await clickText(".rail .ritem", "할 일"); await sleep(500);
  await shot("Todo", [".page .sub", ".grid tbody tr:first-child td:first-child", ".grid tr.overdue td:first-child", ".grid tbody tr:nth-child(6) td:first-child"]);
  await clickText(".rail .ritem", "주간"); await sleep(500);
  await shot("Digest", [".seg", ".page .big", ".cols section:first-child", ".cols section:last-child"]);

  await injectHistory();
  await open("ko");
  await clickText(".rail .ritem", "현장 검증"); await sleep(500);
  await shot("Replay", [".steps .step:nth-child(1)", ".welcome", ".trend", ".cols section:last-child table", ".cols section:first-child table"]);
  await clickText(".step", "2 비교"); await sleep(400);
  await setValue(".formrow input:not([type=number])", "고객사");
  await setValue(".formrow input[type=number]", "20");
  await clickText(".btn", "목록에 추가"); await sleep(200);
  await clickText(".btn", "바뀌는 메일 미리보기"); await sleep(500);
  await shot("Compare", [".formrow", ".cols section:first-child .grid", ".cols section:last-child .big", ".diff td.chg", ".cols section:last-child .btn.primary", ".cols section:first-child .grid:last-of-type"]);
  await clickText(".step", "3 Shadow"); await sleep(400);
  await shot("Shadow", [".cols section:first-child input[type=password]", ".cols section:first-child select", ".kv", ".cols section:last-child .grid"]);
  await setValue("input[type=password]", "sk-ant-demo-not-a-real-key");
  await clickText(".btn", "보낼 내용 미리보기"); await sleep(400);
  await js(`const q = [...document.querySelectorAll(".block.warn")].pop(); q.scrollIntoView({ block: "center" });`);
  await shot("MaskPreview", ["pre.masked", ".block.warn .btn.primary"]);
  await clickText(".step", "4 전환"); await sleep(400);
  await shot("Switch", [".cols section:first-child .grid tbody tr:last-child", ".cols section:first-child .btn.primary", ".cols section:first-child .grid tbody tr:first-child"]);
  // the mock LLM missed one reply the user had marked; let it agree on that mail, then the switch opens
  await js(`const db = await new Promise((res) => { const q = indexedDB.open("mdcv", 1); q.onsuccess = () => res(q.result); });
    const tx = db.transaction("mails", "readwrite"); const st = tx.objectStore("mails");
    const m = await new Promise((r) => { const q = st.get("dev-28"); q.onsuccess = () => r(q.result); });
    m.shadow.answer.needsReply = true; m.shadow.answer.level = "normal"; m.shadow.answer.score = 45; st.put(m);
    await new Promise((r) => { tx.oncomplete = r; });`);
  await open("ko");
  await clickText(".rail .ritem", "현장 검증"); await sleep(400);
  await clickText(".step", "4 전환"); await sleep(400);
  await clickText(".btn", "LLM 판단으로 전환"); await sleep(600);
  await clickText(".step", "4 전환"); await sleep(300);
  await shot("Switched", [".sync .eng", ".cols section:first-child .btn.primary", ".cols section:last-child .grid"]);
  await clickText(".btn", "규칙으로 되돌리기"); await sleep(500);

  await clickText(".rail .ritem", "설정"); await sleep(500);
  await shot("Settings", [".cols > div > section:first-child .actions", ".btn.danger", ".cols > section input", ".cols > section code", ".cols > section .btn.primary"]);
  await clickText(".rail .ritem", "도움말"); await sleep(500);
  await shot("Help", [".steps-list", ".help .block:nth-of-type(2)"]);
  await shot("Privacy", ["#privacy"], "#privacy", 20);

  await open("en");
  await selectMail("dev-05");
  await shot("EnMailbox", [".facts section:first-child ul"]);
  await view(1280, 800, "dark");
  await open("ko", "dark");
  await selectMail("dev-17");
  await shot("Dark", []);
  await view(390, 844, "dark", true);
  await open("ko", "dark");
  await shot("Mobile", []);
  writeFileSync(join(OUT, "marks.json"), JSON.stringify(MARKS, null, 1));
} finally {
  try { ws?.close(); } catch { /* */ }
  proc.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked files stay */ }
}
