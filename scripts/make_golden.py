"""골든 데이터셋 100건 생성 (익명화된 합성 업무 메일, 기대 중요도 라벨 포함)."""
import json
import os

EQUIP = ["펌프", "보일러", "냉각탑", "변압기", "공조기", "컴프레서", "열교환기", "컨베이어"]
NAMES = ["김담당", "박기사", "이과장", "최주임", "정대리"]


def make():
    data = []
    for i in range(25):  # 긴급: 설비 장애 + 즉시/긴급
        e = EQUIP[i % len(EQUIP)]
        data.append({"id": "g-u%02d" % i, "subject": "[긴급] %s 이상 발생" % e,
                     "senderName": NAMES[i % 5], "senderEmail": "u%d@example.com" % i, "receivedAt": "2026-10-23T08:00:00",
                     "bodyText": "%s에서 장애가 발생해 라인이 중단됐습니다. 즉시 점검 부탁드립니다. 내일까지 조치 결과를 회신 부탁드립니다." % e,
                     "expected": "urgent"})
    for i in range(25):  # 중요: 마감 임박 보고서/제출
        data.append({"id": "g-i%02d" % i, "subject": "실적 보고서 제출 요청 %d" % i,
                     "senderName": NAMES[i % 5], "senderEmail": "boss@example.com", "receivedAt": "2026-10-23T09:00:00",
                     "bodyText": "월간 실적 보고서를 오늘까지 제출 바랍니다. 검토가 필요하니 회신 부탁드립니다.",
                     "expected": "important"})
    for i in range(25):  # 일반: 회의/교육 일정
        data.append({"id": "g-n%02d" % i, "subject": "정기 회의 일정 안내 %d" % i,
                     "senderName": NAMES[i % 5], "senderEmail": "n%d@example.com" % i, "receivedAt": "2026-10-23T14:00:00",
                     "bodyText": "다음 주 월요일 오전 10시에 정기 회의가 있습니다. 참석 여부를 알려 주시기 바랍니다.",
                     "expected": "normal"})
    for i in range(25):  # 참고: 광고/뉴스레터
        data.append({"id": "g-r%02d" % i, "subject": "주간 소식 뉴스레터 %d" % i,
                     "senderName": "소식지", "senderEmail": "news@example.com", "receivedAt": "2026-10-23T07:00:00",
                     "bodyText": "이번 주 소식과 이벤트 안내를 전해드립니다. 구독 해지는 unsubscribe를 이용하세요.",
                     "expected": "reference"})
    return data


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "..", "tests", "golden.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(make(), f, ensure_ascii=False, indent=1)
    print("wrote", out, len(make()))
