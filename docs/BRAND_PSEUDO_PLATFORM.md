# Brand is not a platform — a known, deliberate gap

**Status:** accepted compromise, S5 (2026-07-27). Option C of three.
**Constant:** `BRAND_PSEUDO_PLATFORM` in `server/_core/analysisPhase.ts`.
**Eventual fix:** Option B below.

If you are here because you found `BRAND_PSEUDO_PLATFORM` and wondered whether it
was an oversight: it is not. It is a compromise that was argued, chosen and
recorded. This is the record.

## The problem

A brand campaign runs on the same driver, runner, scheduler and ledger as a
creator. That shared spine carries `platform: PlatformName` on every campaign,
phase context and ledger row.

Brand has no platform. It is a different **kind of subject** — a website, review
sites, search fallbacks and optionally two social channels. `PlatformName` is
`"TikTok" | "Instagram" | "YouTube"`, and the toolset registry holds TikTok and
Instagram only, so `toolsetFor("Brand")` throws:

```
No phase toolset registered for Brand.
```

That throw sat directly in the collection driver's evidence-gate call, which is
why `runBrandCollection` could not complete a single run before this change.

## The three options

### A — widen `PlatformName` to include `"Brand"`, register a `BRAND_TOOLSET`

Rejected. Brand builds its own phase objects, so `capture`, `augment` and
`transcribe` on such a toolset would be dead members existing only to reach
`gate`. It would also need an `engagementRate` it has no meaning for, and
`registeredPlatforms()` would begin reporting Brand as a platform, which it is
not. Union-wide churn to reach one function.

### B — separate subject type from platform  ← **the eventual fix**

The correct model, and the one brand's own phase module already describes in its
header. A campaign would carry a subject descriptor; the driver would key its
gate off subject type; no non-platform would ever occupy a platform slot.

Not taken **now** because it necessarily touches `encodeSubject` /
`decodeSubject` and therefore `subject_hint` — the string every in-flight
campaign is keyed by. That invariant is strict (a no-extras subject must encode
byte-identically, forever, or the boot loop stops recognising live rows) and
**no harness can arbitrate it**, because subject identity is not evidence.

The immediately preceding work is why that mattered. The brand symbol decoder had
its inputs silently changed by a refactor — snippets dropped from its corpus, the
formatted perception block substituted for raw review text — and the identity
harness could not see it, because the harness replayed *recorded* parts and never
ran the decoder. An uncovered surface cost a live WHAT change. Making an
unarbitrated change to the identity of in-flight work, in order to repair a
type-level untruth, is the wrong trade at that moment.

### C — brand supplies its gate through its own spec  ← **chosen**

One optional `gate` parameter on `runPhaseCollection`, defaulting to
`toolsetFor(platform).gate`. Creators are untouched — they fall through to the
registry exactly as before. `PlatformName`, the registry and the subject-hint
encoding are all unchanged.

## What C costs, stated plainly

- `CampaignState.platform` and every brand ledger row carry a value outside the
  `PlatformName` union.
- `decodeSubject` hands the queue a platform string the union does not contain.
- Nothing *reads* it as a platform — brand resolves no toolset and supplies its
  own gate — but the type says otherwise, and a reader who trusts the type is
  being misled.

## Rules while this stands

1. **One constant.** Reference `BRAND_PSEUDO_PLATFORM`. Do not write
   `as never` or `as PlatformName` at a call site — a named constant in one place
   is auditable, scattered casts are not.
2. **Use `isPseudoPlatform(...)`** for any code that must ask "is this a real
   platform?" rather than comparing to the string.
3. **Do not grow the pattern.** A second pseudo-platform is the signal that
   Option B is overdue.

## Doing Option B later

The work is: introduce `SubjectType`, thread a subject descriptor through the
driver and campaign spec, key the gate off subject type, and delete this
constant. The gating risk is `subject_hint` — any change must be strictly
additive and backward-compatible with rows already in `analysis_phase_state`,
and it needs a direct harness on encode/decode round-tripping, since the
evidence harnesses cannot cover it. `server/_core/subjectIdentity.ts` states the
invariant it must hold.
