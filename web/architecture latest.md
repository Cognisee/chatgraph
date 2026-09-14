# Chatgraph — Architecture (latest)

_A deep reference for the deployed system: what the architecture is, its layers,
the per-turn flow, and the mechanics of extraction, grounding, provenance,
identity, and symbolic verification. Grounded in the code as it stands on `main`,
not in the paper's framing._

> **Reading guide.** §1 is the one-paragraph mental model. §2 is the layer stack.
> §3 walks a single expert turn end to end. §4–§9 are the deep dives (contract,
> extraction, the gate's six constraint classes, provenance/grounding, identity,
> supersession). §10 is the evaluation/measurement architecture. §11 is the export
> bundle. §12 is the file map. Every mechanism cites the file that implements it.

---

## 1. The one-paragraph model

A domain expert talks; an **LLM interviewer** runs a structured session; a second
**LLM extractor** proposes a typed graph delta for each expert turn; and a
**deterministic symbolic gate** decides, fact by fact, what is allowed to persist.
The gate is not a filter bolted on afterwards — it is the *only* component that
writes to the graph, and it is generated from the **same single contract** that
generates the extractor's prompt and tool schema, so the generator and its
guardrail cannot drift apart. The design thesis: for tacit expert knowledge there
is no reference graph to check against, so **ground truth is manufactured at
capture time** by binding every admitted fact to the verbatim utterance that
licensed it. Structure is easy (constrained decoding already guarantees it);
*grounding* is the hard, enforced part.

---

## 2. The layer stack

```
┌─────────────────────────────────────────────────────────────────────┐
│  L0  CONTRACT (single source of truth)                               │
│      src/main/json/hospitality.json   (schema: 24 vertex, 33 edge)   │
│      hopitality files/*.json          (governance spec: 26 rules)    │
│      → lib/gate/contract.ts derives ONE GateContract                 │
│        that feeds BOTH the extractor prompt AND the gate rules        │
└─────────────────────────────────────────────────────────────────────┘
                │  (generation, deterministic, no LLM)
     ┌──────────┴───────────┐
     ▼                      ▼
┌─────────────────┐   ┌──────────────────────────────────────────────┐
│ L1 INTERVIEW    │   │ L2 EXTRACTION                                │
│ lib/domains.ts  │   │ lib/gate/prompt.ts  (schema ref, tool schema)│
│ agent prompt,   │   │ lib/server/extract-governed.ts  (the loop)   │
│ 7 sections,     │   │ gpt-4o-mini, temp 0, inline evidence required │
│ conduct rules   │   └──────────────────────────────────────────────┘
│ lib/realtime.ts │                    │  proposes typed delta
│ (voice, WebRTC) │                    ▼
└─────────────────┘   ┌──────────────────────────────────────────────┐
     │                │ L3 THE GATE   lib/gate/gate.ts::runGate       │
     │ voice/text     │  6 constraint classes, per-FACT admission,    │
     ▼                │  materializes provenance, resolves identity,  │
┌─────────────────┐   │  supersedes contradictions, emits findings +  │
│ APP / API       │   │  typed retry feedback                          │
│ app/page.tsx    │   └──────────────────────────────────────────────┘
│ app/api/chat    │                    │  admitted delta only
│ app/api/extract │                    ▼
└─────────────────┘   ┌──────────────────────────────────────────────┐
                      │ L4 GRAPH STATE (browser-local)                │
                      │  mergeDelta → GraphState { vertices, edges }  │
                      │  components/GraphView.tsx  (D3 force layout)  │
                      └──────────────────────────────────────────────┘
                                       │
     ┌─────────────────────────────────┴──────────────────────────────┐
     ▼                                                                 ▼
┌──────────────────────────────┐   ┌──────────────────────────────────┐
│ L5 EXPORT / AUDIT BUNDLE     │   │ L6 EVALUATION (offline)          │
│ lib/export.ts, lib/audit.ts  │   │ scripts/nesy_results/*           │
│ 4-file one-click download    │   │ ablation IMPORTS the deployed    │
│ (session, transcript, audit, │   │ gate; A0..A5; metrics; claim     │
│  gate log) + build commit    │   │ verifier; frozen iterations      │
└──────────────────────────────┘   └──────────────────────────────────┘
```

