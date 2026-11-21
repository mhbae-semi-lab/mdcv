import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SwRegister } from "./components/SwRegister";

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const metadata: Metadata = {
  title: "MDCV",
  description: "설비·기한 기준 메일 분류·검증 / Equipment-aware mail triage",
  icons: { icon: `${base}/icon-192.png`, apple: `${base}/icon-192.png` },
  appleWebApp: { capable: true, title: "MDCV", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#1E2A36" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  // manifest link written by hand: Next 15.1 drops basePath from metadata.manifest on static export
  return (<html lang="ko"><head><link rel="manifest" href={`${base}/manifest.webmanifest`} /></head><body>{children}<SwRegister /></body></html>);
}
