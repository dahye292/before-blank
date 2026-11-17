"""비포블랭크 Before Blank (줄여서 비비)

AI에게 묻기 전에 내 생각을 먼저 적고, 그다음에 AI의 답을 보는 질문 노트.
주제 1개에 대화 턴(질문 · 내 생각 · AI 답) N개가 쌓이고,
주제마다 내 생각과 AI 답을 비교하는 수렴형 마인드맵을 만든다.
"""

import hashlib
import base64
import json
import os
import uuid
import re
import secrets
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path

import anthropic
from example_topic import insert_topic, make_example
from dotenv import load_dotenv
from flask import Flask, Response, g, jsonify, request, send_file, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash
import smtplib
from email.message import EmailMessage

BASE_DIR = Path(__file__).resolve().parent
def _arg(name, default=None):
    """--name=값 형태의 실행 옵션을 읽는다 (예: python app.py --db=data/demo.db --port=5051)"""
    for a in sys.argv[1:]:
        if a.startswith(f"--{name}="):
            return a.split("=", 1)[1]
    return default


DB_PATH = Path(_arg("db") or os.environ.get("THINKFIRST_DB") or BASE_DIR / "data" / "thinkfirst.db")
if not DB_PATH.is_absolute():
    DB_PATH = BASE_DIR / DB_PATH
MODEL = "claude-opus-5-5"
MIN_THOUGHT_LEN = 1  # 글자 수 제한은 없지만, 내 생각을 한 글자라도 먼저 적어야 AI 답을 볼 수 있다

load_dotenv(BASE_DIR / ".env")
# 데모 모드: API 키 없이 화면 흐름을 확인하기 위한 가짜 AI. 실제 사용에서는 끈다.
DEMO = os.environ.get("THINKFIRST_DEMO") == "1" or "--demo" in sys.argv

app = Flask(__name__, static_folder="static", static_url_path="/static")

# 배포 모드(PRODUCTION=1): 인터넷에 올릴 때 켠다. https 전용 쿠키, 직접 정한 SECRET_KEY 필수.
PRODUCTION = os.environ.get("PRODUCTION") == "1"
if os.environ.get("TRUST_PROXY") == "1" or PRODUCTION:
    # 배포 서버의 중계 장치(프록시) 뒤에서는 모든 요청이 프록시 주소로 보인다.
    # 프록시가 붙여 주는 X-Forwarded-For/Proto를 한 단계만 믿어 실제 접속 주소와 https 여부를 얻는다.
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
# 디자인(CSS·JS)을 고치면 새로고침만으로 바로 반영되게 브라우저 캐시를 쓰지 않는다
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0


def _secret_key():
    """로그인 쿠키 서명용 키. .env의 SECRET_KEY를 쓰고, 없으면 data/secret_key 파일에 만들어 둔다(git 제외).
    배포 모드에서는 서버가 바뀌어도 로그인이 유지되고 키가 파일로 흩어지지 않게, 직접 정한 키를 반드시 쓴다."""
    if os.environ.get("SECRET_KEY"):
        if PRODUCTION and len(os.environ["SECRET_KEY"]) < 32:
            raise SystemExit("PRODUCTION=1에서는 SECRET_KEY를 32자 이상으로 정해 주세요. (예: python -c \"import secrets; print(secrets.token_hex(32))\")")
        return os.environ["SECRET_KEY"]
    if PRODUCTION:
        raise SystemExit("PRODUCTION=1에서는 .env에 SECRET_KEY를 꼭 정해 주세요. (예: python -c \"import secrets; print(secrets.token_hex(32))\")")
    path = DB_PATH.parent / "secret_key"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(secrets.token_hex(32), encoding="utf-8")
    return path.read_text(encoding="utf-8").strip()


app.secret_key = _secret_key()

# 첨부파일: 질문에 붙이는 자료. AI가 함께 읽고, 마인드맵의 '첨부 자료'로 정리된다
UPLOAD_DIR = DB_PATH.parent / "uploads"
ALLOWED_FILES = {  # 확장자: (MIME, 종류)
    ".txt": ("text/plain", "text"), ".md": ("text/markdown", "text"), ".csv": ("text/csv", "text"),
    ".pdf": ("application/pdf", "pdf"),
    ".png": ("image/png", "image"), ".jpg": ("image/jpeg", "image"), ".jpeg": ("image/jpeg", "image"), ".webp": ("image/webp", "image"),
}
MAX_FILE_MB, MAX_FILES_PER_TURN = 5, 3
app.config["MAX_CONTENT_LENGTH"] = (MAX_FILE_MB * MAX_FILES_PER_TURN + 1) * 1024 * 1024
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,      # 자바스크립트에서 로그인 쿠키를 읽을 수 없게
    SESSION_COOKIE_SAMESITE="Lax",     # 다른 사이트에서 보낸 요청에는 쿠키가 붙지 않게
    SESSION_COOKIE_SECURE=PRODUCTION or os.environ.get("SESSION_COOKIE_SECURE") == "1",  # https에서만 쿠키 전송 (배포 모드면 자동)
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
)

SYSTEM_PROMPT = (
    "당신은 사용자가 스스로 생각한 뒤에 참고하는 조언자입니다. "
    "질문에 한국어로 명확하고 간결하게 답하세요. "
    "결론만 주지 말고, 어떤 관점과 근거로 그렇게 보는지 드러내고, "
    "다르게 볼 수 있는 지점이 있으면 함께 짚어 주세요. "
    "같은 단계의 이전 질문과 답이 함께 주어지면 그 흐름을 이어서 답하고, 앞 단계에서 사용자가 정한 것이 주어지면 그 결정을 전제로 답하세요. "
    "질문에 링크가 있으면 web_fetch로 그 페이지를 직접 읽고, 최근 사실이 필요하면 web_search로 찾아 근거로 쓰세요. "
    "비교가 필요하면 마크다운 표를 써도 되고, 참고한 페이지는 [제목](주소) 링크로 남기세요."
)
# AI 답에서 쓸 수 있는 웹 도구 (Anthropic 서버에서 실행). 답 하나에 각각 최대 3번까지 — 비용이 커지지 않게.
WEB_TOOLS = [
    {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 3},
    {"type": "web_search_20260209", "name": "web_search", "max_uses": 3},
]


# ---------- DB ----------

def get_db():
    if "db" not in g:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def table_exists(db, name):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def columns(db, table):
    return {r[1] for r in db.execute(f"PRAGMA table_info({table})")}


def init_db():
    """테이블을 만들고, 이전 버전 DB(질문 1개 = 기록 1개 구조)를 자동으로 옮긴다."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    try:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                age INTEGER NOT NULL,
                gender TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS stages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                conclusion TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_stages_topic ON stages(topic_id);
            CREATE TABLE IF NOT EXISTS rate_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                key TEXT NOT NULL,
                at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_rate_events ON rate_events(kind, key, at);
            CREATE TABLE IF NOT EXISTS ai_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                day TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage(day, user_id);
            CREATE TABLE IF NOT EXISTS side_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                turn_id INTEGER REFERENCES turns(id) ON DELETE SET NULL,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                text TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                priority TEXT NOT NULL DEFAULT 'mid',
                done INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_side_notes_topic ON side_notes(topic_id);
            CREATE TABLE IF NOT EXISTS attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                turn_id INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                mime TEXT NOT NULL,
                kind TEXT NOT NULL,
                size INTEGER NOT NULL,
                stored_name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS password_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                used_at TEXT
            );
            CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_user_name ON folders(user_id, name);
            CREATE TABLE IF NOT EXISTS topics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT,
                is_starred INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'in_progress',
                mindmap TEXT
            );
            CREATE TABLE IF NOT EXISTS turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                question TEXT NOT NULL,
                my_thought TEXT NOT NULL,
                ai_answer TEXT,
                reflection TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_turns_topic ON turns(topic_id, id);
            """
        )
        cols = columns(db, "topics")
        if "is_starred" not in cols:
            db.execute("ALTER TABLE topics ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0")
        if "status" not in cols:
            db.execute("ALTER TABLE topics ADD COLUMN status TEXT NOT NULL DEFAULT 'in_progress'")
        if "mindmap" not in cols:
            db.execute("ALTER TABLE topics ADD COLUMN mindmap TEXT")
        if "updated_at" not in cols:
            db.execute("ALTER TABLE topics ADD COLUMN updated_at TEXT")
            db.execute("UPDATE topics SET updated_at = created_at")

        # 이전 버전의 entries(질문 1개 단위) → turns(주제 안의 대화 턴)
        if table_exists(db, "entries"):
            old = columns(db, "entries")
            reflection = "reflection" if "reflection" in old else "NULL"
            db.execute(
                f"""INSERT INTO turns (id, topic_id, question, my_thought, ai_answer, reflection, created_at, updated_at)
                    SELECT id, topic_id, question, my_thought, ai_answer, {reflection}, created_at, updated_at
                    FROM entries ORDER BY created_at, id"""
            )
            if "status" in old:
                # 주제 안의 기록이 모두 완료였으면 주제도 완료
                db.execute(
                    """UPDATE topics SET status = 'done'
                       WHERE id IN (SELECT topic_id FROM entries GROUP BY topic_id
                                    HAVING SUM(status != 'done') = 0)"""
                )
            db.execute(
                """UPDATE topics SET updated_at = COALESCE(
                       (SELECT MAX(updated_at) FROM entries WHERE entries.topic_id = topics.id), created_at)"""
            )
            # 지우지 않고 이름만 바꿔 둔다 (되돌릴 수 있게)
            db.execute("ALTER TABLE entries RENAME TO entries_legacy")

        # 회원 기능 이전의 topics 표(주제 이름이 전체에서 하나뿐, user_id 없음) → 사용자별 주제로 다시 만든다
        topics_sql = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='topics'").fetchone()[0]
        if "user_id" not in columns(db, "topics") or "UNIQUE" in topics_sql.upper():
            db.execute("PRAGMA foreign_keys = OFF")
            db.executescript(
                """
                CREATE TABLE topics_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT,
                    is_starred INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'in_progress',
                    mindmap TEXT
                );
                INSERT INTO topics_new (id, name, created_at, updated_at, is_starred, status, mindmap)
                    SELECT id, name, created_at, updated_at, is_starred, status, mindmap FROM topics;
                DROP TABLE topics;
                ALTER TABLE topics_new RENAME TO topics;
                """
            )
        # 같은 사람 안에서만 주제 이름이 겹치지 않게
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_topics_user_name ON topics(user_id, name)")
        # 메모 종류 바꾸기 이전 DB: 모르는 것→확인할 것, 체크할 것→할 일, 나중에 물어볼 것→마음에 드는 것
        if db.execute("SELECT 1 FROM side_notes WHERE kind IN ('unknown', 'later') LIMIT 1").fetchone():
            db.execute("""UPDATE side_notes SET kind = CASE kind WHEN 'check' THEN 'todo' WHEN 'unknown' THEN 'check'
                          WHEN 'later' THEN 'like' END WHERE kind IN ('check', 'unknown', 'later')""")
        # 폴더 기능 이전 DB: 주제에 폴더 칸 추가 (비어 있으면 '폴더 없음')
        if "folder_id" not in columns(db, "topics"):
            db.execute("ALTER TABLE topics ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL")
        if "invite_code" not in columns(db, "users"):
            db.execute("ALTER TABLE users ADD COLUMN invite_code TEXT")
        if "is_sample" not in columns(db, "topics"):
            # 예시로 넣어 준 주제 표시: 통계에서 뺀다 (가입 때 넣는 [예시] 주제는 이름으로 찾아 표시)
            db.execute("ALTER TABLE topics ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0")
            db.execute("UPDATE topics SET is_sample = 1 WHERE name LIKE '[예시]%'")
        if "is_sample" not in columns(db, "turns"):
            # 예시 주제 안에서도 사용자가 새로 한 질문은 실제 사용으로 센다 → 예시로 넣은 대화·메모만 따로 표시
            db.execute("ALTER TABLE turns ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0")
            db.execute("ALTER TABLE side_notes ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0")
            example_qs = [t["question"] for t in make_example()["turns"]]
            db.execute(
                f"""UPDATE turns SET is_sample = 1 WHERE question IN ({','.join('?' * len(example_qs))})
                    AND topic_id IN (SELECT id FROM topics WHERE is_sample = 1)""", example_qs)
            # 예시로 넣은 메모는 그 대화와 같은 시각에 만들어졌다 (사용자가 나중에 담은 메모와 구분)
            db.execute("""UPDATE side_notes SET is_sample = 1 WHERE EXISTS (
                SELECT 1 FROM turns tu WHERE tu.id = side_notes.turn_id AND tu.is_sample = 1 AND tu.created_at = side_notes.created_at)""")
        if "conclusion" not in columns(db, "topics"):
            # 피라미드 정리: 주제 결론 한 줄 + '반대로 생각하면?' 한 줄 (근거는 각 단계의 결론)
            db.execute("ALTER TABLE topics ADD COLUMN conclusion TEXT NOT NULL DEFAULT ''")
            db.execute("ALTER TABLE topics ADD COLUMN counter TEXT NOT NULL DEFAULT ''")
        if "stage_id" not in columns(db, "turns"):
            # 한 주제 = 단계 박스들. 지금까지의 질문은 하나씩 단계가 되고,
            # 내 생각 없이 이어 물은 꼬리 질문은 바로 앞 단계 박스에 붙인다
            db.execute("ALTER TABLE turns ADD COLUMN stage_id INTEGER REFERENCES stages(id) ON DELETE CASCADE")
            for (topic_id,) in db.execute("SELECT DISTINCT topic_id FROM turns").fetchall():
                current = None
                for tid, question, thought, created in db.execute(
                        "SELECT id, question, my_thought, created_at FROM turns WHERE topic_id = ? ORDER BY id", (topic_id,)).fetchall():
                    if current is None or (thought or "").strip():
                        current = db.execute(
                            "INSERT INTO stages (topic_id, title, conclusion, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
                            (topic_id, question[:80], created, created)).lastrowid
                    db.execute("UPDATE turns SET stage_id = ? WHERE id = ?", (current, tid))
        db.commit()
    finally:
        db.close()


