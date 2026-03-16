# Build stage
FROM node:18-alpine AS base

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# API stage
FROM node:18-alpine AS api
WORKDIR /app
COPY --from=base /app/package*.json ./
RUN npm install --only=production
COPY --from=base /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]

# Worker stage
FROM node:18-alpine AS worker
WORKDIR /app
# Install git for cloning
RUN apk add --no-cache git docker-cli
COPY --from=base /app/package*.json ./
RUN npm install --only=production
COPY --from=base /app/dist ./dist
CMD ["node", "dist/worker.js"]
