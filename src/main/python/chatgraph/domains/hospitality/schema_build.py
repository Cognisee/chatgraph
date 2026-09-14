"""Author the hospitality domain GraphSchema and write it to JSON.

Offline schema-authoring step. Run via::

    chatgraph-build-schema hospitality

Output: ``src/main/json/hospitality.json`` at the project root.

Role: like every other domain's ``schema_build.py``, this module is a
*convenience authoring tool*, not a runtime dependency (see "Schema: one
source of truth" in ``CLAUDE.md``). The runtime never imports it;
``hospitality.json`` is what the application loads.

Provenance: the hospitality schema originally arrived as a hand-written
JSON artifact in the web prototype, accompanied by a ``schema_build.py``
that merely *validated* the committed file rather than producing it.
That inverted the project's one-directional rule -- JSON is generated
from Python, never the other way around -- and left the artifact in the
pre-0.17.1 ``@key``/``@value`` encoding, which the current runtime
cannot read. This module restores the invariant by declaring the schema
as data and emitting the JSON through the same pgdsl path the medical
and aviation domains use.

Design notes
------------

The model is an expert-knowledge-capture schema rather than a clinical
one:

* **Person** roots the graph and is tied to a **KnowledgeSession**, so
  each interview is a first-class object carrying its own objective and
  confidentiality level.
* **Operating knowledge** is split by kind -- ``ServiceStandard``,
  ``TimingRule``, ``DecisionRule``, ``OperatingHeuristic``,
  ``ExceptionRule`` -- because these are elicited and reasoned about
  differently even though they all constrain behaviour.
* **ProvenanceEvidence** hangs off the rule-like vertices, keeping the
  record attributable: a heuristic is traceable to what the expert
  actually said, not averaged into anonymous guidance.
* All vertex ids are strings; the sole non-string property is
  ``SessionSection.order``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import hydra.dsl.core as dsl_core

from chatgraph.schema.pgdsl import (
    edge_type,
    encode_graph_schema,
    graph_schema,
    vertex_type,
)


# Literal-type shorthands used by the tables below.
S = "S"
I32 = "I32"
B = "B"

_TYPES = {
    "S": dsl_core.literal_type_string,
    "I32": dsl_core.literal_type_integer(dsl_core.integer_type_int32),
    "B": dsl_core.literal_type_boolean,
}


VERTICES = [
    ('Person', [('name', 'S', False)]),
    ('ExpertRole', [('title', 'S', True), ('description', 'S', False)]),
    ('HospitalityBusiness', [('name', 'S', True), ('businessType', 'S', False), ('scale', 'S', False), ('description', 'S', False)]),
    ('OperatingTenure', [('duration', 'S', True), ('description', 'S', False)]),
    ('KnowledgeSession', [('domain', 'S', True), ('expertName', 'S', False), ('expertRole', 'S', False), ('date', 'S', False), ('objective', 'S', False), ('confidentialityLevel', 'S', False)]),
    ('SessionSection', [('sectionType', 'S', True), ('title', 'S', False), ('order', 'I32', True), ('purpose', 'S', False)]),
    ('TranscriptEpisode', [('verbatimText', 'S', True), ('speaker', 'S', False), ('startTime', 'S', False), ('endTime', 'S', False), ('confidence', 'S', False)]),
    ('ProvenanceEvidence', [('traceText', 'S', True), ('sourceEpisode', 'S', True), ('speaker', 'S', True), ('timestamp', 'S', False), ('confidence', 'S', False)]),
    ('GuestExperiencePrinciple', [('name', 'S', True), ('description', 'S', False), ('type', 'S', False), ('neverCompromise', 'B', False)]),
    ('ServiceStandard', [('name', 'S', True), ('standardText', 'S', False), ('nonNegotiable', 'B', False), ('appliesToSegment', 'S', False)]),
    ('GuestSignal', [('name', 'S', True), ('signalType', 'S', False), ('interpretation', 'S', False), ('highValueIndicator', 'B', False), ('returnLikelihood', 'S', False)]),
    ('GuestPersona', [('name', 'S', True), ('description', 'S', False), ('primaryNeed', 'S', False), ('valueDriver', 'S', False), ('repeatGuest', 'B', False)]),
    ('CheckInPolicy', [('standardTime', 'S', False), ('earlyCheckIn', 'B', False), ('earlyCheckInFee', 'B', False), ('sweetSpotTime', 'S', False), ('earlyArrivalHandling', 'S', False), ('rationale', 'S', False)]),
    ('CheckOutPolicy', [('standardTime', 'S', False), ('lateCheckOut', 'B', False), ('lateCheckOutFee', 'B', False), ('lateHandlingApproach', 'S', False), ('rationale', 'S', False)]),
    ('TimingRule', [('ruleText', 'S', True), ('ruleType', 'S', False), ('ifCondition', 'S', False), ('thenAction', 'S', False), ('exception', 'S', False), ('refinedThroughExperience', 'B', False)]),
    ('ServiceFailure', [('name', 'S', True), ('frequency', 'S', False), ('description', 'S', False), ('severity', 'S', False)]),
    ('RecoveryAction', [('name', 'S', True), ('actionType', 'S', False), ('description', 'S', False), ('leadsToLoyalty', 'B', False), ('commonMistake', 'S', False)]),
    ('ExceptionRule', [('ruleText', 'S', True), ('triggerCondition', 'S', False), ('paidOff', 'B', False), ('guestSegment', 'S', False), ('frequency', 'S', False)]),
    ('DecisionRule', [('ruleText', 'S', True), ('ifCondition', 'S', False), ('thenAction', 'S', False), ('exception', 'S', False), ('priority', 'S', False), ('intuitionBased', 'B', False)]),
    ('OperatingHeuristic', [('name', 'S', True), ('heuristic', 'S', False), ('whenUsed', 'S', False), ('learnedThrough', 'S', False)]),
    ('LoyaltyDriver', [('name', 'S', True), ('description', 'S', False), ('driverType', 'S', False), ('turnsAdvocate', 'B', False), ('destroysTrust', 'B', False)]),
    ('EmotionalMoment', [('name', 'S', True), ('description', 'S', False), ('momentType', 'S', False), ('gestureScale', 'S', False), ('outsizedImpact', 'B', False)]),
    ('ContextualConstraint', [('constraintType', 'S', False), ('seasonality', 'S', False), ('location', 'S', False), ('staffingFactor', 'S', False), ('customerMix', 'S', False), ('operationalBottleneck', 'S', False)]),
    ('Outcome', [('outcomeType', 'S', False), ('description', 'S', False), ('guestRetained', 'B', False), ('loyaltyAchieved', 'B', False), ('revenueImpact', 'S', False)]),
]

EDGES = [
    ('hasSession', 'Person', 'KnowledgeSession'),
    ('hasRole', 'Person', 'ExpertRole'),
    ('operatesBusiness', 'Person', 'HospitalityBusiness'),
    ('hasOperatingTenure', 'HospitalityBusiness', 'OperatingTenure'),
    ('hasSection', 'KnowledgeSession', 'SessionSection'),
    ('hasEpisode', 'SessionSection', 'TranscriptEpisode'),
    ('discusses', 'TranscriptEpisode', 'GuestExperiencePrinciple'),
    ('discussesRule', 'TranscriptEpisode', 'DecisionRule'),
    ('discussesHeuristic', 'TranscriptEpisode', 'OperatingHeuristic'),
    ('discussesFailure', 'TranscriptEpisode', 'ServiceFailure'),
    ('experienceDesignedFor', 'GuestExperiencePrinciple', 'GuestPersona'),
    ('businessDifferentiatedBy', 'HospitalityBusiness', 'GuestExperiencePrinciple'),
    ('standardDeliveredTo', 'ServiceStandard', 'GuestPersona'),
    ('standardEnforces', 'ServiceStandard', 'GuestExperiencePrinciple'),
    ('signalTriggers', 'GuestSignal', 'DecisionRule'),
    ('signalIndicates', 'GuestSignal', 'GuestPersona'),
    ('governs', 'CheckInPolicy', 'TimingRule'),
    ('governsCheckOut', 'CheckOutPolicy', 'TimingRule'),
    ('resolvedBy', 'ServiceFailure', 'RecoveryAction'),
    ('exceptionAppliesTo', 'ExceptionRule', 'DecisionRule'),
    ('exceptionMadeFor', 'ExceptionRule', 'GuestPersona'),
    ('heuristicExplains', 'OperatingHeuristic', 'DecisionRule'),
    ('leadsTo', 'DecisionRule', 'Outcome'),
    ('recoveryLeadsTo', 'RecoveryAction', 'Outcome'),
    ('shapesLoyalty', 'EmotionalMoment', 'LoyaltyDriver'),
    ('drivenBy', 'LoyaltyDriver', 'GuestPersona'),
    ('loyaltyLeadsTo', 'LoyaltyDriver', 'Outcome'),
    ('modulatedBy', 'ContextualConstraint', 'DecisionRule'),
    ('constraintAffectsPolicy', 'ContextualConstraint', 'CheckInPolicy'),
    ('supportedBy', 'DecisionRule', 'ProvenanceEvidence'),
    ('principleSupportedBy', 'GuestExperiencePrinciple', 'ProvenanceEvidence'),
    ('heuristicSupportedBy', 'OperatingHeuristic', 'ProvenanceEvidence'),
]


def _literal(name: str):
    """Resolve a shorthand type name to its Hydra literal type."""
    return _TYPES[name]


def build_schema():
    vertices = []
    for label, props in VERTICES:
        b = vertex_type(label, _literal(S))
        for key, type_name, required in props:
            b = b.property(key, _literal(type_name), required)
        vertices.append(b.build())

    edges = [
        edge_type(label, _literal(S), out_v, in_v).build()
        for label, out_v, in_v in EDGES
    ]

    return graph_schema(vertices, edges)


def schema_path() -> Path:
    # __file__: src/main/python/chatgraph/domains/hospitality/schema_build.py
    # parents[4] is src/main/, so the resolved path is
    # src/main/json/hospitality.json.
    return Path(__file__).resolve().parents[4] / "json" / "hospitality.json"


def main() -> int:
    encoded = encode_graph_schema(build_schema())
    out = schema_path()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(encoded + "\n")
    counts = json.loads(encoded)
    print(f"Wrote {out}")
    print(
        f"  {len(counts['vertices'])} vertex types,"
        f" {len(counts['edges'])} edge types"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
