---
status: draft
phase: 06-daily-driver-polish-session-deployment
source: [06-CONTEXT.md D-40, 06-RESEARCH.md §Pitfall 9, 06-RESEARCH.md §Don't Hand-Roll]
started: TBD
updated: TBD
---

# Phase 6 — 24-Hour Soak Protocol

The soak test is the load-bearing experiment for ROADMAP Phase 6 SC-2: "Scrollback retains at least 10,000 lines of prior output, stays flat on memory across a 24-hour soak." Synthetic generators don't replicate real MicroBeast cadence; the only test that matters is a real MicroBeast running for 24 hours with `performance.memory` + `wasm.memory.buffer.byteLength` sampling.

This document is the protocol. The actual run is out-of-band and does NOT block `/gsd-verify-phase 06`.

## Setup

**Hardware:**
- Real MicroBeast (CP2102N USB-serial, VID 0x10c4, PID 0xea60).
- USB-A or USB-C cable to the test machine.
- Test machine: any modern laptop / desktop with Chromium 89+.

**Workload:**

Run a script on the MicroBeast that emits roughly 1 line/sec of mixed CP/M output for 24 hours. The simplest workload is BASIC counting (CONTEXT §Claude's Discretion):

```basic
10 FOR I = 0 TO 1E9
20 PRINT I
30 NEXT I
```

Adjust `1E9` to anything large enough to outrun 24 hours at terminal-readable speed. Mixed CP/M command output (`DIR`, `TYPE`, `STAT`) is also acceptable but harder to script unattended.

**Browser tab:**
- Open BestialiTTY (deployed `https://<user>.github.io/bestialitty/` OR local `http://localhost:8000/`).
- Connect to the MicroBeast (one click — port permission persists from prior visits).
- Spend the first 30 minutes foreground; minimize / switch tabs for at least 4 hours of the 24-h run to exercise the visibilitychange catch-up path (Phase 5 D-39 + Pitfall 6).

## Sampling

The sampler runs in DevTools console. Paste this snippet immediately after connecting:

```js
// Phase 6 D-40 — 60-second memory sampler. setInterval (NOT rAF — Pitfall 9).
window.__soakSamples = [];
window.__soakInterval = setInterval(() => {
  const sample = {
    ts: new Date().toISOString(),
    wasmByteLength: window.__wasm ? window.__wasm.memory.buffer.byteLength : null,
    sessionLogBytes: window.__sessionLog ? window.__sessionLog.getCurrentBytes() : null,
    perfMemory: performance.memory ? {
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      usedJSHeapSize: performance.memory.usedJSHeapSize,
    } : null,
  };
  window.__soakSamples.push(sample);
  console.log('[soak]', JSON.stringify(sample));
}, 60_000);
```

**Why setInterval, not rAF:** rAF throttles to ~1 Hz when the tab is hidden (Chromium background-tab throttling); the soak measurements would stop while you switch to another tab. setInterval continues firing even on hidden tabs (still close to 60 s — Chromium may stretch to 1-second resolution but does not stop) per RESEARCH §Pitfall 9.

**Why setInterval at 60 s, not 30 s or 10 s:** sample frequency is a tradeoff. 60 s gives 1,440 samples over 24 h — enough resolution to see drift trends without flooding console. Lower cadences fragment the signal; higher cadences (e.g. 5 minutes) miss short-term spikes.

**performance.memory may be removed.** RESEARCH §Assumptions Log A7 documents that `performance.memory` is non-standard and Chromium may eventually remove it. The primary memory signal is `wasm.memory.buffer.byteLength`; `performance.memory` is supplementary. If Chromium removes `performance.memory`, the sampler still records `wasmByteLength` and the pass criterion still applies.

**Saving samples:** after the 24-h run, in DevTools console:

```js
copy(JSON.stringify(window.__soakSamples, null, 2));
```

This copies the full sample array to clipboard; paste into `06-SOAK-RESULT-{YYYYMMDD}.json` for archival.

## Pass Criteria

**Primary criterion (CONTEXT D-40 — locked, not tunable):**

- `wasm.memory.buffer.byteLength` stable within ±10% of initial after the first 10 minutes.
  - "Initial" = the byteLength at sample t=10 minutes.
  - "Stable within ±10%" = no sample after t=10 minutes deviates by more than 10% above OR below the initial value.
  - Pass: max(byteLength) − initial ≤ 0.1 × initial AND initial − min(byteLength) ≤ 0.1 × initial.

**Secondary criteria:**

- `usedJSHeapSize` SHOULD NOT show monotonic growth past steady-state. A bounded sawtooth (GC freeing periodically) is acceptable. Continuous monotonic growth indicates a leak.
- `sessionLogBytes` SHOULD grow linearly with RX volume. The log is per-design unbounded in v1 (CONTEXT D-30). Linear growth proves the chunks-by-reference contract is honored (no per-byte allocation). Non-linear growth (e.g. quadratic) would indicate buffer copy-on-grow.

## Failure handling

If the primary criterion fails:
1. Capture the sample where deviation first crossed ±10%.
2. Take a heap snapshot via DevTools → Memory → Heap snapshot.
3. File a follow-up gap_closure plan for Phase 6 with the snapshot + sample timeline.
4. Common suspects (in order of likelihood):
   - Atlas glyph cache unbounded growth (Phase 3 — atlas.evict() should bound it; verify nonce-based eviction is firing).
   - Selection observer registry leak (Phase 6 — observer added but never removed across navigation; mitigate by always exposing a dispose() return).
   - Session log Uint8Array references retained beyond Connect cycle (Phase 6 D-29 — chunks discarded on next Connect; verify in failure case).

## Result

```yaml
# Filled in by the user post-run.
run_id: TBD
run_started: TBD                    # ISO 8601
run_ended: TBD
samples_captured: TBD               # expect ~1440 for 24 h
initial_byteLength_at_10min: TBD    # bytes
max_byteLength: TBD
min_byteLength: TBD
deviation_max_pct: TBD              # (max - initial) / initial * 100
deviation_min_pct: TBD              # (initial - min) / initial * 100
pass: TBD                           # true if both deviations ≤ 10%
notes: TBD
```

---

*Phase: 06-daily-driver-polish-session-deployment*
*Document version: draft (run pending)*