def now():
    return datetime.now().isoformat(timespec="seconds")


def touch_topic(db, topic_id):
    db.execute("UPDATE topics SET updated_at = ? WHERE id = ?", (now(), topic_id))


# ---------- 회원 · 로그인 ----------

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
GENDERS = ("여성", "남성", "기타", "응답 안 함")
MIN_AGE = 14  # 만 14세 미만은 법정대리인 동의가 필요해서 가입을 받지 않는다


# ---------- 시도 횟수 제한 (로그인·초대 코드·비밀번호 찾기) ----------
# 기록을 DB에 두어 서버를 다시 켜도 초기화되지 않는다.

def rate_count(kind, key, window):
    db = get_db()
    db.execute("DELETE FROM rate_events WHERE at < ?", (time.time() - 86400,))  # 하루 지난 기록은 정리
    return db.execute("SELECT COUNT(*) FROM rate_events WHERE kind = ? AND key = ? AND at > ?",
                      (kind, key, time.time() - window)).fetchone()[0]


def rate_hit(kind, key):
    db = get_db()
    db.execute("INSERT INTO rate_events (kind, key, at) VALUES (?, ?, ?)", (kind, key, time.time()))
    db.commit()


def rate_clear(kind, key):
    db = get_db()
    db.execute("DELETE FROM rate_events WHERE kind = ? AND key = ?", (kind, key))
    db.commit()


def client_ip():
    return request.remote_addr or "?"


def current_user_id():
    return session.get("uid")


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not current_user_id():
            return jsonify(error="로그인이 필요해요."), 401
        return view(*args, **kwargs)
    return wrapper


# 모든 응답에 붙이는 보안 헤더
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",                                        # 외부·인라인 스크립트 실행 금지
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",  # 화면 코드가 쓰는 style 속성 + 글꼴 CSS
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",                                   # 다른 사이트 안에 끼워 넣기(클릭재킹) 금지
])


@app.after_request
def security_headers(resp):
    h = resp.headers
    h.setdefault("Content-Security-Policy", CSP)
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "same-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.path.startswith("/api/"):
        h.setdefault("Cache-Control", "no-store")  # 개인 기록이 브라우저·중간 서버 캐시에 남지 않게
    if PRODUCTION and request.is_secure:
        h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return resp


@app.before_request
def protect_api():
    """다른 사이트가 몰래 보낸 요청(CSRF)을 막기 위해, 데이터를 바꾸는 API 요청은 JSON만 받는다.
    (일반 HTML 폼은 JSON을 보낼 수 없고, 다른 사이트의 JSON 요청은 브라우저가 먼저 막는다)"""
    if request.path.startswith("/api/") and request.method in ("POST", "PATCH", "DELETE"):
        if request.path.endswith("/attachments") and request.headers.get("X-BB-Upload") == "1":
            return None
        if not request.is_json:
            return jsonify(error="잘못된 요청이에요."), 400


def user_json(row):
    return {"id": row["id"], "name": row["name"], "email": row["email"], "ai": ai_status(row),
            "admin": row["email"].lower() in owner_emails()}


# ---------- AI 사용 권한 (내 API 키를 아무나 쓰지 못하게) ----------
# - AI_OWNER_EMAILS: 언제나 AI를 쓸 수 있는 계정(나). 쉼표로 여러 개.
# - AI_INVITE_CODES: 초대 코드. "코드" 또는 "코드:최대인원". 코드를 .env에서 지우면 그 코드로 들어온 사람은 바로 AI를 못 쓴다.
# - AI_DAILY_LIMIT_PER_USER / AI_DAILY_LIMIT_INVITED: 초대받은 한 사람의 하루 한도 / 초대받은 사람 전체의 하루 한도.
# AI를 부를 때(답 1번, 마인드맵 정리 1번)마다 1회로 센다. 이미 받은 답·저장된 마인드맵을 다시 보는 건 세지 않는다.
# 데모 모드는 API를 쓰지 않으므로 기본으로 검사하지 않는다(AI_GATE_IN_DEMO=1이면 검사 — 테스트용).

def _env_list(name):
    return [x.strip() for x in os.environ.get(name, "").split(",") if x.strip()]


def owner_emails():
    return {e.lower() for e in _env_list("AI_OWNER_EMAILS")}


def invite_codes():
    """{코드: 최대 인원 또는 None}"""
    out = {}
    for item in _env_list("AI_INVITE_CODES"):
        code, _, cap = item.partition(":")
        code = code.strip()
        if code:
            out[code] = int(cap) if cap.strip().isdigit() else None
    return out


def _int_env(name, default):
    try:
        return max(0, int(os.environ.get(name, default)))
    except ValueError:
        return default


def ai_gate_on():
    return not DEMO or os.environ.get("AI_GATE_IN_DEMO") == "1"


def today():
    return datetime.now().strftime("%Y-%m-%d")


def ai_access(row):
    """'owner' | 'invited' | 'none'"""
    if not ai_gate_on():
        return "owner"
    if row["email"].lower() in owner_emails():
        return "owner"
    code = row["invite_code"] if "invite_code" in row.keys() else None
    if code and code in invite_codes():
        return "invited"
    return "none"


def ai_status(row):
    access = ai_access(row)
    out = {"access": access}
    if access == "invited":
        used = get_db().execute("SELECT COUNT(*) FROM ai_usage WHERE user_id = ? AND day = ?", (row["id"], today())).fetchone()[0]
        out.update(used_today=used, daily_limit=_int_env("AI_DAILY_LIMIT_PER_USER", 20))
    return out


def ai_check(db, kind):
    """AI를 부르기 직전에 호출. 쓸 수 있으면 사용 기록을 남기고 None, 아니면 (오류 응답, 상태 코드)."""
    if not ai_gate_on():
        return None
    user = db.execute("SELECT * FROM users WHERE id = ?", (current_user_id(),)).fetchone()
    access = ai_access(user)
    if access == "none":
        return jsonify(error="이 계정은 아직 AI 답을 쓸 수 없어요. 초대 코드가 있다면 설정에서 입력해 주세요.", code="no_ai_access"), 403
    if access == "invited":
        day = today()
        mine = db.execute("SELECT COUNT(*) FROM ai_usage WHERE user_id = ? AND day = ?", (user["id"], day)).fetchone()[0]
        if mine >= _int_env("AI_DAILY_LIMIT_PER_USER", 20):
            return jsonify(error="오늘 쓸 수 있는 AI 횟수를 다 썼어요. 내일 다시 이어서 생각해 봐요.", code="ai_daily_limit"), 429
        total = db.execute(
            """SELECT COUNT(*) FROM ai_usage a JOIN users u ON u.id = a.user_id
               WHERE a.day = ? AND u.invite_code IS NOT NULL""", (day,)).fetchone()[0]
        if total >= _int_env("AI_DAILY_LIMIT_INVITED", 100):
            return jsonify(error="오늘은 AI 사용량이 많아 잠시 쉬어 가요. 내일 다시 시도해 주세요.", code="ai_total_limit"), 429
    db.execute("INSERT INTO ai_usage (user_id, kind, day, created_at) VALUES (?, ?, ?, ?)", (user["id"], kind, today(), now()))
    db.commit()
    return None