Two structural facts make this more than a diagram:

1. **The contract feeds both sides.** L2 (what the extractor is told it may emit)
   and L3 (what the gate will accept) are generated from the *same* `GateContract`.
   A rule the contract cannot bind to the schema is reported as **drift and
   disabled**, never silently reinterpreted; `npm test` asserts drift is zero.
2. **The gate is the sole writer.** Nothing reaches L4 except through
   `runGate`'s returned delta. The extractor cannot write; it can only *propose*.

There are three systems in this repo that share vocabulary but not an execution
path — the **Next.js browser app** (the live product; `app/`, `lib/`,
`components/`), the **symbolic gate + evaluation** (the research contribution;
`lib/gate/`, `scripts/nesy_results/`, `results/`), and a **legacy Python
voice/Gremlin runtime** (`src/main/python/`, not invoked by the app). This
document describes the first two. The browser app does not import the Python
package.

---

## 3. The flow of one expert turn

This is the critical path. Follow a single utterance from the microphone to the
persisted, grounded graph.

```
 (1) EXPERT SPEAKS / TYPES
      voice: lib/realtime.ts (OpenAI Realtime, WebRTC, client-owned responses,
             semantic VAD eagerness "low", 1200ms transcript settle, watchdog)
      → a user ChatMessage with a stable id
                │
                ▼
 (2) POST /api/chat            app/api/chat/route.ts
      runs in parallel:
        • runAgent(...)        the interviewer's next question (gpt-4o)
        • extractGraphDelta()  the typed extraction  ── delegates to ──┐
                                                                        ▼
 (3) GOVERNED EXTRACTION       lib/server/extract-governed.ts
      a. FILLER GUARD          isFillerTurn(text)  (lib/filler.ts)
         "continue" / "move on" / bare ack → return EMPTY delta, no episode.
         (Rationale: filler turns are exactly when the extractor re-emits prior
          facts and mutates identities — an empirical finding from live audit.)
      b. EPISODIC SCAFFOLD     episodeScaffold(...)  (deterministic, NO LLM)
         builds SessionSection + TranscriptEpisode + hasSection/hasEpisode edges.
         episode id = ep:<session>:m<10 hex of message id>  (collision-proof)
         section classified from the interviewer's PREVIOUS question, monotonic
         carry-forward (interviews move forward, never snap back).
      c. THE ATTEMPT LOOP      up to MAX_ATTEMPTS = 3
         ┌─ callExtractor(...) gpt-4o-mini, temp 0, tool_choice forced
         │    system = extractorIntro + provenanceInstructions + schemaReference
         │    user   = latest utterance + 8-msg window + knownEntitiesSummary
         │    tool   = emit_graph_delta(extractionToolSchema)  ← evidence REQUIRED
         │    returns raw { vertices[], edges[] }, each vertex carrying inline
         │            evidence:{traceText, confidence}
         │
         ├─ withScaffold(raw, scaffold)   prepend the deterministic scaffold
         │
         ├─ runGate(merged, graph, domainId, {                    ← L3, see §5
         │     deterministicIds:true, temporalContradictions:true,
         │     resolveEntities:true,
         │     evidenceContext:{ sourceEpisode, speaker:"expert", utterance }})
         │
         ├─ score = admitted.vertices + admitted.edges − 10×(soft HR006 gaps)
         │    keep best-scoring attempt
         │
         └─ if result.retryFeedback (a hard rule fired):
                feedback = typed error + schema; retry
            else if soft evidence gaps remain and attempts left:
                feedback = "re-emit with evidence"; ONE soft retry
            else break
      d. RETURN { delta, warnings, gate }   ← gate = full TurnGateReport
                                              (every attempt, every finding)
                │
                ▼
 (4) RESPONSE                  { assistantMessage, delta, warnings, gate }
                │
                ▼
 (5) CLIENT MERGE              app/page.tsx
      graph = mergeDelta(graph, delta)
      turnRecords.push({ userMessageId, userText, delta, warnings, gate })
      GraphView re-renders (superseded nodes hidden, evidence panel on click)
```

Everything in step (3b) is **deterministic and reproducible from the transcript
alone** — no model is involved in building the session/section/episode chain.
Everything in step (3c) that touches the graph goes through the gate.

