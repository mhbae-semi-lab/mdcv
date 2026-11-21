# Build from the repository root: docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 .
# The web app is a static export; nginx only serves files. Leave NEXT_PUBLIC_API_URL empty for the browser-only build.
FROM node:22-alpine AS build
WORKDIR /src
COPY apps/web/package.json apps/web/package-lock.json apps/web/
RUN cd apps/web && npm ci --no-audit --no-fund
COPY packages packages
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
ARG NEXT_PUBLIC_MS_CLIENT_ID=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_MS_CLIENT_ID=$NEXT_PUBLIC_MS_CLIENT_ID
RUN cd apps/web && npm run build

FROM nginx:1.27-alpine
COPY --from=build /src/apps/web/out /usr/share/nginx/html
EXPOSE 80
