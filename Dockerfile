# syntax=docker/dockerfile:1
# Multi-stage Next.js 15 Dockerfile with Prisma.
# - deps stage installs npm dependencies with a BuildKit cache mount.
# - builder stage generates Prisma client and produces `.next/standalone`.
# - runner stage is a slim Node runtime with only the standalone server + public/static.

########## deps ##########
FROM node:20-alpine AS deps
WORKDIR /app
# libc6-compat helps Prisma engines resolve OpenSSL on alpine.
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

########## builder ##########
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Runtime env vars are injected at pod-start; provide a stub so `next build` succeeds
# (build only needs it to be defined for Prisma client generation).
ENV DATABASE_URL="postgresql://x:x@localhost:5432/x"
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=cache,target=/root/.npm \
    npx prisma generate && \
    npm run build

########## runner ##########
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user for the runtime.
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Standalone output already includes minimal node_modules + server.js.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# No public/ directory in this repo — omit that COPY.

# Prisma runtime: schema + migrations + generated client + CLI so `prisma migrate deploy`
# can be invoked from the container if needed. Include node_modules/.prisma and @prisma
# so the generated client library is available at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
