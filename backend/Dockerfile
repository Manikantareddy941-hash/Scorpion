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

# NODE_ENV=production is load-bearing for security, not just performance: the
# dev auth bypass in middleware/auth.ts refuses to activate outside production,
# and ideRoutes requires IDE_SCAN_SECRET when it is set. A deploy that forgets
# it is a deploy with weaker auth.
ENV NODE_ENV=production
# No Docker daemon in a hosted container, so scanners run as host processes.
ENV RUNNER_MODE=binary

COPY backend/package*.json backend/setup-tools.sh ./
# SCORPION_REQUIRE_TOOLS makes setup-tools.sh fail the build if any scanner is
# missing. Shipping an image whose scanners silently do nothing is the failure
# mode this exists to prevent.
RUN SCORPION_REQUIRE_TOOLS=1 npm install --only=production

COPY --from=builder /app/backend/dist ./dist
# The deploy runs `npm run migrate:up` against this image, so the .sql files
# have to be in it — node-pg-migrate is a runtime dependency for that reason.
COPY backend/migrations ./migrations

EXPOSE 3001

# Render/Fly restart an unhealthy container; without this a boot failure (an
# unreachable database, say) would sit there serving errors.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# tsconfig's rootDir spans the repo root (to reach ../shared), so tsc emits
# output nested under dist/backend/src instead of dist/src.
CMD ["node", "dist/backend/src/index.js"]
