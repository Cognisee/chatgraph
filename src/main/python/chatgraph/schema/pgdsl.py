"""Ergonomic builders for authoring Hydra property-graph schemas.

Schema-authoring convenience only; nothing at runtime imports this. A
domain's ``schema_build.py`` uses these builders to express its schema as
readable Python, then calls :func:`encode_graph_schema` to emit the
canonical JSON that the application actually loads (see "Schema: one
source of truth" in ``CLAUDE.md``).

Everything of substance here is Hydra's. The schema is built with Hydra's
own PG DSL (``hydra.dsl.pg.model``), plain Python values are lifted into
terms with Hydra's term DSL (``hydra.overlay.python.dsl.terms``), and the
JSON is rendered by ``hydra.json.encode`` / ``hydra.json.writer``.
Literal types come straight from ``hydra.dsl.core`` -- domains import
those themselves, so this module does not re-export them.

Because ``hydra.dsl.pg.model`` is a *term-level* DSL -- every constructor
returns a ``hydra.typed.TypedTerm`` wrapping a ``hydra.core.Term`` -- a
schema assembled from it *is* the encoded term. There is no separate
``hydra.encode.pg.model`` pass; :func:`encode_graph_schema` just renders
the term as JSON.

What this module adds is only sugar. The DSL constructors are positional
and take terms for every argument (``vertex_type(label, id, properties)``),
which does not scale to a 77-vertex clinical schema. These builders wrap
them in the fluent style the domain modules are written in::

    s = hydra.dsl.core.literal_type_string
    person = (
        vertex_type("Person", s)
        .property("name", s, False)
        .build()
    )
"""

from __future__ import annotations

import hydra.dsl.pg.model as dsl_pg
import hydra.json.encode as json_encode
import hydra.json.writer as json_writer
import hydra.overlay.python.dsl.terms as terms
import hydra.typed as typed

__all__ = [
    "edge_type",
    "encode_graph_schema",
    "graph_schema",
    "vertex_type",
]


def _term(value) -> typed.TypedTerm:
    """Re-wrap a raw ``hydra.core.Term`` as a ``TypedTerm`` for the DSL."""
    return typed.TypedTerm(value)


# -- Element type builders --

class _ElementTypeBuilder:
    """Shared ``.property(...)`` accumulation for vertex/edge builders."""

    def __init__(self):
        self._properties: list[typed.TypedTerm] = []

    def property(self, key: str, value: typed.TypedTerm, required: bool = False):
        """Declare a property. ``value`` is a literal type term, e.g.
        ``hydra.dsl.core.literal_type_string``."""
        self._properties.append(
            dsl_pg.property_type(
                _term(terms.string(key)), value, _term(terms.boolean(required))
            )
        )
        return self

    def _properties_term(self) -> typed.TypedTerm:
        return _term(terms.list_([p.value for p in self._properties]))


class VertexTypeBuilder(_ElementTypeBuilder):
    def __init__(self, label: str, id_type: typed.TypedTerm):
        super().__init__()
        self._label = label
        self._id_type = id_type

    def build(self) -> tuple[str, typed.TypedTerm]:
        """Return ``(label, term)``; :func:`graph_schema` keys on the label."""
        return self._label, dsl_pg.vertex_type(
            _term(terms.string(self._label)),
            self._id_type,
            self._properties_term(),
        )


class EdgeTypeBuilder(_ElementTypeBuilder):
    def __init__(self, label: str, id_type: typed.TypedTerm, out: str, in_: str):
        super().__init__()
        self._label = label
        self._id_type = id_type
        self._out = out
        self._in = in_

    def build(self) -> tuple[str, typed.TypedTerm]:
        """Return ``(label, term)``; :func:`graph_schema` keys on the label."""
        return self._label, dsl_pg.edge_type(
            _term(terms.string(self._label)),
            self._id_type,
            _term(terms.string(self._out)),
            _term(terms.string(self._in)),
            self._properties_term(),
        )


def vertex_type(label: str, id_type: typed.TypedTerm) -> VertexTypeBuilder:
    """Start a vertex type. Chain ``.property(...)``, end with ``.build()``."""
    return VertexTypeBuilder(label, id_type)


def edge_type(
    label: str, id_type: typed.TypedTerm, out: str, in_: str
) -> EdgeTypeBuilder:
    """Start an edge type from ``out`` to ``in_`` (vertex labels)."""
    return EdgeTypeBuilder(label, id_type, out, in_)


def graph_schema(vertices, edges) -> typed.TypedTerm:
    """Assemble built vertex/edge types into a ``GraphSchema`` term.

    Both arguments are sequences of ``(label, term)`` pairs as returned
    by ``VertexTypeBuilder.build()`` / ``EdgeTypeBuilder.build()``.
    """
    def as_map(pairs):
        return _term(
            terms.map_({terms.string(label): t.value for label, t in pairs})
        )

    return dsl_pg.graph_schema(as_map(vertices), as_map(edges))


def encode_graph_schema(schema: typed.TypedTerm) -> str:
    """Render a ``GraphSchema`` term as canonical Hydra JSON text.

    The DSL already produced the term, so this is just Hydra's JSON
    coder: Term -> JSON value -> text.
    """
    result = json_encode.to_json_untyped(schema.value)
    if type(result).__name__ == "Left":
        raise ValueError(f"Failed to encode schema to JSON: {result.value}")
    return json_writer.print_json(result.value)