---

## 4. L0 — The contract: one source of truth

**File:** `lib/gate/contract.ts` (`gateContract(domainId)` → cached `GateContract`).

The contract is derived, once and deterministically, from two authored inputs:

- **The schema** — `src/main/json/hospitality.json`: 24 vertex classes (19
  knowledge, 5 infrastructure) and 33 edge types. Each vertex property carries a
  declared value shape (`{string:{}}`, `{boolean:{}}`, `{integer:{}}`), which the
  contract reads into `VertexSpec.propertyTypes` via `declaredType()`. This is
  hand-authored JSON for hospitality (validated, not regenerated); `medical.json`
  is generated from a Python `schema_build.py`.
- **The governance spec** — `hopitality files/validation rules.json` (26 rules,
  each with a declared severity) plus the provenance spec. Severities are read
  from here, *never* hardcoded.

From these it builds a single `GateContract` (`contract.ts:66`) exposing, among
others:

| Field | What it binds | Used by |
|---|---|---|
| `vertexSpecs` / `edgeSpecs` | labels, properties, required props, endpoint sets, property types | schema conformance (§5-i) |
| `knowledgeLabels` / `infrastructureLabels` | which labels carry knowledge (need evidence) vs structure | provenance (§6) |
| `evidenceLabel`, `provenanceEdgeByLabel` | `ProvenanceEvidence` + which typed edge grounds each label | evidence materialization (§6) |
| `speakerValues`, `confidenceValues` | closed vocabularies {expert…} / {high, medium, low, inferred} | evidence quality (§6) |
| `bannedTracePatterns` | generic-trace blacklist | span rule (§6) |
| `textQualityRules` | `<Label>.<prop> must be specific` (HR014/HR015) | text quality (§5) |
| `singletonLabels` | at-most-one-per-session labels (e.g. CheckInPolicy) | singleton/supersession (§9) |
| `severities` | rule_id → hard/soft/advisory | every constraint |
| `drift` | rules the spec declares but the schema cannot bind | fail-closed guard |

**Why this matters.** The extractor's schema reference, its tool parameter schema,
its grounding instructions, and the gate's rules are all generated from this one
object. Every drift bug this project ever had came from a hand-written copy of
something the schema already said. A rule that cannot be bound is **disabled and
reported**, so the system fails closed rather than silently enforcing a phantom
rule. `npm test` refuses to pass while drift is non-zero.

The full authored rule inventory (severity in brackets):

```
HR001 required_properties_present            [hard]
HR002 no_unknown_vertex_labels               [hard]
HR003 no_unknown_edge_labels                 [hard]
HR004 edge_endpoint_types_match_schema       [hard]
HR005 no_dangling_edges                      [hard]
HR006 provenance_attached_to_knowledge       [soft]   ← admit-flagged, retried once
HR007 correct_provenance_edge_type           [soft]
HR008 session_root_exists                    [hard]
HR009 singleton_policy_not_duplicated        [hard]   (also identity de-collision)
HR010 provenance_speaker_allowed_value       [hard]
HR011 provenance_confidence_allowed_value    [hard]
HR012 provenance_tracetext_not_generic       [hard]   ← the span rule
HR013 inferred_confidence_cites_multiple_ep  [soft]   ← relaxes span for "inferred"
HR014 decision_rule_has_rule_text            [hard]
HR015 operating_heuristic_has_heuristic_text [hard]
HR016 session_required_sections_covered      [soft]
HR017 no_duplicate_guest_persona             [soft]
HR018 no_duplicate_guest_signal              [soft]
HR019 singleton_checkin_policy_once          [soft]
HR020 singleton_checkout_policy_once         [soft]
HR021 service_failure_has_recovery_action    [advisory]
HR022 decision_rule_has_a_connection         [advisory]
HR023 loyalty_driver_linked                  [advisory]
HR024 minimum_knowledge_vertex_count         [advisory]
HR025 all_provenance_source_episodes_exist   [soft]
HR026 cross_turn_relationship_requires_witness [hard]  ← edge-witness rule
```

---

## 5. L2 — Extraction

