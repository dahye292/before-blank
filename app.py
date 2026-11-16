"""생각 먼저 (Think First)

AI에게 묻기 전에 내 생각을 먼저 적고, 그다음에 AI의 답을 보는 질문 노트.
주제 1개에 대화 턴(질문 · 내 생각 · AI 답) N개가 쌓이고,
주제마다 내 생각과 AI 답을 비교하는 수렴형 마인드맵을 만든다.
"""

import json
import os
import re
import secrets
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from flask import Flask, Response, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

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
MIN_THOUGHT_LEN = 20  # 내 생각을 최소 이만큼은 써야 AI 답을 볼 수 있다

load_dotenv(BASE_DIR / ".env")
# 데모 모드: API 키 없이 화면 흐름을 확인하기 위한 가짜 AI. 실제 사용에서는 끈다.
DEMO = os.environ.get("THINKFIRST_DEMO") == "1" or "--demo" in sys.argv

app = Flask(__name__, static_folder="static", static_url_path="/static")
# 디자인(CSS·JS)을 고치면 새로고침만으로 바로 반영되게 브라우저 캐시를 쓰지 않는다
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0


def _secret_key():
    """로그인 쿠키 서명용 키. .env의 SECRET_KEY를 쓰고, 없으면 data/secret_key 파일에 만들어 둔다(git 제외)."""
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = DB_PATH.parent / "secret_key"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(secrets.token_hex(32), encoding="utf-8")
    return path.read_text(encoding="utf-8").strip()


app.secret_key = _secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,      # 자바스크립트에서 로그인 쿠키를 읽을 수 없게
    SESSION_COOKIE_SAMESITE="Lax",     # 다른 사이트에서 보낸 요청에는 쿠키가 붙지 않게
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE") == "1",  # https로 배포할 때 켠다
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
)

SYSTEM_PROMPT = (
    "당신은 사용자가 스스로 생각한 뒤에 참고하는 조언자입니다. "
    "질문에 한국어로 명확하고 간결하게 답하세요. "
    "결론만 주지 말고, 어떤 관점과 근거로 그렇게 보는지 드러내고, "
    "다르게 볼 수 있는 지점이 있으면 함께 짚어 주세요. "
    "같은 주제의 이전 질문과 답이 함께 주어지면 그 흐름을 이어서 답하세요."
)


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
        # 폴더 기능 이전 DB: 주제에 폴더 칸 추가 (비어 있으면 '폴더 없음')
        if "folder_id" not in columns(db, "topics"):
            db.execute("ALTER TABLE topics ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL")
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
_login_fails = {}  # 이메일별 로그인 실패 기록 (간단한 무차별 대입 방지)


def current_user_id():
    return session.get("uid")


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not current_user_id():
            return jsonify(error="로그인이 필요해요."), 401
        return view(*args, **kwargs)
    return wrapper


@app.before_request
def protect_api():
    """다른 사이트가 몰래 보낸 요청(CSRF)을 막기 위해, 데이터를 바꾸는 API 요청은 JSON만 받는다.
    (일반 HTML 폼은 JSON을 보낼 수 없고, 다른 사이트의 JSON 요청은 브라우저가 먼저 막는다)"""
    if request.path.startswith("/api/") and request.method in ("POST", "PATCH", "DELETE"):
        if not request.is_json:
            return jsonify(error="잘못된 요청이에요."), 400


def user_json(row):
    return {"id": row["id"], "name": row["name"], "email": row["email"]}


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

    db = get_db()
    if "email" not in errors and db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        errors["email"] = "이미 가입된 이메일이에요."
    if errors:
        return jsonify(error="입력한 내용을 확인해 주세요.", fields=errors), 400

    first_user = db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    cur = db.execute(
        "INSERT INTO users (name, email, password_hash, age, gender, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (name, email, generate_password_hash(password), age, gender, now()),
    )
    uid = cur.lastrowid
    if first_user:
        # 회원 기능이 생기기 전에 혼자 쓰던 기록은 첫 번째 가입자의 것으로 옮긴다
        db.execute("UPDATE topics SET user_id = ? WHERE user_id IS NULL", (uid,))
    db.commit()
    session.clear()
    session.permanent = True
    session["uid"] = uid
    return jsonify(user={"id": uid, "name": name, "email": email}), 201


