/**
 * THE ATTENTION LIST'S MEMORY — which campaigns this analyst has acknowledged.
 *
 * ─── Scope: THIS MACHINE, deliberately ──────────────────────────────────────
 * Womo runs one app instance per analyst against a shared database. An
 * attention list is "what needs ME", so acknowledgement is honestly per-analyst
 * state: when Jason acknowledges a failed campaign on his machine, Kian's list
 * is untouched — and must be, because Kian may still need to look at it.
 * localStorage gives exactly that scope with no server change.
 *
 * Stated limitation, not hidden: this does not survive a browser-profile wipe
 * and does not follow the analyst across machines. The durable alternative is
 * an `acknowledged_at` column on the ledger — a SERVER change, logged for a
 * server session, deliberately not built here (client session).
 *
 * ─── What acknowledging does NOT do ─────────────────────────────────────────
 * Nothing, to the campaign. The ledger row, the failure class, the refusal —
 * all untouched and still queryable. This only removes the row from this
 * machine's attention view. `resumeRun` remains the tool that changes a
 * campaign's fate.
 */
const KEY = "womo.acknowledgedCampaigns.v1";

/** Parse-tolerant read — a corrupt entry costs the list, never the page. */
function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function acknowledgedRunIds(): Set<string> {
  return new Set(Object.keys(read()));
}

export function acknowledge(runId: string): void {
  try {
    const all = read();
    all[runId] = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage full or unavailable — the row simply stays on the list.
  }
}

export function unacknowledge(runId: string): void {
  try {
    const all = read();
    delete all[runId];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* see above */
  }
}
