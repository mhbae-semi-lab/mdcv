// Mail file import: .eml (RFC 5322 / MIME), .mbox (mboxo / mboxrd) and Outlook .msg (OLE compound file).
// Runs in the browser and in Node; nothing leaves the device. Errors say which file, which mail and which line.

export type ParsedMail = {
  id: string; provider: string; subject: string; senderName: string; senderEmail: string; recipients: string[];
  receivedAt: string; bodyText: string; hasAttachment: boolean; source: string;
};
export type ImportIssue = { file: string; mail?: number; line?: number; message: string; fatal: boolean };
export type ImportResult = { mails: ParsedMail[]; issues: ImportIssue[] };

const MAX_BODY = 200_000; // characters kept per mail; ponytail: very long bodies are cut, the engine only needs the text

// --- small helpers ------------------------------------------------------------------------------------------------------
const latin1 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
};
const bytesOf = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const CHARSET: Record<string, string> = { "ks_c_5601-1987": "euc-kr", "ks_c_5601": "euc-kr", cp949: "euc-kr", "x-windows-949": "euc-kr", "unicode-1-1-utf-7": "utf-8" };
function decode(bytes: Uint8Array, charset = "utf-8"): string {
  const cs = CHARSET[charset.toLowerCase()] ?? charset.toLowerCase();
  try { return new TextDecoder(cs, { fatal: true }).decode(bytes); }
  catch {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return new TextDecoder("euc-kr").decode(bytes); }
  }
}
function b64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  try { return bytesOf(atob(clean + "=".repeat((4 - (clean.length % 4)) % 4))); }
  catch { return bytesOf(atob(clean.slice(0, clean.length - (clean.length % 4)))); } // a stray trailing char
}
function qp(s: string, header = false): Uint8Array {
  const src = header ? s.replace(/_/g, " ") : s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) { out.push(parseInt(src.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(src.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(out);
}
/** RFC 2047 encoded words; raw 8-bit header bytes are read as UTF-8 (or EUC-KR when not valid UTF-8). */
export function decodeHeader(raw: string): string {
  const joined = raw.replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1");
  const plain = (s: string) => (/[\x80-\xff]/.test(s) ? decode(bytesOf(s)) : s);
  let out = "", last = 0;
  for (const m of joined.matchAll(/=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g)) {
    out += plain(joined.slice(last, m.index));
    out += decode(m[2].toUpperCase() === "B" ? b64(m[3]) : qp(m[3], true), m[1]);
    last = m.index! + m[0].length;
  }
  return (out + plain(joined.slice(last))).trim();
}
const stripHtml = (html: string) => html
  .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
  .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&")
  .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const pad = (n: number) => String(n).padStart(2, "0");
function fnv(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
/** Local wall time with offset, e.g. 2026-11-17T09:12:00+09:00. */
export function localIso(d: Date) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ZONES: Record<string, string> = { UT: "+00:00", UTC: "+00:00", GMT: "+00:00", Z: "+00:00", KST: "+09:00", JST: "+09:00", EST: "-05:00", EDT: "-04:00", CST: "-06:00", CDT: "-05:00", PST: "-08:00", PDT: "-07:00" };
/** RFC 2822 date -> ISO keeping the sender's wall time and offset ("오늘" in the mail means the sender's day). */
export function parseMailDate(v: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Za-z]{1,5})?/.exec(v || "");
  if (!m) return null;
  const mo = MONTHS.indexOf(m[2].toLowerCase());
  if (mo < 0) return null;
  let y = +m[3];
  if (y < 100) y += y < 50 ? 2000 : 1900;
  const zone = m[7] ? (/^[+-]/.test(m[7]) ? `${m[7].slice(0, 3)}:${m[7].slice(3)}` : ZONES[m[7].toUpperCase()] ?? "") : "";
  return `${y}-${pad(mo + 1)}-${pad(+m[1])}T${pad(+m[4])}:${m[5]}:${m[6] ?? "00"}${zone}`;
}
/** "Name" <a@b>, Name <a@b>, a@b (Name), bare a@b. */
export function parseAddress(v: string): { name: string; email: string } {
  const s = decodeHeader(v || "");
  let m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(s);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  m = /^\s*([^\s(]+@[^\s(]+)\s*\(([^)]*)\)/.exec(s);
  if (m) return { name: m[2].trim(), email: m[1].trim() };
  return { name: "", email: s.trim() };
}
const splitAddresses = (v: string) => (v.match(/(?:"[^"]*"|[^,"])+/g) ?? []).map(parseAddress).filter((a) => a.email.includes("@"));

// --- RFC 5322 / MIME ----------------------------------------------------------------------------------------------------
type Part = { headers: Map<string, string>; body: string };

function splitHead(raw: string, startLine: number, issues: ImportIssue[], file: string, mail?: number): Part | null {
  const sep = /\r?\n\r?\n/.exec(raw);
  const lines = (sep ? raw.slice(0, sep.index) : raw).split(/\r?\n/);
  let body = sep ? raw.slice(sep.index + sep[0].length) : "";
  const headers = new Map<string, string>();
  let key = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[ \t]/.test(line) && key) { headers.set(key, headers.get(key)! + " " + line.trim()); continue; }
    const m = /^([!-9;-~]+):[ \t]?(.*)$/.exec(line);
    if (m) { key = m[1].toLowerCase(); if (!headers.has(key)) headers.set(key, m[2]); continue; }
    if (i === 0) {
      issues.push({ file, mail, line: startLine, message: "첫 줄이 메일 헤더(이름: 값)가 아닙니다", fatal: true });
      return null;
    }
    // No blank line between headers and body (hand-edited or badly exported files): read the rest as the body.
    issues.push({ file, mail, line: startLine + i, message: "헤더와 본문 사이 빈 줄이 없어 이 줄부터 본문으로 읽었습니다", fatal: false });
    body = lines.slice(i).join("\n") + (sep ? "\n\n" + body : "");
    break;
  }
  return { headers, body };
}

