"""공개 링크·배포용 실행: 개발용 app.run 대신 waitress(실제 서비스용 서버)로 띄운다.

    python serve.py --port=5060              # 내 컴퓨터에서만 받음(127.0.0.1) → 터널(cloudflared)로 공개 링크
    HOST=0.0.0.0 PORT=8000 python serve.py   # 클라우드 서버에서

공개할 때는 PRODUCTION=1 로 실행한다 (https 전용 쿠키, SECRET_KEY 필수, 프록시 뒤 실제 접속 주소).
"""
import os

from waitress import serve

from app import _arg, app

if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(_arg("port") or os.environ.get("PORT", 8000))
    print(f"비포블랭크: http://{host}:{port}  (PRODUCTION={os.environ.get('PRODUCTION', '0')})", flush=True)
    serve(
        app, host=host, port=port,
        threads=8,
        send_bytes=1,                         # AI 답이 한 글자씩 바로 흘러가도록 모아 두지 않는다
        clear_untrusted_proxy_headers=False,  # 접속 주소는 app의 ProxyFix가 X-Forwarded-For로 정한다
        ident="before-blank",
    )
