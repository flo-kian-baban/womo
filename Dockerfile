# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 — Dependencies
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS deps

WORKDIR /app

# Install pnpm via corepack (matches packageManager field in package.json)
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

# Copy lockfile and manifests first for layer caching
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

# Install all dependencies (including devDeps needed for build)
RUN pnpm install --frozen-lockfile

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2 — Build
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/patches ./patches

# Copy full source
COPY . .

# Build frontend (dist/public/) and server bundle (dist/index.js)
RUN pnpm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3 — Production image
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner

# Install Chromium system dependencies required by Playwright
# These are the packages Playwright's install-deps script would install
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Chromium core dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    # Additional Playwright deps
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    libxfont2 \
    libxi6 \
    libxtst6 \
    # Font rendering
    fonts-liberation \
    fonts-noto-color-emoji \
    # SSL / network
    ca-certificates \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set Playwright browser install path BEFORE installing browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production

# ─── node_modules strategy ────────────────────────────────────────────────────
# The server bundle is built with esbuild --packages=external, which means ALL
# node_module imports (including devDeps like 'vite') remain as bare specifiers
# in dist/index.js and must be resolvable at runtime.  Copying the full
# node_modules from the builder stage (which installed everything) is the
# correct pattern for this setup — no --prod reinstall needed.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/patches ./patches

# package.json is required so Node.js picks up "type": "module"
COPY package.json ./

# Install Playwright Chromium binary into /ms-playwright
# Uses the playwright CLI already present in node_modules
RUN node_modules/.bin/playwright install chromium

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Railway injects PORT automatically; the server reads process.env.PORT
EXPOSE 8080

# Run the compiled server bundle
CMD ["node", "dist/index.js"]
