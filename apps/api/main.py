"""FastAPI 운영 서버. 실행: uvicorn main:app --port 8000

라우팅·인증·검증은 mdcv/api.py(표준 라이브러리 서버와 공용)가 처리하고, 여기서는 HTTP 입출력만 맡는다.
"""
import os
import sys
from contextlib import asynccontextmanager

sys.path.insert(0, os.path.dirname(__file__))
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from mdcv.env import load_env

load_env()  # 프로젝트 루트의 .env
from mdcv import scheduler  # noqa: E402
from mdcv.api import VERSION, Api, allowed_origins, setup_logging
from mdcv.service import MailService
from mdcv.store import Store

setup_logging()
store = Store()
service = MailService(store)
api = Api(store, service)


@asynccontextmanager
async def lifespan(_):
    stop = scheduler.start(store, service)
    yield
    if stop:
        stop.set()


app = FastAPI(title="MDCV API", version=VERSION, lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=sorted(allowed_origins()),
                   allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "Authorization"])


@app.api_route("/{path:path}", methods=["GET", "POST", "PATCH", "DELETE"])
async def handle(request: Request, path: str):
    payload = {}
    if request.method != "GET":
        raw = await request.body()
        if len(raw) > 1_000_000:
            return JSONResponse({"error": "요청이 너무 큽니다."}, 413)
        if raw:
            try:
                payload = await request.json()
            except ValueError:
                return JSONResponse({"error": "JSON 형식이 올바르지 않습니다."}, 400)
    r = await run_in_threadpool(api.handle, request.method, "/" + path, dict(request.query_params), payload,
                                request.headers.get("authorization", ""))
    return RedirectResponse(r.location, 302) if r.location else JSONResponse(r.body, r.status)
