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
    # ---- 왜 비포블랭크가 필요한지 보여 주는 사례 1: 원래 하던 일에서 새 버린 대화 ----
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
                "ai_answer": "## 세 묶음으로 나눠 보면 정리가 쉬워요\n\n- **노출**: 얼마나 더운가 — 기온, 위성으로 구하는 **지표면 온도**\n- **민감도**: 더위에 얼마나 약한가 — 65세 이상 비율, 독거노인, 기저질환\n- **적응 능력**: 더위를 피할 수 있는가 — 무더위쉼터 접근성, 녹지 비율, 냉방 시설\n\n묶음마다 1~2개씩, 모두 4~6개면 충분해요. 단위가 다르니 **표준화**한 뒤 합치세요.\n\n지금 생각하신 세 지표는 민감도·적응 능력에 해당해요. 노출 지표를 하나 더하면 균형이 맞습니다.",
                "memo": "AI는 노출·민감도·적응 능력으로 나눴다. 내 지표 세 개가 민감도·적응 능력에 들어가서 방향은 맞다. 노출 쪽으로 지표면 온도를 넣을지만 정하면 된다.",
            },
            {
                "at": T(1, 1, 21),
                "question": "지표면 온도를 지도로 보여 주려면 어떤 도구가 좋아?",
                "my_thought": "보고서에 지도 하나는 넣어야 하니까 파이썬 folium이면 충분할 것 같아. 꾸미는 데 시간을 너무 쓰면 안 돼.",
                "ai_answer": "## 목적에 따라 달라요\n\n- **folium**: 파이썬에서 가장 빠르게 만들 수 있어요. 보고서용 정적 지도에 충분해요.\n- **kepler.gl**: 3D 막대, 시간 애니메이션 등 **눈에 띄는 시각화**가 쉬워요.\n- **QGIS**: 인쇄용 지도를 세밀하게 다듬을 때 좋아요.\n- **Mapbox**: 웹에서 디자인을 자유롭게 바꿀 수 있지만 설정이 많아요.\n\n발표에서 인상을 남기고 싶다면 kepler.gl의 3D 지도도 고려해 보세요.",
                "memo": None,
            },
            {
                "at": T(1, 1, 40),
                "question": "kepler.gl로 3D 지도를 만들려면 데이터를 어떤 형식으로 바꿔야 해?",
                "my_thought": "GeoJSON으로 바꾸면 될 것 같은데 행정동 경계 파일이 필요할 거야. 일단 한번 해 보고 싶어.",
                "ai_answer": "## 두 가지 방법이 있어요\n\n1. **GeoJSON**: 행정동 경계에 값을 붙여서 올리면 면 단위 3D 지도가 돼요.\n2. **위경도 CSV**: 점 데이터를 올린 뒤 **H3 육각형 격자**로 묶으면 지역 경계 없이도 밀도를 보여 줄 수 있어요.\n\n높이 값은 0~1로 표준화해 두면 막대가 지나치게 튀지 않아요.",
                "memo": None,
            },
            {
                "at": T(1, 2, 2),
                "question": "만든 지도를 웹에 올려서 링크로 공유하려면 어떻게 해?",
                "my_thought": "깃허브 페이지에 올리면 무료로 될 것 같아. 심사위원이 링크로 볼 수 있으면 좋겠어.",
                "ai_answer": "## 무료로 올리는 방법\n\n- **GitHub Pages**: kepler.gl에서 HTML로 내보낸 뒤 저장소에 올리면 돼요.\n- **Netlify / Vercel**: 폴더를 끌어다 놓기만 하면 바로 주소가 생겨요.\n\nMapbox 지도를 쓴다면 **토큰이 공개되지 않게** 도메인 제한을 꼭 걸어 두세요.",
                "memo": "잠깐, 원래는 오늘 지표를 확정하려고 했는데 1시간째 지도 배포 방법을 보고 있다. 공모전 제출물은 PDF 보고서라 웹 지도는 필수가 아니다. 지표부터 다시 정하자.",
            },
            {
                "at": T(1, 2, 35),
                "question": "노인 인구 비율, 쉼터 접근성, 녹지 비율, 지표면 온도 네 지표에 가중치를 어떻게 주는 게 좋을까?",
                "my_thought": "처음엔 똑같이 25%씩 주고, 다른 가중치와 결과를 비교해 보는 게 공정할 것 같아. 근거 없는 가중치는 심사에서 지적받을 수 있어.",
                "ai_answer": "## 동일 가중치로 시작하고 검증하세요\n\n- **기준안**: 25%씩 동일 가중치 — 설명하기 가장 쉬워요.\n- **비교안**: 엔트로피 가중치나 전문가 설문(AHP)으로 만든 가중치\n- **민감도 분석**: 가중치를 바꿔도 상위 지역이 크게 바뀌지 않는지 확인하세요.\n\n한 가지 주의할 점: **녹지 비율과 지표면 온도는 서로 강하게 연결**돼 있어서, 둘을 함께 넣으면 같은 효과를 두 번 세는 셈이 될 수 있어요. 상관계수를 먼저 확인해 보세요.",
                "memo": "동일 가중치로 시작해 비교하는 건 같은 생각. 녹지와 지표면 온도가 겹친다는 건 생각 못 했다. 상관계수부터 확인하고 지표를 최종 확정하자.",
            },
        ],
        "mindmap": {
            "mine_only": [
                {"label": "오늘 지표 확정이 목표", "detail": "오늘 안에 지표 3~4개를 확정하는 것이 원래 목표였다.", "turn_ids": [0]},
                {"label": "꾸미는 데 시간 쓰지 않기", "detail": "보고서용 지도는 간단하게, 시각화에 시간을 많이 쓰지 않으려 했다.", "turn_ids": [1]},
                {"label": "근거 있는 가중치", "detail": "근거 없는 가중치는 심사에서 지적받을 수 있다.", "turn_ids": [4]},
            ],
            "shared": [
                {"label": "사람 쪽 지표 함께 보기", "detail": "기온뿐 아니라 고령 인구 같은 민감도 지표가 필요하다.", "kind": "same", "turn_ids": [0]},
                {"label": "쉼터·녹지로 대응력 보기", "detail": "무더위쉼터 접근성과 녹지 비율로 더위를 피할 수 있는지 본다.", "kind": "same", "turn_ids": [0]},
                {"label": "보고서엔 folium이면 충분", "detail": "정적인 보고서 지도는 folium으로 빠르게 만들 수 있다.", "kind": "similar", "turn_ids": [1]},
                {"label": "동일 가중치로 시작", "detail": "25%씩 같은 가중치를 기준안으로 둔다.", "kind": "same", "turn_ids": [4]},
                {"label": "다른 가중치와 비교", "detail": "가중치를 바꿔 결과가 흔들리는지 확인한다.", "kind": "similar", "turn_ids": [4]},
            ],
            "ai_only": [
                {"label": "노출·민감도·적응 능력", "detail": "지표를 세 묶음으로 나눠 균형을 맞춘다.", "turn_ids": [0]},
                {"label": "kepler.gl 3D 지도", "detail": "발표용으로 눈에 띄는 3D 지도를 만든다.", "turn_ids": [1, 2]},
                {"label": "H3 육각형 격자", "detail": "지역 경계 없이 점 데이터를 육각형으로 묶어 보여 준다.", "turn_ids": [2]},
                {"label": "GitHub Pages·Netlify 배포", "detail": "만든 지도를 웹에 올려 링크로 공유한다.", "turn_ids": [3]},
                {"label": "녹지와 지표면 온도의 중복", "detail": "두 지표가 강하게 연결돼 같은 효과를 두 번 셀 수 있다.", "turn_ids": [4]},
            ],
            "uncertain": [
                {"mine_label": "GeoJSON으로 변환", "ai_label": "행정동 경계에 값 붙이기", "shared_label": "지역 경계 데이터 준비",
                 "question": "내 생각의 'GeoJSON으로 변환'과 AI의 '행정동 경계에 값 붙이기'를 같은 생각으로 볼까요?", "turn_ids": [2]},
            ],
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
                "ai_answer": "## 첫 문단의 기본 틀\n\n1. **한 문장 정체성**: '데이터로 문제를 정의하는 분석가 OOO입니다'처럼 나를 한 줄로 소개\n2. **핵심 역량 세 가지**: 문제 정의, 데이터 처리, 커뮤니케이션\n3. **지원 동기 연결**: 회사의 방향과 내 역량이 맞닿는 지점\n\n첫 문장에 직무 키워드를 넣으면 서류 검토자가 빠르게 파악할 수 있어요.",
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
        added.append(f"{topic['name']} (대화 {len(ids)}개)")
    db.commit()
    db.close()
    print(f"[{email}] 추가:", ", ".join(added) if added else "없음")
    if skipped:
        print("이미 있어서 건너뜀:", ", ".join(skipped))


if __name__ == "__main__":
    main()