**Files:** `lib/gate/prompt.ts` (contract → prompt views), `lib/domains.ts`
(domain judgement), `lib/server/extract-governed.ts` (the loop).

The extractor (gpt-4o-mini, temperature 0) is a *proposer*, not a writer. Three
generated prompt views, all from the contract, so the model is never told
something the gate will reject:

- **`schemaReference(domainId)`** — the vertex/edge inventory with required
  properties marked `!`. Gate-authored edges (provenance, `supersededBy`) are
  **omitted**, so the model is never invited to guess them.
- **`provenanceInstructions(domainId)`** — the grounding contract: which labels
  need evidence, that `traceText` must be the expert's own words (a span, not a
  summary, not the whole turn), the confidence vocabulary, the banned generic
  traces, the edge-relationship citation rule, the **assertion-only property**
  guard (derived from `propertyTypes`: set an optional boolean/integer only when
  the expert explicitly asserts that judgment), and the echo guard (agreement with
  the interviewer is not the expert's knowledge).
- **`extractionToolSchema(domainId)`** — the `emit_graph_delta` tool parameters.
  Crucially, `evidence` is a **required** field on every knowledge vertex (left
  optional, the model intermittently omits it and authors orphan evidence nodes
  instead) and an accepted field on every edge.

`knownEntitiesSummary(domainId, graph)` gives the model the current knowledge
vertices as ids "to reuse, never mint a second id for", capped so it never dwarfs
the schema reference.

**The loop** (`extract-governed.ts`): filler guard → deterministic scaffold → up
to three attempts, each `callExtractor → withScaffold → runGate`, keeping the
best-scoring attempt. Scoring subtracts `10 × (soft HR006 evidence gaps)` so a
smaller fully-grounded delta beats a larger flagged one. A **hard** rejection
echoes the gate's typed error back to the model (`retryFeedback`) with an
anti-invention instruction (corrections must correct, never add facts) and
triggers a retry; a purely **soft** evidence gap triggers exactly one grounding
retry. Every attempt — including the rejected ones — is recorded in the returned
`TurnGateReport` (`lib/types.ts`), which is what makes the download bundle able to
show *what went wrong*, not just what was admitted.

---

## 6. L3 — The gate: six constraint classes

**File:** `lib/gate/gate.ts` (`runGate`, `gate.ts:115`). This is the heart of the
system. `runGate(input, graph, domainId, options)` returns
`{ delta, findings, retryFeedback, supersessions }`. **Admission is per fact, not
per delta** — one bad edge does not discard a whole turn's knowledge (replaying an
earlier per-delta implementation, a single dangling edge cost 60.4% of admissible
facts; per-fact recovers 97.9%).

The pipeline order inside `runGate` is deliberate and load-bearing:

```
parse vertices/edges
  → (governed) resolveEntities        rewrite ids onto existing concepts  [§8]
  → materializeEvidence               turn inline evidence into vertices+edges [§7]
  → admit vertices  (per fact):
        drop extractor-authored ProvenanceEvidence (HR006 advisory)
        HR002 unknown label            → drop
        pick() properties to schema; HR001 required present → else drop
        admitEvidenceQuality           HR010/HR011/HR012/HR013  [§7]
        admitTextQuality               HR014/HR015
        admitSingleton                 HR009 + supersession      [§9]
        within-delta singleton dedup   HR009
  → admit edges  (per fact):
        HR003 unknown label            → drop
        HR005 dangling endpoint        → drop
        HR004 endpoint types           → drop
        HR026 cross-turn edge witness  → drop+retry if unwitnessed [§6.v]
        edge evidence span rule        → store traceText or flag
  → checkProvenanceAttachment          HR006/HR007 on survivors    [§7]
  → (deterministicIds) identity-consistency de-collision           [§8]
  → applyDeterministicIds              content-hash ids            [§8]
  → append supersededBy edges                                      [§9]
```

### (i) Typed-schema conformance — `hard`

Labels must be known (`HR002`/`HR003`); required properties present (`HR001`);
edge endpoints must match the schema (`HR004`), where an endpoint declaration may
be a single label *or an array* (one relation legitimately accepts many source
types — `supportedBy` attaches to all 16 knowledge classes that use it); no
dangling edges (`HR005`, endpoint must exist in this delta or the graph).
Properties are filtered to the declared set with `pick()` — an undeclared property
the model invents never persists. Violations are hard: drop the element, echo a
typed error, retry.

