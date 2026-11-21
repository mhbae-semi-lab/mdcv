---
name: MDCV
description: Equipment-scoped mail classification and validation desk for plant staff; steel shell, ruled panes, engraved nameplates.
colors:
  steel: "#1E2A36"
  steel-2: "#2A3846"
  steel-line: "#0E151C"
  steel-ink: "#D3DCE4"
  steel-mute: "#A3B3C2"
  ground: "#EEF1F4"
  pane: "#FFFFFF"
  pane-2: "#F6F8FA"
  ink: "#15191E"
  mute: "#56606B"
  rule: "#D5DBE1"
  rule-soft: "#E6EAEE"
  plate: "#D5DBE1"
  plate-line: "#8A949E"
  plate-ink: "#15191E"
  select: "#E3ECF5"
  mark: "#F2B705"
  mark-ink: "#2B2000"
  urgent: "#C8102E"
  urgent-tint: "#FBEDEF"
  important: "#9A5B00"
  ok: "#1D6B3A"
  ok-tint: "#EAF4EE"
  warn-tint: "#FFF6DE"
  focus: "#1E2A36"
  live: "#5FBF7F"
  dark-steel: "#0F161D"
  dark-steel-2: "#1C2733"
  dark-ground: "#121A22"
  dark-pane: "#18212B"
  dark-pane-2: "#1D2732"
  dark-ink: "#E6EBF0"
  dark-mute: "#A3B0BD"
  dark-rule: "#2E3B48"
  dark-rule-soft: "#24303C"
  dark-plate-line: "#5D6C7A"
  dark-select: "#22344A"
  dark-urgent: "#FF6B7D"
  dark-important: "#F0B45A"
  dark-ok: "#6CCB8E"
typography:
  headline:
    fontFamily: "Malgun Gothic, 맑은 고딕, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "1.4667rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Malgun Gothic, 맑은 고딕, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "1.0667rem"
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: "Malgun Gothic, 맑은 고딕, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "0.9333rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  reading:
    fontFamily: "Malgun Gothic, 맑은 고딕, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.8
  meta:
    fontFamily: "Malgun Gothic, 맑은 고딕, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "0.8667rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Malgun Gothic, 맑은 고딕, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 700
    lineHeight: 1.5
  plate:
    fontFamily: "Consolas, Malgun Gothic, monospace"
    fontSize: "0.8rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
rounded:
  none: "0px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  gutter: "1.75rem"
components:
  button:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 0.9rem"
    height: "2.25rem"
  button-hover:
    backgroundColor: "{colors.pane-2}"
  button-primary:
    backgroundColor: "{colors.steel}"
    textColor: "{colors.pane}"
    rounded: "{rounded.none}"
    padding: "0 0.9rem"
    height: "2.25rem"
  button-primary-hover:
    backgroundColor: "{colors.steel-2}"
  plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.plate-ink}"
    typography: "{typography.plate}"
    rounded: "{rounded.none}"
    padding: "0 0.4rem"
    height: "1.45rem"
  plate-active:
    backgroundColor: "{colors.mark}"
    textColor: "{colors.mark-ink}"
  seg-button:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 0.9rem"
    height: "2.1rem"
  seg-button-active:
    backgroundColor: "{colors.steel}"
    textColor: "{colors.pane}"
  list-row:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink}"
    padding: "0.5rem 1rem 0.55rem"
  list-row-selected:
    backgroundColor: "{colors.select}"
  list-row-hot:
    backgroundColor: "{colors.urgent-tint}"
  rail-item:
    backgroundColor: "{colors.steel}"
    textColor: "{colors.steel-ink}"
    padding: "0.4rem 1rem"
  rail-item-current:
    backgroundColor: "{colors.steel-2}"
    textColor: "{colors.pane}"
  field-input:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 0.6rem"
    height: "2.25rem"
  search-input:
    backgroundColor: "{colors.steel-2}"
    textColor: "{colors.pane}"
    rounded: "{rounded.none}"
    padding: "0 2.2rem 0 2.1rem"
    height: "2.1rem"
---

# Design System: MDCV

## Overview

**Creative North Star: "The Equipment Nameplate Board"**

MDCV reads like a plant control-room board, not a consumer inbox. A steel-navy shell (top bar and rail) frames a cool-grey ground on which white panes sit edge to edge, divided only by 1px rules. Every equipment mention is an engraved aluminium nameplate: a flat grey tag with a 1px darker rule and monospaced tabular caps. Clicking a nameplate, in a list row, in the rail or in the reading pane's facts, scopes the whole mailbox to that asset. That is the signature move, and it is what the system exists to protect.

