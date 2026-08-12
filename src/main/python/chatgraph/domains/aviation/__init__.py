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
)


register(DOMAIN)
