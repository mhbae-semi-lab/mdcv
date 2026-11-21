"use client";
import { useEffect } from "react";
import { BASE } from "../lib/api";

export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }).catch(() => { /* unsupported: the app still works online */ });
    }
  }, []);
  return null;
}