Density is high and deliberate: office desktops around 1920px, 30 to 100 mails a day, two-line rows, small type ramp, no decorative space. Colour is mostly ink on white; the loud colours are signals, not decoration. Safety yellow marks the active scope, red marks urgent, amber marks important, green marks validated/ok. The interface runs on a secured network, so it uses system fonts only, no external fonts, CDNs or image assets; icons are inline 16px SVG strokes.

The system rejects the generic grey mail list with rounded coloured pills and cards. Nothing is rounded, nothing floats except the modal dialog, and hierarchy comes from rules, weight and the three ink values.

**Key Characteristics:**
- Steel shell, cool-grey ground, white panes; light and dark token sets swapped on `:root[data-theme="dark"]`.
- Zero radius and 1px rules everywhere.
- Nameplates are the only tag shape; yellow means "this is the active scope".
- System font stack and a rem scale driven by a user-adjustable root size (13 to 20px, default 15px).
- Keyboard-first list: ↑/↓ or j/k move the selection, `/` focuses search, Esc clears it.

## Colors

A steel-and-aluminium industrial palette: cool neutrals carry everything, and three signal colours plus safety yellow speak only when something needs attention.

### Primary
- **Control-Room Steel** (`steel`): the top bar and rail background, the primary button and the active segment in light mode, the selected-row outline and the light-mode focus ring. `steel-2` is its raised step for hover and the current rail item; `steel-line` is the hairline under/beside the shell.

### Secondary
- **Safety Yellow** (`mark`, with `mark-ink` text): the active-scope marker. Pressed nameplates, the "filter on" nameplate in the list head, the current rail count, text selection, focus rings inside the steel shell, and the search focus border. In dark mode, where steel sinks into the ground, it also carries the primary button, the active segment, the selected-row outline and the focus ring.

### Tertiary (signal colours)
- **Alarm Red** (`urgent`, dark `dark-urgent`): 긴급 level text, the offline sync dot, error messages, struck-out text in validation issues. `urgent-tint` fills an unread urgent row.
- **Signal Amber** (`important`, dark `dark-important`): 중요 level text and its rail square. Reserved for 중요; nothing else is amber.
- **Validated Green** (`ok`, `ok-tint`; `live` for the sync dot): corrected text in validation, ok messages, the ok block fill.
- **Caution Cream** (`warn-tint`): background of a block that carries validation warnings.

### Neutral
- **Cool Grey Ground** (`ground`): the canvas behind the reading pane and full-width pages.
- **White Pane** (`pane`) and **Pane Wash** (`pane-2`): list, facts grid, blocks, tables, inputs; `pane-2` is the hover and summary-bar wash.
- **Ink / Mute** (`ink`, `mute`): the two text values; `plate-line` is the third ink, used for rules on controls, list markers and nameplates, never for text.
- **Rule / Soft Rule** (`rule`, `rule-soft`): pane borders and row separators.
- **Aluminium** (`plate`, `plate-line`, `plate-ink`): nameplate face, edge and engraving.
- **Selection Wash** (`select`): the selected list row fill.

### Named Rules
**The Safety Yellow Rule.** Yellow marks the active scope or selection, focus inside the steel shell, and (dark mode only) the primary action. It is never a decorative accent, a heading colour or a warning fill.

**The Amber Belongs to 중요 Rule.** Amber text means "important" and nothing else. Caution blocks use the cream tint, not amber text.

**The Three Inks Rule.** Text is `ink` or `mute`. `plate-line` is for rules, list markers and control edges only.

## Typography

**Display Font:** none (no display face; the system font carries everything)
**Body Font:** Malgun Gothic (with 맑은 고딕, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif)
**Label/Mono Font:** Consolas (with Malgun Gothic, monospace), nameplates only

**Character:** One plain Korean system sans at office density, tabular numerals everywhere (`font-variant-numeric: tabular-nums`), `word-break: keep-all` so Korean words never split. Monospace appears only on nameplates, where it reads as stamped metal.

### Hierarchy
All sizes are rem against the root size the user sets with 가− / 가+ (13 to 20px, default 15px, persisted as `mdcv.size`). Pixel values below are at the 15px default.
- **Headline** (700, 1.4667rem / 22px, 1.35, -0.01em, `text-wrap: balance`): mail subject in the reading pane and full-width page titles.
- **Title** (700, 1.0667rem / 16px): empty-state headings, the "big" level/score figure in facts, the brand mark; dialog titles at 1.1333rem.
- **Reading** (400, 1rem / 15px, 1.8, max 46em): the original mail body.
- **Body** (400, 0.9333rem / 14px, 1.5): controls, rail items, facts content, tables, fields.
- **Meta** (400, 0.8667rem / 13px): the second row of a list row, sync status, summary bar, mail meta line, notes.
- **Label** (700, 0.8rem / 12px, `mute`): rail group headings, facts section labels, table headers, field labels, level text (긴급/중요/일반/참고).
- **Plate** (600, 0.8rem, Consolas, 0.04em tracking): nameplates.