const param = (v: string, name: string) => {
  const m = new RegExp(`(?:^|;)\\s*${name}\\*?=\\s*(?:"([^"]*)"|([^;\\s]*))`, "i").exec(v || "");
  if (!m) return "";
  const val = m[1] ?? m[2] ?? "";
  const ext = /^([^']*)'[^']*'(.*)$/.exec(val); // RFC 2231 charset''value
  return ext ? decode(qp(ext[2].replace(/%([0-9A-Fa-f]{2})/g, "=$1")), ext[1] || "utf-8") : val;
};

function walk(part: Part, out: { plain: string[]; html: string[]; attachments: number }, depth = 0) {
  const type = (part.headers.get("content-type") || "text/plain").toLowerCase();
  const disp = (part.headers.get("content-disposition") || "").toLowerCase();
  if (depth > 20) return;
  if (type.startsWith("multipart/")) {
    const boundary = param(part.headers.get("content-type") || "", "boundary");
    if (!boundary) return;
    const chunks = part.body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \\t]*\\r?\\n?`));
    for (const chunk of chunks.slice(1)) {
      if (!chunk.trim()) continue;
      const sub = splitHead(chunk, 0, [], "");
      if (sub) walk(sub, out, depth + 1);
    }
    return;
  }
  if (type.startsWith("message/rfc822")) {
    const sub = splitHead(part.body, 0, [], "");
    if (sub) walk(sub, out, depth + 1);
    return;
  }
  if (disp.startsWith("attachment") || param(disp, "filename") || param(part.headers.get("content-type") || "", "name")) {
    out.attachments++;
    return;
  }
  if (!type.startsWith("text/")) return;
  const cte = (part.headers.get("content-transfer-encoding") || "").toLowerCase().trim();
  const bytes = cte === "base64" ? b64(part.body) : cte === "quoted-printable" ? qp(part.body) : bytesOf(part.body);
  const text = decode(bytes, param(part.headers.get("content-type") || "", "charset") || "utf-8");
  (type.startsWith("text/html") ? out.html : out.plain).push(text);
}

function fromPart(part: Part, file: string, fallbackDate: string, issues: ImportIssue[], mail?: number, line?: number): ParsedMail | null {
  const h = part.headers;
  const out = { plain: [] as string[], html: [] as string[], attachments: 0 };
  walk(part, out);
  const from = parseAddress(h.get("from") || "");
  let receivedAt = parseMailDate(h.get("date") || "");
  if (!receivedAt) {
    issues.push({ file, mail, line, message: "Date 헤더가 없거나 읽을 수 없어 파일 시각을 썼습니다", fatal: false });
    receivedAt = fallbackDate;
  }
  const subject = decodeHeader(h.get("subject") || "");
  if (!h.has("from") && !h.has("subject") && !h.has("date")) {
    issues.push({ file, mail, line, message: "From · Subject · Date 헤더가 모두 없어 메일로 볼 수 없습니다", fatal: true });
    return null;
  }
  const bodyText = (out.plain.length ? out.plain.join("\n") : stripHtml(out.html.join("\n"))).replace(/\r\n/g, "\n").trim();
  const msgId = (h.get("message-id") || "").trim();
  return {
    id: "eml:" + fnv(msgId || `${from.email}|${receivedAt}|${subject}|${bodyText.slice(0, 200)}`),
    provider: "file", subject, senderName: from.name, senderEmail: from.email.toLowerCase(),
    recipients: [...splitAddresses(h.get("to") || ""), ...splitAddresses(h.get("cc") || "")].map((a) => a.email.toLowerCase()),
    receivedAt, bodyText: bodyText.slice(0, MAX_BODY), hasAttachment: out.attachments > 0, source: file,
  };
}

export function parseEml(bytes: Uint8Array, file: string, fallbackDate = localIso(new Date())): ImportResult {
  const issues: ImportIssue[] = [];
  const part = splitHead(latin1(bytes), 1, issues, file);
  const mail = part ? fromPart(part, file, fallbackDate, issues, undefined, 1) : null;
  return { mails: mail ? [mail] : [], issues };
}

export function parseMbox(bytes: Uint8Array, file: string, fallbackDate = localIso(new Date())): ImportResult {
  const issues: ImportIssue[] = [];
  const mails: ParsedMail[] = [];
  const lines = latin1(bytes).split(/\r?\n/);
  if (!lines[0]?.startsWith("From ")) {
    issues.push({ file, line: 1, message: "mbox 파일은 'From '으로 시작해야 합니다", fatal: true });
    return { mails, issues };
  }
  let start = 0, n = 0;
  const flush = (end: number) => {
    n++;
    const body = lines.slice(start + 1, end).map((l) => (/^>+From /.test(l) ? l.slice(1) : l)).join("\n");
    const part = splitHead(body, start + 2, issues, file, n);
    const m = part ? fromPart(part, file, fallbackDate, issues, n, start + 1) : null;
    if (m) mails.push(m);
  };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith("From ") && lines[i - 1] === "") { flush(i); start = i; }
  }
  flush(lines.length);
  return { mails, issues };
}

// --- Outlook .msg (OLE / CFB) -------------------------------------------------------------------------------------------
const END = 0xfffffffe, FREE = 0xffffffff;
type Entry = { name: string; type: number; left: number; right: number; child: number; start: number; size: number };

export function readCfb(buf: Uint8Array) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (buf.length < 512 || sig.some((b, i) => buf[i] !== b)) throw new Error("Outlook .msg(OLE 복합 파일) 형식이 아닙니다");
  const ss = 1 << dv.getUint16(0x1e, true);
  const mss = 1 << dv.getUint16(0x20, true);
  const cutoff = dv.getUint32(0x38, true);
  const sector = (sid: number) => {
    const off = (sid + 1) * ss;
    if (off + ss > buf.length + ss) throw new Error("파일이 잘렸거나 손상되었습니다 (섹터 범위 밖)");
    return buf.subarray(off, Math.min(off + ss, buf.length));
  };
  const difat: number[] = [];
  for (let i = 0; i < 109; i++) difat.push(dv.getUint32(0x4c + i * 4, true));
  let ds = dv.getUint32(0x44, true);
  for (let guard = 0; ds !== END && ds !== FREE && guard < 10_000; guard++) {
    const s = sector(ds), sv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    for (let i = 0; i < ss / 4 - 1; i++) difat.push(sv.getUint32(i * 4, true));
    ds = sv.getUint32(ss - 4, true);
  }
  const fat: number[] = [];
  for (const sid of difat) {
    if (sid === FREE || sid === END) continue;
    const s = sector(sid), sv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    for (let i = 0; i < s.length / 4; i++) fat.push(sv.getUint32(i * 4, true));
  }
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    for (let sid = start; sid !== END && sid !== FREE; sid = table[sid]) {
      if (sid >= table.length || out.length > table.length) throw new Error("섹터 연결이 손상되었습니다");
      out.push(sid);
    }
    return out;
  };
  const readBig = (start: number, size: number) => {
    const out = new Uint8Array(size);
    let at = 0;
    for (const sid of chain(start, fat)) { const s = sector(sid); out.set(s.subarray(0, Math.min(s.length, size - at)), at); at += s.length; if (at >= size) break; }
    return out;
  };
  const dirBytes = (() => { const ids = chain(dv.getUint32(0x30, true), fat); return readBig(dv.getUint32(0x30, true), ids.length * ss); })();
  const entries: Entry[] = [];
  const dd = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const nlen = dd.getUint16(off + 0x40, true);
    const name = new TextDecoder("utf-16le").decode(dirBytes.subarray(off, off + Math.max(0, nlen - 2)));
    entries.push({ name, type: dirBytes[off + 0x42], left: dd.getUint32(off + 0x44, true), right: dd.getUint32(off + 0x48, true),
      child: dd.getUint32(off + 0x4c, true), start: dd.getUint32(off + 0x74, true), size: dd.getUint32(off + 0x78, true) });
  }
  const root = entries[0];
  const miniFat: number[] = [];
  const mfStart = dv.getUint32(0x3c, true);
  if (mfStart !== END && mfStart !== FREE) {
    const ids = chain(mfStart, fat);
    const mf = readBig(mfStart, ids.length * ss), mv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
    for (let i = 0; i < mf.length / 4; i++) miniFat.push(mv.getUint32(i * 4, true));
  }
  const miniStream = root.start !== END && root.size ? readBig(root.start, root.size) : new Uint8Array(0);
  const read = (e: Entry) => {
    if (e.size < cutoff) {
      const out = new Uint8Array(e.size);
      let at = 0;
      for (const sid of chain(e.start, miniFat)) { out.set(miniStream.subarray(sid * mss, sid * mss + Math.min(mss, e.size - at)), at); at += mss; if (at >= e.size) break; }
      return out;
    }
    return readBig(e.start, e.size);
  };
  /** Children of a storage: walks the red-black tree of siblings under its child pointer. */
  const children = (e: Entry) => {
    const out: Entry[] = [];
    const stack = [e.child];
    const seen = new Set<number>();
    while (stack.length) {
      const i = stack.pop()!;
      if (i === FREE || i >= entries.length || seen.has(i)) continue;
      seen.add(i);
      out.push(entries[i]);
      stack.push(entries[i].left, entries[i].right);
    }
    return out;
  };
  return { root, children, read };
}

const CODEPAGE: Record<number, string> = { 949: "euc-kr", 65001: "utf-8", 1252: "windows-1252", 932: "shift_jis", 936: "gbk", 20127: "utf-8" };

export function parseMsg(bytes: Uint8Array, file: string): ImportResult {
  const issues: ImportIssue[] = [];
  let cfb;
  try { cfb = readCfb(bytes); }
  catch (e) { return { mails: [], issues: [{ file, message: (e as Error).message, fatal: true }] }; }
  const top = cfb.children(cfb.root);
  const byName = new Map(top.map((e) => [e.name.toUpperCase(), e]));
  const props = byName.get("__PROPERTIES_VERSION1.0");
  const fixed = new Map<number, DataView>();
  if (props) {
    const p = cfb.read(props);
    for (let off = 32; off + 16 <= p.length; off += 16) fixed.set(new DataView(p.buffer, p.byteOffset + off, 16).getUint32(0, true), new DataView(p.buffer, p.byteOffset + off + 8, 8));
  }
  const cpid = fixed.get((0x3fde << 16) | 0x0003)?.getUint32(0, true) ?? fixed.get((0x3ffd << 16) | 0x0003)?.getUint32(0, true) ?? 0;
  const str = (id: number, map = byName) => {
    const hex = id.toString(16).toUpperCase().padStart(4, "0");
    const u = map.get(`__SUBSTG1.0_${hex}001F`);
    if (u) return new TextDecoder("utf-16le").decode(cfb.read(u)).replace(/\0+$/, "");
    const a = map.get(`__SUBSTG1.0_${hex}001E`);
    if (a) return decode(cfb.read(a), CODEPAGE[cpid] ?? "utf-8").replace(/\0+$/, "");
    return "";
  };
  const subject = str(0x0037);
  const headers = str(0x007d);
  let senderEmail = str(0x5d01) || str(0x0c1f) || str(0x0065);
  if (!senderEmail.includes("@")) senderEmail = str(0x5d02) || senderEmail;
  let body = str(0x1000);
  if (!body) {
    const html = byName.get("__SUBSTG1.0_10130102");
    if (html) body = stripHtml(decode(cfb.read(html), CODEPAGE[cpid] ?? "utf-8"));
    else if (byName.get("__SUBSTG1.0_10090102")) issues.push({ file, message: "본문이 RTF 압축 형식만 있어 읽지 못했습니다(제목·발신자만 가져옴)", fatal: false });
  }
  let receivedAt = headers ? parseMailDate(/^Date:\s*(.+)$/im.exec(headers)?.[1] ?? "") : null;
  if (!receivedAt) {
    const ft = fixed.get((0x0e06 << 16) | 0x0040) ?? fixed.get((0x0039 << 16) | 0x0040);
    if (ft) {
      const ticks = ft.getUint32(4, true) * 2 ** 32 + ft.getUint32(0, true);
      receivedAt = localIso(new Date(ticks / 1e4 - 11644473600000));
    }
  }
  if (!subject && !body && !senderEmail) return { mails: [], issues: [...issues, { file, message: "메일 속성(제목 · 본문 · 발신자)을 찾지 못했습니다", fatal: true }] };
  if (!receivedAt) { issues.push({ file, message: "수신 시각을 찾지 못해 지금 시각을 썼습니다", fatal: false }); receivedAt = localIso(new Date()); }
  const recipients: string[] = [];
  let attachments = 0;
  for (const e of top) {
    if (e.type !== 1) continue;
    if (e.name.startsWith("__recip_version1.0_")) {
      const sub = new Map(cfb.children(e).map((c) => [c.name.toUpperCase(), c]));
      const addr = str(0x39fe, sub) || str(0x3003, sub);
      if (addr.includes("@")) recipients.push(addr.toLowerCase());
    } else if (e.name.startsWith("__attach_version1.0_")) attachments++;
  }
  const msgId = str(0x1035);
  return {
    mails: [{
      id: "eml:" + fnv(msgId || `${senderEmail}|${receivedAt}|${subject}|${body.slice(0, 200)}`), provider: "file", subject,
      senderName: str(0x0c1a) || str(0x0042), senderEmail: senderEmail.toLowerCase(), recipients, receivedAt,
      bodyText: body.replace(/\r\n/g, "\n").trim().slice(0, MAX_BODY), hasAttachment: attachments > 0, source: file,
    }],
    issues,
  };
}

/** Picks the parser by extension, falling back to content sniffing. */
export function parseMailFile(name: string, bytes: Uint8Array, fallbackDate?: string): ImportResult {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "msg" || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) return parseMsg(bytes, name);
  if (ext === "mbox" || ext === "mbx" || latin1(bytes.subarray(0, 5)) === "From ") return parseMbox(bytes, name, fallbackDate);
  if (ext === "eml" || ext === "txt" || !ext) return parseEml(bytes, name, fallbackDate);
  return { mails: [], issues: [{ file: name, message: "지원하지 않는 파일입니다 (.eml · .mbox · .msg)", fatal: true }] };
}