def check_invite(db, code, uid=None):
    """초대 코드가 맞고 자리가 남았는지 확인만 한다. (맞는 코드, None) 또는 (None, 오류 문구).
    실패 기록은 바로 DB에 저장(commit)되므로, 계정을 만들기 '전에' 불러야 한다."""
    # 접속 주소(IP)별 실패 기록 — 가입을 새로 해 가며 코드를 맞혀 보는 것도 막는다
    key = client_ip()
    if rate_count("invite", key, 900) >= 5:
        return None, "초대 코드를 너무 여러 번 틀렸어요. 15분 뒤에 다시 시도해 주세요."
    codes = invite_codes()
    match = next((c for c in codes if secrets.compare_digest(c.encode(), code.encode())), None)
    if not match:
        rate_hit("invite", key)
        return None, "초대 코드가 맞지 않아요."
    cap = codes[match]
    if cap is not None:
        used = db.execute("SELECT COUNT(*) FROM users WHERE invite_code = ? AND id != ?", (match, uid or -1)).fetchone()[0]
        if used >= cap:
            return None, "이 초대 코드는 정원이 다 찼어요."
    rate_clear("invite", key)
    return match, None


def redeem_invite(db, uid, code):
    """이미 있는 계정에 초대 코드 적용. 성공하면 None, 실패하면 오류 문구."""
    match, err = check_invite(db, code, uid)
    if err:
        return err
    db.execute("UPDATE users SET invite_code = ? WHERE id = ?", (match, uid))
    return None


@app.post("/api/signup")
def signup():
    d = request.get_json(silent=True) or {}
    name = str(d.get("name", "")).strip()
    email = str(d.get("email", "")).strip().lower()
    password = str(d.get("password", ""))
    confirm = str(d.get("password_confirm", ""))
    gender = str(d.get("gender", ""))
    try:
        age = int(d.get("age"))
    except (TypeError, ValueError):
        age = None

    errors = {}
    if not name:
        errors["name"] = "이름을 입력해 주세요."
    elif len(name) > 30:
        errors["name"] = "이름은 30자 이내로 입력해 주세요."
    if not EMAIL_RE.match(email):
        errors["email"] = "이메일 형식이 올바르지 않아요."
    if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        errors["password"] = "비밀번호는 영문과 숫자를 섞어 8자 이상으로 만들어 주세요."
    if password != confirm:
        errors["password_confirm"] = "비밀번호가 서로 달라요."
    if age is None or not (MIN_AGE <= age <= 120):
        errors["age"] = f"만 {MIN_AGE}세 이상만 가입할 수 있어요." if age is not None and age < MIN_AGE else "나이를 숫자로 입력해 주세요."
    if gender not in GENDERS:
        errors["gender"] = "성별을 골라 주세요."
    if not d.get("agree"):
        errors["agree"] = "개인정보 수집·이용에 동의해야 가입할 수 있어요."
    invite = str(d.get("invite_code", "")).strip()  # 선택. 계정을 만들기 전에 check_invite로 확인

    db = get_db()
    if "email" not in errors and db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        errors["email"] = "이미 가입된 이메일이에요."
    if errors:
        return jsonify(error="입력한 내용을 확인해 주세요.", fields=errors), 400
    invite_match = None
    if invite:  # 계정을 만들기 전에 확인 (틀린 코드로 반쯤 만들어진 계정이 남지 않게)
        invite_match, err = check_invite(db, invite)
        if err:
            return jsonify(error="입력한 내용을 확인해 주세요.", fields={"invite_code": err}), 400

    first_user = db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    cur = db.execute(
        "INSERT INTO users (name, email, password_hash, age, gender, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (name, email, generate_password_hash(password), age, gender, now()),
    )
    uid = cur.lastrowid
    if invite_match:
        db.execute("UPDATE users SET invite_code = ? WHERE id = ?", (invite_match, uid))
    if first_user:
        # 회원 기능이 생기기 전에 혼자 쓰던 기록은 첫 번째 가입자의 것으로 옮긴다
        db.execute("UPDATE topics SET user_id = ? WHERE user_id IS NULL", (uid,))
    # 어떻게 쓰는 앱인지 바로 보이도록 예시 주제 1개를 넣어 준다 (마인드맵까지 미리 정리돼 있어 AI를 부르지 않음)
    insert_topic(db, uid, make_example())
    db.commit()
    session.clear()
    session.permanent = True
    session["uid"] = uid
    return jsonify(user=user_json(db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone())), 201


@app.post("/api/login")
def login():
    d = request.get_json(silent=True) or {}
    email = str(d.get("email", "")).strip().lower()
    password = str(d.get("password", ""))
    # 같은 계정은 같은 곳에서 5번, 한 곳에서는 여러 계정 합쳐 30번까지 (남이 내 계정을 일부러 잠그기 어렵게 접속 주소도 함께 본다)
    pair = f"{email}|{client_ip()}"
    if rate_count("login", pair, 300) >= 5 or rate_count("login_ip", client_ip(), 300) >= 30:
        return jsonify(error="로그인 시도가 너무 많아요. 5분 뒤에 다시 시도해 주세요."), 429
    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        rate_hit("login", pair)
        rate_hit("login_ip", client_ip())
        # 어떤 쪽이 틀렸는지 알려 주지 않는다 (가입 여부를 숨기기 위해)
        return jsonify(error="이메일 또는 비밀번호가 맞지 않아요."), 401
    rate_clear("login", pair)
    session.clear()
    session.permanent = True
    session["uid"] = user["id"]
    return jsonify(user=user_json(user))


# ---------- 비밀번호 찾기 (재설정 링크) ----------
RESET_MINUTES = 30


def password_error(password, confirm):
    if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "password", "비밀번호는 영문과 숫자를 섞어 8자 이상으로 만들어 주세요."
    if password != confirm:
        return "password_confirm", "비밀번호가 서로 달라요."
    return None


def send_reset_mail(to, name, link):
    """SMTP 설정(.env)이 있으면 메일로 보내고, 없으면 서버 콘솔에 링크를 남긴다(로컬 개발용)."""
    host = os.environ.get("SMTP_HOST")
    if not host:
        print(f"[비밀번호 재설정] SMTP 설정이 없어 메일 대신 여기에 남겨요: {to} → {link}", flush=True)
        return False
    msg = EmailMessage()
    msg["Subject"] = "[비포블랭크] 비밀번호 재설정 링크"
    msg["From"] = os.environ.get("MAIL_FROM", os.environ.get("SMTP_USER", ""))
    msg["To"] = to
    msg.set_content(
        f"{name}님, 비밀번호 재설정을 요청하셨어요.\n\n"
        f"아래 링크를 {RESET_MINUTES}분 안에 열어 새 비밀번호를 정해 주세요.\n{link}\n\n"
        "직접 요청하지 않았다면 이 메일은 무시하셔도 돼요. 비밀번호는 바뀌지 않아요."
    )
    with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", 587)), timeout=10) as smtp:
        smtp.starttls()
        if os.environ.get("SMTP_USER"):
            smtp.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
        smtp.send_message(msg)
    return True


@app.post("/api/password/forgot")
def forgot_password():
    email = str((request.json or {}).get("email", "")).strip().lower()
    generic = "가입된 이메일이라면 비밀번호 재설정 링크를 보냈어요. 메일함을 확인해 주세요."
    # 짧은 시간에 메일을 여러 번 보내지 못하게 (이메일별 3번, 한 곳에서 10번)
    if rate_count("reset", email, 900) >= 3 or rate_count("reset_ip", client_ip(), 900) >= 10:
        return jsonify(error="요청이 너무 많아요. 15분 뒤에 다시 시도해 주세요."), 429
    rate_hit("reset", email)
    rate_hit("reset_ip", client_ip())
    # 메일 서버(SMTP)가 설정되지 않았으면 메일이 갈 수 없다 → "보냈어요"라고 하지 않고 사실대로 안내
    # (가입 여부와 상관없이 같은 답이라 어떤 이메일이 가입됐는지는 여전히 알 수 없다)
    if not os.environ.get("SMTP_HOST") and not (DEMO or os.environ.get("SHOW_RESET_LINK") == "1"):
        return jsonify(message="지금은 비밀번호 재설정 메일을 보낼 수 없어요. 서비스 운영자에게 문의해 주세요.", mail_off=True)
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    out = {"message": generic}
    if user:
        token = secrets.token_urlsafe(32)
        expires = (datetime.now() + timedelta(minutes=RESET_MINUTES)).isoformat(timespec="seconds")
        # 이전에 보낸 링크는 무효로 하고, DB에는 토큰 원문이 아니라 해시만 저장
        db.execute("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL", (now(), user["id"]))
        db.execute(
            "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
            (user["id"], hashlib.sha256(token.encode()).hexdigest(), expires),
        )
        db.commit()
        link = f"{request.host_url}#/reset?token={token}"
        try:
            sent = send_reset_mail(email, user["name"], link)
        except (OSError, smtplib.SMTPException) as e:
            print(f"[비밀번호 재설정] 메일 보내기 실패: {e}", flush=True)
            sent = False
        if not sent and (DEMO or os.environ.get("SHOW_RESET_LINK") == "1"):
            out["dev_link"] = link  # 로컬 체험용: 메일 서버가 없을 때 화면에서 바로 열 수 있게
    # 가입 여부와 상관없이 같은 답을 준다 (가입된 이메일인지 알아낼 수 없게)
    return jsonify(out)


