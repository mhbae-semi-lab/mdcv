"use client";
import { useState } from "react";
import { LOCAL } from "../lib/api";
import { t } from "../lib/i18n";
import { clearErrors, readErrors } from "../lib/errors";

export const VERSION = "1.0.0";

export function Help({ section, onSeed, onImport }: { section?: "privacy"; onSeed: () => void; onImport: () => void }) {
  const [errors, setErrors] = useState(readErrors);
  const faq: [string, string][] = [
    ["메일이 어디에 저장되나요?", "브라우저판은 이 브라우저의 IndexedDB에만 저장합니다. 서버가 없고, 다른 기기와 동기화되지 않습니다. 설정 > 데이터에서 백업 파일로 내보내고 다른 기기에서 가져올 수 있습니다."],
    ["LLM 키가 꼭 필요한가요?", "아니요. 분류 · 마감 · 할 일 · 요약 · 답장 초안은 모두 규칙으로 동작합니다. LLM은 현장 검증 > Shadow에서 규칙과 비교할 때만 씁니다."],
    ["LLM에는 무엇이 전송되나요?", "제목과 본문만, 이름 · 이메일 · 전화 · 사번 · IP · 카드번호 · 비밀번호를 가린 뒤 보냅니다. 보내기 전에 가린 내용을 미리 보여 줍니다."],
    ["답장을 보내 주나요?", "아니요. 브라우저판은 메일을 보내지 않습니다. 초안을 복사해 쓰던 메일 프로그램에서 보내세요. Outlook 연결도 읽기 권한(Mail.Read)만 요청합니다."],
    ["왜 이 메일이 '긴급'인가요?", "읽기 창의 '중요도' 칸에 점수를 만든 근거가 모두 나옵니다. 틀렸다면 그 자리에서 고치고, 고친 기록은 현장 검증의 평가 세트가 됩니다."],
    ["설비 이름이 안 잡혀요", "현장 검증 > 비교에서 '설비 추가' 규칙으로 넣고, 미리보기로 바뀌는 메일을 확인한 뒤 적용하세요. INSP-03 · AOI_09 같은 장비 ID와 ALM-2041 같은 알람 코드는 자동으로 잡습니다."],
    ["가져온 메일 날짜가 이상해요", "Date 헤더가 없는 파일은 파일 시각을 씁니다. 가져오기 결과에 어떤 파일인지 표시됩니다."],
    ["데이터를 지우려면?", "설정 > 데이터 > 모든 데이터 삭제를 누르면 이 브라우저의 메일 · 규칙 · 기록이 모두 지워집니다. 브라우저의 사이트 데이터 삭제로도 지워집니다."],
  ];
  return (
    <main className="page"><div className="pin help">
      <h1>{t("도움말")}</h1>
      {section !== "privacy" && <>
        <section className="block" style={{ marginTop: 0 }}>
          <div className="head"><h2>{t("처음 사용하기")}</h2></div>
          <ol className="steps-list">
            <li><b>{t("예시로 보기")}</b> — {t("반도체 검사 장비 현장의 합성 메일 30통을 엽니다.")} <button className="btn sp" onClick={onSeed}>{t("예시 세트 열기")}</button></li>
            <li><b>{t("내 메일 가져오기")}</b> — {t(".eml · .mbox · .msg 파일을 끌어다 놓거나 고릅니다. 파일은 이 브라우저 밖으로 나가지 않습니다.")} <button className="btn sp" onClick={onImport}>{t("파일 고르기")}</button></li>
            <li><b>{t("회신 필요 · 할 일부터")}</b> — {t("'회신 필요' 폴더와 '할 일'(기한순)을 먼저 처리하고, 틀린 분류는 읽기 창에서 바로 고칩니다.")}</li>
            <li><b>{t("규칙 다듬기")}</b> — {t("현장 검증에서 규칙을 바꾸기 전에 바뀌는 메일을 미리 보고, 적용 · 되돌리기를 합니다.")}</li>
          </ol>
          <p className="note">{t("키보드: / 검색, ↑↓ 또는 j/k 이동, E 처리 완료, Esc 검색 지우기")}</p>
        </section>
        <section className="block">
          <div className="head"><h2>{t("메일 파일 만드는 법")}</h2></div>
          <ul className="plain">
            <li><b>Outlook</b> — {t("메일을 바탕 화면으로 끌어 놓으면 .msg 파일이 됩니다. 여러 통을 한 번에 끌 수 있습니다.")}</li>
            <li><b>Gmail</b> — {t("메일 ⋮ > 원본 다운로드(.eml), 또는 Google 테이크아웃에서 메일을 .mbox로 받습니다.")}</li>
            <li><b>Thunderbird</b> — {t("메일 > 다른 이름으로 저장(.eml), 또는 프로필 폴더의 메일함 파일(mbox)을 그대로 씁니다.")}</li>
          </ul>
          <p className="note">{t("깨진 파일은 건너뛰고, 몇 번째 메일 · 몇 번째 줄에서 무엇이 문제인지 가져오기 결과에 적습니다.")}</p>
        </section>
      </>}
      <section className="block" id="privacy">
        <div className="head"><h2>{t("개인정보 처리 안내")}</h2></div>
        <ul className="plain">
          {LOCAL ? <>
            <li>{t("메일 · 규칙 · 수정 기록은 이 브라우저(IndexedDB)에만 저장됩니다. 이 앱에는 서버가 없고 분석 · 오류 수집 도구도 넣지 않았습니다.")}</li>
            <li>{t("Outlook 연결은 Microsoft 로그인 창에서 본인이 동의할 때만 동작하며, 읽기 권한(Mail.Read)만 요청합니다. 토큰은 이 탭의 세션 저장소에만 있습니다.")}</li>
          </> : <li>{t("셀프호스트판은 메일과 토큰을 설치한 서버의 DB에 암호화해 저장합니다. 서버 관리자가 데이터 관리자입니다.")}</li>}
          <li>{t("LLM은 사용자가 자기 키를 넣고 실행할 때만 호출됩니다. 보내기 전에 가린 내용을 보여 주고, 제목과 본문 외에는 보내지 않습니다.")}</li>
          <li>{t("API 키는 기본적으로 메모리에만 있습니다. '이 기기에 키 기억'을 켠 경우에만 브라우저 저장소에 남습니다.")}</li>
          <li>{t("오류 기록은 이 브라우저에만 남고(최근 50건, 메일 내용 제외), 어디로도 보내지 않습니다.")}</li>
        </ul>
      </section>
      {section !== "privacy" && <>
        <section className="block">
          <div className="head"><h2>{t("자주 묻는 질문")}</h2></div>
          {faq.map(([q, a]) => <details key={q} className="faq"><summary>{t(q)}</summary><p>{t(a)}</p></details>)}
        </section>
        <section className="block">
          <div className="head"><h2>{t("오류 기록 (이 브라우저에만)")}</h2>
            {errors.length > 0 && <button className="btn sp" onClick={() => { clearErrors(); setErrors([]); }}>{t("지우기")}</button>}</div>
          {errors.length ? <table className="grid"><tbody>{errors.map((e, i) => <tr key={i}><td className="nw">{e.at.replace("T", " ")}</td><td>{e.message}</td></tr>)}</tbody></table>
            : <p className="note" style={{ marginTop: 0 }}>{t("기록된 오류가 없습니다.")}</p>}
        </section>
        <p className="note">MDCV {VERSION} · MIT License · {t(LOCAL ? "브라우저판" : "셀프호스트판")}</p>
      </>}
    </div></main>
  );
}
