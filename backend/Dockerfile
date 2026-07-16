# Build context is the repo root (see docker-compose.yml) because backend/src
# imports shared/types.ts via a relative path that reaches outside backend/.

# Build Stage
FROM node:24-slim AS builder

WORKDIR /app/backend

COPY backend/package*.json ./
# --ignore-scripts: this stage only compiles TypeScript, it doesn't need the
# scanning tools that the postinstall hook (setup-tools.sh) installs.
RUN npm install --ignore-scripts

COPY backend/ ./
COPY shared/ /app/shared/
RUN npm run build

# Production Stage
FROM node:24-slim

WORKDIR /app/backend

# setup-tools.sh (run via postinstall below) needs these to install
# trivy/gitleaks/semgrep; musl-based alpine lacks bash and has unreliable
# semgrep wheels, so this stage uses Debian slim instead.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates python3 python3-pip tar \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json backend/setup-tools.sh ./
RUN npm install --only=production

COPY --from=builder /app/backend/dist ./dist

EXPOSE 3001

# tsconfig's rootDir spans the repo root (to reach ../shared), so tsc emits
# output nested under dist/backend/src instead of dist/src.
CMD ["node", "dist/backend/src/index.js"]
