"""Delta-with-known-vertices schema validation for extractor output.

The extractor's per-utterance output is a partial ``hydra.pg.model.Graph``
(the "delta") whose edges usually reference vertices in the *live* graph
from prior turns -- most notably the ``Person`` root that every
``reports`` edge points out of. Those endpoint vertices are not present
in the delta itself.

Why we can't just call ``validate_graph``
-----------------------------------------
``hydra.validate.pg.validate_graph`` does two things over the single
graph it is handed: it validates every vertex (label + id + properties),
and it resolves every edge endpoint against that same ``graph.vertices``
map, reporting ``OutVertexNotFound`` / ``InVertexNotFound`` when an
endpoint is missing. It offers no way to supply endpoint labels from
elsewhere, or to disable the cross-graph check.

So for a delta whose edges legitimately point at live-graph vertices we
are stuck between two options that both fail:

- Validate the delta alone -> every edge to a prior-turn vertex (incl.
  the ``Person`` root) fails with ``OutVertexNotFound``. This is the bug
  that made the medical demo reject almost every utterance.
- Merge label-only placeholder vertices for the known ids into the graph
  so endpoints resolve -> but ``validate_graph`` then *also* validates
  those placeholders as vertices, and a bare ``Severity`` placeholder
  (no ``scale`` property) trips ``MissingRequired``. We'd trade one false
  failure for another.

The key fact that resolves the tension: endpoint checking only inspects
an endpoint vertex's **label** (``validate_edge``'s ``check_out`` /
``check_in`` compare ``label.value`` against the edge type's declared
out/in label and nothing else -- not id, not properties). So we want two
*different* vertex sets: the delta alone for vertex validation, and the
delta-plus-known-labels for edge-endpoint resolution.

What we do instead
------------------
We bypass the top-level ``validate_graph`` and drive Hydra's still-public
``validate_vertex`` / ``validate_edge`` directly:

- vertices: validate only the delta's own vertices (label + id +
  properties), exactly as before.
- edges: validate each delta edge with a ``label_for_vertex_id``
  resolver that looks up the delta's vertices first, then falls back to
  ``known_labels``. Endpoints in either set resolve (label-only); an id
  in neither is a genuine dangling reference and is reported as
  ``OutVertexNotFound`` / ``InVertexNotFound`` -- which is what we want,
  so the LLM can self-correct.

``known_labels`` (vertex id -> label string) is maintained by the caller
(``RollingContext.vertex_labels``): seeded once from the live graph at
session start, then grown as each validated delta is written.

The returned :class:`Result` (from Hydra's TinkerPop coder) carries the
typed error (if any). ``repr(result)`` produces a one-line string suitable for
echoing back to the LLM as corrective feedback. The repr is intentionally
the dataclass dump of the typed error; it is verbose but identical
across Hydra's polyglot bindings (Python / Java / Scala / ...), so
downstream tooling that wants nicer formatting should be added at the
Hydra level (see CategoricalData/hydra#374).
"""

from __future__ import annotations

from collections.abc import Mapping

import hydra.error.pg as epg
import hydra.pg.model as pg
import hydra.validate.pg as pg_validation
from hydra.overlay.python.dsl.python import Given, None_
from hydra.overlay.python.tinkerpop.coder import Result, check_literal


def validate_delta(
    schema: pg.GraphSchema,
    delta: pg.Graph,
    known_labels: Mapping[str, str] | None = None,
) -> Result:
    """Validate a delta against the schema.

    The delta's own vertices are validated in full (label, id,
    properties). Each edge is validated for label/id/properties and its
    endpoints are resolved against the delta plus ``known_labels`` (vertex
    id -> label of vertices already in the live graph). An endpoint in
    neither set is reported as not-found.

    Returns a :class:`Result`. Use ``result.is_valid``
    to test for success; ``result.error`` for the typed
    ``InvalidGraphError`` (or ``None``); ``repr(result)`` for a
    human-readable string suitable for LLM feedback.
    """
    known = known_labels or {}

    # Resolver: delta vertices win, then fall back to the known live-graph
    # labels. Returns Given(VertexLabel) when the id is known, None_()
    # otherwise (-> the edge check reports it as not-found). These are
    # Hydra's optionals, not Python's: a bare None here silently breaks
    # validate_edge's fold.
    def label_for_vertex_id(vid):
        v = delta.vertices.get(vid)
        if v is not None:
            return Given(v.label)
        label = known.get(vid.value)
        if label is not None:
            return Given(pg.VertexLabel(label))
        return None_()

    resolver = Given(label_for_vertex_id)
    profile = pg_validation.default_pg_profile()

    # Validate the delta's own vertices (full check: label/id/properties).
    for v in delta.vertices.values():
        typ = schema.vertices.get(v.label)
        if typ is None:
            return Result(
                epg.InvalidGraphErrorVertex(
                    epg.InvalidGraphVertexError(
                        v.id,
                        epg.InvalidVertexErrorLabel(
                            epg.NoSuchVertexLabelError(v.label)
                        ),
                    )
                )
            )
        err = _first_error(
            pg_validation.validate_vertex(profile, check_literal, typ, v)
        )
        if err is not None:
            return Result(
                epg.InvalidGraphErrorVertex(
                    epg.InvalidGraphVertexError(v.id, err)
                )
            )

    # Validate each edge (full check) with endpoint resolution against
    # delta + known labels.
    for e in delta.edges.values():
        typ = schema.edges.get(e.label)
        if typ is None:
            return Result(
                epg.InvalidGraphErrorEdge(
                    epg.InvalidGraphEdgeError(
                        e.id,
                        epg.InvalidEdgeErrorLabel(
                            epg.NoSuchEdgeLabelError(e.label)
                        ),
                    )
                )
            )
        err = _first_error(
            pg_validation.validate_edge(
                profile, check_literal, resolver, typ, e
            )
        )
        if err is not None:
            return Result(
                epg.InvalidGraphErrorEdge(
                    epg.InvalidGraphEdgeError(e.id, err)
                )
            )

    return Result(None)


def _first_error(result):
    """First error from a ``hydra.validation.ValidationResult``, or None.

    ``errors`` is a ConsList; validate_delta reports one error at a time,
    so we surface the first and ignore warnings.
    """
    for err in result.errors:
        return err
    return None
