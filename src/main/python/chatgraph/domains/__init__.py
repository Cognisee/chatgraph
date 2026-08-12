"""Domain definitions for chatgraph.

A *domain* bundles four things that need to vary together:

- the typed property-graph schema (a Hydra ``GraphSchema``),
- the agent's system prompt (the interviewer's persona + which dimensions
  to ask about),
- the extractor's domain-flavoured prompt intro (the LLM that maps
  utterances into vertex/edge deltas),
- the opening line spoken to the patient on a fresh session.

Each domain is a Python subpackage under ``chatgraph.domains`` that
exposes a module-level ``DOMAIN: Domain`` value. The package's
``build.py`` script generates the committed schema JSON.

The registry (``REGISTRY``) is populated lazily by importing each
subpackage. To add a new domain, create a new subpackage and add a line
to ``_register_all`` below.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Domain:
    """A complete domain configuration.

    Immutable by value: ``Domain`` instances cannot be mutated after
    construction. The :data:`REGISTRY` that maps names to ``Domain``
    instances IS mutable, however -- :func:`register` deliberately
    allows re-registration so a test or notebook can swap in a
    modified ``Domain`` under an existing name.

    Attributes:
        name: short id used on the CLI (e.g. ``"medical"``).
        schema_path: path to the committed schema JSON.
        agent_system_prompt: the system prompt for the conversational
            agent (Claude Sonnet). Should describe the interviewer's
            persona and which schema dimensions to follow up on.
        extractor_prompt_intro: the *domain-flavoured* preamble prepended
            to the extractor's system prompt. The extractor appends a
            schema reference (vertex/edge labels + properties) derived
            from ``schema_path``, so this string should describe the
            interview context, not the schema mechanics.
        opening_line: the deterministic line the agent says on a fresh
            session. Resumed sessions get an LLM-generated opener
            informed by the existing graph instead.
        description: human-readable summary, shown on ``-h`` and when
            an unknown domain is requested.
        root_label: vertex label of the graph root -- the vertex every
            session hangs its content off (``Person`` for medical,
            ``Pilot`` for aviation). Must exist in the domain's schema:
            the runtime creates this vertex at startup if the graph
            doesn't already contain one, and a label outside the schema
            would fail validation on the first delta.
        root_id: id given to the root vertex when the runtime creates
            it.
        root_properties: properties set on the root vertex at creation.
            Keys and literal types must match the schema's declaration
            for ``root_label``.
        subject_noun: what to call the interview subject in
            domain-agnostic prose ("patient", "pilot"). Used in
            runtime-generated prompts (e.g. the resume opening) so they
            don't read as medical in a non-medical domain.
        stt_keyterms: domain vocabulary passed to the speech-to-text
            engine to bias recognition. Proper nouns and jargon are
            where a general model fails worst, and its mistakes become
            graph facts -- "Citabria" heard as "Sudavia" produced an
            ``Aircraft:sudavia`` vertex in one session. List the terms
            whose misrecognition would be most damaging.
    """

    name: str
    schema_path: Path
    agent_system_prompt: str
    extractor_prompt_intro: str
    opening_line: str
    description: str
    root_label: str = "Person"
    root_id: str = "Person:patient"
    root_properties: tuple[tuple[str, str], ...] = (("name", "patient"),)
    subject_noun: str = "patient"
    stt_keyterms: tuple[str, ...] = ()


REGISTRY: dict[str, Domain] = {}


def register(domain: Domain) -> None:
    """Register a domain by name. Re-registering overrides."""
    REGISTRY[domain.name] = domain


def get(name: str) -> Domain:
    """Look up a domain. Raises KeyError with available names if missing."""
    _register_all()
    try:
        return REGISTRY[name]
    except KeyError:
        available = ", ".join(sorted(REGISTRY)) or "(none)"
        raise KeyError(
            f"unknown domain {name!r}; available: {available}"
        ) from None


def available() -> list[str]:
    """Return the sorted list of registered domain names."""
    _register_all()
    return sorted(REGISTRY)


def _register_all() -> None:
    """Import all domain subpackages so they register themselves."""
    # Import is intentionally inside the function so we don't pay the
    # cost (and don't risk circular imports) at module load time. Add a
    # line per new domain.
    if "medical" not in REGISTRY:
        from chatgraph.domains import medical  # noqa: F401
    if "aviation" not in REGISTRY:
        from chatgraph.domains import aviation  # noqa: F401