@app.post("/api/password/reset")
def reset_password():
    d = request.get_json(silent=True) or {}
    token = str(d.get("token", ""))
    db = get_db()
    row = db.execute(
        "SELECT * FROM password_resets WHERE token_hash = ?", (hashlib.sha256(token.encode()).hexdigest(),)
    ).fetchone()
    if not row or row["used_at"] or row["expires_at"] < now():
        return jsonify(error="링크가 만료됐거나 이미 사용됐어요. 비밀번호 찾기를 다시 요청해 주세요."), 400
    err = password_error(str(d.get("password", "")), str(d.get("password_confirm", "")))
    if err:
        return jsonify(error="입력한 내용을 확인해 주세요.", fields={err[0]: err[1]}), 400
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (generate_password_hash(d["password"]), row["user_id"]))
    db.execute("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL", (now(), row["user_id"]))
    db.commit()
    session.clear()
    return jsonify(ok=True)


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.delete("/api/me")
@login_required
def delete_account():
    """회원 탈퇴: 비밀번호를 한 번 더 확인하고, 계정과 모든 주제·대화·메모를 지운다."""
    d = request.get_json(silent=True) or {}
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (current_user_id(),)).fetchone()
    if not user or not check_password_hash(user["password_hash"], str(d.get("password", ""))):
        return jsonify(error="비밀번호가 맞지 않아요."), 401
    remove_files(db.execute("SELECT stored_name FROM attachments WHERE user_id = ?", (user["id"],)).fetchall())
    db.execute("DELETE FROM topics WHERE user_id = ?", (user["id"],))  # 대화는 주제와 함께 지워진다
    db.execute("DELETE FROM users WHERE id = ?", (user["id"],))
    db.commit()
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    uid = current_user_id()
    user = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone() if uid else None
    if uid and not user:
        session.clear()
    return jsonify(user=user_json(user) if user else None)


@app.post("/api/me/invite")
@login_required
def use_invite():
    code = str((request.json or {}).get("code", "")).strip()
    if not code:
        return jsonify(error="초대 코드를 입력해 주세요."), 400
    db = get_db()
    err = redeem_invite(db, current_user_id(), code)
    if err:
        return jsonify(error=err), 429 if "15분" in err else 400
    db.commit()
    return jsonify(user=user_json(db.execute("SELECT * FROM users WHERE id = ?", (current_user_id(),)).fetchone()))


def own_topic(db, topic_id):
    """로그인한 사람의 주제만 돌려준다. 남의 주제는 '없는 것'으로 취급한다."""
    return db.execute("SELECT * FROM topics WHERE id = ? AND user_id = ?", (topic_id, current_user_id())).fetchone()


def own_turn(db, turn_id):
    return db.execute(
        "SELECT u.* FROM turns u JOIN topics t ON t.id = u.topic_id WHERE u.id = ? AND t.user_id = ?",
        (turn_id, current_user_id()),
    ).fetchone()


# ---------- 폴더 (주제를 묶는 곳. 없어도 쓸 수 있다) ----------

def own_folder(db, folder_id):
    return db.execute("SELECT * FROM folders WHERE id = ? AND user_id = ?", (folder_id, current_user_id())).fetchone()


def folder_name_error(db, name, exclude_id=None):
    if not name:
        return "폴더 이름을 입력해 주세요."
    if len(name) > 30:
        return "폴더 이름은 30자 이내로 입력해 주세요."
    row = db.execute("SELECT id FROM folders WHERE user_id = ? AND name = ?", (current_user_id(), name)).fetchone()
    if row and row["id"] != exclude_id:
        return "이미 있는 폴더 이름이에요."
    return None


@app.get("/api/folders")
@login_required
def list_folders():
    rows = get_db().execute(
        """SELECT f.id, f.name, COUNT(t.id) AS topic_count
           FROM folders f LEFT JOIN topics t ON t.folder_id = f.id
           WHERE f.user_id = ? GROUP BY f.id ORDER BY f.name""",
        (current_user_id(),),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/folders")
@login_required
def create_folder():
    db = get_db()
    name = str((request.json or {}).get("name", "")).strip()
    err = folder_name_error(db, name)
    if err:
        return jsonify(error=err), 400
    cur = db.execute("INSERT INTO folders (user_id, name, created_at) VALUES (?, ?, ?)", (current_user_id(), name, now()))
    db.commit()
    return jsonify(id=cur.lastrowid, name=name), 201


@app.patch("/api/folders/<int:folder_id>")
@login_required
def rename_folder(folder_id):
    db = get_db()
    if not own_folder(db, folder_id):
        return jsonify(error="폴더를 찾을 수 없어요."), 404
    name = str((request.json or {}).get("name", "")).strip()
    err = folder_name_error(db, name, exclude_id=folder_id)
    if err:
        return jsonify(error=err), 400
    db.execute("UPDATE folders SET name = ? WHERE id = ?", (name, folder_id))
    db.commit()
    return jsonify(ok=True)


@app.delete("/api/folders/<int:folder_id>")
@login_required
def delete_folder(folder_id):
    """폴더만 지운다. 안에 있던 주제는 지우지 않고 '폴더 없음'으로 옮긴다."""
    db = get_db()
    if not own_folder(db, folder_id):
        return jsonify(error="폴더를 찾을 수 없어요."), 404
    db.execute("UPDATE topics SET folder_id = NULL WHERE folder_id = ? AND user_id = ?", (folder_id, current_user_id()))
    db.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
    db.commit()
    return jsonify(ok=True)


# ---------- 첨부파일 ----------

def remove_files(rows):
    for r in rows:
        try:
            (UPLOAD_DIR / r["stored_name"]).unlink(missing_ok=True)
        except OSError:
            pass


def attachments_of(db, turn_ids):
    if not turn_ids:
        return {}
    q = ",".join("?" * len(turn_ids))
    out = {}
    for r in db.execute(f"SELECT id, turn_id, filename, mime, kind, size FROM attachments WHERE turn_id IN ({q}) ORDER BY id", list(turn_ids)):
        out.setdefault(r["turn_id"], []).append({k: r[k] for k in ("id", "filename", "mime", "kind", "size")})
    return out


@app.post("/api/turns/<int:turn_id>/attachments")
@login_required
def upload_attachments(turn_id):
    db = get_db()
    turn = own_turn(db, turn_id)
    if not turn:
        return jsonify(error="대화를 찾을 수 없어요."), 404
    if turn["ai_answer"]:
        return jsonify(error="AI 답을 받은 뒤에는 자료를 더 붙일 수 없어요."), 400
    files = request.files.getlist("files")
    have = db.execute("SELECT COUNT(*) FROM attachments WHERE turn_id = ?", (turn_id,)).fetchone()[0]
    if not files:
        return jsonify(error="파일을 골라 주세요."), 400
    if have + len(files) > MAX_FILES_PER_TURN:
        return jsonify(error=f"질문 하나에 자료는 {MAX_FILES_PER_TURN}개까지 붙일 수 있어요."), 400
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    saved = []
    for f in files:
        name = Path(f.filename or "").name[:120] or "file"
        ext = Path(name).suffix.lower()
        if ext not in ALLOWED_FILES:
            return jsonify(error=f"'{name}'은(는) 붙일 수 없는 형식이에요. (txt, md, csv, pdf, png, jpg, webp)"), 400
        data = f.read(MAX_FILE_MB * 1024 * 1024 + 1)
        if len(data) > MAX_FILE_MB * 1024 * 1024:
            return jsonify(error=f"'{name}'이(가) {MAX_FILE_MB}MB보다 커요."), 400
        if not data:
            return jsonify(error=f"'{name}'이(가) 비어 있어요."), 400
        mime, kind = ALLOWED_FILES[ext]
        stored = f"{uuid.uuid4().hex}{ext}"  # 저장 이름은 무작위로 (원래 이름은 DB에만)
        (UPLOAD_DIR / stored).write_bytes(data)
        cur = db.execute(
            "INSERT INTO attachments (turn_id, user_id, filename, mime, kind, size, stored_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (turn_id, current_user_id(), name, mime, kind, len(data), stored, now()),
        )
        saved.append({"id": cur.lastrowid, "filename": name, "mime": mime, "kind": kind, "size": len(data)})
    db.commit()
    return jsonify(saved), 201


@app.get("/api/attachments/<int:att_id>")
@login_required
def download_attachment(att_id):
    row = get_db().execute("SELECT * FROM attachments WHERE id = ? AND user_id = ?", (att_id, current_user_id())).fetchone()
    if not row:
        return jsonify(error="파일을 찾을 수 없어요."), 404
    resp = send_file(UPLOAD_DIR / row["stored_name"], mimetype=row["mime"], as_attachment=True, download_name=row["filename"])
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


def read_text_file(path, limit=30000):
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp949"):  # 한국어 CSV는 cp949인 경우가 많다
        try:
            return raw.decode(enc)[:limit]
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")[:limit]


def attachment_blocks(db, turn_id):
    """Claude에게 보낼 첨부 자료 블록: 텍스트는 글로, PDF는 문서로, 그림은 이미지로."""
    blocks = []
    for r in db.execute("SELECT * FROM attachments WHERE turn_id = ? ORDER BY id", (turn_id,)):
        path = UPLOAD_DIR / r["stored_name"]
        if not path.exists():
            continue
        label = f'<attachment id="{r["id"]}" name="{r["filename"]}">'
        if r["kind"] == "text":
            blocks.append({"type": "text", "text": f"{label}\n{read_text_file(path)}\n</attachment>"})
        else:
            data = base64.standard_b64encode(path.read_bytes()).decode()
            blocks.append({"type": "text", "text": label})
            if r["kind"] == "pdf":
                blocks.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}})
            else:
                blocks.append({"type": "image", "source": {"type": "base64", "media_type": r["mime"], "data": data}})
            blocks.append({"type": "text", "text": "</attachment>"})
    return blocks


# ---------- 주제 ----------

TOPIC_SELECT = """
    SELECT t.id, t.name, t.folder_id, t.is_starred, t.status, t.created_at, t.updated_at, t.is_sample, t.conclusion, t.counter,
           COUNT(u.id) AS turn_count,
           (SELECT COUNT(*) FROM side_notes n WHERE n.topic_id = t.id AND n.done = 0) AS open_notes,
           (SELECT question FROM turns WHERE topic_id = t.id ORDER BY id DESC LIMIT 1) AS last_question
    FROM topics t LEFT JOIN turns u ON u.topic_id = t.id
"""


@app.get("/api/topics")
@login_required
def list_topics():
    q = request.args.get("q", "").strip()
    sql, params = TOPIC_SELECT + " WHERE t.user_id = ?", [current_user_id()]
    if q:
        like = f"%{q}%"
        sql += """ AND (t.name LIKE ? OR t.id IN (
                     SELECT topic_id FROM turns
                     WHERE question LIKE ? OR my_thought LIKE ? OR ai_answer LIKE ? OR reflection LIKE ?)
                   OR t.id IN (SELECT topic_id FROM side_notes WHERE text LIKE ? OR note LIKE ?))"""
        params += [like] * 7
    # 중요 표시한 주제를 먼저, 그다음 최근에 대화한 순서
    sql += " GROUP BY t.id ORDER BY t.is_starred DESC, t.updated_at DESC"
    return jsonify([dict(r) for r in get_db().execute(sql, params).fetchall()])


