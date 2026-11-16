"""DB 백업: 서버를 멈추지 않고 안전하게 복사한다(SQLite backup API). 최근 14개만 남긴다.

    python backup_db.py                     # data/thinkfirst.db → data/backups/thinkfirst-날짜시각.db
    python backup_db.py --db=data/other.db --keep=30

하루 한 번 예약 작업(cron, 작업 스케줄러)으로 돌리고, 백업 폴더는 다른 저장소에도 복사해 두는 것을 권장.
업로드한 첨부파일(data/uploads)도 함께 백업할 것.
"""
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent


def arg(name, default):
    for a in sys.argv[1:]:
        if a.startswith(f"--{name}="):
            return a.split("=", 1)[1]
    return default


src = Path(arg("db", "data/thinkfirst.db"))
src = src if src.is_absolute() else BASE / src
keep = int(arg("keep", "14"))
out_dir = src.parent / "backups"
out_dir.mkdir(parents=True, exist_ok=True)
dest = out_dir / f"{src.stem}-{datetime.now():%Y%m%d-%H%M%S}.db"

with sqlite3.connect(src) as a, sqlite3.connect(dest) as b:
    a.backup(b)
print("백업:", dest)

old = sorted(out_dir.glob(f"{src.stem}-*.db"))[:-keep]
for f in old:
    f.unlink()
if old:
    print(f"오래된 백업 {len(old)}개 정리")
