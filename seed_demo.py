"""예시 데이터 넣기.

    python seed_demo.py

이미 같은 이름의 주제가 있으면 그 주제는 건너뛴다 (기존 데이터는 건드리지 않음).
마인드맵도 미리 정리해 넣어 두어서 API 키 없이도 마인드맵 탭을 볼 수 있다.
"""

import json
import sqlite3
from datetime import datetime, timedelta

import app  # import 하면 DB 테이블이 준비된다

T = lambda days, hours=0, minutes=0: (
    datetime(2026, 11, 16, 9, 0) - timedelta(days=days) + timedelta(hours=hours, minutes=minutes)
).isoformat(timespec="seconds")

# 마인드맵의 turn_ids는 아래 turns 목록의 순서 번호(0부터)로 적고, 넣을 때 실제 id로 바꾼다.
TOPICS = [
    {
        "name": "데이터 분석 포트폴리오",
        "is_starred": 1,
        "status": "in_progress",
        "turns": [
            {
                "at": T(6),
                "question": "데이터 분석 직무 포트폴리오에는 프로젝트를 몇 개 넣는 게 좋을까?",
                "my_thought": "2~3개를 깊게 보여주는 게 좋다고 생각해. 많이 넣으면 하나하나가 얕아 보이고, 면접에서도 결국 한두 개만 물어볼 것 같아. 대신 각 프로젝트가 다른 역량(전처리, 모델링, 시각화)을 보여주면 좋겠어.",
                "ai_answer": "## 핵심: 3개 안팎, 깊이 우선\n\n채용 담당자는 포트폴리오를 오래 보지 않아요. 그래서 **개수보다 첫 프로젝트의 완성도**가 인상을 좌우합니다.\n\n- **대표 프로젝트 1개**: 문제 정의부터 결론까지 가장 깊이 있게. 맨 앞에 둡니다.\n- **보조 프로젝트 1~2개**: 대표 프로젝트와 다른 역량을 보여 주는 것.\n- **지원 직무와의 연결**: 지원하는 회사의 도메인과 비슷한 데이터를 다룬 프로젝트가 있으면 우선순위를 높이세요.\n\n다르게 볼 지점도 있어요. 신입이라면 작은 분석 노트(EDA 몇 개)를 '부록'처럼 따로 묶어 꾸준함을 보여 주는 방법도 있습니다.",
                "memo": "AI도 깊이를 강조했지만 '대표 프로젝트를 맨 앞에'라는 건 생각 못 했다. 대구 폭염 분석을 대표로 두자. 개수는 내 기준(2~3개) 유지.",
            },
            {
                "at": T(4, 2),
                "question": "프로젝트 설명에는 무엇을 꼭 넣어야 할까?",
                "my_thought": "문제 정의와 내가 내린 판단의 근거가 꼭 들어가야 한다고 생각해. 결과 숫자보다 왜 그 방법을 골랐는지가 더 중요하고, 실패했던 시도도 짧게 적으면 좋을 것 같아.",
                "ai_answer": "## 프로젝트 설명의 뼈대\n\n1. **문제**: 누가, 왜 이 문제를 겪는가 (한두 문장)\n2. **데이터**: 출처, 규모, 한계\n3. **접근**: 어떤 방법을 왜 골랐는지 — *다른 선택지와 비교*해서\n4. **결과**: 숫자와 함께, 그 숫자가 의사결정에 어떤 의미인지\n5. **회고**: 다시 한다면 무엇을 바꿀지\n\n특히 **판단의 근거**가 드러나야 분석가로서의 사고가 보여요. 그리고 결과는 가능하면 **비즈니스 임팩트**(비용 절감, 위험 감소 등)로 번역해 주세요.\n\n코드는 깃허브에 올리고, README에 **재현 방법**을 적어 두면 신뢰도가 올라갑니다.",
                "memo": "근거를 중요하게 본 건 같은 생각. 나는 '실패한 시도'를, AI는 '회고'를 말했는데 비슷한 이야기다. 비즈니스 임팩트로 번역하기는 내가 약한 부분.",
            },
            {
                "at": T(1, 5),
                "question": "공공데이터로 한 프로젝트도 기업 지원에 도움이 될까?",
                "my_thought": "도움이 된다고 생각해. 공공데이터는 지저분해서 전처리 역량을 보여주기 좋고, 지역 문제를 직접 정의했다는 점에서 문제 정의 능력도 보여줄 수 있을 것 같아. 다만 기업 데이터와 성격이 달라서 연결고리를 설명해야 할 듯.",
                "ai_answer": "## 충분히 도움이 됩니다\n\n- **전처리 역량**: 결측, 단위 불일치, 기관별 형식 차이를 다룬 경험은 실무와 그대로 이어져요.\n- **문제를 스스로 정의한 경험**: 주어진 과제가 아니라 직접 질문을 만든 점이 강점입니다.\n- **연결고리 설명**: 지원 기업의 문제와 어떻게 닮았는지 한 줄로 이어 주세요. 예: *'지역별 위험 격차 분석 → 매장별 성과 격차 분석'*\n\n추가로, **공공기관 지원**이라면 정책 제안까지 이어진 결과물이 특히 강하게 보입니다. 데이터 출처와 라이선스를 명시하는 것도 잊지 마세요.",
                "memo": None,
            },
        ],
        "mindmap": {
            "mine_only": [
                {"label": "역량별로 다르게 구성", "detail": "프로젝트마다 전처리·모델링·시각화처럼 서로 다른 역량을 보여주자.", "turn_ids": [0]},
                {"label": "실패한 시도도 기록", "detail": "잘 안 된 시도도 짧게 적어 판단 과정을 보여주자.", "turn_ids": [1]},
            ],
            "shared": [
                {"label": "소수 프로젝트를 깊게", "detail": "개수보다 2~3개를 깊이 있게 보여주는 게 낫다.", "kind": "same", "turn_ids": [0]},
                {"label": "판단 근거 드러내기", "detail": "결과 숫자보다 왜 그 방법을 골랐는지가 중요하다.", "kind": "same", "turn_ids": [1]},
                {"label": "공공데이터 = 전처리 역량", "detail": "지저분한 공공데이터를 다룬 경험이 실무 전처리 역량으로 이어진다.", "kind": "same", "turn_ids": [2]},
                {"label": "스스로 정의한 문제", "detail": "지역 문제를 직접 정의한 경험이 문제 정의 능력을 보여준다.", "kind": "similar", "turn_ids": [2]},
                {"label": "기업 문제와 연결하기", "detail": "공공데이터 프로젝트와 지원 기업의 문제를 잇는 설명이 필요하다.", "kind": "similar", "turn_ids": [2]},
            ],
            "ai_only": [
                {"label": "대표 프로젝트를 맨 앞에", "detail": "가장 완성도 높은 프로젝트를 첫 번째에 두어 인상을 좌우한다.", "turn_ids": [0]},
                {"label": "비즈니스 임팩트로 번역", "detail": "결과 숫자를 의사결정에 주는 의미로 바꿔 설명한다.", "turn_ids": [1]},
                {"label": "코드와 재현 방법 공개", "detail": "깃허브 README에 재현 방법을 적어 신뢰도를 높인다.", "turn_ids": [1]},
                {"label": "출처·라이선스 명시", "detail": "공공데이터의 출처와 라이선스를 밝힌다.", "turn_ids": [2]},
            ],
        },
    },
    {
        "name": "오래 기억하는 공부법",
        "is_starred": 0,
        "status": "done",
        "turns": [
            {
                "at": T(9),
                "question": "새로 배운 개념을 오래 기억하려면 어떻게 공부해야 할까?",
                "my_thought": "남에게 설명해 보는 게 제일 오래 남는 것 같아. 설명하다가 막히는 부분이 내가 모르는 부분이니까. 그리고 며칠 뒤에 다시 한 번 보는 것도 필요할 것 같아.",
                "ai_answer": "## 기억을 오래 가게 하는 두 가지\n\n- **인출 연습**: 다시 읽기보다 *떠올리기*가 훨씬 효과적이에요. 책을 덮고 설명해 보거나, 스스로 문제를 내 보세요.\n- **간격 반복**: 1일 → 3일 → 1주 → 2주처럼 간격을 늘려 가며 복습합니다.\n\n덧붙여 **잠**도 중요해요. 공부한 날 충분히 자야 기억이 정리됩니다.",
                "memo": "내가 말한 '설명하기'가 인출 연습이라는 이름이 있었다. 복습 간격을 구체적인 숫자로 정해 두자.",
            },
            {
                "at": T(8, 3),
                "question": "복습 일정을 꾸준히 지키려면 어떻게 해야 할까?",
                "my_thought": "캘린더에 복습 날짜를 미리 박아 두는 게 좋을 것 같아. 의지로 기억하려고 하면 결국 잊어버리니까, 정해진 시간에 짧게 하는 습관으로 만들고 싶어.",
                "ai_answer": "## 의지보다 시스템\n\n- **미리 예약하기**: 공부한 날 바로 다음 복습 날짜를 캘린더에 넣으세요.\n- **짧게 쪼개기**: 한 번에 15분 이내면 미루지 않게 됩니다.\n- **플래시카드 앱** 활용: 간격 반복을 자동으로 계산해 줘서 일정 관리 부담이 줄어요.\n- **기록 남기기**: 복습한 날을 체크하면 이어 가고 싶은 마음이 생깁니다.",
                "memo": "캘린더 예약은 같은 생각. 플래시카드 앱은 써 본 적이 없어서 이번 주에 시도해 보기로.",
            },
        ],
        "mindmap": {
            "mine_only": [
                {"label": "막히는 곳 = 모르는 곳", "detail": "설명하다 막히는 지점으로 내가 모르는 부분을 찾는다.", "turn_ids": [0]},
            ],
            "shared": [
                {"label": "설명하며 떠올리기", "detail": "남에게 설명하는 것이 인출 연습으로 기억을 오래 남긴다.", "kind": "same", "turn_ids": [0]},
                {"label": "간격 두고 다시 보기", "detail": "며칠 뒤 다시 보는 간격 반복이 필요하다.", "kind": "similar", "turn_ids": [0]},
                {"label": "복습 일정 미리 예약", "detail": "캘린더에 복습 날짜를 미리 넣어 둔다.", "kind": "same", "turn_ids": [1]},
                {"label": "짧은 습관으로 만들기", "detail": "의지 대신 짧고 정해진 시간의 습관으로 만든다.", "kind": "similar", "turn_ids": [1]},
            ],
            "ai_only": [
                {"label": "충분한 잠", "detail": "공부한 날 충분히 자야 기억이 정리된다.", "turn_ids": [0]},
                {"label": "플래시카드 앱", "detail": "간격 반복을 자동으로 계산해 주는 앱을 쓴다.", "turn_ids": [1]},
                {"label": "복습 기록 체크", "detail": "복습한 날을 표시해 이어 가는 동기를 만든다.", "turn_ids": [1]},
            ],
        },
    },
    {
        "name": "대학원 vs 취업",
        "is_starred": 1,
        "status": "in_progress",
        "turns": [
            {
                "at": T(2, 1),
                "question": "데이터 분석 분야에서 대학원에 가는 것과 바로 취업하는 것 중 무엇이 나을까?",
                "my_thought": "지금은 바로 취업하는 쪽으로 마음이 기울어. 실무 데이터를 다뤄 보면서 내가 어떤 분야를 더 깊게 공부하고 싶은지 알고 싶고, 대학원은 그 뒤에 가도 늦지 않을 것 같아. 다만 연구직을 원하면 학위가 필요할 수도 있어.",
                "ai_answer": "## 목표 직무가 기준이에요\n\n- **연구·모델 개발 직무**를 원한다면 대학원이 유리합니다. 논문 경험이 곧 경력처럼 인정되는 경우가 많아요.\n- **분석·기획 직무**라면 실무 경험이 더 큰 자산이 됩니다.\n\n바로 취업한다면 **재직 중 대학원(야간·온라인)**이라는 선택지도 있어요. 반대로 대학원부터 간다면 **산학 프로젝트**로 실무 감각을 보완할 수 있습니다.\n\n결정이 어렵다면 관심 회사의 채용 공고 10개를 모아 *학위 요건*을 세어 보는 것부터 해 보세요.",
                "memo": "채용 공고 10개 세어 보기 — 이번 주에 해 볼 것. 결정은 아직 보류.",
            },
        ],
        "mindmap": {
            "mine_only": [
                {"label": "실무로 관심 분야 찾기", "detail": "일해 보면서 더 깊게 공부할 분야를 알고 싶다.", "turn_ids": [0]},
            ],
            "shared": [
                {"label": "연구직은 학위가 유리", "detail": "연구 직무를 원하면 대학원 학위가 필요할 수 있다.", "kind": "same", "turn_ids": [0]},
                {"label": "대학원은 나중에도 가능", "detail": "먼저 취업한 뒤 대학원을 선택할 수 있다.", "kind": "similar", "turn_ids": [0]},
            ],
            "ai_only": [
                {"label": "목표 직무가 기준", "detail": "연구·개발인지 분석·기획인지에 따라 답이 달라진다.", "turn_ids": [0]},
                {"label": "채용 공고로 확인", "detail": "관심 회사 공고 10개의 학위 요건을 세어 본다.", "turn_ids": [0]},
                {"label": "산학 프로젝트", "detail": "대학원에 가면 산학 프로젝트로 실무 감각을 보완한다.", "turn_ids": [0]},
            ],
        },
    },
    {
        "name": "운동 습관 만들기",
        "is_starred": 0,
        "status": "done",
        "turns": [
            {
                "at": T(12),
                "question": "바쁜 평일에도 운동을 꾸준히 하려면 어떻게 해야 할까?",
                "my_thought": "아침에 10분이라도 하는 게 현실적일 것 같아. 저녁에는 피곤해서 미루게 되니까, 출근 전에 짧게 스트레칭이나 맨몸 운동을 하면 될 것 같아.",
                "ai_answer": "## 작게, 같은 시간에\n\n- **최소 단위 정하기**: '10분' 또는 '팔굽혀펴기 10개'처럼 아주 작게 시작하세요.\n- **기존 습관에 붙이기**: 양치 직후처럼 이미 하는 행동 뒤에 붙이면 잊지 않아요.\n- **준비물 미리 두기**: 운동복을 전날 꺼내 두면 시작이 쉬워집니다.\n\n주말에는 조금 길게 해서 평일의 짧은 운동을 보완하는 방식도 좋아요.",
                "memo": None,
            },
        ],
        "mindmap": {
            "mine_only": [
                {"label": "저녁은 피곤해서 미룸", "detail": "저녁 시간대는 피로 때문에 지키기 어렵다.", "turn_ids": [0]},
            ],
            "shared": [
                {"label": "10분부터 작게", "detail": "짧고 작은 단위로 시작하는 게 현실적이다.", "kind": "same", "turn_ids": [0]},
                {"label": "정해진 시간에 하기", "detail": "출근 전 같은 시간대에 고정한다.", "kind": "similar", "turn_ids": [0]},
            ],
            "ai_only": [
                {"label": "기존 습관에 붙이기", "detail": "양치 직후처럼 이미 하는 행동 뒤에 붙인다.", "turn_ids": [0]},
                {"label": "운동복 미리 꺼내 두기", "detail": "준비물을 미리 두어 시작을 쉽게 만든다.", "turn_ids": [0]},
                {"label": "주말에 보완", "detail": "주말에 조금 길게 해서 평일을 보완한다.", "turn_ids": [0]},
            ],
        },
    },
]


