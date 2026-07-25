# Womo — Local Runbook (macOS)

Womo is **local-only**: the whole app (UI + analysis engine) runs on your
laptop and connects to the **shared cloud Supabase** database. Analyses you run
locally are saved to the same database every analyst uses. Your residential IP
and full local memory make scraping reliable — and the local browser profile
avoids the container-era crash-prone `--single-process` mode automatically.
There is no login: the app opens directly.

This guide takes you from `git clone` to a running app. No prior knowledge of
the codebase is assumed.

---

## 1. Prerequisites (one-time)

| Tool | Check | Install if missing |
|---|---|---|
| **Node.js 20+** | `node --version` | <https://nodejs.org> (LTS) |
| **pnpm** | `pnpm --version` | `corepack enable && corepack prepare pnpm@10.4.1 --activate` |
| **Git** | `git --version` | ships with Xcode Command Line Tools (`xcode-select --install`) |

## 2. Clone and install

```bash
git clone https://github.com/flo-kian-baban/womo.git
cd womo
pnpm install
```

## 3. Install the scraping browser (one-time)

```bash
pnpm exec playwright install chromium
```

Downloads the pinned headless Chromium Playwright drives for TikTok/Instagram
scraping (~150 MB, into your user cache — not the repo).

## 4. Configure your environment

```bash
cp .env.example .env
```

Open `.env` and fill in the **[required]** values (get real credentials from
Kian / the team vault — they are never committed to the repo):

- `DATABASE_URL` — the shared Supabase **connection-pooler** URL
- `GEMINI_API_KEY` — Google AI Studio key (the analysis LLM)
- `GOOGLE_MAPS_API_KEY` — brand analysis

Everything else in the template is optional tuning. **Never commit `.env`.**

## 5. Run

```bash
pnpm start:local
```

Wait for `serving on port 3000`, then open **<http://localhost:3000>** — the
app opens directly (no login). That's the whole loop — analyses run on your
machine and persist to the shared database.

To stop: `Ctrl-C` in the terminal. To run again later: `pnpm start:local`.

---

## Day-to-day

- **Start of a work session:** `git pull` then `pnpm start:local`. If
  `package.json`/`pnpm-lock.yaml` changed in the pull, run `pnpm install` first.
- **Analyses appear for everyone** — the database is shared. The Library shows
  runs from every analyst.
- **Timeout tuning:** a hard creator that exceeds the 5-minute analysis window
  can be given more room locally — set `ANALYSIS_TIMEOUT_MS=600000` in `.env`
  and restart.

## Version discipline (multi-analyst)

The database schema is shared by every running copy of the app, so versions
must stay compatible:

1. **Always pull from `main`** — never run long-lived local branches against
   the shared database.
2. **Schema changes are deliberate** — they happen only via reviewed Supabase
   migrations (see `docs/STORAGE_MODEL.md`; `pnpm db:push` is intentionally
   blocked). If you're not making one, you'll never need to think about this.
3. **Stay current with the other analyst(s):** when one of you pulls a change
   that touched `drizzle/schema.ts` or `docs/STORAGE_MODEL.md`, both of you
   should pull before running new analyses.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `browserType.launch: Executable doesn't exist` | Step 3 was skipped — run `pnpm exec playwright install chromium`. |
| Database errors on every page | `DATABASE_URL` wrong or the pooler string lost its password when pasted. Test with step 5's boot log — a dead DB warns at startup. |
| Analysis times out on a huge creator | Raise `ANALYSIS_TIMEOUT_MS` (see Day-to-day) and retry. Also check the run's diagnostics panel — "insufficient data" is TikTok returning nothing, not a timeout; just retry those. |
| Port 3000 already in use | Set `PORT=3001` in `.env` (or quit the other process). |
| LLM errors (`401 Unauthorized`) on every analysis | The `GEMINI_API_KEY` is invalid or was revoked — issue a new key in Google AI Studio and update `.env`, then restart. |