### (ii) Structural provenance + the span rule — `soft` coverage, `hard` quality

See §7. Every knowledge vertex must carry evidence (`HR006`, soft: admit flagged);
the evidence's `traceText` must be a verbatim span of the utterance and not
generic and not the whole turn (`HR012`, hard: drop the evidence, keep the fact
unprovenanced).

### (iii) Calibrated confidence — `hard` vocabulary, `soft` inferred tier

`confidence ∈ {high, medium, low, inferred}` from a closed vocabulary (`HR011`).
`inferred` marks cross-episode synthesis no single quote supports; it **relaxes
the span rule to an audit flag** (`HR013`) rather than a rejection, since
cross-turn synthesis is by definition not a span of the current turn. Speaker is
likewise a closed vocabulary (`HR010`) and is overwritten by the gate from the
turn context regardless of what the model supplied.

### (iv) Identity — resolution + content-derived ids + consistency

See §8. Near-duplicates resolve onto existing vertices; genuinely new facts get a
content-hash id; a reused id is protected only if it still names the *same
concept* (identity consistency).

### (v) Cross-turn edge witnesses — `HR026`, `hard`

`gate.ts:238`. An edge whose **both** endpoints are knowledge vertices that live
only in the graph — neither re-emitted this turn (`!deltaVertexIds.has(out) &&
!deltaVertexIds.has(in)`) — asserts a relationship the current utterance did not
visibly discuss. Such an edge must carry its own span-valid witness
(`item.evidence.traceText` passing `edgeTraceProblem`); otherwise it is dropped
and made retryable. An edge with a *freshly asserted* endpoint is exempt — the
endpoint's own evidence witnesses the turn. This closes the channel through which
relationships were minted from graph memory ("theft resolvedBy cigarette
response") with nothing in the utterance asserting them.

### (vi) Invalidate-not-delete supersession — `HR009`/`HR019`/`HR020`

See §9. A changed session-singleton supersedes its predecessor via an explicit
gate-authored `supersededBy` edge; the old fact stays in the graph.

**Graduated severity** runs through everything via `severityOf(contract, ruleId,
default, options)`: `hard` (reject; typed error; bounded retry), `soft` (admit,
warn, flag), `advisory` (report only). The value comes from the spec; a test
option can escalate (this is exactly the A4 vs A4-strict ablation — the same rule,
soft vs hard).

---

## 7. Provenance and grounding (the deep dive)

This is the system's reason to exist. Two properties are enforced: **provenance is
structural** (you cannot have an orphan or fabricated evidence node), and
**evidence is non-vacuous** (the trace must actually be something the expert said).

### 7.1 Evidence is materialized by the gate, not authored by the model

The extractor attaches evidence *inline* on the fact:

```jsonc
{ "id": "...", "label": "ServiceStandard",
  "properties": { "name": "Hot towel on arrival" },
  "evidence": { "traceText": "we hand every guest a hot towel", "confidence": "high" } }
```

`materializeEvidence` (`gate.ts:586`) turns that inline object into:

- a `ProvenanceEvidence` vertex (`id = evidence:<factId>`), with `sourceEpisode`
  and `speaker` **supplied by the gate from the turn context** — overwriting
  anything the model put there;
- the correct typed provenance edge, chosen from `provenanceEdgeByLabel`
  (`supportedBy` for ServiceStandard, `principleSupportedBy` for
  GuestExperiencePrinciple, `heuristicSupportedBy` for OperatingHeuristic, …).

Any `ProvenanceEvidence` vertex or provenance edge the *extractor* tries to emit
directly is **dropped** (`gate.ts:177`, HR006 advisory). Consequence: an
orphan-evidence node is unrepresentable, and the episode/speaker on every evidence
node is the gate's, not the model's. This is the "provenance by construction"
property — coverage went from the 2–5% measured when evidence was a node the model
had to *remember* to link, to 84.8–100% when it is carried inline and the gate
materializes it.

### 7.2 The span rule (anti-vacuity) — `admitEvidenceQuality`, `gate.ts:631`

For each materialized evidence node:

- `HR010` speaker ∈ vocabulary; `HR011` confidence ∈ vocabulary — hard.
- `HR012` the **span rule** (`traceSpecificity`, `gate.ts:690`): `traceText` must,
  after normalization, be a substring of the utterance; must not match a banned
  generic pattern ("the expert described their approach"); and must not restate
  the whole turn (rejected when it is ≥90% of a ≥20-word utterance — citing the
  entire turn identifies no particular claim). Hard: the evidence is dropped, the
  fact survives *unprovenanced* and is flagged.
- `HR013` if `confidence === "inferred"`, the span requirement is relaxed to an
  advisory flag — synthesis across turns is legitimately not a span of this one.

Edges get the same treatment: a knowledge-to-knowledge edge's inline evidence is
validated by `edgeTraceProblem` (`gate.ts:721`) and, if it passes, stored as
`traceText`/`confidence` **on the edge itself** (`gate.ts:259`), so relationships
carry their own citations.

### 7.3 Coverage attachment check — `checkProvenanceAttachment`, `gate.ts:786`

After admission, on what actually survived: every knowledge vertex must have a
provenance edge (`HR006`) of the correct type (`HR007`). This is *soft* per spec —
the fact is admitted and flagged, not dropped — which is why the pipeline spends
one soft retry trying to ground it. When a test escalates HR006 to hard (A4-strict),
ungrounded facts and anything hanging off them are removed from the delta
(`gate.ts:309`).

### 7.4 Property-level grounding

A subtler channel: a fact whose *core* claim is grounded can still carry optional
**property values the expert never stated** (booleans stamped `true`, invented
descriptions). Per-fact faithfulness misses this because the core is genuinely
supported. The mitigation is schema-derived, in `provenanceInstructions`: the
list of assertion-only boolean/integer properties is generated from
`propertyTypes`, with the instruction to set them only on explicit assertion. It
is prompt-enforced today (the gate could check it — a specified but not-yet-built
constraint class).

---

## 8. Identity (the deep dive)

**Goal:** the same concept is one vertex; distinct concepts are distinct vertices;
and — the lesson from live deployment — a graph that is 100% span-grounded can
still be *wrong* if identity mutates underneath its edges. Three mechanisms, in
`runGate` order:

### 8.1 Entity resolution — `resolveEntities`, `gate.ts:436` (runs first)

A proposed fact is merged onto an existing vertex when label matches and key text
matches. "Matches" is: exact after normalization, **or** `conceptOverlap ≥ 0.7`
(Jaccard over stopword-filtered tokens, with `tokensMatch` tolerating up to one
edit so "centred" ≈ "centered", "signal" ≈ "signals"), **or** `subsumedName`
(one name's token set is contained in the other, e.g. "body language" onto "Body
Language Cues"). Key text is chosen by `keyText` (`gate.ts:339`) — a preferred
property list, then first-string-property fallback — and, critically, resolution
keys only on **schema-declared** properties, so an undeclared property the gate
would later strip cannot block a merge. When a rewrite fires, every candidate and
edge id is rewritten to the canonical target *before* materialization and
admission, so evidence and edges follow the resolved id. Superseded vertices are
never resolution targets.

### 8.2 Content-derived ids — `applyDeterministicIds`, `gate.ts:510` (runs last)

A genuinely new fact receives `id = <label>:<fnv1a-16hex of label + normalized
declared properties>` (`contentHash`, `gate.ts:558`). Identical content collapses
onto one id regardless of the id the model happened to pick; different content
gets different ids. This makes re-extraction idempotent.

### 8.3 Identity consistency — the reused-id guard, `gate.ts:278`

The subtle one, added after the first live audit. Iteration-05 protected *any*
reused id from re-hashing. That let the extractor reuse an existing hash id for a
**different** concept, and last-write-wins merge relabeled the stored vertex —
"loyalty program" became "theft" — dragging every previously attached edge to the
wrong endpoint. The graph passed a perfect provenance audit and was materially
wrong: **grounding is not coherence.** Now a reused id keeps its identity only if
its content still names the same concept (`sameConceptName`, `gate.ts:418` — exact
/ overlap ≥ 0.7 / subset). If it names a different concept, it de-collides onto its
own content hash and the stored concept is left untouched (HR009 advisory,
`repaired`). Singletons are exempt (they have supersession instead). Within-delta
duplicates of a singleton label are also collapsed (`gate.ts:197`).

---

## 9. Supersession (invalidate-not-delete)

**File:** `admitSingleton`, `gate.ts:753`. Some labels are session-singletons
(`singletonLabels`, e.g. `CheckInPolicy`, `CheckOutPolicy`). When a new singleton
arrives whose content differs from the stored one (compared on pick-filtered
declared properties), the gate does **not** overwrite: it records a `Supersession`
and, at the end of `runGate` (`gate.ts:318`), writes an explicit
`<old>--supersededBy-->{new}` edge. The old fact stays in the graph, excluded from
resolution targets and from the extractor's known-entities summary and hidden in
the graph view. An *unchanged* restatement is a no-op (no supersession, no
contradiction). Belief revision is thus part of the recorded knowledge, not a
destructive edit. This is deliberately minimal (singletons only); full bi-temporal
validity over all knowledge is future work.

---

## 10. L6 — Evaluation and verification architecture

**Files:** `scripts/nesy_results/*`, `results/`.

The measurement architecture has one non-negotiable property: **the harness
imports the deployed gate.** `run_gated_ablation.mjs` calls `runGate` and the same
`lib/gate/prompt.ts` generators the product uses — there is no second gate
implementation to drift. (An early harness reimplemented the gate, enforced
spec-soft rules as hard, and reported the resulting 0/59 admission as a *finding*;
that is the mistake this rule exists to prevent.)

- **Conditions** — A0 ungated free-form; A1 constrained decoding; A2 +schema; A3
  +typed-error retry; A4 +provenance (soft, per spec); A4-strict (same rule, hard)
  — an ablation *of severity policy itself*; A5 the full deployed gate.
- **Stateless extraction** — a request depends only on the turn, attempt, and
  correction text, never on the condition, so attempt-1 proposals are identical
  across A1–A5 and fact-level pairing is valid. Per-session graph reset prevents
  cross-session contamination.
- **Metrics** — OC/SH/RH/OH (Text2KGBench), plus Provenance Coverage, Citation
  Correctness, Evidential Faithfulness, Usable-Faithful-per-turn (the headline;
  denominator is the interview turn, constant across conditions), Duplicate Rate,
  Yield, Cost. Every proportion carries exact counts and a Wilson interval;
  `UNMEASURED` is never a zero. Paired contrasts use exact McNemar over a per-turn
  contamination outcome.
- **Adjudication** — EF and citations judged by a model that never sees the
  condition (gpt-4o for the harness; a **cross-family** Claude judge for the live
  deployed-session audit, since a same-family judge could certify shared errors).
  Human labels are `UNMEASURED`; a blinded 119-row sample is prepared.
- **Live-session audit** — `derive_live_audit.mjs` → `aggregate_live_audit.mjs` →
  `results/live_session_audit.json`: deterministic checks (span rule, dupes) plus
  the cross-family judge over facts/edges.
- **The iteration record** — every methodological iteration is frozen in
  `results/iterations/iteration-NN.md` with an immutable
  `iteration-NN-metrics.json` snapshot *before work moves on*; negative results and
  non-replications are kept. `npm run test:results` fails if the current run is not
  the latest snapshot.
- **The claim verifier** — `verify_paper_claims.mjs` extracts every figure from
  the paper and fails CI unless it matches `results/metrics.json`, including
  required presence of the non-significance and non-replication statements. The
  paper cannot silently drift from the evidence.

---

## 11. L5 — The export / audit bundle

**Files:** `lib/export.ts`, `lib/audit.ts`.

One click on the download button (`exportSessionBundle`) produces four files under
one timestamp, the complete input set for analysis:

1. **`<stamp>.json`** — the session export (`chatgraph-session/v1`): transcript,
   per-turn admitted deltas **with their full gate reports**, the whole graph, a
   knowledge view giving each fact its evidence and relations, session stats, and
   the **build commit sha** (so a stale deployment is self-identifying in the
   data). Top-level `domainId` + `messages` keep it readable by the ablation
   harness — the same file is both corpus and analysis artifact.
2. **`<stamp>-transcript.txt`** — the conversation, human-readable.
3. **`<stamp>-audit.json`** — every fact and semantic edge with its trace and the
   1-based utterance index it was extracted from, derived by `lib/audit.ts`
   (`deriveAuditInput`) — the *same library* the CLI evaluation uses, so
   re-derivation reproduces the file. Attribution goes through the admitting turn
   record (collision-proof), not episode-id arithmetic (which once caused a
   spurious audit failure under concurrent voice turns).
4. **`<stamp>-gatelog.json`** — the "what went wrong" file: per turn, every
   extraction attempt with its findings including hard rejections that never
   reached the graph, plus an aggregate (findings by rule/severity/action, retry
   counts, proposed-vs-admitted totals).

The elicitation session is thereby **self-documenting**: continuous evaluation is
a property of the artifact, not a separate campaign.

---

## 12. File map (where everything lives)

```
lib/
  gate/
    contract.ts        L0  build the one GateContract from schema + spec; drift check
    gate.ts            L3  runGate — the six constraint classes, ~936 lines
    prompt.ts          L2  schemaReference / provenanceInstructions / tool schema
  domains.ts           L1  agent prompt, 7 interview sections, conduct rules, intros
  filler.ts            L2  isFillerTurn — shared by product AND harness
  realtime.ts          L1  OpenAI Realtime voice loop (WebRTC, client-owned responses)
  server/
    extract.ts         L2  dispatcher (hospitality → governed)
    extract-governed.ts L2 the attempt loop: filler → scaffold → extract → gate → retry
  audit.ts             L5  deriveAuditInput — shared browser/CLI audit derivation
  export.ts            L5  buildSessionExport, buildGateLog, exportSessionBundle
  types.ts             --  GraphState, TurnRecord, TurnGateReport, GateAttemptReport

app/
  page.tsx             --  session state, mergeDelta, turnRecords, download button
  api/chat/route.ts    --  parallel: interviewer question + governed extraction
  api/extract/route.ts --  extraction-only endpoint (voice path)
  api/realtime/token   --  ephemeral token; semantic_vad; create_response:false

components/
  GraphView.tsx        L4  D3 force layout; superseded hidden; evidence panel

src/main/json/
  hospitality.json     L0  the schema (hand-authored): 24 vertex, 33 edge
  medical.json         L0  generated from domains/medical/schema_build.py
hopitality files/
  validation rules.json L0 the 26 governance rules with severities
  provenance spec.json  L0 provenance edge mapping + span rule config

scripts/nesy_results/  L6  run_gated_ablation.mjs (imports the gate), build_results_
                           package.mjs, verify_paper_claims.mjs, validate_results.mjs,
                           derive_live_audit.mjs, aggregate_live_audit.mjs
results/               L6  metrics.json, live_session_audit.json, claims.md,
                           iterations/ (frozen per-iteration record + snapshots)

src/main/python/       --  legacy voice/Gremlin runtime; NOT invoked by the app
```

---

## 13. Design invariants (the things that must never break)

1. **One contract, generated.** No label, endpoint, severity, or vocabulary is
   ever restated by hand in a prompt or in code. Unbindable rules → drift →
   disabled + reported. `npm test` asserts drift is zero.
2. **The gate is the sole writer.** The extractor proposes; only `runGate`'s
   returned delta reaches the graph.
3. **Provenance is structural.** Evidence is materialized by the gate from an
   inline field; the model cannot author evidence nodes or provenance edges;
   episode and speaker are the gate's. Orphan evidence is unrepresentable.
4. **Severity comes from the spec, not the code.** `hard`/`soft`/`advisory` are
   read from `validation rules.json` via `severityOf`.
5. **Grounding is not coherence.** Span validity is necessary, not sufficient:
   identity consistency (§8.3) and edge witnesses (§6.v) guard the graph-level
   properties that per-fact grounding cannot.
6. **Admission is per fact.** One bad element never discards a turn's knowledge.
7. **The harness runs the deployed gate.** No second implementation; measured
   results are claims about the shipped system.
8. **Every measurement is frozen and every paper figure is machine-checked.**
   `results/iterations/` never rewrites history; `verify_paper_claims.mjs` fails
   CI on drift between the paper and `metrics.json`.
