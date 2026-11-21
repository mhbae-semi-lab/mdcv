"""의존성 없는 표준 라이브러리 HTTP 서버 (로컬 즉시 실행용).

실행: python server.py  -> http://127.0.0.1:8000
운영 권장: main.py(FastAPI) + uvicorn. 두 서버는 mdcv/api.py의 같은 처리를 사용합니다.
다른 PC에서 접속하려면 MDCV_HOST=0.0.0.0 과 MDCV_API_TOKEN 을 함께 설정하세요.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(__file__))
from mdcv.env import load_env

load_env()  # 프로젝트 루트의 .env
from mdcv import scheduler  # noqa: E402
from mdcv.api import Api, allowed_origins, setup_logging
from mdcv.service import MailService
from mdcv.store import Store

MAX_BODY = 1_000_000


class Handler(BaseHTTPRequestHandler):
    api = None  # main()에서 주입

    def log_message(self, *a):
        pass  # 요청 로그는 Api.handle이 남긴다

    def _headers(self, origin):
        if origin in allowed_origins():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")

    def _run(self, method):
        url = urlparse(self.path)
        origin = self.headers.get("Origin", "").rstrip("/")
        payload = {}
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self._send(413, {"error": "요청이 너무 큽니다."}, None, origin)
        if length:
            try:
                payload = json.loads(self.rfile.read(length))
            except ValueError:
                return self._send(400, {"error": "JSON 형식이 올바르지 않습니다."}, None, origin)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        r = self.api.handle(method, url.path, query, payload, self.headers.get("Authorization", ""))
        self._send(r.status, r.body, r.location, origin)

    def _send(self, status, body, location, origin):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        if location:
            self.send_header("Location", location)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._headers(origin)
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._headers(self.headers.get("Origin", "").rstrip("/"))
        self.end_headers()

    do_GET = lambda self: self._run("GET")
    do_POST = lambda self: self._run("POST")
    do_PATCH = lambda self: self._run("PATCH")
    do_DELETE = lambda self: self._run("DELETE")


def main():
    setup_logging()
    store = Store()
    service = MailService(store)
    Handler.api = Api(store, service)
    scheduler.start(store, service)
    host, port = os.getenv("MDCV_HOST") or "127.0.0.1", int(os.getenv("PORT") or 8000)
    print("MDCV API http://%s:%d (데모 메일: POST /api/demo/seed)" % (host, port))
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
