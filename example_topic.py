"""새로 가입한 사람에게 넣어 주는 예시 주제 1개 (+ seed_demo.py가 함께 쓰는 넣기 함수).

어떻게 쓰는 앱인지 첫 화면에서 바로 보이도록:
질문 → 먼저 적은 내 생각 → AI 답 → 돌아보기 메모, AI 답에서 담아 둔 곁가지(메모함), 미리 정리한 마인드맵까지 다 들어 있다.
마인드맵을 미리 넣어 두므로 예시를 열어도 AI(API)를 부르지 않는다.
"""

import json
from datetime import datetime, timedelta

EXAMPLE_NAME = "[예시] 폭염 취약지역 분석 보고서"

# turns의 "at"은 시작 시각부터 몇 분 뒤인지. 마인드맵·메모의 turn 번호는 turns 순서(0부터).
_HEAT = {
    "is_starred": 1,
    "status": "in_progress",
    "turns": [
        {
            "at": 0,
            "question": "폭염 취약지역을 고를 때 어떤 지표를 써야 할까?",
            "my_thought": "기온만 보면 안 되고 사람 쪽 지표가 같이 들어가야 할 것 같아. 노인 인구 비율, 무더위쉼터까지 거리, 녹지 비율 정도를 생각하고 있어. 오늘 안에 지표 3~4개를 확정하는 게 목표야.",
            "ai_answer": "## 세 묶음으로 나눠 보면 정리가 쉬워요\n\n- **노출**: 얼마나 더운가 — 기온, 위성으로 구하는 **지표면 온도**(Landsat 위성 자료는 대기 보정이 필요해요)\n- **민감도**: 더위에 얼마나 약한가 — 65세 이상 비율, 독거노인, 기저질환\n- **적응 능력**: 더위를 피할 수 있는가 — 무더위쉼터 접근성, 녹지 비율, 냉방 시설\n\n묶음마다 1~2개씩, 모두 4~6개면 충분해요. 단위가 다르니 **min-max 정규화**나 **z-score 표준화**로 맞춘 뒤 합치세요.\n\n지금 생각하신 세 지표는 민감도·적응 능력에 해당해요. 노출 지표를 하나 더하면 균형이 맞습니다.",
            "memo": "노출 지표로 지표면 온도를 넣기로. 위성 보정이나 표준화 방법처럼 모르는 건 메모함에 넣어 두고, 지금은 지표 확정에만 집중하자.",
        },
        {
            "at": 15,
            "question": "노인 인구 비율, 쉼터 접근성, 녹지 비율, 지표면 온도 데이터는 각각 어디서 구해?",
            "my_thought": "인구는 통계청, 쉼터는 공공데이터포털에 있을 것 같아. 녹지랑 지표면 온도는 잘 모르겠어. 출처만 정하고 바로 다음 단계로 가고 싶어.",
            "ai_answer": "## 지표별 출처\n\n- **노인 인구 비율**: 통계청 SGIS 행정동 단위 인구\n- **쉼터 접근성**: 행정안전부 무더위쉼터 목록(공공데이터포털) — 연도별로 바뀌니 **최신 연도**를 확인하세요\n- **녹지 비율**: 환경부 토지피복지도\n- **지표면 온도**: USGS EarthExplorer의 Landsat 8, 또는 **Google Earth Engine**에서 바로 계산\n\n결과는 **kepler.gl로 3D 지도**를 만들면 발표 때 인상적이고, **GitHub Pages**에 올리면 링크로 공유할 수도 있어요.",
            "memo": "3D 지도랑 웹 공유는 끌리지만 제출물은 PDF 보고서다. 따라가지 않고 '마음에 드는 것'으로 담아 둠. 출처는 네 개 모두 확정.",
        },
        {
            "at": 36,
            "question": "네 지표에 가중치를 어떻게 주는 게 좋을까?",
            "my_thought": "처음엔 똑같이 25%씩 주고, 다른 가중치와 결과를 비교해 보는 게 공정할 것 같아. 근거 없는 가중치는 심사에서 지적받을 수 있어.",
            "ai_answer": "## 동일 가중치로 시작하고 검증하세요\n\n- **기준안**: 25%씩 동일 가중치 — 설명하기 가장 쉬워요.\n- **비교안**: **엔트로피 가중치**나 전문가 설문(AHP)으로 만든 가중치\n- **민감도 분석**: 가중치를 바꿔도 상위 지역이 크게 바뀌지 않는지 확인하세요.\n\n주의할 점: **녹지 비율과 지표면 온도는 서로 강하게 연결**돼 있어서, 둘을 함께 넣으면 같은 효과를 두 번 세는 셈이 될 수 있어요. 상관계수를 먼저 확인해 보세요.",
            "memo": "41분 만에 지표 4개, 출처, 가중치 방식까지 확정. 곁가지 8개는 메모함에 있다. 다음 작업은 '높음' 메모부터.",
        },
    ],
    # 대화 중 AI 답에서 드래그해 담아 둔 메모 (turn은 위 대화의 순서 번호)
    "notes": [
        {"turn": 0, "kind": "check", "text": "min-max 정규화나 z-score 표준화", "note": "둘 중 뭘 써야 하는지 모름. 보고서 쓰기 전에 확인", "priority": "high"},
        {"turn": 0, "kind": "check", "text": "Landsat 위성 자료는 대기 보정이 필요해요", "note": "", "priority": "mid"},
        {"turn": 1, "kind": "todo", "text": "최신 연도를 확인하세요", "note": "무더위쉼터 목록 2025년판 받음", "priority": "high", "done": 1},
        {"turn": 1, "kind": "check", "text": "Google Earth Engine", "note": "", "priority": "mid"},
        {"turn": 1, "kind": "like", "text": "kepler.gl로 3D 지도", "note": "발표 자료 만들 때 물어보기", "priority": "low"},
        {"turn": 1, "kind": "like", "text": "GitHub Pages에 올리면 링크로 공유", "note": "제출물은 PDF라 필수 아님", "priority": "low"},
        {"turn": 2, "kind": "todo", "text": "녹지 비율과 지표면 온도는 서로 강하게 연결", "note": "상관계수 먼저 계산하기", "priority": "high"},
        {"turn": 2, "kind": "todo", "text": "가중치를 바꿔도 상위 지역이 크게 바뀌지 않는지 확인", "note": "", "priority": "mid"},
        {"turn": 2, "kind": "check", "text": "엔트로피 가중치", "note": "", "priority": "low"},
    ],
    "mindmap": {
        "mine_only": [
            {"label": "오늘 지표 확정이 목표", "detail": "오늘 안에 지표 3~4개를 확정하는 것이 목표였다.", "turn_ids": [0]},
            {"label": "출처만 정하고 다음으로", "detail": "데이터 출처를 정하는 데서 멈추고 다음 단계로 넘어가려 했다.", "turn_ids": [1]},
            {"label": "근거 있는 가중치", "detail": "근거 없는 가중치는 심사에서 지적받을 수 있다.", "turn_ids": [2]},
        ],
        "shared": [
            {"label": "사람 쪽 지표 함께 보기", "detail": "기온뿐 아니라 고령 인구 같은 민감도 지표가 필요하다.", "kind": "same", "turn_ids": [0]},
            {"label": "쉼터·녹지로 대응력 보기", "detail": "무더위쉼터 접근성과 녹지 비율로 더위를 피할 수 있는지 본다.", "kind": "same", "turn_ids": [0]},
            {"label": "인구는 통계청, 쉼터는 공공데이터", "detail": "노인 인구와 쉼터 데이터의 출처가 같다.", "kind": "same", "turn_ids": [1]},
            {"label": "동일 가중치로 시작", "detail": "25%씩 같은 가중치를 기준안으로 둔다.", "kind": "same", "turn_ids": [2]},
            {"label": "다른 가중치와 비교", "detail": "가중치를 바꿔 결과가 흔들리는지 확인한다.", "kind": "similar", "turn_ids": [2]},
        ],
        "ai_only": [
            {"label": "노출·민감도·적응 능력", "detail": "지표를 세 묶음으로 나눠 균형을 맞춘다.", "turn_ids": [0]},
            {"label": "지표면 온도는 위성 자료로", "detail": "Landsat 8이나 Google Earth Engine으로 구한다.", "turn_ids": [1]},
            {"label": "녹지와 지표면 온도의 중복", "detail": "두 지표가 강하게 연결돼 같은 효과를 두 번 셀 수 있다.", "turn_ids": [2]},
        ],
        "uncertain": [],
    },
}


