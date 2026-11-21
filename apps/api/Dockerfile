# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM python:3.12-slim
WORKDIR /app
COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/api/ .
COPY packages/shared/rules.json packages/shared/rules.json
COPY packages/shared/samples/fab-dev-30.json packages/shared/samples/fab-dev-30.json
RUN useradd --create-home mdcv && mkdir -p /data && chown mdcv /data
USER mdcv
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
