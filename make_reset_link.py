"""운영자용: 메일 서버(SMTP)가 없을 때, 비밀번호를 잊은 사용자에게 줄 재설정 링크를 직접 만든다.

    python make_reset_link.py --email=사용자이메일 --base=https://공개주소

- 비밀번호 원문은 해시로만 저장돼 누구도 알 수 없다. 그래서 '찾아 주기'가 아니라 새 비밀번호를 정할 링크를 준다.
- 링크는 30분 동안 한 번만 쓸 수 있고, 이전에 만든 링크는 무효가 된다 (사이트의 '비밀번호 찾기'와 같은 규칙).
- 링크를 가진 사람은 그 계정의 비밀번호를 바꿀 수 있다 → 본인인지 확인한 뒤, 그 사람에게만 따로 보낸다.
"""
import hashlib
import secrets
import sqlite3
import sys
from datetime import datetime, timedelta

import app  # DB 위치·테이블을 앱과 똑같이 쓴다


def main():
    email = (app._arg("email") or "").strip().lower()
    base = (app._arg("base") or "http://localhost:5050").rstrip("/")
    if not email:
        raise SystemExit("사용법: python make_reset_link.py --email=사용자이메일 --base=https://공개주소")
    db = sqlite3.connect(app.DB_PATH)
    row = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if not row:
        raise SystemExit(f"{email} 로 가입한 계정이 없어요.")
    token = secrets.token_urlsafe(32)
    expires = (datetime.now() + timedelta(minutes=app.RESET_MINUTES)).isoformat(timespec="seconds")
    db.execute("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL", (app.now(), row[0]))
    db.execute("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
               (row[0], hashlib.sha256(token.encode()).hexdigest(), expires))
    db.commit()
    print(f"재설정 링크 ({expires[11:16]}까지, 한 번만 쓸 수 있어요):")
    print(f"{base}/#/reset?token={token}")


if __name__ == "__main__":
    sys.exit(main())
