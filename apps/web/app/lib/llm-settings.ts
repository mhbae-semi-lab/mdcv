// LLM settings that the settings screen needs without loading the Anthropic SDK.
import { store } from "./api";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", price: "$4 / $20 per 1M tokens" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", price: "$2 / $10 per 1M tokens" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", price: "$0.10 / $0.50 per 1M tokens" },
];
const KEY = "mdcv.llmKey";
const MODEL = "mdcv.llmModel";
let key = "";

export const llmKey = () => key || store(KEY) || "";
export const llmModel = () => store(MODEL) || MODELS[0].id;
export function setLlm(newKey: string, model: string, remember: boolean) {
  key = newKey.trim();
  store(MODEL, model);
  try { if (remember) localStorage.setItem(KEY, key); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
export const remembered = () => !!store(KEY);
