"""Per-utterance property-graph extractor.

Calls Claude Haiku 4.5 with the patient's latest utterance plus a rolling
window of prior turns, and asks it to emit a small delta of new vertices
and edges that match the headache GraphSchema. The delta is materialised
as ``hydra.pg.model.Vertex`` and ``Edge`` values with deterministic ids
so re-extractions don't duplicate vocabulary items in the live graph.

The allow-lists of vertex and edge labels are derived from the committed
``src/main/json/medical.json`` at import time, so the extractor stays
in sync with whatever the schema currently looks like without manual
mirroring.

Vertex id strategy
------------------
- Vocabulary vertices with a ``value`` (e.g. ``IngestedTrigger``,
  ``Quality``, ``BodyLocation``, ``Severity``, ``Frequency``, ``Age``):
  ``"{label}:{value-or-slug}"``. The same concept across utterances
  reduces to a single vertex.
- Bare-label vertex types with no payload (concrete symptoms like
  ``Nausea``, ``LightSensitivity``, autonomic features, aura subtypes,
  red flags, prodromal symptoms): the id is just the label, since the
  label IS the meaning.
- ``Headache``: ``"Headache:{slug}"`` minted on first introduction of a
  named pattern. The orchestrator threads the id back into
  ``RollingContext.known_headaches`` so subsequent calls reuse it.
- Per-headache buckets (``HeadacheTriggers``, ``AlleviatingFactors``,
  ``Prodrome``, ``Aura``, ``Postdrome``, ``PainCharacter``): one bucket
  per Headache, id pattern ``"{type}:{headache-suffix}"``.
- ``Comment``: a fresh uuid-like id each time.
- ``Concept`` (reification indirection for Comment edges): ``"c:" +
  underlying_vocab_id`` so the same underlying vocabulary item shares
  one Concept indirection.

Edge ids are deterministic: ``"{out_id}-{label}->{in_id}"``.

Validation loop
---------------
Each materialised delta is validated against the domain's typed
``hydra.pg.model.GraphSchema`` (loaded once at construction) via
``chatgraph.chat.validation.validate_delta``. On failure the typed
error is echoed back to Claude Haiku as a ``tool_result`` and the
call is retried, up to ``MAX_EXTRACTION_ATTEMPTS`` total attempts.
After exhausting the budget the utterance's delta is dropped (logged
but not written) and the conversation continues.

A delta's edges usually reference vertices in the *live* graph from
prior turns (most notably the ``Person`` root that every ``reports``
edge points out of). Validation resolves those endpoints against
``RollingContext.vertex_labels`` -- an id->label cache seeded from the
live graph at session start and grown as each validated delta is
written -- so cross-graph edges validate (by label) instead of being
falsely rejected as dangling. See ``chatgraph.chat.validation`` for the
full rationale.

Failures (API errors, malformed extractions, exhausted retries) are
logged and swallowed -- the conversation never blocks on the graph.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import anthropic
import hydra.core as core
import hydra.pg.model as pg
from hydra.overlay.python.dsl.python import FrozenDict

if TYPE_CHECKING:
    from chatgraph.domains import Domain

log = logging.getLogger(__name__)


DEFAULT_MODEL = "claude-haiku-4-5-20251001"

# Max number of extraction attempts per utterance, counting the initial
# attempt. With ``MAX_EXTRACTION_ATTEMPTS = 3``, the extractor tries
# once and then up to two corrective retries if validation fails before
# giving up and dropping the utterance's delta.
MAX_EXTRACTION_ATTEMPTS = 3

def _allowlists_from_schema(schema: dict) -> tuple[
    dict[str, set[str]],
    dict[str, tuple[str, str]],
    dict[str, set[str]],
    tuple[str, ...],
]:
    """Derive (allowed_vertex_props, allowed_edges, allowed_edge_props,
    vocabulary_labels) from a parsed schema-JSON dict.

    Reading the schema as the source of truth eliminates the drift class
    where the schema gains a new label or property but the extractor
    still drops it as "unknown".
    """
    allowed_vertex_props: dict[str, set[str]] = {}
    for entry in schema["vertices"]:
        label = entry["key"]
        props = {p["key"] for p in entry["value"].get("properties", [])}
        allowed_vertex_props[label] = props

    allowed_edges: dict[str, tuple[str, str]] = {}
    allowed_edge_props: dict[str, set[str]] = {}
    for entry in schema["edges"]:
        label = entry["key"]
        v = entry["value"]
        allowed_edges[label] = (v["out"], v["in"])
        allowed_edge_props[label] = {p["key"] for p in v.get("properties", [])}

    vocabulary = tuple(
        label for label in allowed_vertex_props if label not in {"Comment", "Concept"}
    )
    return allowed_vertex_props, allowed_edges, allowed_edge_props, vocabulary


def _literal_type_name(value) -> str:
    """Render a property's JSON literal-type node as a short string.

    Hydra encodes a simple literal type as a bare string (``"string"``,
    ``"boolean"``) and a parameterized one as a single-key dict
    (``{"integer": "int32"}`` -> ``"int32"``). Returns the innermost
    name so the prompt shows the model exactly what JSON scalar a
    property expects (the chief cause of validation retries is emitting
    the wrong scalar type).
    """
    node = value
    name = "?"
    # Walk down single-key wrapper dicts to the most specific name.
    while isinstance(node, dict) and node:
        name = next(iter(node))
        node = node[name]
    return node if isinstance(node, str) else name


def _prop_types_from_schema(
    schema: dict,
) -> dict[str, dict[str, tuple[str, bool]]]:
    """Map ``element-label -> {prop-key: (type-name, required)}`` for both
    vertices and edges, derived from the same parsed schema JSON used by
    ``_allowlists_from_schema``.

    Used only to annotate the prompt's schema reference with literal
    types and required-ness; the allow-list/membership logic still uses
    the plain property-name sets, so this carries no risk to the
    materializer or tool spec.
    """
    out: dict[str, dict[str, tuple[str, bool]]] = {}
    for section in ("vertices", "edges"):
        for entry in schema[section]:
            label = entry["key"]
            detail: dict[str, tuple[str, bool]] = {}
            for p in entry["value"].get("properties", []):
                detail[p["key"]] = (
                    _literal_type_name(p.get("value", {})),
                    bool(p.get("required", False)),
                )
            out[label] = detail
    return out


_SIMPLE_LITERAL_TYPES = {
    "binary": core.LiteralTypeBinary,
    "boolean": core.LiteralTypeBoolean,
    "string": core.LiteralTypeString,
}

_INTEGER_TYPES = {t.name.lower(): t for t in core.IntegerType}
_FLOAT_TYPES = {t.name.lower(): t for t in core.FloatType}


def _decode_literal_type(value) -> core.LiteralType:
    """Decode a JSON literal-type node into a ``hydra.core.LiteralType``.

    Inverse of ``hydra.encode.core.literal_type``: a simple type is a
    bare string (``"string"``), a parameterized one a single-key dict
    (``{"integer": "int32"}``). Hydra's own decoder wants a term-level
    graph context we have no use for here, so we read the JSON the
    schema already gives us.
    """
    if isinstance(value, str):
        ctor = _SIMPLE_LITERAL_TYPES.get(value)
        if ctor is None:
            raise ValueError(f"Unknown literal type: {value!r}")
        return ctor()
    if isinstance(value, dict) and len(value) == 1:
        tag, arg = next(iter(value.items()))
        if tag == "integer":
            return core.LiteralTypeInteger(_INTEGER_TYPES[arg])
        if tag == "float":
            return core.LiteralTypeFloat(_FLOAT_TYPES[arg])
    raise ValueError(f"Unknown literal type: {value!r}")


def _decode_property_type(p: dict) -> pg.PropertyType:
    return pg.PropertyType(
        key=pg.PropertyKey(p["key"]),
        value=_decode_literal_type(p["value"]),
        required=bool(p.get("required", False)),
    )


def _decode_graph_schema(schema: dict) -> pg.GraphSchema:
    """Decode the committed schema JSON into a ``pg.GraphSchema``.

    The JSON is the single source of truth (see CLAUDE.md); this is the
    typed view of it that ``validate_delta`` checks each delta against.
    Maps are encoded as lists of ``{"key": ..., "value": ...}`` entries.
    """
    vertices = {}
    for entry in schema["vertices"]:
        v = entry["value"]
        label = pg.VertexLabel(entry["key"])
        vertices[label] = pg.VertexType(
            label=label,
            id=_decode_literal_type(v["id"]),
            properties=[
                _decode_property_type(p) for p in v.get("properties", [])
            ],
        )

    edges = {}
    for entry in schema["edges"]:
        e = entry["value"]
        label = pg.EdgeLabel(entry["key"])
        edges[label] = pg.EdgeType(
            label=label,
            id=_decode_literal_type(e["id"]),
            out=pg.VertexLabel(e["out"]),
            in_=pg.VertexLabel(e["in"]),
            properties=[
                _decode_property_type(p) for p in e.get("properties", [])
            ],
        )

    return pg.GraphSchema(vertices=vertices, edges=edges)


@dataclass
class RollingContext:
    """Short conversational context for the extractor.

    Carries the last few turns (for anaphora resolution) plus the set of
    Headache patterns the patient has already named, so the extractor
    can reuse those ids instead of inventing a fresh Headache vertex on
    each utterance.
    """

    window: deque = field(default_factory=lambda: deque(maxlen=4))
    # The id of the Person vertex representing the patient. Set at
    # session start (either by creating a fresh Person or discovering
    # the existing one in the graph). Every Headache the extractor mints
    # should be connected to this Person via a `reports` edge.
    person_id: str | None = None
    # Known Headache patterns: id -> short natural-language label
    # ("daily", "acute", "morning", ...). The extractor is asked to reuse
    # an existing id when an utterance is about a previously-named
    # pattern, and to mint a fresh id ONLY when the patient introduces a
    # genuinely new pattern.
    known_headaches: dict = field(default_factory=dict)
    # Convenience pointer to the most recently discussed Headache id; the
    # extractor still gets this as a default when the utterance is
    # ambiguous about which pattern is meant.
    current_headache_id: str | None = None
    # True after the patient has signaled they're done. Flips back to
    # False if the patient resumes substantive content.
    session_done: bool = False
    # Known per-Headache "bucket" vertices: maps bucket vertex label
    # (HeadacheTriggers, AlleviatingFactors, Prodrome, Aura, Postdrome,
    # PainCharacter) to a dict of {bucket_id: {headache_id, ...}}. When
    # the patient says "the triggers are the same across patterns" the
    # extractor should emit a `triggers` edge from BOTH Headaches to the
    # SAME bucket vertex rather than creating parallel buckets.
    known_buckets: dict = field(default_factory=dict)
    # Vertex id -> vertex-label string for every vertex believed to exist
    # in the live graph: seeded once from the graph at session start
    # (incl. the Person root) and grown as each validated delta is
    # written. Used by validate_delta to resolve edge endpoints that
    # reference live-graph vertices (e.g. the `reports` edge out of the
    # Person root) without falsely rejecting them as dangling. See
    # chatgraph.chat.validation for the full rationale.
    vertex_labels: dict = field(default_factory=dict)

    BUCKET_LABELS = (
        "HeadacheTriggers", "AlleviatingFactors",
        "Prodrome", "Aura", "Postdrome", "PainCharacter",
    )

    def __post_init__(self) -> None:
        # If constructed with a person_id, treat the root vertex as a
        # known live-graph vertex so the first root-anchored edge
        # resolves. (The runtime sets person_id via _ensure_person, which
        # seeds the cache itself; this covers callers that pass it to
        # __init__.)
        #
        # The label is derived from the id rather than hardcoded to
        # "Person": ids follow the "Label:slug" convention, and the root
        # label is domain-specific (Person for medical, Pilot for
        # aviation). Hardcoding it registered the aviation root under a
        # label absent from that schema, so edges leaving the root failed
        # validation as dangling.
        if self.person_id and self.person_id not in self.vertex_labels:
            root_label = (
                self.person_id.split(":", 1)[0]
                if ":" in self.person_id else self.person_id
            )
            self.vertex_labels[self.person_id] = root_label

    def add(self, speaker: str, text: str) -> None:
        self.window.append({"speaker": speaker, "text": text})

    def as_history(self) -> list[dict]:
        return list(self.window)

    def register_headache(self, headache_id: str, label: str | None = None) -> None:
        """Record a Headache id so the extractor knows to reuse it."""
        self.known_headaches.setdefault(headache_id, label or "")
        self.current_headache_id = headache_id

    def register_vertices(self, vertices) -> None:
        """Record (id -> label) for every vertex now believed to be in the
        live graph, so subsequent deltas can anchor edges to them.

        ``vertices`` is an iterable of ``hydra.pg.model.Vertex``. Called
        once at session start (seeded from the live graph) and after each
        validated delta is written.
        """
        for v in vertices:
            self.vertex_labels[v.id.value] = v.label.value

    def register_bucket(
        self, bucket_label: str, bucket_id: str, headache_id: str | None = None
    ) -> None:
        """Record that a bucket vertex exists, optionally with the
        Headache that points at it."""
        if bucket_label not in self.BUCKET_LABELS:
            return
        per_label = self.known_buckets.setdefault(bucket_label, {})
        owners = per_label.setdefault(bucket_id, set())
        if headache_id:
            owners.add(headache_id)

    def buckets_summary(self) -> str:
        """Render known buckets for the extractor prompt. Empty string if
        no buckets are known yet."""
        if not self.known_buckets:
            return ""
        lines = ["Known buckets (Headaches sharing a bucket should not get a duplicate):"]
        for bucket_label in self.BUCKET_LABELS:
            entries = self.known_buckets.get(bucket_label, {})
            if not entries:
                continue
            for bid, owners in entries.items():
                owners_str = (
                    ", ".join(sorted(owners)) if owners else "(no Headache attached yet)"
                )
                lines.append(
                    f"  - {bucket_label}: id={bid!r} attached to: {owners_str}"
                )
        return "\n".join(lines)

    def known_headaches_summary(self) -> str:
        """Render the known Headaches for the extractor prompt."""
        if not self.known_headaches:
            return "(no Headache patterns recorded yet)"
        lines = []
        for hid, label in self.known_headaches.items():
            marker = " (most recent)" if hid == self.current_headache_id else ""
            lines.append(
                f'  - id={hid!r} label={label!r}{marker}' if label
                else f'  - id={hid!r}{marker}'
            )
        return "\n".join(lines)


def _format_schema_reference(
    allowed_vertex_props: dict[str, set[str]],
    allowed_edges: dict[str, tuple[str, str]],
    allowed_edge_props: dict[str, set[str]],
    prop_types: dict[str, dict[str, tuple[str, bool]]] | None = None,
) -> str:
    """Render the schema as a compact reference appended to the system
    prompt. Auto-generated so it stays in sync with the JSON.

    When ``prop_types`` (label -> {prop: (type-name, required)}) is given,
    each property is annotated with its literal type and a trailing ``!``
    if required, e.g. ``value:string!, scale:int32``. This tells the model
    the exact JSON scalar a property expects up front, which is the chief
    cause of validation retries.
    """
    prop_types = prop_types or {}

    def render_props(label: str, props: list[str]) -> str:
        detail = prop_types.get(label, {})
        rendered = []
        for p in props:
            if p in detail:
                type_name, required = detail[p]
                rendered.append(f"{p}:{type_name}{'!' if required else ''}")
            else:
                rendered.append(p)
        return ", ".join(rendered)

    # Vertex labels with their property list.
    v_lines = []
    for label in sorted(allowed_vertex_props):
        props = sorted(allowed_vertex_props[label])
        if props:
            v_lines.append(f"  {label}: properties = {{{render_props(label, props)}}}")
        else:
            v_lines.append(f"  {label}: (no properties)")

    # Edges grouped by out-label so the model can scan "what edges go
    # out from Headache" quickly. Edge properties are shown inline when
    # present so the model knows the allowed keys.
    edges_by_out: dict[str, list[tuple[str, str]]] = {}
    for label, (out, in_) in allowed_edges.items():
        edges_by_out.setdefault(out, []).append((label, in_))
    e_lines = []
    for out in sorted(edges_by_out):
        for elabel, in_ in sorted(edges_by_out[out]):
            props = sorted(allowed_edge_props.get(elabel, ()))
            if props:
                e_lines.append(
                    f"  {elabel}: {out} -> {in_}  "
                    f"(edge props: {render_props(elabel, props)})"
                )
            else:
                e_lines.append(f"  {elabel}: {out} -> {in_}")

    # Inbound index: for each vertex type, every edge that can point AT
    # it. The edge list above is grouped by out-label, which answers
    # "what can leave X" but makes "how do I reach X" a scan of the
    # whole list -- and that is exactly the question the model gets
    # wrong. It reaches for a plausible-sounding edge (Pilot -reads->
    # SightPicture) when the only legal route is via an intermediary
    # (Cue -seenAs-> SightPicture), and burns retries discovering this.
    # Types with a single inbound edge are the sharp cases, so flag them.
    edges_by_in: dict[str, list[tuple[str, str]]] = {}
    for label, (out, in_) in allowed_edges.items():
        edges_by_in.setdefault(in_, []).append((label, out))
    in_lines = []
    for in_ in sorted(allowed_vertex_props):
        routes = sorted(edges_by_in.get(in_, []))
        # Concept-reification edges exist for every vocabulary type and
        # are only for the Comment escape hatch; listing them here would
        # bury the real routes.
        real = [(el, o) for el, o in routes if not el.startswith("concept")]
        if not real:
            in_lines.append(f"  {in_}: (only reachable via Concept)")
            continue
        rendered = ", ".join(f"{o} -{el}->" for el, o in real)
        marker = "  <-- ONLY ROUTE" if len(real) == 1 else ""
        in_lines.append(f"  {in_}: {rendered}{marker}")

    return (
        "VERTEX TYPES (label : allowed properties; prop:type, ! = required):\n"
        + "\n".join(v_lines)
        + "\n\nEDGE TYPES (label : out-vertex -> in-vertex; edge props in parens):\n"
        + "\n".join(e_lines)
        + "\n\nHOW TO REACH EACH VERTEX TYPE (every edge that may point AT it).\n"
        "Check this BEFORE emitting an edge: if the edge you want is not\n"
        "listed for the target type, it does not exist and will fail\n"
        "validation. Types marked ONLY ROUTE have exactly one way in --\n"
        "you must create the intermediary vertex to attach them.\n"
        + "\n".join(in_lines)
    )


def _build_extract_tool(
    allowed_vertex_props: dict[str, set[str]],
    allowed_edges: dict[str, tuple[str, str]],
) -> dict:
    """Build the Anthropic tool-use spec from a domain's allowlists.

    The enum values for ``label`` are taken straight from the schema, so
    the LLM can only emit labels the schema knows about. The signal flags
    (``patient_signaled_done`` / ``patient_resumed`` / ``new_current_headache_id``)
    are domain-agnostic and shipped uniformly.
    """
    return {
        "name": "emit_graph_delta",
        "description": (
            "Emit the new vertices and edges captured from the latest "
            "utterance by the interview subject. Emit nothing if the "
            "utterance has no substantive content.\n\n"
            "CONNECTIVITY IS REQUIRED. Every vertex you emit must be "
            "attached to the graph by at least one edge in the same "
            "delta -- either to another vertex in this delta, or to a "
            "vertex already in the graph (listed in the user message). "
            "A vertex with no edge is unreachable and worthless: it "
            "will not appear connected in the graph and tells nobody "
            "anything.\n\n"
            "Before returning, check the `edges` array against the "
            "`vertices` array. If any vertex id appears in no edge, "
            "either add the edge that connects it or remove the "
            "vertex. `edges` should almost never be empty when "
            "`vertices` is non-empty -- 4 vertices with 5 edges is a "
            "good delta; 12 vertices with 0 edges is a failed one."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "vertices": {
                    "type": "array",
                    "description": (
                        "New vertices. Every one of these ids must also "
                        "appear in at least one edge below."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {
                                "type": "string",
                                "enum": sorted(allowed_vertex_props.keys()),
                            },
                            "id": {"type": "string"},
                            "properties": {
                                "type": "object",
                                "additionalProperties": True,
                            },
                        },
                        "required": ["label", "id"],
                    },
                },
                "edges": {
                    "type": "array",
                    "description": (
                        "Edges connecting the new vertices to each "
                        "other and to the existing graph. Emit these in "
                        "the SAME call as the vertices they connect -- "
                        "not in a later turn. Endpoints may be vertices "
                        "from this delta or ids already in the graph."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {
                                "type": "string",
                                "enum": sorted(allowed_edges.keys()),
                            },
                            "out": {"type": "string"},
                            "in": {"type": "string"},
                            "properties": {
                                "type": "object",
                                "additionalProperties": True,
                                "description": (
                                    "Optional edge properties. Allowed "
                                    "keys depend on the edge label; see "
                                    "the edge property catalog in the "
                                    "system prompt."
                                ),
                            },
                        },
                        "required": ["label", "out", "in"],
                    },
                },
                "new_current_headache_id": {
                    "type": "string",
                    "description": (
                        "Optional. If a new Headache vertex emerged in "
                        "this utterance, the id of that Headache vertex; "
                        "future calls should reuse it as "
                        "current_headache_id. Domain-specific to "
                        "headache interviews; other domains may ignore."
                    ),
                },
                "patient_signaled_done": {
                    "type": "boolean",
                    "description": (
                        "Set true if the latest patient utterance signals "
                        "they're finished discussing the topic at hand "
                        "(\"that's all\", \"I'm done\", \"let's stop\", "
                        "\"I have to go\", etc.). The agent will stop "
                        "asking questions until the patient resumes "
                        "substantive content. Set false otherwise "
                        "(including when the patient just paused or "
                        "said 'okay')."
                    ),
                },
                "patient_resumed": {
                    "type": "boolean",
                    "description": (
                        "Set true if the patient was previously marked "
                        "done but is now offering substantive new "
                        "content. The agent will resume asking "
                        "questions. Set false otherwise."
                    ),
                },
            },
            "required": ["vertices", "edges"],
        },
    }


@dataclass
class ExtractionResult:
    delta: pg.Graph
    new_current_headache_id: str | None = None
    patient_signaled_done: bool = False
    patient_resumed: bool = False


class Extractor:
    """Per-utterance graph-delta extractor.

    Bound to a single :class:`~chatgraph.domains.Domain` at construction
    time. The domain provides the schema (which determines the
    allowlists and the tool's enum), the headache-flavoured intro to the
    system prompt, and the agent's stylistic preferences. The
    schema-driven part of the system prompt and the tool spec are built
    once per Extractor instance.
    """

    def __init__(
        self,
        domain: "Domain",
        api_key: str | None = None,
        model: str | None = None,
    ) -> None:
        api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model or os.environ.get(
            "CHATGRAPH_EXTRACTOR_MODEL", DEFAULT_MODEL
        )
        self._domain = domain

        # The committed schema JSON drives two parts of the extractor:
        #   - allow-list dicts that the tool spec and materializer use
        #     to filter unknown labels and unknown properties; and
        #   - a typed ``hydra.pg.model.GraphSchema`` used to validate
        #     each delta before it is written.
        # Load the JSON once, then derive both.
        with open(domain.schema_path) as _f:
            schema_json = json.load(_f)
        (
            self._allowed_vertex_props,
            self._allowed_edges,
            self._allowed_edge_props,
            self._vocabulary_labels,
        ) = _allowlists_from_schema(schema_json)
        self._prop_types = _prop_types_from_schema(schema_json)
        self._schema = _decode_graph_schema(schema_json)

        # System prompt = domain-supplied intro + schema reference.
        self._system_prompt = domain.extractor_prompt_intro + _format_schema_reference(
            self._allowed_vertex_props,
            self._allowed_edges,
            self._allowed_edge_props,
            self._prop_types,
        )

        # Tool spec is schema-driven (enum values for label come from
        # the allowlists) so the LLM can't emit unknown labels.
        self._tool = _build_extract_tool(
            self._allowed_vertex_props, self._allowed_edges,
        )

    async def extract(
        self, utterance: str, context: RollingContext
    ) -> ExtractionResult:
        """Run extraction over one patient utterance.

        Returns an ExtractionResult with the new vertices and edges plus an
        optional new current_headache_id. The materialized delta is
        validated against the domain's Hydra GraphSchema; if validation
        fails, the extractor is asked to correct its output and the call
        is retried (up to ``MAX_EXTRACTION_ATTEMPTS`` total attempts).
        After exhausting retries, returns an empty result. On any other
        failure, also returns an empty result; never raises.
        """
        from chatgraph.chat.validation import validate_delta

        user_msg = self._build_user_message(utterance, context)
        # Mutable message history: grows with each corrective retry so
        # the model can see its prior tool_use and the validation feedback.
        messages: list[dict] = [{"role": "user", "content": user_msg}]

        last_error_message: str | None = None
        for attempt in range(1, MAX_EXTRACTION_ATTEMPTS + 1):
            try:
                resp = await self._client.messages.create(
                    model=self._model,
                    # Must be generous. The tool call emits `vertices`
                    # then `edges`, so a budget that runs out partway
                    # truncates the response *after* the vertices and
                    # *before* the edges -- yielding a delta of orphan
                    # vertices with stop_reason=max_tokens. At 1024 this
                    # happened on every substantial utterance, and looked
                    # exactly like the model ignoring instructions: no
                    # amount of prompting fixed it, and a stronger model
                    # failed identically. A rich utterance can easily
                    # need 2-3k tokens for the vertex properties alone.
                    max_tokens=16384,
                    system=self._system_prompt,
                    tools=[self._tool],
                    tool_choice={"type": "tool", "name": "emit_graph_delta"},
                    messages=messages,
                )
            except Exception:
                log.exception("Extractor: Anthropic call failed")
                return ExtractionResult(delta=_empty_graph())

            # Truncation is silent and its symptom is misleading: the
            # delta arrives with vertices but no edges, which reads as
            # the model ignoring the connectivity rule. Say so loudly.
            if getattr(resp, "stop_reason", None) == "max_tokens":
                log.warning(
                    "Extractor: response hit max_tokens (%s output "
                    "tokens); the delta is TRUNCATED and its edges are "
                    "probably missing. Raise max_tokens.",
                    getattr(getattr(resp, "usage", None), "output_tokens", "?"),
                )

            tool_use = next(
                (b for b in resp.content if getattr(b, "type", None) == "tool_use"),
                None,
            )
            if tool_use is None:
                log.warning("Extractor: model returned no tool_use block")
                return ExtractionResult(delta=_empty_graph())

            try:
                args = tool_use.input
                if isinstance(args, str):  # defensive
                    args = json.loads(args)
                result = _materialize(
                    args,
                    current_headache_id=context.current_headache_id,
                    allowed_vertex_props=self._allowed_vertex_props,
                    allowed_edges=self._allowed_edges,
                    allowed_edge_props=self._allowed_edge_props,
                )
            except Exception:
                log.exception("Extractor: failed to materialize delta")
                return ExtractionResult(delta=_empty_graph())

            validation = validate_delta(
                self._schema, result.delta, context.vertex_labels
            )
            if validation.is_valid:
                # Schema-valid but possibly useless: a delta of vertices
                # with no edges passes every type check and still adds
                # nothing navigable to the graph. Orphans were the single
                # biggest quality problem in early sessions (37 of 50
                # vertices unreachable in one run), and prompt-level
                # instructions alone did not fix it -- so reject orphans
                # here and let the existing retry loop ask for a
                # correction, exactly as with a type error.
                orphans = _orphan_vertex_ids(result.delta)
                if orphans and attempt < MAX_EXTRACTION_ATTEMPTS:
                    # Be explicit that the fix is to ADD EDGES, keeping
                    # the vertices. Told merely to "correct the error",
                    # the model takes the cheap way out and re-emits an
                    # empty delta -- which passes the orphan check and
                    # loses the entire utterance.
                    last_error_message = (
                        "These vertices have no edge connecting them to "
                        "anything: " + ", ".join(sorted(orphans)) + ".\n\n"
                        "FIX BY ADDING EDGES, NOT BY REMOVING VERTICES. "
                        "Keep the vertices -- they capture real content "
                        "from the utterance. For each one, find the edge "
                        "in the schema reference that connects it to "
                        "another vertex in this delta or to a known id, "
                        "and add that edge. Typical shapes: "
                        "Pilot -uses-> Procedure -hasStep-> Step "
                        "-servesPurpose-> Purpose; "
                        "Pilot -reads-> Cue -cueObservedDuring-> Step; "
                        "Site -hasHazard-> Hazard; "
                        "Cue -cueFrom-> InformationSource; "
                        "Cue -cueIndicates-> ConditionFactor.\n\n"
                        "Re-emit the FULL delta: the same vertices, plus "
                        "the edges that connect them. Do NOT return an "
                        "empty delta -- that discards the utterance."
                    )
                    log.warning(
                        "Extractor: %d orphan vertex/vertices (attempt "
                        "%d/%d): %s",
                        len(orphans), attempt, MAX_EXTRACTION_ATTEMPTS,
                        ", ".join(sorted(orphans)),
                    )
                    messages.append(
                        {"role": "assistant", "content": resp.content}
                    )
                    messages.append(_validation_feedback_message(
                        tool_use_id=tool_use.id,
                        error_message=last_error_message,
                    ))
                    continue

                if orphans:
                    # Out of attempts. Keep the connected part rather than
                    # dropping the whole delta -- a partial graph beats
                    # nothing, and the utterance is not coming back.
                    log.warning(
                        "Extractor: dropping %d orphan vertex/vertices "
                        "after %d attempts: %s",
                        len(orphans), attempt, ", ".join(sorted(orphans)),
                    )
                    result = ExtractionResult(
                        delta=_without_vertices(result.delta, orphans),
                        new_current_headache_id=result.new_current_headache_id,
                        patient_signaled_done=result.patient_signaled_done,
                        patient_resumed=result.patient_resumed,
                    )

                if attempt > 1:
                    log.info(
                        "Extractor: delta valid after %d attempt(s)", attempt
                    )
                # The delta is about to be written, so its vertices join
                # the live-graph set that future deltas can anchor edges
                # to (e.g. a later turn's edge into this turn's Headache).
                context.register_vertices(result.delta.vertices.values())
                return result

            # Result's repr() produces "INVALID - <typed error dump>", which
            # is verbose but identical across Hydra's polyglot bindings.
            last_error_message = repr(validation)
            log.warning(
                "Extractor: validation failed (attempt %d/%d): %s",
                attempt, MAX_EXTRACTION_ATTEMPTS, last_error_message,
            )

            if attempt == MAX_EXTRACTION_ATTEMPTS:
                break

            # Re-prompt the model with its prior tool_use and the
            # validation error as a tool_result. The next iteration's
            # messages.create call sees the full corrective context.
            messages.append({"role": "assistant", "content": resp.content})
            messages.append(_validation_feedback_message(
                tool_use_id=tool_use.id, error_message=last_error_message,
            ))

        log.error(
            "Extractor: giving up on utterance after %d failed attempts; "
            "last error: %s",
            MAX_EXTRACTION_ATTEMPTS, last_error_message,
        )
        return ExtractionResult(delta=_empty_graph())

    def _build_user_message(
        self, utterance: str, context: RollingContext
    ) -> str:
        history_lines = [
            f"  {t['speaker']}: {t['text']}" for t in context.as_history()
        ]
        history = "\n".join(history_lines) if history_lines else "  (none)"
        current = context.current_headache_id or "(none open)"
        known = context.known_headaches_summary()
        person = context.person_id or "(not yet set)"
        buckets = context.buckets_summary()
        buckets_block = f"\n\n{buckets}" if buckets else ""

        # Vertices already in the live graph, grouped by label. Without
        # this the model cannot reuse existing ids, so it re-mints a new
        # vertex for a concept it already recorded a turn ago -- which is
        # how one idea ends up as three unconnected vertices
        # (AbortRule:stop-before-midpoint, AbortRule:stop-by-midpoint,
        # Doctrine:stop-by-midpoint-short-strips). Reuse is what makes
        # the graph accumulate rather than fragment.
        known_block = ""
        if context.vertex_labels:
            by_label: dict[str, list[str]] = {}
            for vid, label in context.vertex_labels.items():
                by_label.setdefault(label, []).append(vid)
            lines = [
                f"  {label}: {', '.join(sorted(ids))}"
                for label, ids in sorted(by_label.items())
            ]
            known_block = (
                "\nVertices ALREADY in the graph -- reuse these ids when "
                "the utterance refers to the same thing; do NOT mint a "
                "near-duplicate:\n" + "\n".join(lines) + "\n"
            )

        # The Headache/bucket lines are medical-domain scaffolding. Only
        # include them when they actually carry something, so an aviation
        # session isn't told "Known Headache patterns: (none recorded)".
        medical_block = ""
        if context.known_headaches or context.current_headache_id:
            medical_block = (
                f"\nKnown Headache patterns:\n{known}"
                f"{buckets_block}\n"
                f"\nmost_recent_headache_id (default when ambiguous): "
                f"{current}\n"
            )

        # The connectivity reminder is repeated HERE, at the very end of
        # the user message, on purpose. The system prompt is ~26k chars
        # (mostly the generated schema reference), and an instruction
        # placed near its top is reliably ignored: both Haiku and Sonnet
        # emitted 9-11 orphan vertices per delta despite an emphatic
        # rule up there. Restating it as the last thing the model reads
        # before emitting is what actually changes the output. Keep it
        # short -- this competes with the utterance for attention.
        return (
            f"root vertex id (the interview subject; use as `out` of "
            f"edges that hang off the subject): {person}\n"
            f"{known_block}"
            f"\nRecent turns (oldest first):\n{history}\n"
            f"{medical_block}"
            f"\nLatest utterance from the interview subject:\n  {utterance}\n"
            f"\n---\n"
            f"REMINDER: every vertex you emit needs at least one edge in "
            f"the same delta connecting it to another vertex here or to "
            f"an id listed above. Write the `edges` array FIRST, then "
            f"emit exactly the vertices those edges refer to. If "
            f"`vertices` is non-empty and `edges` is empty, you have "
            f"made a mistake."
        )


# -- Materialization helpers --


def _empty_graph() -> pg.Graph:
    return pg.Graph(vertices=FrozenDict({}), edges=FrozenDict({}))


def _orphan_vertex_ids(delta: pg.Graph) -> set[str]:
    """Ids of vertices in ``delta`` that no edge in ``delta`` touches.

    A delta is a *partial* graph, so an edge may legitimately point at a
    vertex that lives only in the live graph from earlier turns. What
    cannot be justified is a vertex this delta introduces and then
    connects to nothing: no edge here, and (being new) no edge anywhere
    else either. Such a vertex is unreachable in the graph -- it renders
    as a floating dot in a viewer and answers no query.
    """
    touched: set[str] = set()
    for e in delta.edges.values():
        touched.add(e.out.value)
        touched.add(e.in_.value)
    return {
        vid.value for vid in delta.vertices
        if vid.value not in touched
    }


def _without_vertices(delta: pg.Graph, drop: set[str]) -> pg.Graph:
    """Return ``delta`` minus the named vertices.

    Edges are left untouched: a vertex being dropped is by definition
    referenced by no edge in this delta, so nothing can dangle.
    """
    return pg.Graph(
        vertices=FrozenDict({
            vid: v for vid, v in delta.vertices.items()
            if vid.value not in drop
        }),
        edges=delta.edges,
    )


def _validation_feedback_message(*, tool_use_id: str, error_message: str) -> dict:
    """Build the corrective ``user`` message sent back to the extractor LLM
    after a validation failure. The next ``messages.create`` call will see
    the original user message, the prior ``tool_use``, and this
    ``tool_result``, and is expected to re-emit a corrected delta.
    """
    return {
        "role": "user",
        "content": [{
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": (
                f"Schema validation failed: {error_message}. "
                f"Re-emit the entire graph delta for this utterance "
                f"with the error corrected."
            ),
            "is_error": True,
        }],
    }


def _lit(s: str):
    return core.LiteralString(s)


def _lit_int(n: int):
    return core.LiteralInteger(core.IntegerValueInt32(int(n)))


def _lit_bool(v: bool):
    return core.LiteralBoolean(bool(v))


def _normalize_vertex_id(vid: str) -> str:
    """Normalize a vertex id so equivalent natural-language values
    collapse onto the same vertex.

    Splits on the FIRST colon (label prefix) and slugifies the rest:
    lowercased, whitespace collapsed to single hyphens, stray
    punctuation removed. Internal colons in the value are preserved
    (e.g. Concept reification ids like ``c:Symptom:photophobia``).
    """
    if ":" not in vid:
        return vid
    label, _, value = vid.partition(":")
    import re

    slug = value.lower().strip()
    slug = re.sub(r"\s+", "-", slug)
    # Allow alnum, hyphen, underscore, AND colons (for nested ids).
    slug = re.sub(r"[^a-z0-9_:\-]", "", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return f"{label}:{slug}" if slug else label


def _materialize(
    tool_input: dict,
    *,
    current_headache_id: str | None,
    allowed_vertex_props: dict[str, set[str]],
    allowed_edges: dict[str, tuple[str, str]],
    allowed_edge_props: dict[str, set[str]],
) -> ExtractionResult:
    vertices_in = tool_input.get("vertices", []) or []
    edges_in = tool_input.get("edges", []) or []
    new_headache_id = tool_input.get("new_current_headache_id")
    signaled_done = bool(tool_input.get("patient_signaled_done", False))
    resumed = bool(tool_input.get("patient_resumed", False))

    out_vertices: dict = {}
    out_edges: dict = {}

    for v in vertices_in:
        label = v.get("label")
        vid = v.get("id")
        if not label or not vid:
            continue
        if label not in allowed_vertex_props:
            log.warning("Extractor: skipping vertex with unknown label %r", label)
            continue
        # Normalize the id so equivalent natural-language values collapse
        # to one vertex. The slug fix matters most for vocabulary types
        # (Quality, BodyLocation, Severity, ...) where the LLM emits
        # things like 'Quality:dull ache' vs 'Quality:dull-ache'.
        vid = _normalize_vertex_id(vid)
        props_in = v.get("properties") or {}
        allowed = allowed_vertex_props[label]
        properties: dict = {}
        for k, val in props_in.items():
            if k not in allowed:
                log.debug(
                    "Extractor: dropping property %r on %s (not in schema)",
                    k, label,
                )
                continue
            # NB: bool is a subclass of int, so check bool first.
            if isinstance(val, bool):
                properties[pg.PropertyKey(k)] = _lit_bool(val)
            elif isinstance(val, int):
                properties[pg.PropertyKey(k)] = _lit_int(val)
            elif isinstance(val, str):
                properties[pg.PropertyKey(k)] = _lit(val)
            else:
                # Coerce anything else to string. Keeps the graph writable
                # if the model emits an unexpected JSON shape.
                properties[pg.PropertyKey(k)] = _lit(str(val))
        vid_lit = _lit(vid)
        out_vertices[vid_lit] = pg.Vertex(
            label=pg.VertexLabel(label), id=vid_lit,
            properties=FrozenDict(properties),
        )

    for e in edges_in:
        label = e.get("label")
        out = e.get("out")
        in_ = e.get("in")
        if not label or not out or not in_:
            continue
        if label not in allowed_edges:
            log.warning("Extractor: skipping edge with unknown label %r", label)
            continue
        # Normalize endpoint ids the same way we normalize vertex ids so
        # edges land on the right vertex even if the LLM produced a
        # slightly different slug.
        out = _normalize_vertex_id(out)
        in_ = _normalize_vertex_id(in_)
        # Defensive: if the model swapped out/in (Haiku sometimes reads
        # "triggers" as the trigger pointing at the headache), correct it.
        expected_out, expected_in = allowed_edges[label]
        out_v = out_vertices.get(_lit(out))
        in_v = out_vertices.get(_lit(in_))
        out_label = out_v.label.value if out_v else None
        in_label = in_v.label.value if in_v else None
        if (
            out_label == expected_in
            and in_label == expected_out
            and out_label != expected_out
        ):
            log.info("Extractor: flipping reversed edge %s", label)
            out, in_ = in_, out
        # Edge properties, filtered by what the schema declares for this
        # edge label.
        edge_props_in = e.get("properties") or {}
        allowed_edge = allowed_edge_props.get(label, set())
        edge_properties: dict = {}
        for k, val in edge_props_in.items():
            if k not in allowed_edge:
                log.debug(
                    "Extractor: dropping edge prop %r on %s (not in schema)",
                    k, label,
                )
                continue
            if isinstance(val, bool):
                edge_properties[pg.PropertyKey(k)] = _lit_bool(val)
            elif isinstance(val, int):
                edge_properties[pg.PropertyKey(k)] = _lit_int(val)
            elif isinstance(val, str):
                edge_properties[pg.PropertyKey(k)] = _lit(val)
            else:
                edge_properties[pg.PropertyKey(k)] = _lit(str(val))

        eid = f"{out}-{label}->{in_}"
        eid_lit = _lit(eid)
        out_edges[eid_lit] = pg.Edge(
            label=pg.EdgeLabel(label),
            id=eid_lit,
            out=_lit(out), in_=_lit(in_),
            properties=FrozenDict(edge_properties),
        )

    # Mint Headache uuid if the model didn't and the utterance produced a
    # Headache vertex without a current id. (Defensive: the system prompt
    # asks the model to do this, but we shouldn't trust it.)
    next_headache_id: str | None = current_headache_id
    if new_headache_id:
        next_headache_id = new_headache_id
    elif any(v.label.value == "Headache" for v in out_vertices.values()):
        # The model emitted a Headache but didn't flag a new id. If exactly
        # one Headache vertex appears, treat its id as the current one.
        headaches = [
            v for v in out_vertices.values() if v.label.value == "Headache"
        ]
        if len(headaches) == 1:
            next_headache_id = headaches[0].id.value

    delta = pg.Graph(
        vertices=FrozenDict(out_vertices),
        edges=FrozenDict(out_edges),
    )
    return ExtractionResult(
        delta=delta,
        new_current_headache_id=next_headache_id,
        patient_signaled_done=signaled_done,
        patient_resumed=resumed,
    )


def synthesize_headache_id() -> str:
    """Mint a fresh Headache id. Exposed for tests/callers that pre-mint."""
    return f"Headache:{uuid.uuid4().hex[:12]}"
