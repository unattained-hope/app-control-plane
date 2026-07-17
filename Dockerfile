# Apoaap Control Plane — PERSISTENT container (cp-platform-infrastructure AC9.1).
# NOT serverless: hosts the RR7 server, the Socket.IO gateway, BullMQ workers, and
# warm DB/Redis pools across requests. Deploy co-located near the SaleSwitch replica.
FROM node:20-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Install all deps (including build tooling). Production image prunes later.
FROM base AS deps
COPY package.json package-lock.json* ./
# --include=dev so vite / esbuild / @react-router/dev are available to build.
RUN npm ci --include=dev

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM base AS runtime
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
COPY --from=build /app/prisma ./prisma
# Secrets (replica creds, WorkOS, Shopify) are injected at runtime by the secrets
# manager — NEVER baked into this image (AC9.4).
EXPOSE 3000
# Do NOT use react-router-serve — it never attaches Socket.IO.
CMD ["node", "./build/server/prod.js"]
