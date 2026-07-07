# Production Hardening Task List

## Phase 0 — Immediate
- [x] FIX 0-1: .env in .gitignore (already present — verified)
- [ ] FIX 0-2: Create .env.example

## Phase 1 — Core Infrastructure
- [ ] FIX 1-1: Remove findAvailablePort (server/_core/index.ts)
- [ ] FIX 1-2: Add trust proxy (server/_core/index.ts)
- [ ] FIX 1-3: Add SIGTERM handler (server/_core/index.ts)
- [ ] FIX 1-4: Required env var validation (server/_core/env.ts)
- [ ] FIX 1-5: Fix health check timeout (railway.toml)
- [ ] FIX 1-6: Add --disable-gpu to Playwright (server/scraping/browserClient.ts)
- [ ] FIX 1-7: Add test files to .dockerignore

## Phase 2 — Security Hardening
- [ ] FIX 2-1: Fix sameSite cookie (server/routers.ts)
- [ ] FIX 2-2: Sign auth cookie with HMAC (server/routers.ts + server/_core/context.ts)
- [ ] FIX 2-3: Add Gemini 429 retry (server/_core/llm.ts)
- [ ] FIX 2-4: Add bulk analysis cap (server/routers.ts)
- [ ] FIX 2-5: Add VITE_API_URL warning (client/src/main.tsx)

## Phase 3 — Stability
- [ ] FIX 3-1: Add concurrency semaphore (server/routers.ts)
- [ ] FIX 3-2: Fix Playwright page leak (server/webResearch.ts) — already handled by existing try/catch, verified no action needed
- [ ] FIX 3-3: Switch DB to connection pool (server/db.ts)

## Verification
- [ ] npx tsc --noEmit — zero errors
- [ ] git check-ignore -v .env
- [ ] Build and verify startup validation
- [ ] Commit all changes
