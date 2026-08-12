"""The aviation (field operations) domain.

Importing this module registers the domain in
``chatgraph.domains.REGISTRY`` under the name ``"aviation"``.

The interview subject is an identified pilot describing how *they
personally* operate into a specific site -- not general guidance. See
``docs/aviation-domain-background.md`` for the domain background.
"""

from pathlib import Path

from chatgraph.domains import Domain, register
from chatgraph.domains.aviation.agent_prompt import (
    OPENING_LINE,
    SYSTEM_PROMPT as AGENT_SYSTEM_PROMPT,
)
from chatgraph.domains.aviation.extractor_prompt import EXTRACTOR_PROMPT_INTRO


# Schema JSON path: project_root/src/main/json/aviation.json. Generated
# by chatgraph-build-schema aviation and committed to the repo; this
# module reads it as a peer artifact of the Python sources, both living
# under src/main/. Path computed relative to this file so it works
# regardless of CWD.
# parents[4] from this file is src/main/, so the resolved path is
# src/main/json/aviation.json. Ancestry for reference:
#   [0]=aviation [1]=domains [2]=chatgraph [3]=python
#   [4]=main     [5]=src     [6]=project_root
_SCHEMA_PATH = (
    Path(__file__).resolve().parents[4] / "json" / "aviation.json"
)


DOMAIN = Domain(
    name="aviation",
    schema_path=_SCHEMA_PATH,
    agent_system_prompt=AGENT_SYSTEM_PROMPT,
    extractor_prompt_intro=EXTRACTOR_PROMPT_INTRO,
    opening_line=OPENING_LINE,
    description=(
        "Interview with a pilot about how they personally operate into a "
        "specific airstrip. Covers site characteristics and hazards, "
        "published-vs-personal knowledge, perceptual cues, personal "
        "minimums and doctrine, abort rules and commitment points, "
        "technique, tradeoffs, and lessons from experience."
    ),
    # The graph root. Everything personal -- doctrine, minimums,
    # procedures, skills -- hangs off this vertex, so the record is
    # attributable to an identified individual rather than anonymous.
    # `Person` (the medical default) is not in this domain's schema.
    root_label="Pilot",
    root_id="Pilot:subject",
    root_properties=(("name", "the pilot"),),
    subject_noun="pilot",
    # Proper nouns and aviation jargon that general-purpose speech
    # recognition mangles. Observed failures: "Las Trancas" -> "lost
    # truncus", "Citabria" -> "Sudavia" (which became an
    # `Aircraft:sudavia` vertex in the graph).
    stt_keyterms=(
        "Las Trancas",
        "Citabria",
        "taildragger",
        "tailwheel",
        "backcountry",
        "windsock",
        "rotor",
        "downwind",
        "go-around",
        "short field",
        "soft field",
        "density altitude",
        "power curve",
        "three-point landing",
        "Half Moon Bay",
    ),
)


register(DOMAIN)
