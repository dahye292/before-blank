"""실제 서비스용 실행 진입점. 개발용 app.run 대신 이걸 쓴다.

    리눅스 서버:  gunicorn --workers 2 --threads 8 --timeout 120 --bind 0.0.0.0:$PORT wsgi:app
    윈도우:       waitress-serve --listen=0.0.0.0:8000 wsgi:app

.env에 PRODUCTION=1, SECRET_KEY(32자 이상)를 넣고 https 뒤에서 실행한다.
"""
from app import app  # noqa: F401  (import 할 때 DB 준비까지 끝난다)