@app.post("/api/topics")
@login_required
def create_topic():
    name = (request.json or {}).get("name", "").strip()
    if not name:
        return jsonify(error="주제 이름을 입력해 주세요."), 400
    db = get_db()
    if db.execute("SELECT 1 FROM topics WHERE name = ? AND user_id = ?", (name, current_user_id())).fetchone():
        return jsonify(error="이미 있는 주제 이름이에요."), 409
    folder_id = (request.json or {}).get("folder_id")
    if folder_id is not None and not own_folder(db, folder_id):
        return jsonify(error="폴더를 찾을 수 없어요."), 404
    ts = now()
    cur = db.execute(
        "INSERT INTO topics (user_id, folder_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (current_user_id(), folder_id, name, ts, ts),
    )
    db.commit()
    return jsonify(id=cur.lastrowid), 201


@app.get("/api/topics/<int:topic_id>")
@login_required
def get_topic(topic_id):
    db = get_db()
    topic = db.execute(TOPIC_SELECT + " WHERE t.id = ? AND t.user_id = ? GROUP BY t.id", (topic_id, current_user_id())).fetchone()
    if not topic:
        return jsonify(error="주제를 찾을 수 없어요."), 404
    turns = [dict(t) for t in db.execute(
        "SELECT id, stage_id, question, my_thought, ai_answer, reflection, created_at FROM turns WHERE topic_id = ? ORDER BY id",
        (topic_id,),
    )]
    atts = attachments_of(db, [t["id"] for t in turns])
    for t in turns:
        t["attachments"] = atts.get(t["id"], [])
    notes = [dict(r) for r in db.execute(
        "SELECT id, turn_id, kind, text, note, priority, done, created_at FROM side_notes WHERE topic_id = ? ORDER BY id", (topic_id,))]
    stages = [dict(r) for r in db.execute(
        "SELECT id, title, conclusion, created_at FROM stages WHERE topic_id = ? ORDER BY id", (topic_id,))]
    return jsonify(topic=dict(topic), turns=turns, notes=notes, stages=stages)


@app.patch("/api/topics/<int:topic_id>")
@login_required
def update_topic(topic_id):
    data = request.json or {}
    db = get_db()
    if not own_topic(db, topic_id):
        return jsonify(error="주제를 찾을 수 없어요."), 404
    if "name" in data:
        name = str(data["name"]).strip()
        if not name:
            return jsonify(error="주제 이름을 입력해 주세요."), 400
        try:
            db.execute("UPDATE topics SET name = ? WHERE id = ?", (name, topic_id))
        except sqlite3.IntegrityError:
            return jsonify(error="이미 있는 주제 이름이에요."), 409
    if "is_starred" in data:
        db.execute("UPDATE topics SET is_starred = ? WHERE id = ?", (1 if data["is_starred"] else 0, topic_id))
    if "folder_id" in data:
        fid = data["folder_id"]
        if fid is not None and not own_folder(db, fid):
            return jsonify(error="폴더를 찾을 수 없어요."), 404
        db.execute("UPDATE topics SET folder_id = ? WHERE id = ?", (fid, topic_id))
    if data.get("status") in ("in_progress", "done"):
        db.execute("UPDATE topics SET status = ? WHERE id = ?", (data["status"], topic_id))
    for key in ("conclusion", "counter"):  # 피라미드: 결론 한 줄, 반대로 생각하면?
        if key in data:
            db.execute(f"UPDATE topics SET {key} = ? WHERE id = ?", (str(data[key] or "").strip()[:500], topic_id))
    db.commit()
    return jsonify(ok=True)


@app.delete("/api/topics/<int:topic_id>")
@login_required
def delete_topic(topic_id):
    db = get_db()
    remove_files(db.execute(
        "SELECT a.stored_name FROM attachments a JOIN turns u ON u.id = a.turn_id JOIN topics t ON t.id = u.topic_id WHERE t.id = ? AND t.user_id = ?",
        (topic_id, current_user_id()),
    ).fetchall())
    db.execute("DELETE FROM topics WHERE id = ? AND user_id = ?", (topic_id, current_user_id()))
    db.commit()
    return jsonify(ok=True)


# ---------- 메모함 ----------
# AI 답에서 지금 다루지 않을 곁가지를 담아 두는 곳:
# 확인할 것(check) / 할 일(todo) / 마음에 드는 것(like) + 우선순위 + 완료
NOTE_KINDS = ("check", "todo", "like")
NOTE_LABELS = {"check": "확인할 것", "todo": "할 일", "like": "마음에 드는 것"}
PRIORITIES = ("high", "mid", "low")


def note_fields(d, partial=False):
    out = {}
    if "kind" in d or not partial:
        if d.get("kind") not in NOTE_KINDS:
            raise ValueError("메모 종류를 골라 주세요.")
        out["kind"] = d["kind"]
    if "text" in d or not partial:
        text = str(d.get("text", "")).strip()
        if not text:
            raise ValueError("메모할 내용을 적어 주세요.")
        out["text"] = text[:500]
    if "note" in d:
        out["note"] = str(d.get("note") or "").strip()[:500]
    if "priority" in d:
        if d["priority"] not in PRIORITIES:
            raise ValueError("우선순위가 올바르지 않아요.")
        out["priority"] = d["priority"]
    if "done" in d:
        out["done"] = 1 if d["done"] else 0
    return out


def own_note(db, note_id):
    return db.execute("SELECT * FROM side_notes WHERE id = ? AND user_id = ?", (note_id, current_user_id())).fetchone()


@app.post("/api/topics/<int:topic_id>/notes")
@login_required
def create_note(topic_id):
    db = get_db()
    if not own_topic(db, topic_id):
        return jsonify(error="주제를 찾을 수 없어요."), 404
    d = request.json or {}
    try:
        f = note_fields(d)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    turn_id = d.get("turn_id")
    if turn_id is not None and not db.execute("SELECT 1 FROM turns WHERE id = ? AND topic_id = ?", (turn_id, topic_id)).fetchone():
        turn_id = None
    ts = now()
    cur = db.execute(
        "INSERT INTO side_notes (topic_id, turn_id, user_id, kind, text, note, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (topic_id, turn_id, current_user_id(), f["kind"], f["text"], f.get("note", ""), f.get("priority", "mid"), ts, ts),
    )
    db.commit()
    return jsonify(dict(db.execute("SELECT id, turn_id, kind, text, note, priority, done, created_at FROM side_notes WHERE id = ?", (cur.lastrowid,)).fetchone())), 201


@app.patch("/api/notes/<int:note_id>")
@login_required
def update_note(note_id):
    db = get_db()
    if not own_note(db, note_id):
        return jsonify(error="메모를 찾을 수 없어요."), 404
    try:
        f = note_fields(request.json or {}, partial=True)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    if f:
        sets = ", ".join(f"{k} = ?" for k in f)
        db.execute(f"UPDATE side_notes SET {sets}, updated_at = ? WHERE id = ?", (*f.values(), now(), note_id))
        db.commit()
    return jsonify(dict(db.execute("SELECT id, turn_id, kind, text, note, priority, done, created_at FROM side_notes WHERE id = ?", (note_id,)).fetchone()))


@app.delete("/api/notes/<int:note_id>")
@login_required
def delete_note(note_id):
    db = get_db()
    if not own_note(db, note_id):
        return jsonify(error="메모를 찾을 수 없어요."), 404
    db.execute("DELETE FROM side_notes WHERE id = ?", (note_id,))
    db.commit()
    return jsonify(ok=True)


# ---------- 대화 턴 ----------

@app.post("/api/topics/<int:topic_id>/turns")
@login_required
def create_turn(topic_id):
    data = request.json or {}
    question = data.get("question", "").strip()
    thought = data.get("my_thought", "").strip()
    if not question:
        return jsonify(error="질문을 입력해 주세요."), 400
    db = get_db()
    if not own_topic(db, topic_id):
        return jsonify(error="주제를 찾을 수 없어요."), 404
    # 한 주제는 단계 박스들로 나뉜다. stage_id가 있으면 그 단계 안에서 이어 묻는 꼬리 질문,
    # 없으면 새 단계를 연다. 단계의 첫 질문은 내 생각을 꼭 먼저 적고,
    # 같은 단계에서 AI 답을 받은 뒤의 꼬리 질문만 내 생각을 건너뛸 수 있다
    ts = now()
    stage_id = data.get("stage_id")
    if stage_id:
        stage = db.execute("SELECT id FROM stages WHERE id = ? AND topic_id = ?", (stage_id, topic_id)).fetchone()
        if not stage:
            return jsonify(error="단계를 찾을 수 없어요."), 404
        answered = db.execute("SELECT 1 FROM turns WHERE stage_id = ? AND ai_answer IS NOT NULL LIMIT 1", (stage_id,)).fetchone()
        if len(thought) < MIN_THOUGHT_LEN and not answered:
            return jsonify(error="내 생각을 먼저 적어야 AI 답을 볼 수 있어요."), 400
    else:
        if len(thought) < MIN_THOUGHT_LEN:
            return jsonify(error="새 단계의 첫 질문은 내 생각을 먼저 적어야 해요."), 400
        title = (str(data.get("stage_title") or "").strip() or question)[:80]
        stage_id = db.execute(
            "INSERT INTO stages (topic_id, title, conclusion, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
            (topic_id, title, ts, ts)).lastrowid
    cur = db.execute(
        "INSERT INTO turns (topic_id, stage_id, question, my_thought, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (topic_id, stage_id, question, thought, ts, ts),
    )
    db.execute("UPDATE stages SET updated_at = ? WHERE id = ?", (ts, stage_id))
    # 새 질문을 이어 가면 주제는 다시 '진행중'
    db.execute("UPDATE topics SET status = 'in_progress', updated_at = ? WHERE id = ?", (ts, topic_id))
    db.commit()
    return jsonify(id=cur.lastrowid, stage_id=stage_id), 201


@app.patch("/api/turns/<int:turn_id>")
@login_required
def update_turn(turn_id):
    """생각 메모만 고칠 수 있다. 질문과 내 생각은 AI 답을 보기 전 그대로 남긴다."""
    data = request.json or {}
    db = get_db()
    if not own_turn(db, turn_id):
        return jsonify(error="대화를 찾을 수 없어요."), 404
    if "reflection" in data:
        db.execute(
            "UPDATE turns SET reflection = ?, updated_at = ? WHERE id = ?",
            (str(data["reflection"]).strip(), now(), turn_id),
        )
        db.commit()
    return jsonify(ok=True)


