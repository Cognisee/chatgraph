"""Ergonomic builders for authoring Hydra property-graph schemas.

Schema-authoring convenience only; nothing at runtime imports this. A
domain's ``schema_build.py`` uses these builders to express its schema as
readable Python, then calls :func:`encode_graph_schema` to emit the
canonical JSON that the application actually loads (see "Schema: one
source of truth" in ``CLAUDE.md``).

Hydra ships a property-graph DSL of its own at ``hydra.dsl.pg.model``,
but it is a *term-level* DSL: it builds ``TypedTerm`` values for use
inside Hydra programs, not the plain ``hydra.pg.model`` dataclasses we
want to hand to the encoder. These builders are a thin fluent wrapper
over those dataclasses -- ``vertex_type(...).property(...).build()`` --
which keeps a large schema readable::

    person = (
        vertex_type("Person", string())
        .property("name", string(), False)
        .build()
    )

:func:`encode_graph_schema` mirrors the reference chain in Hydra's own
``demos/validatepg`` (``GenerateData.java``): encode the schema to a
``hydra.core.Term``, render that term as JSON, and print it.
"""

from __future__ import annotations

import hydra.encode.core as encode_core
import hydra.encode.pg.model as encode_pg
import hydra.json.encode as json_encode
import hydra.json.writer as json_writer
import hydra.pg.model as pg
from hydra.overlay.python.dsl.literal_types import boolean, int32, string

__all__ = [
    "boolean",
    "edge_type",
    "encode_graph_schema",
    "graph_schema",
    "int32",
    "string",
    "vertex_type",
]


class _ElementTypeBuilder:
    """Shared ``.property(...)`` accumulation for vertex/edge builders."""

    def __init__(self):
        self._properties: list[pg.PropertyType] = []

    def property(self, key: str, value, required: bool = False):
        """Declare a property. ``value`` is a ``hydra.core.LiteralType``."""
        self._properties.append(
            pg.PropertyType(
                key=pg.PropertyKey(key), value=value, required=required
            )
        )
        return self


class VertexTypeBuilder(_ElementTypeBuilder):
    def __init__(self, label: str, id_type):
        super().__init__()
        self._label = label
        self._id_type = id_type

    def build(self) -> pg.VertexType:
        return pg.VertexType(
            label=pg.VertexLabel(self._label),
            id=self._id_type,
            properties=tuple(self._properties),
        )


class EdgeTypeBuilder(_ElementTypeBuilder):
    def __init__(self, label: str, id_type, out: str, in_: str):
        super().__init__()
        self._label = label
        self._id_type = id_type
        self._out = out
        self._in = in_

    def build(self) -> pg.EdgeType:
        return pg.EdgeType(
            label=pg.EdgeLabel(self._label),
            id=self._id_type,
            out=pg.VertexLabel(self._out),
            in_=pg.VertexLabel(self._in),
            properties=tuple(self._properties),
        )


def vertex_type(label: str, id_type) -> VertexTypeBuilder:
    """Start a vertex type. Chain ``.property(...)``, end with ``.build()``."""
    return VertexTypeBuilder(label, id_type)


def edge_type(label: str, id_type, out: str, in_: str) -> EdgeTypeBuilder:
    """Start an edge type from ``out`` to ``in_`` (vertex labels)."""
    return EdgeTypeBuilder(label, id_type, out, in_)


def graph_schema(vertices, edges) -> pg.GraphSchema:
    """Assemble built vertex/edge types into a ``GraphSchema``."""
    return pg.GraphSchema(
        vertices={vt.label: vt for vt in vertices},
        edges={et.label: et for et in edges},
    )


def encode_graph_schema(schema: pg.GraphSchema) -> str:
    """Encode a ``GraphSchema`` as canonical Hydra JSON text.

    Mirrors ``hydra.demos.validatepg.GenerateData``: PG model -> Term ->
    JSON value -> text.
    """
    term = encode_pg.graph_schema(encode_core.literal_type, schema)
    result = json_encode.to_json_untyped(term)
    value = getattr(result, "value", None)
    if value is None or type(result).__name__ == "Left":
        raise ValueError(f"Failed to encode schema to JSON: {result}")
    return json_writer.print_json(value)
