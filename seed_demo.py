"""예시 데이터 넣기.

    python seed_demo.py                      # 체험용 계정을 만들고 그 계정에 넣는다
    python seed_demo.py --email=me@example.com  # 이미 가입한 내 계정에 넣는다

체험용 계정: demo@thinkfirst.local / thinkfirst1  (로컬 체험 전용, 실제 서비스에서는 쓰지 말 것)
그 계정에 같은 이름의 주제가 이미 있으면 건너뛴다 (기존 데이터는 건드리지 않음).
마인드맵도 미리 정리해 넣어 두어서 API 키 없이도 마인드맵 탭을 볼 수 있다.
"""

import json
import sqlite3
from datetime import datetime, timedelta

from werkzeug.security import generate_password_hash

import app  # import 하면 DB 테이블이 준비된다

DEMO_USER = {"name": "체험용", "email": "demo@thinkfirst.local", "password": "thinkfirst1", "age": 25, "gender": "응답 안 함"}

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
            ],
            "uncertain": [
                {"mine_label": "실패한 시도도 기록", "ai_label": "회고 남기기", "shared_label": "과정을 돌아보는 기록",
                 "question": "내 생각의 '실패한 시도도 기록'과 AI의 '회고 남기기'를 같은 생각으로 볼까요?", "turn_ids": [1]},
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
    # ---- 비포블랭크를 왜 쓰는지 보여 주는 사례: 곁가지는 메모함에 붙잡고, 대화는 한 방향으로 ----
    {
        "name": "폭염 취약지역 분석 보고서",
        "folder": "공모전",
        "is_starred": 1,
        "status": "in_progress",
        "turns": [
            {
                "at": T(1, 1, 5),
                "question": "폭염 취약지역을 고를 때 어떤 지표를 써야 할까?",
                "my_thought": "기온만 보면 안 되고 사람 쪽 지표가 같이 들어가야 할 것 같아. 노인 인구 비율, 무더위쉼터까지 거리, 녹지 비율 정도를 생각하고 있어. 오늘 안에 지표 3~4개를 확정하는 게 목표야.",
                "ai_answer": "## 세 묶음으로 나눠 보면 정리가 쉬워요\n\n- **노출**: 얼마나 더운가 — 기온, 위성으로 구하는 **지표면 온도**(Landsat 위성 자료는 대기 보정이 필요해요)\n- **민감도**: 더위에 얼마나 약한가 — 65세 이상 비율, 독거노인, 기저질환\n- **적응 능력**: 더위를 피할 수 있는가 — 무더위쉼터 접근성, 녹지 비율, 냉방 시설\n\n묶음마다 1~2개씩, 모두 4~6개면 충분해요. 단위가 다르니 **min-max 정규화**나 **z-score 표준화**로 맞춘 뒤 합치세요.\n\n지금 생각하신 세 지표는 민감도·적응 능력에 해당해요. 노출 지표를 하나 더하면 균형이 맞습니다.",
                "memo": "노출 지표로 지표면 온도를 넣기로. 위성 보정이나 표준화 방법처럼 모르는 건 메모함에 넣어 두고, 지금은 지표 확정에만 집중하자.",
            },
            {
                "at": T(1, 1, 20),
                "question": "노인 인구 비율, 쉼터 접근성, 녹지 비율, 지표면 온도 데이터는 각각 어디서 구해?",
                "my_thought": "인구는 통계청, 쉼터는 공공데이터포털에 있을 것 같아. 녹지랑 지표면 온도는 잘 모르겠어. 출처만 정하고 바로 다음 단계로 가고 싶어.",
                "ai_answer": "## 지표별 출처\n\n- **노인 인구 비율**: 통계청 SGIS 행정동 단위 인구\n- **쉼터 접근성**: 행정안전부 무더위쉼터 목록(공공데이터포털) — 연도별로 바뀌니 **최신 연도**를 확인하세요\n- **녹지 비율**: 환경부 토지피복지도\n- **지표면 온도**: USGS EarthExplorer의 Landsat 8, 또는 **Google Earth Engine**에서 바로 계산\n\n결과는 **kepler.gl로 3D 지도**를 만들면 발표 때 인상적이고, **GitHub Pages**에 올리면 링크로 공유할 수도 있어요.",
                "memo": "3D 지도랑 웹 공유는 끌리지만 제출물은 PDF 보고서다. 따라가지 않고 '마음에 드는 것'으로 담아 둠. 출처는 네 개 모두 확정.",
            },
            {
                "at": T(1, 1, 41),
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
    },
    # ---- 사례 2: AI 답에 끌려갈 뻔했지만, 먼저 적은 내 생각으로 방향을 지킨 대화 ----
    {
        "name": "자기소개서 첫 문단",
        "folder": "취업 준비",
        "is_starred": 0,
        "status": "done",
        "turns": [
            {
                "at": T(3, 5, 10),
                "question": "데이터 분석 직무 자기소개서 첫 문단은 어떻게 시작하는 게 좋을까?",
                "my_thought": "'저는 ~한 사람입니다'로 시작하는 건 너무 흔해. 공공데이터로 지역 폭염 문제를 분석했던 경험 한 장면으로 바로 시작하고 싶어.",
                "ai_answer": "## 첫 문단의 기본 틀\n\n1. **한 문장 정체성**: '데이터로 문제를 정의하는 분석가 OOO입니다'처럼 나를 한 줄로 소개\n2. **핵심 역량 세 가지**: 문제 정의, 데이터 처리, 커뮤니케이션\n3. **지원 동기 연결**: 회사의 방향과 내 역량이 맞닿는 지점\n\n첫 문장에 직무 키워드를 넣으면 서류 검토자가 빠르게 파악할 수 있어요. 경험은 **STAR 기법**(상황-과제-행동-결과)으로 정리하면 좋고, 지원 회사의 **인재상**도 미리 확인해 두세요.",
                "memo": "AI 답을 먼저 봤다면 '데이터로 문제를 정의하는 분석가입니다'를 그대로 썼을 것 같다. 무난하지만 누구나 쓸 수 있는 문장이다. 내 원래 생각대로 폭염 분석 장면으로 시작하고, AI가 말한 '직무 키워드'는 둘째 문장에 넣자.",
            },
            {
                "at": T(3, 5, 32),
                "question": "경험 한 장면으로 시작하면 너무 길어지지 않을까?",
                "my_thought": "장면은 두 문장 안으로 짧게 쓰고, 바로 '그래서 나는 이런 분석가'로 연결하면 길지 않을 것 같아.",
                "ai_answer": "## 장면으로 시작할 때의 요령\n\n- 장면은 **두 문장 이내**: 상황 → 내가 한 행동\n- 셋째 문장에서 **역량으로 연결**: '이 경험으로 ~을 배웠습니다'\n- 숫자 하나를 넣으면 짧아도 구체적으로 보여요 (예: 8개 구, 3년치 데이터)",
                "memo": "두 문장으로 짧게 쓰는 건 같은 생각. 숫자를 넣으라는 건 좋은 팁 — '8개 구, 3년치 데이터'를 넣자.",
            },
        ],
        "notes": [
            {"turn": 0, "kind": "check", "text": "STAR 기법(상황-과제-행동-결과)", "note": "", "priority": "mid"},
            {"turn": 0, "kind": "todo", "text": "지원 회사의 인재상", "note": "채용 공고와 회사 소개 페이지에서 확인", "priority": "high"},
            {"turn": 1, "kind": "like", "text": "둘째 문단은 어떻게 구성할까?", "note": "첫 문단 끝내고 묻기", "priority": "mid"},
        ],
        "mindmap": {
            "mine_only": [
                {"label": "흔한 첫 문장 피하기", "detail": "'저는 ~한 사람입니다'처럼 누구나 쓰는 시작은 피한다.", "turn_ids": [0]},
                {"label": "폭염 분석 장면으로 시작", "detail": "공공데이터로 지역 문제를 분석한 경험 한 장면으로 바로 시작한다.", "turn_ids": [0]},
            ],
            "shared": [
                {"label": "장면은 두 문장 이내", "detail": "경험 장면은 짧게 쓰고 바로 역량으로 잇는다.", "kind": "same", "turn_ids": [1]},
                {"label": "경험을 역량으로 연결", "detail": "장면 뒤에 어떤 분석가인지로 연결한다.", "kind": "similar", "turn_ids": [1]},
            ],
            "ai_only": [
                {"label": "한 문장 정체성", "detail": "'~하는 분석가입니다'처럼 나를 한 줄로 소개한다.", "turn_ids": [0]},
                {"label": "첫 문장에 직무 키워드", "detail": "서류 검토자가 빠르게 파악하도록 키워드를 넣는다.", "turn_ids": [0]},
                {"label": "숫자 하나 넣기", "detail": "구 개수, 기간 같은 숫자로 구체성을 더한다.", "turn_ids": [1]},
            ],
            "uncertain": [],
        },
    },
]


def target_user(db):
    email = app._arg("email")
    if email:
        row = db.execute("SELECT id FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()
        if not row:
            raise SystemExit(f"{email} 로 가입한 계정이 없어요. 먼저 사이트에서 회원가입해 주세요.")
        return row[0], email
    row = db.execute("SELECT id FROM users WHERE email = ?", (DEMO_USER["email"],)).fetchone()
    if row:
        return row[0], DEMO_USER["email"]
    cur = db.execute(
        "INSERT INTO users (name, email, password_hash, age, gender, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (DEMO_USER["name"], DEMO_USER["email"], generate_password_hash(DEMO_USER["password"]),
         DEMO_USER["age"], DEMO_USER["gender"], app.now()),
    )
    print(f"체험용 계정을 만들었어요: {DEMO_USER['email']} / {DEMO_USER['password']}")
    return cur.lastrowid, DEMO_USER["email"]


def main():
    db = sqlite3.connect(app.DB_PATH)
    uid, email = target_user(db)
    added, skipped = [], []
    for topic in TOPICS:
        if db.execute("SELECT 1 FROM topics WHERE name = ? AND user_id = ?", (topic["name"], uid)).fetchone():
            skipped.append(topic["name"])
            continue
        first, last = topic["turns"][0]["at"], topic["turns"][-1]["at"]
        folder_id = None
        if topic.get("folder"):  # 폴더가 있으면 쓰고, 없으면 만든다
            row = db.execute("SELECT id FROM folders WHERE user_id = ? AND name = ?", (uid, topic["folder"])).fetchone()
            folder_id = row[0] if row else db.execute(
                "INSERT INTO folders (user_id, name, created_at) VALUES (?, ?, ?)", (uid, topic["folder"], first)).lastrowid
        cur = db.execute(
            "INSERT INTO topics (user_id, folder_id, name, created_at, updated_at, is_starred, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (uid, folder_id, topic["name"], first, last, topic["is_starred"], topic["status"]),
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
            key: [{**p, "turn_ids": [ids[i] for i in p["turn_ids"]]} for p in topic["mindmap"].get(key, [])]
            for key in ("mine_only", "shared", "ai_only", "uncertain")
        }
        mm["signature"] = ids
        mm["created_at"] = last
        db.execute("UPDATE topics SET mindmap = ? WHERE id = ?", (json.dumps(mm, ensure_ascii=False), topic_id))
        for n in topic.get("notes", []):
            at = topic["turns"][n["turn"]]["at"]
            db.execute(
                """INSERT INTO side_notes (topic_id, turn_id, user_id, kind, text, note, priority, done, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (topic_id, ids[n["turn"]], uid, n["kind"], n["text"], n.get("note", ""), n.get("priority", "mid"), n.get("done", 0), at, at),
            )
        added.append(f"{topic['name']} (대화 {len(ids)}개" + (f", 메모 {len(topic['notes'])}개)" if topic.get("notes") else ")"))
    db.commit()
    db.close()
    print(f"[{email}] 추가:", ", ".join(added) if added else "없음")
    if skipped:
        print("이미 있어서 건너뜀:", ", ".join(skipped))


if __name__ == "__main__":
    main()
