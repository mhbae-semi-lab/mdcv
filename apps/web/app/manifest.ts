import type { MetadataRoute } from "next";

export const dynamic = "force-static";
const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MDCV — equipment-aware mail triage",
    short_name: "MDCV",
    description: "설비·기한 기준 메일 분류·검증 / Equipment-aware mail triage",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    background_color: "#1E2A36",
    theme_color: "#1E2A36",
    icons: [
      { src: `${base}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