### Named Rules
**The Root-Size Rule.** Every size, gap and pane width is in rem so the 가−/가+ control rescales the whole interface. Never use px for type or layout widths.

**The No Webfont Rule.** System fonts only; the product runs on a secured network where external fonts and CDNs are blocked.

## Layout

A fixed application shell on CSS grid, full viewport height (`100dvh`):
- **Top bar** spans the full width, 3.2rem (48px) tall: brand, search (up to 30rem), sync status, then tools pushed right (새로고침, Outlook, Gmail, a 1px separator, 가−, 가+, theme toggle).
- **Rail** 15.5rem (≈232px): 메일함 folders with counts, 할 일, 설비 nameplates, 기간 요약 periods, 관리.
- **Work area**: list 29rem (≈435px) plus the reading pane taking the rest; full-width views (할 일, digest, settings) collapse to one column.
- **Reading pane** content max 62rem, padded 1.25rem 1.75rem 3rem; full-width pages max 72rem with the same padding.

Spacing rhythm is small and stepped: 0.25, 0.5, 0.75, 1, 1.25 and 1.75rem. Rows, heads and controls sit on a 2.1–2.25rem control height.

Responsive:
- **≤1100px**: list narrows to 24rem; brand subtitle and the search `/` hint hide.
- **≤860px**: one column. The top bar wraps with search on its own full-width line; the rail becomes a horizontal scrolling strip of folders (group headings and nameplates hidden); the list caps at 55vh above the reading pane; the facts grid and settings columns stack; pane padding drops to 1rem.

## Elevation & Depth

Flat. Depth is conveyed by tone (steel shell, grey ground, white pane) and 1px rules, never by shadow. The single exception is the modal dialog, which lifts off a dimmed steel backdrop.

### Shadow Vocabulary
- **Modal lift** (`box-shadow: 0 12px 32px rgb(0 0 0 / .22)`, backdrop `rgb(14 21 28 / .45)`): the account-connect dialog only.

### Named Rules
**The Flat Board Rule.** Panes, rows, blocks, tables and nameplates never cast shadows. If something needs separating, give it a 1px rule or a tonal step.

## Shapes

Square everything: radius 0 on panes, buttons, inputs, nameplates, dialog, status dots and rail level squares (0.5rem squares, not circles). Every border is 1px. List markers are squares (`list-style: square`) tinted `plate-line`. Selection is a fill plus a 1px inset outline, not a side stripe. Focus is a 2px outline inset by 2px (`outline-offset: -2px`).

## Components

### Nameplate (signature)
Engraved aluminium tag for an equipment ID.
- **Shape:** square, 1.45rem tall, 0 0.4rem padding, 1px `plate-line` edge, `plate` face, `plate-ink` engraving in the plate type role. An optional count follows in regular weight at 75% opacity.
- **Behaviour:** always a button that scopes the mailbox to that equipment; in list rows it is out of the tab order (row keyboard model owns focus) and clicking it also selects the row. One plate per row, extras summarised as `+N` in meta type.
- **Hover:** edge darkens to `plate-ink`.
- **Active:** `aria-pressed="true"` or the "on" variant turns the plate safety yellow with `mark-ink` text and a dark-yellow edge; the list-head "on" plate carries a 12px ✕ icon to clear the filter.
- **Rail variant:** inside the steel rail, plates keep the light aluminium face in both themes so they read as metal tags on a dark panel; pressed rail plates go full yellow with a yellow edge.

### Buttons
- **Shape:** square (0), 2.25rem tall, 0 0.9rem padding, 600 weight body size, 0.4rem gap for a leading 16px icon.
- **Default:** white pane face, 1px `plate-line` edge. Hover: edge goes to `ink`, face to `pane-2`.
- **Primary:** steel face, white text, steel edge; hover steps to `steel-2`. Dark mode: safety yellow face with `mark-ink` text. One primary per action row (답장 초안 · 첨삭).
- **Busy / Disabled:** `aria-busy` at 0.7 opacity with progress cursor; disabled at 0.45.
- **Toolbar (top bar):** transparent, 2.1rem square minimum, steel-ink text; hover gains `steel-2` face and a 1px edge.

### Segmented control
A row of square buttons inside one 1px `plate-line` frame, divided by 1px rules, 2.1rem tall. The pressed segment is steel with white bold text (yellow with `mark-ink` in dark). Used for digest periods (오전 … 연간).

