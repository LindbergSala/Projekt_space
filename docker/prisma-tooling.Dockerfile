FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

WORKDIR /workspace

RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node scripts/prisma-generate-vercel.mjs ./scripts/
RUN npm ci && npm cache clean --force

RUN mkdir -p /workspace/prisma/migrations /workspace/scripts \
  && chown node:node /workspace/prisma /workspace/prisma/migrations /workspace/scripts

USER node
