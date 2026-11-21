"""Plant-equipment sample mails kept as unit-test fixtures (the demo now uses packages/shared/samples/fab-dev-30.json)."""
from datetime import datetime, timedelta

# Fixed clock so results do not depend on the weekday the tests run (relative deadlines such as "이번 주 금요일").
NOW = datetime(2026, 11, 22, 9, 0)


def _t(days=0, hour=9):
    return (NOW - timedelta(days=days)).replace(hour=hour).isoformat()


SAMPLE_MAILS = [
    {"id": "demo-001", "provider": "demo", "providerMessageId": "demo-001", "subject": "[긴급] PU-101 펌프 이상 발생 - 즉시 점검 요청",
     "senderName": "김설비", "senderEmail": "kim@example.com", "recipients": ["me@example.com"], "receivedAt": _t(0, 8),
     "bodyText": "금일 오전 PU-101 펌프에서 이상 소음과 진동이 발생했습니다. 압력이 12 bar까지 상승하여 긴급 점검이 필요합니다. 내일까지 조치 결과를 회신 부탁드립니다. 방치 시 라인 중단 우려가 있습니다.", "isRead": False, "hasAttachment": True},
    {"id": "demo-002", "provider": "demo", "providerMessageId": "demo-002", "subject": "주간 정기 점검 일정 안내 (10월 28일)",
     "senderName": "박정비", "senderEmail": "park@example.com", "recipients": ["me@example.com"], "receivedAt": _t(0, 10),
     "bodyText": "다음 주 월요일 오전 10시부터 보일러와 냉각탑 정기 점검을 진행합니다. 점검 시간은 약 2시간 소요될 예정입니다. 관련 담당자분들은 참석 부탁드립니다.", "isRead": False, "hasAttachment": False},
    {"id": "demo-003", "provider": "demo", "providerMessageId": "demo-003", "subject": "10월 정비 실적 보고서 제출 요청",
     "senderName": "이부장", "senderEmail": "lee@example.com", "recipients": ["me@example.com"], "receivedAt": _t(1, 14),
     "bodyText": "10월 정비 실적 보고서를 이번 주 금요일까지 제출 바랍니다. 설비별 고장 건수와 조치 내용을 포함해 주세요. 양식은 첨부파일을 참고하시기 바랍니다.", "isRead": True, "hasAttachment": True},
    {"id": "demo-004", "provider": "demo", "providerMessageId": "demo-004", "subject": "신규 설비 CNC-02 도입 관련 견적 검토",
     "senderName": "최구매", "senderEmail": "choi@example.com", "recipients": ["me@example.com"], "receivedAt": _t(2, 11),
     "bodyText": "CNC-02 도입 관련 업체 견적서 3건을 첨부드립니다. 검토 후 의견 회신 부탁드립니다. 예산은 5,000만원 범위를 예상하고 있슴니다. 확인부탁드립니다.", "isRead": False, "hasAttachment": True},
    {"id": "demo-005", "provider": "demo", "providerMessageId": "demo-005", "subject": "[광고] 10월 한정 프로모션 안내",
     "senderName": "마케팅팀", "senderEmail": "news@promo.example.com", "recipients": ["me@example.com"], "receivedAt": _t(0, 7),
     "bodyText": "이벤트 안내 메일입니다. 지금 구독하시면 특별 할인 혜택을 드립니다. 수신거부를 원하시면 unsubscribe를 눌러주세요.", "isRead": False, "hasAttachment": False},
    {"id": "demo-006", "provider": "demo", "providerMessageId": "demo-006", "subject": "내일 안전 교육 일정 확인",
     "senderName": "정안전", "senderEmail": "jung@example.com", "recipients": ["me@example.com"], "receivedAt": _t(0, 15),
     "bodyText": "내일 오후 2시 대강당에서 전 직원 안전 교육이 있습니다. 참석 여부를 오늘까지 알려 주시기 바랍니다. 불참 시 별도 교육 일정을 안내하겠습니다.", "isRead": False, "hasAttachment": False},
    {"id": "demo-007", "provider": "demo", "providerMessageId": "demo-007", "subject": "AHU 공조기 필터 교체 완료 보고",
     "senderName": "한공조", "senderEmail": "han@example.com", "recipients": ["me@example.com"], "receivedAt": _t(3, 9),
     "bodyText": "AHU 공조기 필터 교체가 완료되었습니다. 교체 전 차압은 250Pa, 교체 후 80Pa로 정상화되었습니다. 다음 교체 예정일은 3개월 후입니다. 자세한 내용은 첨부 보고서를 확인해 주세요.", "isRead": True, "hasAttachment": True},
    {"id": "demo-008", "provider": "demo", "providerMessageId": "demo-008", "subject": "변압기 정기 검사 결과 및 조치 필요 사항",
     "senderName": "김설비", "senderEmail": "kim@example.com", "recipients": ["me@example.com"], "receivedAt": _t(5, 13),
     "bodyText": "변압기 정기 검사 결과 절연유 수분 함량이 기준치를 초과했습니다. 온도는 65도로 측정됐고 다른 항목의 온도는 72도로 기록되어 확인이 필요합니다. 교체 일정을 협의하고자 하니 회신 바랍니다.", "isRead": False, "hasAttachment": False},
]
