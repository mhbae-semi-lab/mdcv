import { memo } from "react";
import { I, Icon } from "./Icon";
import { Mail, deadline, level, levelName, when } from "../lib/api";
import { t } from "../lib/i18n";

export const Row = memo(function Row({ m, selected, onSelect, onEquip }: {
  m: Mail; selected: boolean; onSelect: (m: Mail) => void; onEquip: (e: string) => void;
}) {
  const c = m.classification;
  const lv = level(m);
  const done = m.status === "done";
  const unread = !m.isRead;
  const due = c?.needsReply && !done ? deadline(c) : undefined;
  const eq = c?.entities.equipment || [];
  return (
    <div role="option" aria-selected={selected} tabIndex={selected ? 0 : -1} data-id={m.id} onClick={() => onSelect(m)}
      className={`row${unread ? " unread" : ""}${unread && lv === "urgent" ? " hot" : ""}${done ? " done" : ""}`}>
      <span className="r1">
        <span className={`lv ${lv}`}>{levelName(lv)}</span>
        <span className="from">{m.senderName}</span>
        <span className="subj">{m.subject}</span>
        {eq[0] && <button className="plate" tabIndex={-1} title={t("{e} 메일만 보기", { e: eq[0] })} onClick={(e) => { e.stopPropagation(); onSelect(m); onEquip(eq[0]); }}>{eq[0]}</button>}
        {eq.length > 1 && <span className="more" title={eq.slice(1).join(", ")}>+{eq.length - 1}</span>}
        {m.hasAttachment && <span className="clip" title={t("첨부 있음")}><Icon d={I.clip} size={14} /></span>}
        <span className="time">{when(m.receivedAt)}</span>
      </span>
      <span className="r2">
        <span className={`lv ${lv}`} aria-hidden="true" />
        {done ? <span className="reply">{t("처리 완료")}</span> : c?.needsReply && <span className="reply">{t("회신")}{due ? ` · ${due}` : ""}</span>}
        <span className="sum">{c?.summary || m.bodyText}</span>
      </span>
    </div>
  );
});
