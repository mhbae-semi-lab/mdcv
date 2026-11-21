# Changelog

## 1.0.0 — 2026-11-22

First public-ready release. Browser PWA (no server) plus Docker self-host.

### Added
- Browser build: everything runs in the browser and is stored in IndexedDB; static export for any static host.
- Mail file import: `.eml` (MIME, RFC 2047, EUC-KR), `.mbox`, Outlook `.msg` (OLE compound file read directly),
  with a per-file / per-mail / per-line problem report.
- Outlook connection from the browser (MSAL.js, Microsoft Graph `Mail.Read` only).
- Field verification: replay set and miss trend per rule version (user corrections as the evaluation set),
  rule change preview → apply → roll back with version history, LLM shadow with validation, switch criteria and rollback.
- Semiconductor equipment dictionary with aliases, tool IDs and alarm codes as entities.
- Korean / English deadline parser (`11/24(화)`, `금주 중`, `차주 화요일`, `익일 09시`, `월말`, `3일 이내`, `by Friday`, `EOD Thursday` …)
  and a to-do list sorted by the resolved due time.
- PII masking (names, e-mail, phones, resident / card numbers, employee IDs, IPs, passwords) with a preview before any LLM call.
- Anthropic (user's own key) for both builds; LLM answers are used only after validation against the mail text.
- Korean / English UI, dark mode following the OS, offline app shell, local error log, help / FAQ / privacy pages.
- Tests: 50 Python unit tests, 25 `node --test` cases, Python ↔ TypeScript parity (190 mails), i18n coverage check, CI.

### Changed
- One rule dictionary (`packages/shared/rules.json`) shared by the Python and TypeScript engines.
- Self-host: tokens and mail bodies encrypted with AES-256-GCM; older v1/v2 values and plaintext bodies are re-encrypted at startup.
- Self-host: `Mail.Send` / `gmail.send` are requested only when `MDCV_ENABLE_SEND=1`.
- Self-host: digests load only the requested period; to-dos sort by resolved due time.
- The golden set (4 templates × 25) is reported as a regression check, not as accuracy.

### Fixed
- "다음 주 X요일" landed one week too late.
- Tool IDs followed by Korean particles (`INSP-03이`) were not extracted.
- LLM output overwrote the importance level without checking its value or range.
