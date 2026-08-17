# ---------- Build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Build config (src/, astro.config, styles, public, etc.) is fully copied by `COPY . .`
RUN npm run build

# ---------- Runtime stage ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=4321

# Production dependencies only (sharp etc. are required at runtime).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Standalone server build output (dist/server/entry.mjs + dist/client/) ...
COPY --from=build /app/dist ./dist
# ... plus the source content tree: the Markdown editor reads and writes
# files directly under src/content, so those files must exist at runtime.
COPY --from=build /app/src ./src
# User state (users, sessions, audit) lives in data/ and is ignored by Git.
RUN mkdir -p data

# Run as non-root.
USER node

VOLUME ["/app/data"]

EXPOSE 4321

# AUTH_SECRET (>= 32 chars), PORTAL_ADMIN_EMAIL/PASSWORD and SITE_URL are
# expected via environment in production.
CMD ["node", "dist/server/entry.mjs"]