def make_example(start=None, name=EXAMPLE_NAME, folder=None, is_starred=1):
    """시작 시각을 받아 실제 시각이 들어간 예시 주제를 만든다."""
    start = start or (datetime.now() - timedelta(minutes=40))
    t = json.loads(json.dumps(_HEAT, ensure_ascii=False))  # 깊은 복사
    for turn in t["turns"]:
        turn["at"] = (start + timedelta(minutes=turn["at"])).isoformat(timespec="seconds")
    t.update(name=name, folder=folder, is_starred=is_starred)
    return t


def insert_topic(db, uid, topic):
    """주제 1개를 대화·메모함·마인드맵까지 넣는다. db는 sqlite3 연결(커밋은 부르는 쪽에서)."""
    first, last = topic["turns"][0]["at"], topic["turns"][-1]["at"]
    folder_id = None
    if topic.get("folder"):  # 폴더가 있으면 쓰고, 없으면 만든다
        row = db.execute("SELECT id FROM folders WHERE user_id = ? AND name = ?", (uid, topic["folder"])).fetchone()
        folder_id = row[0] if row else db.execute(
            "INSERT INTO folders (user_id, name, created_at) VALUES (?, ?, ?)", (uid, topic["folder"], first)).lastrowid
    topic_id = db.execute(
        # is_sample=1: 실제로 쓴 기록이 아니라 예시로 넣은 주제 → 사용 통계에서 뺀다
        "INSERT INTO topics (user_id, folder_id, name, created_at, updated_at, is_starred, status, is_sample) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
        (uid, folder_id, topic["name"], first, last, topic.get("is_starred", 0), topic.get("status", "in_progress")),
    ).lastrowid
    ids = []
    for t in topic["turns"]:
        ids.append(db.execute(
            """INSERT INTO turns (topic_id, question, my_thought, ai_answer, reflection, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (topic_id, t["question"], t["my_thought"], t["ai_answer"], t.get("memo", ""), t["at"], t["at"]),
        ).lastrowid)
    if topic.get("mindmap"):
        # 마인드맵의 순서 번호 → 실제 turn id, 그리고 캐시가 그대로 쓰이도록 signature를 맞춘다
        mm = {
            key: [{**p, "turn_ids": [ids[i] for i in p["turn_ids"]]} for p in topic["mindmap"].get(key, [])]
            for key in ("mine_only", "shared", "ai_only", "uncertain")
        }
        mm.update(signature=ids, created_at=last, edited=False, materials=[])
        db.execute("UPDATE topics SET mindmap = ? WHERE id = ?", (json.dumps(mm, ensure_ascii=False), topic_id))
    for n in topic.get("notes", []):
        at = topic["turns"][n["turn"]]["at"]
        db.execute(
            """INSERT INTO side_notes (topic_id, turn_id, user_id, kind, text, note, priority, done, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (topic_id, ids[n["turn"]], uid, n["kind"], n["text"], n.get("note", ""), n.get("priority", "mid"), n.get("done", 0), at, at),
        )
    return topic_id, ids