@app.post("/api/login")
def login():
    d = request.get_json(silent=True) or {}
    email = str(d.get("email", "")).strip().lower()
    password = str(d.get("password", ""))
    fails = [t for t in _login_fails.get(email, []) if time.time() - t < 300]
    if len(fails) >= 5:
        return jsonify(error="로그인 시도가 너무 많아요. 5분 뒤에 다시 시도해 주세요."), 429
    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        _login_fails[email] = fails + [time.time()]
        # 어떤 쪽이 틀렸는지 알려 주지 않는다 (가입 여부를 숨기기 위해)
        return jsonify(error="이메일 또는 비밀번호가 맞지 않아요."), 401
    _login_fails.pop(email, None)
    session.clear()
    session.permanent = True
    session["uid"] = user["id"]
    return jsonify(user=user_json(user))


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


# ---------- 주제 ----------

TOPIC_SELECT = """
    SELECT t.id, t.name, t.folder_id, t.is_starred, t.status, t.created_at, t.updated_at,
           COUNT(u.id) AS turn_count,
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
                     WHERE question LIKE ? OR my_thought LIKE ? OR ai_answer LIKE ? OR reflection LIKE ?))"""
        params += [like] * 5
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
    turns = db.execute(
        "SELECT id, question, my_thought, ai_answer, reflection, created_at FROM turns WHERE topic_id = ? ORDER BY id",
        (topic_id,),
    ).fetchall()
    return jsonify(topic=dict(topic), turns=[dict(t) for t in turns])


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
    db.commit()
    return jsonify(ok=True)


@app.delete("/api/topics/<int:topic_id>")
@login_required
def delete_topic(topic_id):
    db = get_db()
    db.execute("DELETE FROM topics WHERE id = ? AND user_id = ?", (topic_id, current_user_id()))
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
    if len(thought) < MIN_THOUGHT_LEN:
        return jsonify(error=f"내 생각을 {MIN_THOUGHT_LEN}자 이상 적어야 AI 답을 볼 수 있어요."), 400
    db = get_db()
    if not own_topic(db, topic_id):
        return jsonify(error="주제를 찾을 수 없어요."), 404
    ts = now()
    cur = db.execute(
        "INSERT INTO turns (topic_id, question, my_thought, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (topic_id, question, thought, ts, ts),
    )
    # 새 질문을 이어 가면 주제는 다시 '진행중'
    db.execute("UPDATE topics SET status = 'in_progress', updated_at = ? WHERE id = ?", (ts, topic_id))
    db.commit()
    return jsonify(id=cur.lastrowid), 201


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
    if not own_turn(db, turn_id):
        return jsonify(error="대화를 찾을 수 없어요."), 404
    db.execute("DELETE FROM turns WHERE id = ?", (turn_id,))
    db.commit()
    return jsonify(ok=True)


# ---------- AI 답변 (스트리밍) ----------

def history_messages(db, turn):
    """같은 주제의 이전 턴 중 답이 있는 것을 대화 기록으로 넣는다. 내 생각은 넣지 않는다."""
    msgs = []
    for t in db.execute(
        "SELECT question, ai_answer FROM turns WHERE topic_id = ? AND id < ? AND ai_answer IS NOT NULL ORDER BY id",
        (turn["topic_id"], turn["id"]),
    ):
        msgs.append({"role": "user", "content": t["question"]})
        msgs.append({"role": "assistant", "content": t["ai_answer"]})
    msgs.append({"role": "user", "content": turn["question"]})
    return msgs