@app.delete("/api/turns/<int:turn_id>")
@login_required
def delete_turn(turn_id):
    db = get_db()
    turn = own_turn(db, turn_id)
    if not turn:
        return jsonify(error="대화를 찾을 수 없어요."), 404
    remove_files(db.execute("SELECT stored_name FROM attachments WHERE turn_id = ?", (turn_id,)).fetchall())
    db.execute("DELETE FROM turns WHERE id = ?", (turn_id,))
    # 질문이 하나도 남지 않은 단계는 함께 지운다
    db.execute("DELETE FROM stages WHERE id = ? AND NOT EXISTS (SELECT 1 FROM turns WHERE stage_id = ?)", (turn["stage_id"], turn["stage_id"]))
    db.commit()
    return jsonify(ok=True)


@app.patch("/api/stages/<int:stage_id>")
@login_required
def update_stage(stage_id):
    """단계 이름과 '이 단계 결론'(다음 단계로 넘길 내용)을 고친다."""
    data = request.json or {}
    db = get_db()
    stage = db.execute("SELECT s.* FROM stages s JOIN topics t ON t.id = s.topic_id WHERE s.id = ? AND t.user_id = ?",
                       (stage_id, current_user_id())).fetchone()
    if not stage:
        return jsonify(error="단계를 찾을 수 없어요."), 404
    title = str(data.get("title", stage["title"])).strip()[:80]
    if not title:
        return jsonify(error="단계 이름을 적어 주세요."), 400
    conclusion = str(data.get("conclusion", stage["conclusion"])).strip()[:500]
    db.execute("UPDATE stages SET title = ?, conclusion = ?, updated_at = ? WHERE id = ?", (title, conclusion, now(), stage_id))
    db.commit()
    return jsonify(id=stage_id, title=title, conclusion=conclusion)


# ---------- AI 답변 (스트리밍) ----------

def stage_preface(db, turn):
    """앞 단계에서 '내가 정한 것'만 짧게 알려 준다 (단계 이름 + 결론). 앞 단계의 대화 자체는 보내지 않아
    단계끼리 섞이지 않고, 깊이 파고들어도 산으로 가지 않게 한다. 결론이 비어 있으면 그 단계의 생각 메모를 쓴다."""
    topic = db.execute("SELECT name FROM topics WHERE id = ?", (turn["topic_id"],)).fetchone()
    lines = []
    for st in db.execute("SELECT id, title, conclusion FROM stages WHERE topic_id = ? AND id < ? ORDER BY id",
                         (turn["topic_id"], turn["stage_id"] or 0)):
        decided = st["conclusion"].strip() or " / ".join(
            r[0].strip() for r in db.execute(
                "SELECT reflection FROM turns WHERE stage_id = ? AND trim(coalesce(reflection, '')) != '' ORDER BY id", (st["id"],)))
        lines.append(f"- {st['title']}" + (f": {decided}" if decided else ""))
    head = f"[주제: {topic['name']}]"
    if lines:
        head += "\n이 주제는 단계별로 진행 중이에요. 앞 단계에서 사용자가 정한 것:\n" + "\n".join(lines) + \
                "\n지금 단계의 질문에만 집중해서 답해 주세요."
    return head


def history_messages(db, turn):
    """같은 단계 안의 이전 질문·답만 대화 기록으로 넣고, 앞 단계는 '정한 것'만 머리말로 붙인다. 내 생각은 넣지 않는다."""
    pairs = db.execute(
        "SELECT question, ai_answer FROM turns WHERE stage_id = ? AND id < ? AND ai_answer IS NOT NULL ORDER BY id",
        (turn["stage_id"], turn["id"]),
    ).fetchall() if turn["stage_id"] else []
    preface = stage_preface(db, turn) + "\n\n"
    msgs = []
    for i, t in enumerate(pairs):
        msgs.append({"role": "user", "content": (preface if i == 0 else "") + t["question"]})
        msgs.append({"role": "assistant", "content": t["ai_answer"]})
    question = ("" if pairs else preface) + turn["question"]
    blocks = attachment_blocks(db, turn["id"])
    if blocks:
        msgs.append({"role": "user", "content": blocks + [{"type": "text", "text": "위 첨부 자료를 참고해서 답해 주세요.\n\n" + question}]})
    else:
        msgs.append({"role": "user", "content": question})
    return msgs


def demo_answer(question, files=()):
    text = (
        (f"(첨부 자료 {', '.join(files)}를 함께 읽었어요.)\n\n" if files else "") +
        f"## 핵심\n'{question}'에 대해서는 세 가지를 함께 보면 좋아요.\n\n"
        "- **목표를 먼저 분명히** 하기: 무엇을 얻고 싶은지에 따라 방법이 달라져요.\n"
        "- **작게 시작해서 반복**하기: 한 번에 완벽하게 하기보다 짧게 시도하고 고쳐 가요.\n"
        "- **근거를 기록**하기: 왜 그렇게 판단했는지 남겨 두면 나중에 비교하기 쉬워요.\n\n"
        "(데모 모드 답변입니다. 실제 AI 답은 API 키를 넣으면 나와요.)"
    )
    for piece in re.findall(r".{1,6}", text, flags=re.S):
        time.sleep(0.01)
        yield piece


@app.post("/api/turns/<int:turn_id>/answer")
@login_required
def answer(turn_id):
    db = get_db()
    turn = own_turn(db, turn_id)
    if not turn:
        return jsonify(error="대화를 찾을 수 없어요."), 404
    if turn["ai_answer"]:
        return Response(turn["ai_answer"], mimetype="text/plain; charset=utf-8")
    if not DEMO and not os.environ.get("ANTHROPIC_API_KEY"):
        return jsonify(error="ANTHROPIC_API_KEY가 설정되지 않았어요. think-first/.env 파일을 확인해 주세요."), 500
    blocked = ai_check(db, "answer")
    if blocked:
        return blocked

    messages = history_messages(db, turn)
    topic_id = turn["topic_id"]
    # 스트리밍은 요청이 끝난 뒤에도 이어지므로, DB에서 필요한 값은 미리 읽어 둔다
    att_names = [r["filename"] for r in db.execute("SELECT filename FROM attachments WHERE turn_id = ?", (turn_id,))]

    def claude_stream():
        client = anthropic.Anthropic()
        msgs = list(messages)
        # 링크 읽기·검색은 서버 쪽 도구라, 길어지면 중간에 멈춤(pause_turn)으로 돌아올 수 있다 → 이어서 최대 3번
        for _ in range(3):
            with client.beta.messages.stream(
                model=MODEL,
                max_tokens=16000,
                system=SYSTEM_PROMPT,
                output_config={"effort": "low"},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                tools=WEB_TOOLS,
                messages=msgs,
            ) as stream:
                for text in stream.text_stream:
                    yield text
                final = stream.get_final_message()
            if final.stop_reason != "pause_turn":
                break
            msgs = msgs + [{"role": "assistant", "content": final.content}]
        if final.stop_reason == "refusal":
            yield "\n\n(AI가 이 질문에는 답하지 않았어요.)"

    def generate():
        # AI에게는 질문(과 이전 질문·답)만 보낸다. 내 생각은 보내지 않아서
        # AI 답이 내 생각에 맞춰지지 않고, 둘을 독립적으로 비교할 수 있다.
        parts = []
        source = demo_answer(turn["question"], att_names) if DEMO else claude_stream()
        try:
            for text in source:
                parts.append(text)
                yield text
        except anthropic.AuthenticationError:
            yield "\n\n[오류] API 키가 올바르지 않아요."
            return
        except anthropic.RateLimitError:
            yield "\n\n[오류] 요청이 너무 많아요. 잠시 후 다시 시도해 주세요."
            return
        except anthropic.APIStatusError as e:
            yield f"\n\n[오류] API 응답 오류 ({e.status_code})"
            return
        except anthropic.APIConnectionError:
            yield "\n\n[오류] AI 서버에 연결하지 못했어요."
            return

        full = "".join(parts).strip()
        if full:
            with sqlite3.connect(DB_PATH) as conn:
                ts = now()
                conn.execute("UPDATE turns SET ai_answer = ?, updated_at = ? WHERE id = ?", (full, ts, turn_id))
                conn.execute("UPDATE topics SET updated_at = ? WHERE id = ?", (ts, topic_id))

    return Response(generate(), mimetype="text/plain; charset=utf-8",
                    headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})


# ---------- 수렴형 마인드맵 ----------
# 왼쪽: 나만의 관점 / 가운데: 내 생각과 AI 답이 겹치는 생각 / 오른쪽: AI만의 관점
# 모든 요점은 어느 대화 턴에서 나왔는지 turn_ids로 가리킨다.

POINT = {
    "type": "object",
    "properties": {
        "label": {"type": "string"},
        "detail": {"type": "string"},
        "turn_ids": {"type": "array", "items": {"type": "integer"}},
    },
    "required": ["label", "detail", "turn_ids"],
    "additionalProperties": False,
}
SHARED_POINT = {
    "type": "object",
    "properties": {
        "label": {"type": "string"},
        "detail": {"type": "string"},
        "kind": {"type": "string", "enum": ["same", "similar"]},
        "turn_ids": {"type": "array", "items": {"type": "integer"}},
    },
    "required": ["label", "detail", "kind", "turn_ids"],
    "additionalProperties": False,
}
UNCERTAIN_POINT = {
    "type": "object",
    "properties": {
        "mine_label": {"type": "string"},
        "ai_label": {"type": "string"},
        "shared_label": {"type": "string"},
        "question": {"type": "string"},
        "turn_ids": {"type": "array", "items": {"type": "integer"}},
    },
    "required": ["mine_label", "ai_label", "shared_label", "question", "turn_ids"],
    "additionalProperties": False,
}
MATERIAL = {
    "type": "object",
    "properties": {
        "attachment_id": {"type": "integer"},
        "summary": {"type": "string"},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "relation": {"type": "string"},
    },
    "required": ["attachment_id", "summary", "key_points", "relation"],
    "additionalProperties": False,
}
MINDMAP_SCHEMA = {
    "type": "object",
    "properties": {
        "materials": {"type": "array", "items": MATERIAL},
        "mine_only": {"type": "array", "items": POINT},
        "shared": {"type": "array", "items": SHARED_POINT},
        "ai_only": {"type": "array", "items": POINT},
        "uncertain": {"type": "array", "items": UNCERTAIN_POINT},
    },
    "required": ["materials", "mine_only", "shared", "ai_only", "uncertain"],
    "additionalProperties": False,
}

