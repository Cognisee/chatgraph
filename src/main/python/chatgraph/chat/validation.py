"""Delta-only schema validation for extractor output.

The extractor's per-utterance output is a partial ``hydra.pg.model.Graph``
(the "delta") whose edges usually reference vertices in the *live* graph
from prior turns. ``hydra.validate.pg.validate_graph`` can be invoked
without a vertex-id-to-label resolver (the default ``Nothing()`` for
``label_for_vertex_id``), in which case the cross-graph endpoint checks
(``InVertexLabel`` / ``OutVertexLabel`` / ``InVertexNotFound`` /
``OutVertexNotFound``) are silently skipped, leaving everything else
(literal types, missing required properties, unknown labels, etc.)
fully checked.

That trade-off is the right one for an LLM-driven extractor: the live
graph is the source of truth for vertex-label identity, while
delta-local schema conformance (correct literal types, no unknown
labels, no missing required properties) is what the LLM needs to be
told about so it can self-correct.

The returned :class:`hydrapop.validate.Result` carries the typed error
(if any). ``repr(result)`` produces a one-line string suitable for
echoing back to the LLM as corrective feedback. The repr is intentionally
the dataclass dump of the typed error; it is verbose but identical
across Hydra's polyglot bindings (Python / Java / Scala / ...), so
downstream tooling that wants nicer formatting should be added at the
Hydra level (see CategoricalData/hydra#374).
"""

from __future__ import annotations

import hydra.pg.model as pg
import hydra.validate.pg as pg_validation
from hydra.dsl.python import Just
from hydrapop.validate import Result, check_literal


def validate_delta(schema: pg.GraphSchema, delta: pg.Graph) -> Result:
    """Validate a delta against the schema, skipping cross-graph endpoint checks.

    Returns a :class:`hydrapop.validate.Result`. Use ``result.is_valid``
    to test for success; ``result.error`` for the typed
    ``InvalidGraphError`` (or ``None``); ``repr(result)`` for a
    human-readable string suitable for LLM feedback.
    """
    # Calling validate_graph without a label_for_vertex_id resolver
    # disables the cross-graph endpoint checks. Every other variant of
    # InvalidGraphError (label, properties, literal-type) is still
    # raised.
    maybe_error = pg_validation.validate_graph(check_literal, schema, delta)
    match maybe_error:
        case Just(e):
            return Result(e)
        case _:
            return Result(None)