### List rows
Two-line rows on a white pane, separated by 1px `rule-soft`.
- **Line 1:** level text (label role, 2rem column), sender (4.5rem, ellipsis), subject (fills, ellipsis), first nameplate, `+N`, attachment clip, time.
- **Line 2 (meta):** an invisible level spacer keeps alignment, then bold "회신 · deadline" when a reply is needed, then the summary.
- **States:** unread = sender and subject bold; unread urgent = `urgent-tint` fill; hover = `pane-2`; selected = `select` fill plus a 1px inset steel outline (yellow in dark).
- **Level text:** 긴급 in `urgent` bold, 중요 in `important` bold, 일반 and 참고 in `mute` regular.

### Navigation (rail)
Steel rail, rail items at body size with 0.4rem 1rem padding; group headings in label role, `steel-mute`. Level folders carry a 0.5rem square swatch (red for 긴급, amber for 중요, steel-mute otherwise). Current item: `steel-2` face, white bold text, count in yellow. Hover: `steel-2`. Focus rings inside the shell are yellow.

### Search
Inside the top bar: `steel-2` field with a 1px #3B4B5B edge, white text, 16px search icon at left, a `/` key hint at right while empty. Focus swaps the edge to safety yellow instead of an outline.

### Facts grid
Classification facts in a ruled two-column grid on a white pane: the outer frame and each cell share 1px `rule` lines (no doubled borders), cells padded 0.75rem 1rem, each headed by a label-role heading. Content uses body size; the headline figure uses the title role coloured by level; key/value pairs sit in a 3.5rem label column.

### Blocks
Bordered white sections (1px `rule`, 0.85rem 1rem padding) below the facts for validation results and the reply draft. Warning blocks fill `warn-tint`, ok blocks fill `ok-tint`. Issue lines strike the wrong text in red and show the correction in bold green without underline. The draft textarea is square, 1px `rule`, line-height 1.7.

### Tables
Full-width white table with a 1px `rule` frame. Headers in label role with a 1px `ink` rule beneath; cells 0.55rem 0.6rem with 1px `rule-soft` separators. Clickable rows wash `pane-2` on hover.

### Inputs / Fields
Label-role caption above a square 2.25rem input or select, 1px `plate-line` edge, white face. Focus: 2px `focus` outline inset 1px. Messages below in meta size, red for errors, green for ok.

### Dialog
Native `<dialog>`, width min(34rem, 100vw − 2rem), square, 1px `plate-line` edge, white pane, modal lift shadow over a dimmed steel backdrop. Content padded 1.25rem 1.5rem; actions right-aligned at the bottom.

### States
- **Loading:** eight static skeleton rows (3.4rem) drawn as two `pane-2` bars on the white pane; no shimmer. Sync text reads 불러오는 중.
- **Empty:** plain text block, title-role heading in `ink`, explanation in `mute` (max 34em), optional inline `code` in a ruled box. Examples: 아직 메일이 없습니다, 조건에 맞는 메일이 없습니다, 메일을 선택하세요.
- **Offline:** the sync dot turns red with "API 연결 안 됨" and the list shows the API 서버에 연결할 수 없습니다 empty state.
- **Sync dot:** a 0.5rem square, `live` green when connected.

### Keyboard model
↑/↓ or j/k move the list selection (focus and scroll follow); the selected row is the single tab stop in the list (`role="option"`, roving tabindex). `/` focuses search from anywhere outside a field; Esc in search clears and blurs it. Global focus ring: 2px `focus`, inset.

## Do's and Don'ts

### Do:
- **Do** keep every corner at 0 and every rule at 1px.
- **Do** render every equipment ID as a nameplate that scopes the mailbox when clicked.
- **Do** reserve safety yellow for the active scope, selection, in-shell focus and the dark-mode primary action.
- **Do** colour level text by meaning: 긴급 red, 중요 amber, everything else `mute`.
- **Do** mark selection with the `select` fill plus a 1px inset outline.
- **Do** size everything in rem so the 가−/가+ root size (13–20px) scales the whole interface.
- **Do** define every new colour in both the light and the dark token set.
- **Do** use system fonts and inline SVG icons only.

### Don't:
- **Don't** use rounded pills, coloured chips or cards for tags; the nameplate is the only tag.
- **Don't** use coloured side stripes on rows or blocks to show state.
- **Don't** add shadows to anything but the modal dialog.
- **Don't** use amber for anything other than 중요.
- **Don't** load external fonts, CDNs or remote assets.
- **Don't** set `plate-line` grey as a text colour.
