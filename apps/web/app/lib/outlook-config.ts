// Outlook connection settings, usable without loading MSAL.
import { BASE, store } from "./api";

const CLIENT_KEY = "mdcv.msClientId";
export const defaultClientId = process.env.NEXT_PUBLIC_MS_CLIENT_ID || "";
export const clientId = () => store(CLIENT_KEY) || defaultClientId;
export const setClientId = (id: string) => store(CLIENT_KEY, id.trim());
export const redirectUri = () => (typeof location === "undefined" ? "" : `${location.origin}${BASE}/`);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validClientId = (id: string) => GUID.test(id.trim());
