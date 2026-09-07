# chatgraph

This is a voice-driven knowledge elicitation demo using [Hydra](https://github.com/CategoricalData/hydra)
and [TinkerPop](https://tinkerpop.apache.org/).
A subject speaks in their own
words about some topic in a specified *domain* with an LLM-driven assistant,
while a second LLM agent extracts a property
graph of what was said, vertex by vertex and edge by edge, into a live
graph database that you can watch update during the
conversation in a tool like [gdotv](https://www.gdotv.com/). The
architecture is domain-neutral: a domain is a self-contained subpackage
(schema + prompts + opening line), and three ship today — `medical`
(headache disorders), `aviation` (a pilot's own approach technique),
and `hospitality` (operator knowledge capture).

## Status

This demo rests on firm foundations — [Hydra](https://github.com/CategoricalData/hydra)
for typed property-graph schemas and transformations,
[Apache TinkerPop](https://tinkerpop.apache.org/) for the graph
database, and well-defined APIs (Anthropic, Deepgram, OpenAI) for the
LLM and voice pieces. The application code that stitches these
together, however, was largely vibe-coded with Claude and is intended
for demonstration purposes. It has not been hardened for production
use and is not guaranteed to perform predictably under load, in
adversarial conditions, or with real user data. Treat it as a working
sketch of what an elicitation loop can look like, not as a deployable
system.

## Software overview

chatgraph is a single Python process with three orchestrated layers and
one external graph server. Everything is asyncio; live audio is handled
on dedicated worker threads bridged into the event loop.

- **Voice loop.** A microphone capture task feeds 16 kHz mono PCM into
  two consumers: a local
  [Silero VAD](https://github.com/snakers4/silero-vad) for fast
  (~tens-of-ms) detection that the patient has started speaking again
  during agent playback (barge-in), and a
  [Deepgram Flux](https://developers.deepgram.com/docs/flux) streaming
  WebSocket connection for transcription with built-in conversational
  turn detection (`StartOfTurn` / `Update` / `EagerEndOfTurn` /
  `TurnResumed` / `EndOfTurn`). The agent's voice is rendered by
  [OpenAI `tts-1`](https://platform.openai.com/docs/guides/text-to-speech)
  streamed through a worker thread into the default speaker.

- **Conversational agent.** Each finalized patient turn (Flux's
  `EndOfTurn`) is appended to the rolling conversation and sent to
  [Claude Sonnet](https://www.anthropic.com/claude/sonnet) (default
  `claude-sonnet-4-6`) with a clinician-style system prompt that is
  schema-aware and explicitly *not* claiming to be an actual physician.
  Sonnet's reply is streamed token-by-token and synthesized by TTS as it
  arrives. Eager generation begins on Flux's `EagerEndOfTurn` and is
  cancelled on `TurnResumed` for lower perceived latency.

- **Graph extractor.** In parallel with the agent reply, each patient
  turn is sent to
  [Claude Haiku](https://www.anthropic.com/claude/haiku) (default
  `claude-haiku-4-5-20251001`) using
  [tool-use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
  with a strict JSON schema mirroring the headache GraphSchema. The
  extractor emits a delta of new vertices and edges with deterministic
  ids so re-extractions don't duplicate vertices. The delta is written
  through a single-consumer queue into a local
  [Apache TinkerPop Gremlin Server](https://tinkerpop.apache.org/)
  via [gremlinpython](https://pypi.org/project/gremlinpython/). Writes
  are serialized so concurrent extractions can't race their edges past
  each other's vertices.

- **Incremental graph validation.** Before each delta is written, it is
  validated against the domain's typed Hydra `GraphSchema`
  (`chatgraph.chat.validation.validate_delta`). The check catches
  literal-type mismatches, missing required properties, and unknown
  labels that the tool-spec enum and the materializer's allow-lists let
  through (e.g. a property declared `int32` in the schema arriving as a
  string). If validation fails, the typed error is echoed back to Claude
  Haiku as a `tool_result` and the extractor is asked to correct its
  output; the call retries up to three attempts total. After three
  consecutive failures the utterance's delta is dropped (logged but not
  written), and the conversation continues uninterrupted.

  The subtlety is that a delta is a *partial* graph: its edges routinely
  point at vertices that live only in the graph from earlier turns — the
  `Person` root that every `reports` edge starts from, a `Headache`
  named two turns ago, a shared trigger bucket. Hydra's
  `validate_graph` resolves every edge endpoint against the single graph
  it is handed, so validating a delta on its own rejects all of those
  edges as dangling (`OutVertexNotFound`). To validate incrementally, we
  keep an `id → label` cache of every vertex believed to be in the live
  graph — seeded once from the graph at session start (including the
  `Person` root) and grown as each validated delta is written — and
  resolve edge endpoints against the delta *plus* that cache. Endpoint
  checks are label-only (an edge type pins its `(out-label, in-label)`
  pair), so the cache needs labels, not full vertices; an id in neither
  the delta nor the cache is a genuine dangling reference and is still
  reported. See `src/main/python/chatgraph/chat/validation.py` for the
  full rationale, including why the known vertices can't simply be merged
  into the delta before calling `validate_graph`.

- **Schema / typed property graph.** The schema is a
  [Hydra](https://github.com/CategoricalData/hydra) `GraphSchema`.
  Hydra is a functional, polyglot data-modeling language for type-aware
  graphs; we use it because it gives us a single Python-DSL definition
  of the domain that round-trips through a canonical JSON
  representation, follows stable naming conventions (vertex labels
  PascalCase, edge labels camelCase, properties on both), and pins
  every edge's `(out-label, in-label)` so we can validate the live
  graph against the schema. The Hydra runtime itself (`hydra-kernel`,
  `hydra-pg`) is a regular PyPI dependency; schemas are authored
  offline using `hydra.pg.model` types, serialized via Hydra's JSON
  coder, and committed (`src/main/json/medical.json`).

  That committed JSON is the **single source of truth for the schema**.
  Everything the runtime needs is derived from it programmatically: the
  extractor's tool-use spec, its label/property allow-lists, and the
  schema-reference table appended to the LLM's prompt are all generated
  from the JSON at startup (no LLM in that generation step), so a schema
  change flows through without any hand-mirroring. The prose walkthrough
  in `docs/medical-schema.md` is **for humans only** — it is loaded by no
  code, and if it ever disagrees with the JSON, the JSON wins. Hydra's
  Python overlay provides the Hydra ↔ TinkerPop bridge
  (`hydra.overlay.python.tinkerpop.coder`: `gremlin_to_hydra` for
  reading the live graph back into Hydra values, `hydra_to_gremlin` for
  writing a `hydra.pg.model.Graph` delta into Gremlin Server).

- **Persistence and resume.** TinkerPop's Gremlin Server is the only
  persistent store (everything else is per-process). On startup the
  graph is read back; if non-empty, the agent uses a doctor-like resume
  greeting generated from a summary of what's already known. `--fresh`
  drops everything before starting.

External services and processes:

- Local: Gremlin Server on `ws://localhost:8182/gremlin` (in-process
  TinkerGraph, string ids). gdotv reads from the same endpoint.
- Cloud: Anthropic API (Sonnet + Haiku), Deepgram Flux (STT), OpenAI
  (TTS). All three keys are required.

## Prerequisites

- Python 3.12+ (the venv is built with 3.13 and works).
- No source-level dependencies: the Hydra runtime (`hydra-kernel`,
  `hydra-pg` 0.17.1, including the Hydra ↔ TinkerPop bridge in its
  Python overlay) is pulled from PyPI by `pyproject.toml`.
- A local install of [Apache TinkerPop Gremlin Server](https://tinkerpop.apache.org/downloads.html)
  (3.7.3 tested). The bundled config files in `config/gremlin/` start an empty
  TinkerGraph with `vertexIdManager=ANY` and a registered `g` traversal
  source.
- A working microphone and speakers. On macOS, your terminal needs
  Microphone permission (System Settings → Privacy & Security →
  Microphone).

## Accounts and services

Running the demo end-to-end touches three cloud APIs and (optionally)
one desktop tool. All four are commercial products; the demo cannot
run with the LLM, STT, and TTS pieces stubbed out.

- **Anthropic** ([console.anthropic.com](https://console.anthropic.com))
  — powers both the conversational agent (Claude Sonnet) and the graph
  extractor (Claude Haiku). Set `ANTHROPIC_API_KEY`. Use the API
  console, **not** Claude Max — those are separate products and the
  Max subscription does not grant API access.

- **Deepgram** ([deepgram.com](https://deepgram.com)) — streaming
  speech-to-text via the Flux model. Set `DEEPGRAM_API_KEY`. New
  accounts get $200 of trial credit; confirm your account has Flux
  access (it is gated on some account tiers).

- **OpenAI** ([platform.openai.com](https://platform.openai.com)) —
  streaming text-to-speech (`tts-1` / `gpt-4o-mini-tts`). Set
  `OPENAI_API_KEY`. Use the API platform, **not** ChatGPT Plus —
  separate products. Anthropic has no TTS API, so a second vendor is
  needed for the voice output side. ~$5 of credits covers thousands
  of demo runs.

- **gdotv** ([gdotv.com](https://gdotv.com)) — optional desktop
  viewer that connects to Gremlin Server at `ws://localhost:8182/gremlin`
  and lets you watch the graph populate as the interview progresses.
  Not required to run the demo (the graph still builds inside Gremlin
  Server either way), and not configured in this repo. gdotv is a
  commercial product with a time-limited free trial followed by paid
  tiers; see [gdotv.com/buy](https://gdotv.com/buy/) for current
  pricing. Any TinkerPop-compatible viewer works as a substitute.

## One-time setup

From the repository root:

```bash
# 1. Create the venv and install deps.
python3.12 -m venv .venv          # or python3.13
source .venv/bin/activate
pip install -e .

# 2. Configure API keys.
cp .env.example .env
$EDITOR .env                       # fill in the three API keys
```

## Start Gremlin Server

In a separate terminal, install the configs into
`$GREMLIN_SERVER_HOME/conf/` and launch:

```bash
export GREMLIN_SERVER_HOME=/path/to/apache-tinkerpop-gremlin-server-3.7.3
cp config/gremlin/chatgraph-gremlin-server.yaml \
   config/gremlin/chatgraph-tinkergraph.properties \
   config/gremlin/chatgraph-init.groovy \
   "$GREMLIN_SERVER_HOME/conf/"
"$GREMLIN_SERVER_HOME/bin/gremlin-server.sh" "$GREMLIN_SERVER_HOME/conf/chatgraph-gremlin-server.yaml"
```

The boot log should show `A GraphTraversalSource is now bound to [g]`
and `Channel started at port 8182.`. Leave it running. See
`docs/gremlin-setup.md` for more.

## Domains

A *domain* bundles the four things that need to vary together for a
different topic of interview: a typed property-graph schema, the
agent's system prompt, the domain-flavoured intro to the extractor's
system prompt, and the opening line spoken on a fresh session. Each
domain lives under `src/main/python/chatgraph/domains/<name>/`.

Currently shipped:

- **`medical`** — doctor-like interview about headache disorders.
  Covers ICHD-3 classification, attack phases, triggers, alleviating
  factors, red flags, family history, and functional impact. See
  `docs/medical-schema.md` for a written walkthrough of the clinical model.
- **`aviation`** — interview with a pilot about how they personally fly
  a specific, demanding approach: site-specific hazards, personal
  minimums, abort rules, techniques, and the perceptual cues behind
  them. See `docs/aviation-domain-background.md`. The record is one
  pilot's practice, not guidance for others.
- **`hospitality`** — knowledge capture from a hospitality operator:
  service standards, timing rules, decision rules, operating
  heuristics, and the evidence behind them. Contributed with the web
  application; the schema was regenerated through `schema_build.py`
  to match the current encoding.

The first positional argument to `chatgraph` selects the domain.

### Adding a new domain

Create `src/main/python/chatgraph/domains/<name>/` containing:

1. `schema_build.py` — authors a `hydra.pg.model.GraphSchema` and
   writes it to `src/main/json/<name>.json`.
2. `agent_prompt.py` — module-level `OPENING_LINE` string and
   `SYSTEM_PROMPT` string for the conversational agent.
3. `extractor_prompt.py` — module-level `EXTRACTOR_PROMPT_INTRO`
   string. The extractor appends a schema-reference table
   automatically; this string should cover the interview context,
   vertex/edge conventions specific to your model, and id rules.
4. `__init__.py` — exposes a module-level `DOMAIN: Domain` instance
   and calls `register(DOMAIN)` to add itself to the registry.

Then add `from chatgraph.domains import <name>` to
`chatgraph/domains/__init__.py::_register_all`. Run
`chatgraph-build-schema <name>` to produce the committed schema JSON;
then `chatgraph <name>` to run the demo.

## Build the schema (offline, one-time per domain)

```bash
chatgraph-build-schema medical    # build the medical domain's schema
chatgraph-build-schema            # build every registered domain
```

Writes `src/main/json/<domain>.json`. The JSON is committed; re-running
regenerates it byte-identically unless you've edited the domain's
`schema_build.py`.

`schema_build.py` is just a convenience authoring tool — a readable
Python way to produce the JSON — not something the runtime loads. The
committed JSON is the source of truth; once a schema is finalized,
`schema_build.py` could be discarded and the JSON would stand on its
own. Until then, edit the schema there and regenerate; never hand-edit
the JSON.

## Verify the stack

```bash
python bin/diagnose.py
```

Should report `[OK]` for env vars, sound device, Gremlin Server,
Deepgram, Anthropic, and OpenAI TTS.

## Run the smoke test

```bash
pip install -e ".[dev]"   # one-time: pytest + ruff + pyright
pytest src/test/python/chatgraph/test_extractor_smoke.py -v -s
```

The smoke test calls Claude Haiku for real and costs a few cents per
run. It requires `ANTHROPIC_API_KEY` in the
environment. The test asserts that one rich utterance yields the
expected vertex and edge labels in the extracted delta.

## Run the demo

```bash
chatgraph medical            # resume from prior session if any
chatgraph medical --fresh    # drop the prior graph and start over
chatgraph medical -v         # add INFO logs (per-turn extractor / TTS / STT)
chatgraph medical -vv        # add DEBUG logs (per-audio-chunk, WebSocket frames)
```

A fresh `medical` session opens with the agent saying:

> Hello. Please tell me what's been bothering you, health-wise.

Speak naturally. When you pause, the agent will respond. The agent
constrains follow-up to dimensions the schema can capture; if you
volunteer something outside scope, it acknowledges but doesn't probe.
Telling the agent you're done ("that's all", "let's stop", etc.) flips
it into acknowledge-only mode; resuming substantive content flips it
back.

Press **Ctrl-C** to end the session. Each session writes three files
under `transcripts/`, sharing one timestamp:

```
Transcript: transcripts/20260515-074011.txt
            transcripts/20260515-074011.jsonl
Log:        transcripts/20260515-074011.log
```

- `.txt` — human-readable, `speaker: text` paragraphs, agent turns
  marked `[interrupted]` if they were cut short.
- `.jsonl` — one utterance per line with `ts_start` / `ts_end` /
  `interrupted` fields. Suitable for downstream tooling.
- `.log` — the raw diagnostic log for the session (everything at DEBUG
  and up, plain text, no color codes), regardless of the console
  verbosity set by `-v` / `-vv`. The `.txt` and `.jsonl` stay clean
  conversation transcripts; operational detail and any errors — e.g. the
  extractor's per-utterance validation failures — go here instead, so
  they're captured durably rather than only scrolling past on screen.

The three files are always written; the paths above are printed on a
clean exit. Ending with Ctrl-C closes and flushes all three (the data is
safe) but skips the closing printout — the files are in `transcripts/`
under the session timestamp regardless.

The Gremlin graph keeps accumulating across sessions until you pass
`--fresh`. Connect a viewer like gdotv to `ws://localhost:8182/gremlin`
and refresh during the conversation to watch the graph grow.

## Configuration knobs

Environment variables (in `.env` or your shell):

| Variable | Default | Meaning |
|---|---|---|
| `CHATGRAPH_AGENT_MODEL` | `claude-sonnet-4-6` | Claude model id for the interviewer. |
| `CHATGRAPH_EXTRACTOR_MODEL` | `claude-haiku-4-5-20251001` | Claude model id for the extractor. |
| `CHATGRAPH_TTS_VOICE` | `nova` | OpenAI TTS voice (e.g. `alloy` / `echo` / `nova` / `shimmer` / `verse`). `tts-1` accepts the classic six; `gpt-4o-mini-tts` adds more. |
| `CHATGRAPH_TTS_SPEED` | `1.15` | Speech-rate multiplier for OpenAI TTS (`0.25`–`4.0`; `1.0` is normal pace). The default is slightly brisk; raise toward `1.3` for a punchier demo, lower toward `1.0` for a calmer read. Out-of-range values are clamped. |
| `CHATGRAPH_LOG_LEVEL` | (unset) | Overrides the `-v` / `-vv` flags. Set to `INFO` or `DEBUG` if you want. |

If the agent jumps in too eagerly when you pause to think, the
Deepgram Flux API supports `eot_threshold` and `eot_timeout_ms`
parameters that gate the `EagerEndOfTurn` and `EndOfTurn` events.
They are not currently wired up in `src/main/python/chatgraph/chat/stt.py`
(the `connect()` call only passes `model`, `encoding`, and
`sample_rate`); adding them is the smallest change that would expose
this control to the user.

## Project layout

```
chatgraph/
  bin/
    diagnose.py                  # one-shot health check of all dependencies
  config/
    gremlin/
      chatgraph-gremlin-server.yaml    # server config
      chatgraph-tinkergraph.properties # in-memory graph properties
      chatgraph-init.groovy            # registers the `g` traversal source
  docs/
    medical-schema.md            # clinician-readable walkthrough of the medical schema
    gremlin-setup.md             # detailed Gremlin Server install/connect notes
  src/
    main/
      json/
        medical.json             # committed schema JSON for the medical domain
        aviation.json            # ... for the aviation domain
        hospitality.json         # ... for the hospitality domain
      python/chatgraph/
        domains/
          __init__.py            # Domain dataclass + REGISTRY
          medical/               # the medical (headache) domain
            __init__.py          # exposes DOMAIN; registers itself
            schema_build.py      # builds src/main/json/medical.json via chatgraph.schema.pgdsl
            agent_prompt.py      # OPENING_LINE + SYSTEM_PROMPT for the agent
            extractor_prompt.py  # EXTRACTOR_PROMPT_INTRO for the extractor
          aviation/              # the aviation (backcountry landing) domain
          hospitality/           # the hospitality knowledge-capture domain
        schema/
          build.py               # CLI dispatcher: chatgraph-build-schema <domain>
          pgdsl.py               # fluent sugar over Hydra's PG DSL + JSON coder
        chat/
          audio.py               # mic + speaker + Silero VAD; cancellable playback
          stt.py                 # Deepgram Flux v2 socket wrapper (async over sync recv)
          tts.py                 # OpenAI TTS streaming (sync client on worker thread)
          agent.py               # Claude Sonnet streaming, domain-agnostic
          extractor.py           # Claude Haiku per-utterance delta; bound to a domain
          graph_writer.py        # GremlinWriter: serialized write queue, load_graph, drop_all
          transcript.py          # .txt + .jsonl + .log writer (append-only, flush-per-write)
          main.py                # Coordinator + CLI; domain positional + --fresh / -v / -vv
    test/python/chatgraph/
      test_extractor_smoke.py    # end-to-end extractor smoke test (costs cents)
  web/                           # a SEPARATE browser application (see below)
    app/                         # Next.js routes and API handlers
    components/GraphView.tsx     # force-directed live graph view
    lib/                         # TypeScript agent, extractor, schema reader
    package.json                 # web-only dependencies; not part of the Python build
  pyproject.toml
  .env.example
```

The `src/main/python/<package>` and `src/test/python/<package>` layout
matches the convention used across Hydra-family projects (Hydra, the
Hydra Python dist packages).

## Two applications in one repository

This repository currently holds **two distinct applications** that share
a repository and a schema, but not a codebase:

| | Python application | Web application |
|---|---|---|
| Location | `src/main/python/`, `bin/`, `config/` | `web/` |
| Author | Joshua Shinavier | Yawar Sayeed |
| Interface | terminal, voice-driven | browser, voice + typed |
| Agent / extractor | Claude, in Python | Claude + OpenAI Realtime, in TypeScript |
| Schema handling | Hydra (`hydra-kernel`, `hydra-pg`) | hand-written TypeScript reader |
| Validation | `hydra.validate.pg` | none equivalent |
| Graph storage | live TinkerPop Gremlin Server | browser IndexedDB |

The Python application is the primary one: it is where the Hydra work
lands and what the current demos are built on. The web application is a
browser prototype whose **user experience** may in time supersede the
terminal interface.

The important caveat is that `web/` is **not a client of the Python
backend**. It reimplements the agent, the extractor, and the schema
reader in TypeScript, and talks to no Gremlin Server. The two
applications are coupled only through the committed schema JSON in
`src/main/json/`, which both read. Everything else — prompts, extraction
logic, validation, persistence — exists twice, in two languages, and
must be kept in step by hand.

### How this came about

The web application began as a *copy* of this repository (at commit
`d74eb43`, 2026-06-03) rather than a branch or a fork, so its original
history did not build on this one. It has since been reconstructed on
top of the real history: its commits were replayed onto their true fork
point with their original authorship and dates intact, then rebased
forward. Yawar's work lives under `web/` and is attributed to him in the
commit log; the Python tree is unchanged by the import.

Two things were repaired in the process, both in follow-up commits:
the hospitality schema was regenerated through `schema_build.py` (it had
been hand-written in the pre-0.17.1 `@key`/`@value` encoding, which the
current runtime cannot read), and the web app's schema reader was taught
the current `key`/`value` encoding.

### Next steps: alignment

The duplication above is a maintenance liability, not a design. The
options for removing it, roughly in order of increasing ambition:

1. **Share the schema properly.** Already partly done — both sides read
   `src/main/json/`. The web reader should consume Hydra's own encoding
   rather than pattern-matching JSON shapes.
2. **Adopt Hydra-TypeScript in `web/`.** Hydra publishes TypeScript
   packages to npm. If they cover the property-graph DSL and the
   validation surface the Python side depends on, the web application
   could use the *same* schema and validation primitives instead of
   reimplementing them — keeping both sides aligned by construction
   rather than by discipline.
3. **Make `web/` a thin client.** Expose the Python agent, extractor,
   validation, and Gremlin persistence over an API, and let the browser
   supply only the interface. This keeps one implementation of the
   logic, at the cost of requiring a running backend.

Options 2 and 3 are not mutually exclusive: a thin client still benefits
from typed schemas on the browser side. The choice turns on whether the
extraction logic should live in one language or two, and that is worth
deciding deliberately rather than by accretion.

## Troubleshooting

**`ANTHROPIC_API_KEY is not set`** — fill in `.env` or export the key.

**Silence on first run, no transcription** — on macOS the terminal app
needs Microphone permission.

**The agent's voice plays but cuts out mid-sentence** — that's
self-cancellation from VAD picking up speaker bleed-back. The
orchestrator gates VAD off during agent playback by default; if you
disabled that, restore it in `chat/main.py`.

**`addE(...) failed because the to() traversal ... does not map to a value`**
on the first run — a previous-session Headache vertex is missing. Pass
`--fresh` or accept the stub-vertex fallback (the bridge creates a
placeholder so the edge still lands).

**Long delay before the opening greeting** — OpenAI's first TTS
request on a fresh connection can take 20–30s. `chatgraph` calls a
warmup request before the listening banner; if you still see a long
gap, OpenAI's TTS endpoint is having a slow moment. Setting
`CHATGRAPH_TTS_VOICE` to a `tts-1` voice (e.g. `nova`, `echo`) usually
gives the most consistent latency.

**Gremlin Server `499 the traversal source [g] ... is not configured`**
— start the server with the bundled `chatgraph-gremlin-server.yaml`
config (it loads `chatgraph-init.groovy` which registers `g`).

**`KeyError` on `claude-sonnet-4-6` / `claude-haiku-4-5-...`** — model
ids changed. Set `CHATGRAPH_AGENT_MODEL` / `CHATGRAPH_EXTRACTOR_MODEL`
to the current ids.
