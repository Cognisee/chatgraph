# LLM quickstart guide for the chatgraph web application

This document orients an LLM assistant (or human reader) to the browser
application under `web/`. For the repository as a whole, and for the
Python application it sits alongside, see `../CLAUDE.md`.

## Read this first: which system is which

This guide covers the browser application under `web/`. It is one of two
applications in this repository; the Python voice/Gremlin runtime at the
repository root is the primary one, and `../CLAUDE.md` is its guide.

The two share concepts but not an execution path. Confusing them is the
most common mistake here.

| System | Status | Lives in |
|---|---|---|
| **Next.js browser app** | this guide's subject | `app/`, `lib/`, `components/` |
| **Symbolic gate** | the research contribution | `lib/gate/`, tested by `src/test/js/` |
| **Evaluation package + paper** | the measurement record | not in this repository yet — still in Chatgraph-V2 (see issue #1) |
| **Python voice/Gremlin runtime** | the primary application; not invoked by the browser app | `../src/main/python/chatgraph/` |

The browser app does **not** import the Python package, Deepgram, or
Gremlin, and the Python application does not import anything here. The
two are coupled only through the committed schema JSON in
`../src/main/json/`. That is deliberate — see "Two applications in one
repository" in the root `README.md`, and issue #1 for the work to
converge them on one contract.

## The symbolic gate

For the hospitality domain, nothing enters the graph without a
deterministic admission decision (`web/lib/gate/`). Five constraint classes:
typed-schema conformance, provenance with a specificity rule, confidence
vocabulary, content-derived identity, and invalidate-not-delete
supersession.

Three invariants matter more than the code:

1. **One contract, generated.** `web/lib/gate/contract.ts` derives a single
   contract from the hospitality schema JSON plus the authored specs in
   `web/hopitality files/`. (Today the gate reads its own legacy-encoded
   copy, `web/src/main/json/hospitality.json`; the schema reconciliation
   retires that copy in favour of `src/main/json/hospitality.json`.) The extractor's schema reference, its tool
   parameter schema, and the gate's rules are all generated from it.
   **Never restate a label, endpoint, severity, or vocabulary in a
   prompt or in code.** Every drift bug this project has had came from a
   hand-written copy of something the schema already said. A rule the
   contract cannot bind is reported as drift and disabled; `npm test`
   (run in `web/`) asserts drift is zero.
2. **Provenance is structural.** The extractor attaches an `evidence`
   object to a fact; the gate materializes the evidence vertex and picks
   the provenance edge. Do not ask the model to emit `ProvenanceEvidence`
   vertices or provenance edges — the gate ignores them by design.
3. **Severity comes from the spec, not the code.** `hard` rejects and
   retries, `soft` admits and flags, `advisory` reports. If you find
   yourself hardcoding a severity, read `validation rules.json` instead.

## Research claims must stay measured

The measurement record — `results/`, the ablation harness under
`scripts/nesy_results/`, and the paper draft — did not come across in the
web import; it still lives in the Chatgraph-V2 repository until it is given
a home here (issue #1). The commands below are that repository's. The rules
apply to any measurement that lands in either place:

- Never convert `UNMEASURED` into a number. A missing denominator is not
  a zero.
- Every proportion carries exact counts and a Wilson interval.
- The ablation harness imports the deployed gate. Do not create a second
  gate implementation for evaluation — that is exactly how the
  superseded 2026-07-16 run produced a bug it reported as a finding.
- `npm test` verifies that every figure in the paper matches
  `results/metrics.json`. If you change a measurement, re-run
  `npm run ablation && npm run results:build` and update the paper;
  do not edit numbers by hand.
- Evidential faithfulness is model-adjudicated. Do not describe it as
  human-verified; the blinded sample is unlabelled.
- **Every methodological iteration gets a numbered file in
  `results/iterations/`** — date, method, outcome with counts, reasoning,
  evidence — plus a frozen `iteration-NN-metrics.json` snapshot, *before work
  moves on*. `results/metrics.json` is the current run and gets overwritten;
  the numbered snapshots never do. `npm run test:results` fails if the current
  run is not frozen as the latest snapshot. Negative results, dead ends, and
  non-replications belong in the record — they are corpus for the paper.

