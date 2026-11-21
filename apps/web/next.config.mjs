// Static export: the browser build needs no server (GitHub Pages or any static host).
// NEXT_PUBLIC_BASE_PATH = sub-path when hosted under one (e.g. /mdcv on GitHub Pages).
// NEXT_PUBLIC_API_URL   = self-host API address; empty means everything runs in the browser.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
export default {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  experimental: { externalDir: true }, // the rule engine lives in ../../packages/engine (shared with Node tests)
};
