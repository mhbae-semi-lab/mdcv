// IndexedDB persistence for the browser build. Two stores: mails (by id) and kv (named documents).
// Schema version 1. Bump VERSION and extend upgrade() when the stored shape changes.
import type { Persist } from "./local";

const NAME = "mdcv";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("mails")) db.createObjectStore("mails", { keyPath: "id" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
const all = <T>(req: IDBRequest<T>) => new Promise<T>((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export function idbPersist(): Persist {
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () => (dbp ??= open());
  return {
    async load() {
      const d = await db();
      const tx = d.transaction(["mails", "kv"], "readonly");
      const mails = await all(tx.objectStore("mails").getAll());
      const keys = await all(tx.objectStore("kv").getAllKeys());
      const values = await all(tx.objectStore("kv").getAll());
      const kv: Record<string, unknown> = {};
      keys.forEach((k, i) => { kv[String(k)] = values[i]; });
      return { mails, kv };
    },
    async putMails(list) {
      const tx = (await db()).transaction("mails", "readwrite");
      for (const m of list) tx.objectStore("mails").put(m);
      await done(tx);
    },
    async deleteMails(ids) {
      const tx = (await db()).transaction("mails", "readwrite");
      for (const id of ids) tx.objectStore("mails").delete(id);
      await done(tx);
    },
    async putKv(key, value) {
      const tx = (await db()).transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      await done(tx);
    },
    async clear() {
      const tx = (await db()).transaction(["mails", "kv"], "readwrite");
      tx.objectStore("mails").clear();
      tx.objectStore("kv").clear();
      await done(tx);
    },
  };
}