def demo_answer(question):
    text = (
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

    messages = history_messages(db, turn)
    topic_id = turn["topic_id"]

    def claude_stream():
        client = anthropic.Anthropic()
        with client.beta.messages.stream(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=messages,
        ) as stream:
            for text in stream.text_stream:
                yield text
            final = stream.get_final_message()
        if final.stop_reason == "refusal":
            yield "\n\n(AI가 이 질문에는 답하지 않았어요.)"

    def generate():
        # AI에게는 질문(과 이전 질문·답)만 보낸다. 내 생각은 보내지 않아서
        # AI 답이 내 생각에 맞춰지지 않고, 둘을 독립적으로 비교할 수 있다.
        parts = []
        source = demo_answer(turn["question"]) if DEMO else claude_stream()
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
MINDMAP_SCHEMA = {
    "type": "object",
    "properties": {
        "mine_only": {"type": "array", "items": POINT},
        "shared": {"type": "array", "items": SHARED_POINT},
        "ai_only": {"type": "array", "items": POINT},
        "uncertain": {"type": "array", "items": UNCERTAIN_POINT},
    },
    "required": ["mine_only", "shared", "ai_only", "uncertain"],
    "additionalProperties": False,
}

MINDMAP_PROMPT = """아래는 '{topic}' 주제로 나눈 대화입니다. 각 턴마다 사용자가 AI 답을 보기 전에 먼저 적은 생각(my_thought)과 AI의 답(ai_answer)이 있습니다.
주제 전체에 걸쳐 두 쪽의 핵심 요점을 뽑아 세 묶음으로 나눠 주세요.

- shared: 사용자 생각과 AI 답에 공통으로 들어 있는 요점. 사실상 같은 주장이면 kind "same", 방향은 같지만 강조점이나 범위가 다르면 "similar". 억지로 만들지 말고, 없으면 빈 배열.
- mine_only: 사용자 생각에만 있는 요점 (AI 답에는 없는 나만의 관점).
- ai_only: AI 답에만 있는 요점 (사용자가 생각하지 못한 새로운 관점).
- 묶음마다 0~6개, 글에 실제로 있는 내용만, 중요한 순서대로. 같은 요점을 두 묶음에 중복해서 넣지 마세요.
- label: 마인드맵 노드에 들어갈 15자 안팎의 짧은 핵심 어구. detail: 그 요점을 풀어 쓴 한 문장.
- turn_ids: 그 요점이 나온 턴의 id (아래 <turn id="..."> 값). 여러 턴에 걸쳐 있으면 모두 적으세요.
- uncertain: 사용자 생각의 한 요점과 AI 답의 한 요점이 겹치는지 아닌지 확신하기 어려운 경우, 그 쌍은 위 세 묶음 어디에도 넣지 말고 여기에 넣으세요.
  mine_label·ai_label은 각 쪽 요점(15자 안팎), shared_label은 겹친다고 볼 때의 공통 요점,
  question은 사용자에게 물을 한 문장 질문(예: "'작게 시작하기'와 'MVP부터 만들기'를 같은 생각으로 볼까요?"). 확실한 것만 있으면 빈 배열.

{turns}"""


def turns_signature(turns):
    return [t["id"] for t in turns]


def build_mindmap(topic_name, turns):
    if DEMO:
        return demo_mindmap(turns)
    body = "\n".join(
        f'<turn id="{t["id"]}">\n<question>{t["question"]}</question>\n'
        f'<my_thought>{t["my_thought"]}</my_thought>\n<ai_answer>{t["ai_answer"]}</ai_answer>\n</turn>'
        for t in turns
    )
    client = anthropic.Anthropic()
    resp = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": MINDMAP_SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=[{"role": "user", "content": MINDMAP_PROMPT.format(topic=topic_name, turns=body)}],
    )
    if resp.stop_reason == "refusal":
        raise ValueError("AI가 이 내용은 정리하지 않았어요.")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return json.loads(text)


def demo_mindmap(turns):
    """데모 모드: 턴마다 내 생각 첫 문장, 공통 요점, AI 답 첫 요점을 하나씩 뽑는다."""
    def short(s, n=16):
        s = re.sub(r"[#*`\-\n]+", " ", s).strip()
        return s if len(s) <= n else s[:n].rstrip() + "…"

    mm = {"mine_only": [], "shared": [], "ai_only": []}
    for i, t in enumerate(turns):
        first = re.split(r"(?<=[.!?。])\s+|\n", t["my_thought"].strip())[0]
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
    return mm


def clean_mindmap(data, valid_ids):
    """AI가 만든 결과 정리: 존재하지 않는 turn_id는 버리고, 근거 턴이 하나도 없는 요점은 뺀다."""
    out = {}
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

    sig = turns_signature(turns)
    cached = json.loads(topic["mindmap"]) if topic["mindmap"] else None
    refresh = (request.json or {}).get("refresh")
    if cached and not refresh:
        cached.setdefault("uncertain", [])
        if cached.get("signature") == sig:
            return jsonify(cached)
        if cached.get("edited"):
            # 직접 고친 마인드맵은 대화가 늘어도 자동으로 덮어쓰지 않고, 다시 정리할지 사용자에게 맡긴다
            return jsonify({**cached, "stale": True})
    if not DEMO and not os.environ.get("ANTHROPIC_API_KEY"):
        return jsonify(error="ANTHROPIC_API_KEY가 설정되지 않았어요. think-first/.env 파일을 확인해 주세요."), 500
    try:
        data = clean_mindmap(build_mindmap(topic["name"], turns), set(sig))
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
    data.update(signature=cached.get("signature", []), created_at=cached.get("created_at"), edited=True, edited_at=now())
    db.execute("UPDATE topics SET mindmap = ? WHERE id = ?", (json.dumps(data, ensure_ascii=False), topic_id))
    db.commit()
    return jsonify(data)


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