MINDMAP_PROMPT = """아래는 '{topic}' 주제로 나눈 대화입니다. 각 턴마다 사용자가 AI 답을 보기 전에 먼저 적은 생각(my_thought)과 AI의 답(ai_answer)이 있습니다.
my_thought가 비어 있는 턴은 사용자가 같은 단계에서 생각 없이 이어 물은 꼬리 질문이므로, 그 턴에서는 사용자 쪽 요점을 만들지 마세요.
주제 전체에 걸쳐 두 쪽의 핵심 요점을 뽑아 세 묶음으로 나눠 주세요.

- shared: 사용자 생각과 AI 답에 공통으로 들어 있는 요점. 사실상 같은 주장이면 kind "same", 방향은 같지만 강조점이나 범위가 다르면 "similar". 억지로 만들지 말고, 없으면 빈 배열.
- mine_only: 사용자 생각에만 있는 요점 (AI 답에는 없는 나만의 관점).
- ai_only: AI 답에만 있는 요점 (사용자가 생각하지 못한 새로운 관점).
- 묶음마다 0~6개, 글에 실제로 있는 내용만, 중요한 순서대로. 같은 요점을 두 묶음에 중복해서 넣지 마세요.
- label: 마인드맵 노드에 들어갈 15자 안팎의 짧은 핵심 어구. detail: 그 요점을 풀어 쓴 한 문장(40자 안팎).
- 말투: 사용자가 쓴 말을 최대한 그대로 살리고, 일상적인 쉬운 한국어로 쓰세요. '~의 중요성', '~적 관점', '균형 잡힌', '핵심 요소' 같은
  보고서·AI 투 표현과 사용자가 쓰지 않은 영어·전문 용어는 피하세요. label은 '쉼터 거리도 보기', '25%씩 똑같이 시작'처럼 무엇을 하는지 바로 보이게.
- turn_ids: 그 요점이 나온 턴의 id (아래 <turn id="..."> 값). 화면은 질문별로 묶이고 첫 번째 id의 질문 아래에 놓이므로, 처음 나온 턴을 맨 앞에 적으세요.
- uncertain: 사용자 생각의 한 요점과 AI 답의 한 요점이 겹치는지 아닌지 확신하기 어려운 경우, 그 쌍은 위 세 묶음 어디에도 넣지 말고 여기에 넣으세요.
  mine_label·ai_label은 각 쪽 요점(15자 안팎), shared_label은 겹친다고 볼 때의 공통 요점,
  question은 사용자에게 물을 한 문장 질문(예: "'작게 시작하기'와 'MVP부터 만들기'를 같은 생각으로 볼까요?"). 확실한 것만 있으면 빈 배열.

- materials: 질문에 첨부 자료(<attachment id="...">)가 있으면 자료마다 하나씩. summary는 자료 내용 2문장 요약,
  key_points는 자료의 핵심 3~5개(각 20자 안팎), relation은 이 자료가 사용자 생각·AI 답과 어떻게 이어지는지 한 문장. 첨부가 없으면 빈 배열.

{turns}"""


def turns_signature(turns, att_ids=()):
    # 대화나 첨부 자료가 바뀌면 서명이 달라져 마인드맵을 다시 만든다
    return [t["id"] for t in turns] + [f"a{a}" for a in att_ids]


def build_mindmap(topic_name, turns, db=None):
    if DEMO:
        return demo_mindmap(turns, db)
    content = [{"type": "text", "text": MINDMAP_PROMPT.split("{turns}")[0].format(topic=topic_name)}]
    for t in turns:
        content.append({"type": "text", "text": f'<turn id="{t["id"]}">\n<question>{t["question"]}</question>'})
        content += attachment_blocks(db, t["id"]) if db is not None else []
        content.append({"type": "text", "text": f'<my_thought>{t["my_thought"]}</my_thought>\n<ai_answer>{t["ai_answer"]}</ai_answer>\n</turn>'})
    client = anthropic.Anthropic()
    resp = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": MINDMAP_SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=[{"role": "user", "content": content}],
    )
    if resp.stop_reason == "refusal":
        raise ValueError("AI가 이 내용은 정리하지 않았어요.")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return json.loads(text)


def demo_mindmap(turns, db=None):
    """데모 모드: 턴마다 내 생각 첫 문장, 공통 요점, AI 답 첫 요점을 하나씩 뽑는다."""
    def short(s, n=16):
        s = re.sub(r"[#*`\-\n]+", " ", s).strip()
        return s if len(s) <= n else s[:n].rstrip() + "…"

    mm = {"mine_only": [], "shared": [], "ai_only": []}
    for i, t in enumerate(turns):
        first = re.split(r"(?<=[.!?。])\s+|\n", t["my_thought"].strip())[0]
        if first:  # 내 생각을 건너뛴 꼬리 질문은 '나만의 관점'이 없다
            mm["mine_only"].append({"label": short(first), "detail": first, "turn_ids": [t["id"]]})
        bullets = re.findall(r"\*\*(.+?)\*\*", t["ai_answer"] or "")
        if bullets:
            mm["ai_only"].append({"label": short(bullets[-1]), "detail": bullets[-1], "turn_ids": [t["id"]]})
        mm["shared"].append({
            "label": short(t["question"], 14), "detail": f"'{t['question']}'에 대해 내 생각과 AI 답이 같은 방향이에요.",
            "kind": "same" if i % 2 == 0 else "similar", "turn_ids": [t["id"]],
        })
    mm["uncertain"] = [{
        "mine_label": short(turns[0]["my_thought"], 12), "ai_label": "목표를 먼저 분명히",
        "shared_label": "방향을 먼저 정하기",
        "question": "내 생각의 첫 요점과 AI의 '목표를 먼저 분명히'를 같은 생각으로 볼까요?",
        "turn_ids": [turns[0]["id"]],
    }]
    if len(turns) > 1:
        mm["shared"].append({
            "label": "기록하며 비교하기", "detail": "여러 턴에 걸쳐 근거를 남기자는 생각이 겹쳐요.",
            "kind": "similar", "turn_ids": [t["id"] for t in turns],
        })
    mm["materials"] = []
    if db is not None:
        for t in turns:
            for r in db.execute("SELECT id, filename FROM attachments WHERE turn_id = ?", (t["id"],)):
                mm["materials"].append({
                    "attachment_id": r["id"], "summary": f"'{r['filename']}' 자료의 요약이에요. (데모 모드)",
                    "key_points": ["자료의 첫 번째 핵심", "자료의 두 번째 핵심", "자료의 세 번째 핵심"],
                    "relation": "내 생각의 근거를 보완해 주는 자료예요. (데모 모드)",
                })
    return mm


def clean_mindmap(data, valid_ids, att_turn=None):
    """AI가 만든 결과 정리: 존재하지 않는 turn_id는 버리고, 근거 턴이 하나도 없는 요점은 뺀다."""
    att_turn = att_turn or {}
    out = {"materials": []}
    for m in data.get("materials", []):
        aid = m.get("attachment_id")
        if aid in att_turn:  # 이 주제에 실제로 있는 첨부만
            out["materials"].append({
                "attachment_id": aid, "turn_ids": [att_turn[aid]], "summary": str(m.get("summary", ""))[:400],
                "key_points": [str(k)[:60] for k in m.get("key_points", [])][:6], "relation": str(m.get("relation", ""))[:200],
            })
    for key in ("mine_only", "shared", "ai_only", "uncertain"):
        items = []
        for p in data.get(key, []):
            ids = [i for i in p.get("turn_ids", []) if i in valid_ids]
            if ids:
                items.append({**p, "turn_ids": sorted(set(ids))})
        out[key] = items
    return out


def validate_user_mindmap(data, valid_ids):
    """사용자가 고친 마인드맵 검사: 모양이 맞는지, 글자 수, 내 대화 ID만 쓰는지. 근거 대화 없이 직접 추가한 요점도 허용."""
    if not isinstance(data, dict):
        raise ValueError("마인드맵 형식이 올바르지 않아요.")
    out = {}
    for key in ("mine_only", "shared", "ai_only", "uncertain"):
        items = data.get(key, [])
        if not isinstance(items, list) or len(items) > 30:
            raise ValueError("마인드맵 형식이 올바르지 않아요.")
        clean = []
        for p in items:
            if not isinstance(p, dict):
                raise ValueError("마인드맵 형식이 올바르지 않아요.")
            ids = sorted({int(i) for i in p.get("turn_ids", []) if isinstance(i, int) and i in valid_ids})
            if key == "uncertain":
                item = {k: str(p.get(k, "")).strip()[:120] for k in ("mine_label", "ai_label", "shared_label", "question")}
            else:
                label = str(p.get("label", "")).strip()
                if not label:
                    raise ValueError("요점 이름이 비어 있어요.")
                item = {"label": label[:40], "detail": str(p.get("detail", "")).strip()[:200]}
                if key == "shared":
                    item["kind"] = "similar" if p.get("kind") == "similar" else "same"
            item["turn_ids"] = ids
            clean.append(item)
        out[key] = clean
    return out


@app.post("/api/topics/<int:topic_id>/mindmap")
@login_required
def mindmap(topic_id):
    db = get_db()
    topic = own_topic(db, topic_id)
    if not topic:
        return jsonify(error="주제를 찾을 수 없어요."), 404
    turns = [dict(t) for t in db.execute(
        "SELECT id, question, my_thought, ai_answer FROM turns WHERE topic_id = ? AND ai_answer IS NOT NULL ORDER BY id",
        (topic_id,),
    )]
    if not turns:
        return jsonify(empty=True)

    att_rows = db.execute(
        f"SELECT id, turn_id, filename FROM attachments WHERE turn_id IN ({','.join('?' * len(turns))}) ORDER BY id",
        [t["id"] for t in turns],
    ).fetchall()
    att_turn = {r["id"]: r["turn_id"] for r in att_rows}
    sig = turns_signature(turns, [r["id"] for r in att_rows])
    cached = json.loads(topic["mindmap"]) if topic["mindmap"] else None
    refresh = (request.json or {}).get("refresh")
    if cached and not refresh:
        cached.setdefault("uncertain", [])
        cached.setdefault("materials", [])
        if cached.get("signature") == sig:
            return jsonify(cached)
        if cached.get("edited"):
            # 직접 고친 마인드맵은 대화가 늘어도 자동으로 덮어쓰지 않고, 다시 정리할지 사용자에게 맡긴다
            return jsonify({**cached, "stale": True})
    if not DEMO and not os.environ.get("ANTHROPIC_API_KEY"):
        return jsonify(error="ANTHROPIC_API_KEY가 설정되지 않았어요. think-first/.env 파일을 확인해 주세요."), 500
    blocked = ai_check(db, "mindmap")
    if blocked:
        return blocked
    try:
        data = clean_mindmap(build_mindmap(topic["name"], turns, db), {t["id"] for t in turns}, att_turn)
    except anthropic.APIStatusError as e:
        return jsonify(error=f"API 응답 오류 ({e.status_code})"), 502
    except anthropic.APIConnectionError:
        return jsonify(error="AI 서버에 연결하지 못했어요."), 502
    except (ValueError, KeyError, TypeError) as e:
        return jsonify(error=str(e) or "마인드맵을 만들지 못했어요."), 502
    data["signature"] = sig
    data["created_at"] = now()
    data["edited"] = False
    db.execute("UPDATE topics SET mindmap = ? WHERE id = ?", (json.dumps(data, ensure_ascii=False), topic_id))
    db.commit()
    return jsonify(data)


