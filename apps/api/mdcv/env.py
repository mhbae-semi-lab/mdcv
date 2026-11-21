""".env 읽기(표준 라이브러리). 프로젝트 루트의 .env를 환경변수로 올린다.

- 이미 설정된 환경변수는 덮어쓰지 않는다(Docker·서비스 설정이 우선).
- 값이 비어 있는 줄은 '미설정'으로 취급해 코드의 기본값이 적용되게 한다.
"""
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "..")


def load_env(path=None):
    path = path or os.getenv("MDCV_ENV_FILE") or os.path.join(ROOT, ".env")
    if not os.path.isfile(path):
        return 0
    loaded = 0
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip().strip("'\"")
            if value and key not in os.environ:
                os.environ[key] = value
                loaded += 1
    return loaded