def main():
    db = sqlite3.connect(app.DB_PATH)
    added, skipped = [], []
    for topic in TOPICS:
        if db.execute("SELECT 1 FROM topics WHERE name = ?", (topic["name"],)).fetchone():
            skipped.append(topic["name"])
            continue
        first, last = topic["turns"][0]["at"], topic["turns"][-1]["at"]
        cur = db.execute(
            "INSERT INTO topics (name, created_at, updated_at, is_starred, status) VALUES (?, ?, ?, ?, ?)",
            (topic["name"], first, last, topic["is_starred"], topic["status"]),
        )
        topic_id = cur.lastrowid
        ids = []
        for t in topic["turns"]:
            cur = db.execute(
                """INSERT INTO turns (topic_id, question, my_thought, ai_answer, reflection, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (topic_id, t["question"], t["my_thought"], t["ai_answer"], t["memo"], t["at"], t["at"]),
            )
            ids.append(cur.lastrowid)
        # 마인드맵의 순서 번호 → 실제 turn id, 그리고 캐시가 유효하도록 signature를 맞춘다
        mm = {
            key: [{**p, "turn_ids": [ids[i] for i in p["turn_ids"]]} for p in topic["mindmap"][key]]
            for key in ("mine_only", "shared", "ai_only")
        }
        mm["signature"] = ids
        mm["created_at"] = last
        db.execute("UPDATE topics SET mindmap = ? WHERE id = ?", (json.dumps(mm, ensure_ascii=False), topic_id))
        added.append(f"{topic['name']} (대화 {len(ids)}개)")
    db.commit()
    db.close()
    print("추가:", ", ".join(added) if added else "없음")
    if skipped:
        print("이미 있어서 건너뜀:", ", ".join(skipped))


if __name__ == "__main__":
    main()