@app.patch("/api/topics/<int:topic_id>/mindmap")
@login_required
def edit_mindmap(topic_id):
    """사용자가 직접 고친 마인드맵을 저장한다 (AI 판단을 고치거나, 애매한 요점에 답한 결과)."""
    db = get_db()
    topic = own_topic(db, topic_id)
    if not topic or not topic["mindmap"]:
        return jsonify(error="마인드맵을 찾을 수 없어요."), 404
    cached = json.loads(topic["mindmap"])
    valid = {r["id"] for r in db.execute("SELECT id FROM turns WHERE topic_id = ?", (topic_id,))}
    try:
        data = validate_user_mindmap(request.json or {}, valid)
    except (ValueError, TypeError) as e:
        return jsonify(error=str(e)), 400
    data.update(signature=cached.get("signature", []), created_at=cached.get("created_at"), edited=True, edited_at=now(),
                materials=cached.get("materials", []))
    db.execute("UPDATE topics SET mindmap = ? WHERE id = ?", (json.dumps(data, ensure_ascii=False), topic_id))
    db.commit()
    return jsonify(data)

# ---------- 사용 통계 (주인 계정만) ----------
# 가입할 때 "개인을 알아볼 수 없는 통계로만" 쓰겠다고 약속했으므로:
#   - 질문·생각·답·메모의 '내용'은 절대 내보내지 않고 숫자만 계산한다.
#   - 인원이 적은 묶음(5명 미만)은 숫자 대신 '5명 미만'으로 가린다.
#   - 예시로 넣어 준 주제·대화·메모(가입 때 [예시] 주제, seed_demo.py로 넣은 주제)는 is_sample로 표시돼 통계에서 뺀다.
#     예시 주제 안에서라도 사용자가 새로 한 질문과 메모는 실제 사용으로 센다.
MIN_GROUP = 5


def _median(xs):
    xs = sorted(xs)
    if not xs:
        return None
    m = len(xs) // 2
    return xs[m] if len(xs) % 2 else round((xs[m - 1] + xs[m]) / 2)


def _ratio(a, b):
    return round(a / b, 3) if b else None


def _hide_small(groups):
    """{이름: 인원} → [{label, n}] (5명 미만은 n=None)"""
    return [{"label": k, "n": v if v >= MIN_GROUP else None} for k, v in groups.items()]


@app.get("/api/admin/stats")
@login_required
def admin_stats():
    db = get_db()
    me = db.execute("SELECT email FROM users WHERE id = ?", (current_user_id(),)).fetchone()
    if not me or me["email"].lower() not in owner_emails():
        return jsonify(error="찾을 수 없어요."), 404  # 통계 화면이 있다는 것도 알리지 않는다
    include_owner = request.args.get("include_owner") == "1"
    owners = owner_emails()
    users = [u for u in db.execute("SELECT id, email, age, gender, created_at FROM users")
             if include_owner or u["email"].lower() not in owners]
    uids = [u["id"] for u in users]
    now_dt = datetime.now()
    since = lambda days: (now_dt - timedelta(days=days)).isoformat(timespec="seconds")
    if not uids:
        return jsonify(empty=True, include_owner=include_owner)
    qs = ",".join("?" * len(uids))

    # 예시로 넣은 대화·메모(is_sample)는 빼고, 예시 주제 안에서라도 사용자가 새로 한 질문·메모는 센다
    turns = db.execute(
        f"""SELECT tu.id, tu.topic_id, tu.created_at, length(tu.my_thought) AS mine, length(tu.ai_answer) AS ai,
                   (tu.ai_answer IS NOT NULL) AS answered, (trim(coalesce(tu.reflection, '')) != '') AS reflected,
                   t.user_id
            FROM turns tu JOIN topics t ON t.id = tu.topic_id
            WHERE t.user_id IN ({qs}) AND tu.is_sample = 0""", uids).fetchall()
    real_note_topics = {r[0] for r in db.execute(
        f"SELECT n.topic_id FROM side_notes n JOIN topics t ON t.id = n.topic_id WHERE t.user_id IN ({qs}) AND n.is_sample = 0", uids)}
    used_topic_ids = {r["topic_id"] for r in turns} | real_note_topics
    # 주제: 직접 만든 주제 + 예시 주제 중 새 질문을 이어 가거나 메모를 새로 담은 주제
    topics = [t for t in db.execute(
        f"SELECT id, user_id, status, mindmap, is_sample FROM topics WHERE user_id IN ({qs})", uids)
        if not t["is_sample"] or t["id"] in used_topic_ids]
    tids = [t["id"] for t in topics] or [-1]
    tq = ",".join("?" * len(tids))
    notes = db.execute(f"SELECT kind, done, topic_id FROM side_notes WHERE topic_id IN ({tq}) AND is_sample = 0", tids).fetchall()
    answered = [r for r in turns if r["answered"]]
    thought_rows = [r for r in answered if (r["mine"] or 0) > 0]  # 꼬리 질문에서 내 생각을 건너뛴 대화는 길이 통계에서 뺀다

    # 마인드맵: 만든 주제, 직접 고친 비율, 겹치는 생각
    # (예시로 미리 넣어 둔 마인드맵은 빼고, 사용자의 새 대화까지 반영해 다시 정리된 것만 센다)
    real_turn_ids = {r["id"] for r in turns}
    maps = []
    for t in topics:
        if not t["mindmap"]:
            continue
        m = json.loads(t["mindmap"])
        if not t["is_sample"] or real_turn_ids & {x for x in m.get("signature", []) if isinstance(x, int)}:
            maps.append(m)
    shared = [p for m in maps for p in m.get("shared", [])]

    # 최근 14일 새 대화
    days = [(now_dt - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(13, -1, -1)]
    per_day = {d: 0 for d in days}
    for r in turns:
        d = (r["created_at"] or "")[:10]
        if d in per_day:
            per_day[d] += 1

    # 연령대·성별 (5명 미만 묶음은 가림)
    bands = {"10대": 0, "20대": 0, "30대": 0, "40대": 0, "50대 이상": 0}
    for u in users:
        a = u["age"] or 0
        key = "10대" if a < 20 else "20대" if a < 30 else "30대" if a < 40 else "40대" if a < 50 else "50대 이상"
        bands[key] += 1
    genders = {g: 0 for g in GENDERS}
    for u in users:
        if u["gender"] in genders:
            genders[u["gender"]] += 1

    usage = db.execute(
        f"SELECT kind, day FROM ai_usage WHERE user_id IN ({qs}) AND day >= ?", (*uids, since(6)[:10])).fetchall()
    today_s = today()
    kinds = {"check": 0, "todo": 0, "like": 0}
    for n in notes:
        if n["kind"] in kinds:
            kinds[n["kind"]] += 1

    return jsonify(
        include_owner=include_owner,
        min_group=MIN_GROUP,
        users={"total": len(users), "new_7d": sum(1 for u in users if (u["created_at"] or "") >= since(7)),
               "active_7d": len({r["user_id"] for r in turns if (r["created_at"] or "") >= since(7)})},
        topics={"total": len(topics), "done": sum(1 for t in topics if t["status"] == "done"),
                "avg_turns": round(len(turns) / len(topics), 1) if topics else None},
        turns={"total": len(turns), "answered": len(answered),
               "thought_avg": round(sum(r["mine"] for r in thought_rows) / len(thought_rows)) if thought_rows else None,
               "thought_median": _median([r["mine"] for r in thought_rows]),
               "thought_vs_ai": _ratio(sum(r["mine"] for r in thought_rows), sum(r["ai"] or 0 for r in thought_rows)),
               "skipped_thought": len(answered) - len(thought_rows),
               "reflection_rate": _ratio(sum(1 for r in answered if r["reflected"]), len(answered))},
        notes={"total": len(notes), "done_rate": _ratio(sum(1 for n in notes if n["done"]), len(notes)),
               "topic_rate": _ratio(len({n["topic_id"] for n in notes}), len(topics)),
               "kinds": [{"label": NOTE_LABELS[k], "n": v} for k, v in kinds.items()]},
        mindmap={"maps": len(maps), "edited_rate": _ratio(sum(1 for m in maps if m.get("edited")), len(maps)),
                 "shared_avg": round(len(shared) / len(maps), 1) if maps else None,
                 "same": sum(1 for p in shared if p.get("kind") != "similar"),
                 "similar": sum(1 for p in shared if p.get("kind") == "similar")},
        daily=[{"day": d, "n": per_day[d]} for d in days],
        ages=_hide_small(bands) if len(users) >= MIN_GROUP else None,
        genders=_hide_small(genders) if len(users) >= MIN_GROUP else None,
        ai={"today": sum(1 for u in usage if u["day"] == today_s),
            "week_answer": sum(1 for u in usage if u["kind"] == "answer"),
            "week_mindmap": sum(1 for u in usage if u["kind"] == "mindmap")},
    )


@app.get("/api/config")
def config():
    return jsonify(min_thought=MIN_THOUGHT_LEN, demo=DEMO, genders=GENDERS, min_age=MIN_AGE)


@app.get("/")
def index():
    return send_from_directory(BASE_DIR / "static", "index.html")


init_db()

if __name__ == "__main__":
    # 개발할 때만 FLASK_DEBUG=1 로 디버그 모드를 켠다 (배포 시 디버그 모드 금지)
    app.run(port=int(_arg("port") or os.environ.get("PORT", 5050)), debug=os.environ.get("FLASK_DEBUG") == "1", threaded=True)
