# ---- Stage 1: Install dependencies ----
FROM node:20-alpine AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/

RUN pnpm install --frozen-lockfile

# ---- Stage 2: Build backend + frontend ----
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules

COPY . .

# Build backend
RUN pnpm build

# Build frontend
RUN pnpm build:web

# ---- Stage 3: Production image ----
FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./public
COPY package.json ./

EXPOSE 3000

CMD ["node", "dist/main.js"]
