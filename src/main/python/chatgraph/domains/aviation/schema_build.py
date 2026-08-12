"""Author the aviation (field operations) domain GraphSchema and write it to JSON.

Offline schema-authoring step. Run via::

    chatgraph-build-schema aviation

Output: ``src/main/json/aviation.json`` at the project root.

Role: this module is a *convenience authoring tool*, not a runtime
dependency. Its only job is to produce ``aviation.json`` ergonomically --
expressing the schema as readable Python (helpers, shared constants,
loops) instead of hand-writing a large JSON file. The runtime never
imports it; ``aviation.json`` is the single source of truth that the
application loads (see the "Schema: one source of truth" section in
``CLAUDE.md``). Consequently this file is disposable: once the schema is
finalized, ``schema_build.py`` could be dropped and the committed JSON
would stand on its own.

Design notes
------------

This schema models **how one identified pilot personally operates into a
specific site** -- not general guidance, not a procedure manual. It is
built for a demo in which the subject is interviewed about landing a
taildragger at Las Trancas (17CL), a short backcountry strip on a coastal
bluff. See ``docs/aviation-domain-background.md`` for the domain
background and the subject's own account, and
``docs/aviation-schema-draft.md`` for the design rationale.

Vocabulary is deliberately **transferable**: every vertex label is one an
airline operations or safety professional would recognize (``Site``,
``Hazard``, ``PersonalMinimum``, ``AbortRule``, ``Technique``, ``Cue``).
Nothing in a *label* is GA-specific; the taildragger/backcountry
specifics live in property *values*. The audience should read structure
first and aircraft type second.

Structural commitments, each of which exists because something in the
subject's account would otherwise be lost:

* **Attribution and provenance are first-class.** This is one pilot's
  practice. ``PersonalMinimum``, ``Doctrine``, and ``WorkingValue`` are
  explicitly personal; ``PublishedData`` and ``PublishedProcedure`` are
  explicitly not. The edges between them (``corrects``, ``contradicts``,
  ``refines``, ``confirms``, ``stricterThan``, ``elaborates``) are where
  the demo's payload lives: the delta between what is written down and
  what an expert actually does.

* **Doctrine is portable; landmarks are local.** ``Doctrine`` attaches to
  the ``Pilot``, not the ``Site`` ("always be able to stop by the
  midpoint" applies to every short strip). It is ``appliedAt`` a site and
  ``yields`` a site-specific ``AbortRule``, which is ``expressedAs`` a
  ``Landmark``. A second interview about a different strip reuses the
  same Doctrine vertex and grows a new chain from it -- composability
  made structural rather than asserted.

* **Rules can be counterfactual.** ``AbortRule.testType`` distinguishes a
  retained-capability test ("could I stop by there?", evaluated while
  actually rolling past) from an observed outcome. Recording "stops
  before the ramp" would be simply false.

* **Hazards are interactions, not properties.** A ``Hazard``
  ``arisesFrom`` both a ``SiteCharacteristic`` and a ``ConditionFactor``:
  gusts alone are acceptable, a bluff alone is acceptable, wind over this
  bluff is not. ``compoundsWith`` carries the same shape between gates.

* **Landmarks are first-class alongside numbers.** "Until you cross the
  edge of the cliff", "the beginning of the ramp". Tacit knowledge
  attaches to sight pictures; a numbers-only schema loses all of it.

* **As-practiced may diverge from as-recommended.** ``Technique`` carries
  both, plus a divergence reason. The subject landed off his first low
  pass and recommends against it; a schema holding only best practice
  would flatten that.

* **Perception gets real structure.** ``Cue``, ``Sensation``, and
  ``SightPicture`` exist so that perceptual, hard-to-verbalize knowledge
  has somewhere richer to go than a free-text note. This is the analogue
  of the medical schema's ``VisualAura`` detail properties.

Naming conventions:
* Vertex labels are PascalCase.
* Edge labels are camelCase.
"""

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


# =====================================================================
# VERTEX LABELS
# =====================================================================

# --- Root / identity ---
PILOT = "Pilot"
AIRCRAFT = "Aircraft"
SITE = "Site"

# --- The site as it actually is ---
SITE_CHARACTERISTIC = "SiteCharacteristic"
SURFACE = "Surface"
LANDMARK = "Landmark"
HAZARD = "Hazard"
OBSTRUCTION = "Obstruction"
CONSTRAINT = "Constraint"
TERRAIN_FEATURE = "TerrainFeature"
RUNWAY = "Runway"

# --- The published layer (what anyone can look up) ---
PUBLISHED_DATA = "PublishedData"
PUBLISHED_PROCEDURE = "PublishedProcedure"
WORKING_VALUE = "WorkingValue"

# --- Conditions ---
CONDITION_FACTOR = "ConditionFactor"
WIND_CONDITION = "WindCondition"
VISIBILITY_CONDITION = "VisibilityCondition"
LIGHT_CONDITION = "LightCondition"
DENSITY_ALTITUDE_CONDITION = "DensityAltitudeCondition"
LOADING_CONDITION = "LoadingCondition"
SURFACE_CONDITION = "SurfaceCondition"

# --- Perception (deliberately rich; see design notes) ---
CUE = "Cue"
SIGHT_PICTURE = "SightPicture"
SENSATION = "Sensation"
SOUND_CUE = "SoundCue"
INFORMATION_SOURCE = "InformationSource"
# A calibrated expectation of "normal here", against which deviations
# are judged. See the Baseline vertex type for why this is separate.
BASELINE = "Baseline"
# An in-flight forecast used to test a rule against a predicted outcome.
PROJECTION = "Projection"

# --- Rules, limits, doctrine ---
DOCTRINE = "Doctrine"
PERSONAL_MINIMUM = "PersonalMinimum"
ABORT_RULE = "AbortRule"
COMMITMENT_POINT = "CommitmentPoint"
GATE = "Gate"

# --- Procedure and technique ---
PROCEDURE = "Procedure"
STEP = "Step"
PURPOSE = "Purpose"
TECHNIQUE = "Technique"
CONFIGURATION = "Configuration"
ENERGY_STATE = "EnergyState"

# --- Judgment ---
TRADEOFF = "Tradeoff"
TRADEOFF_SIDE = "TradeoffSide"
DECISION = "Decision"
RATIONALE = "Rationale"
CONSEQUENCE = "Consequence"
CONTINGENCY = "Contingency"

# --- Reflection / experience ---
EXPERIENCE = "Experience"
LESSON_LEARNED = "LessonLearned"
SKILL = "Skill"

# --- Open-world escape hatch + reification indirection ---
COMMENT = "Comment"
CONCEPT = "Concept"


# Phase-of-flight enumeration. Carried as a `phase` *property* on the
# types that need it rather than as a FlightPhase vertex -- a vertex
# would become a hub that nearly everything hangs off, adding a hop
# without adding meaning.
#
# Note the deliberate absence of "arrival": in aviation that term names
# a published STAR procedure into a terminal area, which is not what
# happens at a 800 ft backcountry strip. The operation here is an
# *approach* -- pattern, final, landing, rollout. Using "arrival" would
# sound wrong to any pilot watching the recording, and would put the
# wrong word in the subject's mouth.
PHASES = (
    "planning",      # before the flight: go/no-go, personal minimums
    "enroute",       # transit to the field
    "overflight",    # the low pass / inspection pass
    "pattern",       # downwind, base
    "final",         # final approach, including the bluff crossing
    "landing",       # flare and touchdown
    "rollout",       # braking and the stop-by-the-ramp test
    "ground",        # taxi, parking
    "departure",     # takeoff and climb out
)


# Condition subtypes that share the "one typed reading" shape. Each is a
# concrete vertex type carrying its own value, reached from a
# ConditionFactor-style edge on Site or Decision.
CONDITION_SUBTYPES = (
    (WIND_CONDITION, "windCondition"),
    (VISIBILITY_CONDITION, "visibilityCondition"),
    (LIGHT_CONDITION, "lightCondition"),
    (DENSITY_ALTITUDE_CONDITION, "densityAltitudeCondition"),
    (LOADING_CONDITION, "loadingCondition"),
    (SURFACE_CONDITION, "surfaceCondition"),
)

# Perceptual vertex types reachable from a Cue. Split by sensory channel
# so that "what I see" and "what I feel" don't collapse into one blob --
# the demo's most valuable material is perceptual.
PERCEPT_TYPES = (
    (SIGHT_PICTURE, "seenAs"),
    (SENSATION, "feltAs"),
    (SOUND_CUE, "heardAs"),
)

# Vocabulary labels a Concept can reify (everything except Concept
# itself, Comment, and pure structural roots).
VOCABULARY_LABELS = (
    AIRCRAFT, SITE,
    SITE_CHARACTERISTIC, SURFACE, LANDMARK, HAZARD, OBSTRUCTION,
    CONSTRAINT, TERRAIN_FEATURE, RUNWAY,
    PUBLISHED_DATA, PUBLISHED_PROCEDURE, WORKING_VALUE,
    CONDITION_FACTOR,
    WIND_CONDITION, VISIBILITY_CONDITION, LIGHT_CONDITION,
    DENSITY_ALTITUDE_CONDITION, LOADING_CONDITION, SURFACE_CONDITION,
    CUE, SIGHT_PICTURE, SENSATION, SOUND_CUE, INFORMATION_SOURCE,
    BASELINE, PROJECTION,
    DOCTRINE, PERSONAL_MINIMUM, ABORT_RULE, COMMITMENT_POINT, GATE,
    PROCEDURE, STEP, PURPOSE, TECHNIQUE, CONFIGURATION, ENERGY_STATE,
    TRADEOFF, TRADEOFF_SIDE, DECISION, RATIONALE, CONSEQUENCE,
    CONTINGENCY,
    EXPERIENCE, LESSON_LEARNED, SKILL,
)


def build_schema():
    # Literal types straight from Hydra's DSL: the simple ones are values,
    # the parameterized ones (int32) are functions over a type argument.
    s = dsl_core.literal_type_string
    b = dsl_core.literal_type_boolean
    i = dsl_core.literal_type_integer(dsl_core.integer_type_int32)

    # -----------------------------------------------------------------
    # VERTEX TYPES
    # -----------------------------------------------------------------

    # --- Root / identity ---
    # The subject. Graph root, analogous to medical's Person. Everything
    # personal (doctrine, minimums, technique) hangs off this vertex,
    # which is what makes the record attributable rather than anonymous.
    pilot = (
        vertex_type(PILOT, s)
        .property("name", s, False)
        # e.g. "private, instrument, tailwheel endorsement"
        .property("ratings", s, False)
        # free text: "taildragger, backcountry, aerobatics"
        .property("experienceSummary", s, False)
        .property("totalHours", i, False)
        .build()
    )

    aircraft = (
        vertex_type(AIRCRAFT, s)
        .property("type", s, True)              # "7KCAB Citabria"
        .property("manufacturer", s, False)     # "American Champion"
        # tailwheel | tricycle -- load-bearing for this subject's rules
        .property("gearConfiguration", s, False)
        .property("engineHp", i, False)
        .property("tireType", s, False)         # "standard" | "tundra"
        .property("notes", s, False)
        .build()
    )

    # Deliberately Site, not Airport: an airline's equivalent is a
    # station, and the schema should read as transferable.
    site = (
        vertex_type(SITE, s)
        .property("identifier", s, False)       # "17CL"
        .property("name", s, True)              # "Las Trancas"
        # backcountryStrip | towered | uncontrolled | privateStrip
        .property("siteType", s, False)
        .property("elevationFt", i, False)
        .property("coordinates", s, False)
        .property("access", s, False)           # "private, PPR, briefing required"
        .build()
    )

    # --- The site as it actually is ---

    site_characteristic = (
        vertex_type(SITE_CHARACTERISTIC, s)
        .property("value", s, True)             # "very short", "on a bluff"
        # geometry | surface | terrain | environment | access
        .property("category", s, False)
        # How much this characteristic drives difficulty: "governing" |
        # "significant" | "minor". The subject named four *governing*
        # facts whose combination is the whole problem.
        .property("severity", s, False)
        .property("note", s, False)
        .build()
    )

    runway = (
        vertex_type(RUNWAY, s)
        .property("identifier", s, False)       # "14/32"
        .property("lengthFt", i, False)
        .property("widthFt", i, False)
        .property("surfaceType", s, False)
        # Slope and straightness are separate facts here and both matter.
        .property("slope", s, False)            # "downhill past midpoint on 14"
        .property("straightness", s, False)     # "slight turn to the right"
        .property("preferredDirection", s, False)
        .property("note", s, False)
        .build()
    )

    surface = (
        vertex_type(SURFACE, s)
        .property("value", s, True)             # "gravel"
        .property("condition", s, False)        # "rough", "recently graded"
        .property("variability", s, False)      # "varies with season/maintenance"
        .property("note", s, False)
        .build()
    )

    # First-class, and load-bearing. Tacit knowledge attaches to sight
    # pictures ("the edge of the cliff", "the beginning of the ramp"),
    # not to altitudes and airspeeds. A numbers-only schema loses it.
    landmark = (
        vertex_type(LANDMARK, s)
        .property("value", s, True)             # "the edge of the cliff"
        .property("visualDescription", s, False)
        # whatItMarks: "decision point" | "power reduction" | "aim point"
        .property("useCase", s, False)
        # Is this landmark a substitute for a computed quantity? The ramp
        # edge stands in for "the midpoint of the runway" -- a deliberate
        # swap of perception for arithmetic, executable while low, slow,
        # and busy.
        .property("substitutesForMeasurement", b, False)
        # THE OCCLUSION PROBLEM. The cliff edge "passes out of your field
        # of view when you get close, but you see it for long enough that
        # timing tells you when you have crossed." The landmark stops
        # being visible at exactly the moment it must be acted on, so the
        # pilot dead-reckons a few seconds from the last sighting. A
        # written procedure would never capture this -- it would say
        # "cross the threshold at X", never "you will lose sight of it,
        # so count."
        .property("occludedWhenActedOn", b, False)
        # How the pilot bridges the gap: "timingFromLastSighting" |
        # "peripheralReference" | "notApplicable".
        .property("bridgingMethod", s, False)
        .property("note", s, False)
        .build()
    )

    # Hazards are interactions (see arisesFrom edges), not properties of
    # a place. `mechanism` is where the *why* goes -- the difference
    # between "there is turbulence here" and understanding the geometry.
    hazard = (
        vertex_type(HAZARD, s)
        .property("value", s, True)             # "rotor on short final to 32"
        # The physical explanation: "sea breeze over 100ft bluff edge
        # separates into non-laminar flow"
        .property("mechanism", s, False)
        # When it bites: one of PHASES.
        .property("phase", s, False)
        .property("severity", s, False)
        # Whether the hazard sits exactly where the pilot is most
        # committed and has least energy -- the key insight of this site.
        .property("atCommitmentPoint", b, False)
        .property("note", s, False)
        .build()
    )

    obstruction = (
        vertex_type(OBSTRUCTION, s)
        .property("value", s, True)             # "power line"
        .property("distanceFt", i, False)
        .property("bearing", s, False)          # "200 ft east of runway"
        .property("note", s, False)
        .build()
    )

    constraint = (
        vertex_type(CONSTRAINT, s)
        .property("value", s, True)             # "1000 ft overflight restriction"
        # regulatory | environmental | owner | neighborly
        .property("kind", s, False)
        .property("source", s, False)           # "Marine Sanctuary", "owner"
        .property("note", s, False)
        .build()
    )

    terrain_feature = (
        vertex_type(TERRAIN_FEATURE, s)
        .property("value", s, True)             # "100 ft cliff on three sides"
        .property("heightFt", i, False)
        .property("relativePosition", s, False) # "both runway ends", "west side"
        .property("note", s, False)
        .build()
    )

    # --- The published layer ---
    # One vertex per published claim, so a WorkingValue can point at the
    # specific claim it corrects.
    published_data = (
        vertex_type(PUBLISHED_DATA, s)
        .property("field", s, True)             # "runwayLength"
        .property("value", s, True)             # "1300 ft"
        .property("source", s, False)           # "FAA" | "AirNav" | "RAF briefing"
        .property("asOf", s, False)
        .property("note", s, False)
        .build()
    )

    published_procedure = (
        vertex_type(PUBLISHED_PROCEDURE, s)
        .property("value", s, True)             # "remain close to the strip"
        # AFH | briefing | FAA | POH -- different authorities, one type;
        # the interesting relation is contradicts/refines regardless.
        .property("source", s, False)
        .property("summary", s, False)
        .property("phase", s, False)
        .build()
    )

    # The corrected value the pilot actually plans against. The demo's
    # single clearest artifact: published 1300 ft, working 800 ft,
    # established by self-measurement.
    working_value = (
        vertex_type(WORKING_VALUE, s)
        .property("field", s, True)             # "runwayLength"
        .property("value", s, True)             # "800 ft"
        # "self-measured on Google Earth" | "observed" | "briefing"
        .property("establishedBy", s, False)
        .property("confidence", s, False)
        .property("note", s, False)
        .build()
    )

    # --- Conditions ---
    condition_factor = (
        vertex_type(CONDITION_FACTOR, s)
        .property("value", s, True)             # "gusty winds"
        # wind | visibility | light | densityAltitude | loading | surface
        .property("factor", s, False)
        # acceptable | marginal | disqualifying
        .property("acceptability", s, False)
        # Whether this factor is only disqualifying in combination with
        # something else (the compounding structure the subject uses).
        .property("onlyInCombination", b, False)
        .property("note", s, False)
        .build()
    )

    condition_subtype_vts = [
        (
            vertex_type(label, s)
            .property("value", s, True)
            .property("acceptability", s, False)
            .property("threshold", s, False)
            .property("note", s, False)
            .build()
        )
        for label, _ in CONDITION_SUBTYPES
    ]

    # --- Perception ---
    # Deliberately rich. This is the analogue of medical's VisualAura:
    # the place where hard-to-verbalize expert perception lands. If the
    # interview produces one memorable line, it will live here.
    # The practice interview reshaped this type substantially. Two
    # findings drove the changes:
    #
    # 1. The subject's primary sensing channel is NOT visual. He reads
    #    wind from the corrections the airplane demands and from how
    #    those demands change with altitude -- perception *mediated by
    #    the aircraft's response*, not perception of the environment.
    #    Hence `mediatedBy`.
    # 2. A sensation can be the threat itself (sub-1g sink, which
    #    determines whether he makes the threshold) or an *instrument*
    #    for measuring the threat (buffeting, which "tells you the
    #    boundaries of the turbulent area"). Same channel, opposite
    #    roles. Hence `role`.
    cue = (
        vertex_type(CUE, s)
        .property("value", s, True)             # "sink just before the cliff edge"
        # visual | kinesthetic | aural | proprioceptive
        .property("sensoryChannel", s, False)
        # What carries the signal to the pilot: "aircraftResponse" |
        # "directObservation" | "instrument". The subject reads wind
        # through the airplane, not through the windscreen.
        .property("mediatedBy", s, False)
        # threat | instrument | confirmation. A sub-1g drop IS the
        # danger; buffeting MEASURES the danger. Collapsing these would
        # lose the distinction the subject draws most sharply.
        .property("role", s, False)
        # When in the operation this cue is read.
        .property("whenObserved", s, False)
        # What the pilot concludes from it.
        .property("indicates", s, False)
        # Is this cue available to a novice, or does it require
        # experience to notice/interpret? The heart of tacit knowledge.
        .property("requiresExperience", b, False)
        # Whether the cue appears in any published source.
        .property("isDocumented", b, False)
        # Whether this cue's meaning is bound to this specific site. The
        # subject is explicit that his feel for this air does not
        # transfer: "there is no other strip like it in Northern
        # California."
        .property("siteSpecific", b, False)
        .property("note", s, False)
        .build()
    )

    # A calibrated expectation of what "normal" feels like here, against
    # which deviations are judged. The single most expert structure in
    # the account: the abort trigger is not "sink" but "sink beyond the
    # slight mushy sensation I always feel just before the cliff edge."
    # Detection is by *comparison*, and the baseline is itself the
    # knowledge -- a pilot without it has nothing to compare against.
    baseline = (
        vertex_type(BASELINE, s)
        .property("value", s, True)             # "slight mushy sensation"
        .property("phase", s, False)
        # How the baseline was acquired: "repeatedExposure" |
        # "instruction" | "firstPrinciples".
        .property("establishedBy", s, False)
        # What a departure from it means.
        .property("deviationSignifies", s, False)
        .property("siteSpecific", b, False)
        .property("note", s, False)
        .build()
    )

    sight_picture = (
        vertex_type(SIGHT_PICTURE, s)
        .property("value", s, True)             # "runway edge sits here in the windscreen"
        .property("phase", s, False)
        .property("note", s, False)
        .build()
    )

    sensation = (
        vertex_type(SENSATION, s)
        .property("value", s, True)             # "sharp jolt, then the wing drops"
        .property("intensity", s, False)
        .property("bodyReference", s, False)    # "through the stick", "in the seat"
        .property("note", s, False)
        .build()
    )

    sound_cue = (
        vertex_type(SOUND_CUE, s)
        .property("value", s, True)             # "engine note changes"
        .property("note", s, False)
        .build()
    )

    information_source = (
        vertex_type(INFORMATION_SOURCE, s)
        .property("value", s, True)             # "the low pass", "windsock"
        # How much the pilot trusts it, and why.
        .property("reliability", s, False)
        .property("availability", s, False)     # "only on site", "preflight"
        # Whether it samples the same conditions the decision needs. The
        # low pass is explicitly an imperfect proxy and the subject knows
        # it -- that awareness is itself expert knowledge.
        .property("isProxy", b, False)
        .property("proxyLimitation", s, False)
        .property("note", s, False)
        .build()
    )

    # --- Rules, limits, doctrine ---

    # Portable, self-authored, cross-site. Attaches to the Pilot, NOT the
    # Site: "always be able to stop by the midpoint" applies to every
    # short strip. This is the composability showpiece -- a second
    # interview about a different field reuses this vertex.
    doctrine = (
        vertex_type(DOCTRINE, s)
        .property("value", s, True)
        # allShortStrips | allOperations | thisSiteOnly
        .property("scope", s, False)
        # self-authored | taught | regulatory | inherited
        .property("origin", s, False)
        .property("heldSince", s, False)
        # Has it ever been revised? Stability is itself informative.
        .property("revised", b, False)
        .property("note", s, False)
        .build()
    )

    personal_minimum = (
        vertex_type(PERSONAL_MINIMUM, s)
        .property("value", s, True)             # "no gusty conditions"
        .property("factor", s, False)           # wind | visibility | light | ...
        # Always false by construction for this type, but explicit so the
        # published/personal distinction is visible in the data rather
        # than implied by the label.
        .property("isPublished", b, False)
        # stricterThanPublished | noPublishedEquivalent
        .property("strictness", s, False)
        # NOTE: no `rationale` property here -- reasons are Rationale
        # vertices, reached via `minimumRationale`. Keeping both a
        # property and a vertex type for the same content would scatter
        # reasons across two places and give the extractor a coin-flip.
        # Is this limit about the operator rather than the aircraft or
        # site? "I'm more comfortable in taildraggers" is explicitly
        # about the pilot, and the subject is careful to mark it so.
        .property("aboutOperator", b, False)
        .property("note", s, False)
        .build()
    )

    # testType distinguishes a retained-capability test ("could I stop by
    # there?") from an observed outcome ("I stop by there"). The subject
    # rolls PAST the landmark to park -- and in fact never comes to a
    # full stop at all, easing off at taxi speed -- so the counterfactual
    # is evaluated against an outcome that occurs on no flight ever.
    # Recording the observed version would be simply false.
    abort_rule = (
        vertex_type(ABORT_RULE, s)
        .property("value", s, True)
        # counterfactual | observed | timeBased | positionBased
        .property("testType", s, False)
        .property("action", s, False)           # "full power, go around"
        # Continuously during the roll, or checked at one moment?
        .property("evaluatedWhen", s, False)
        .property("timesTriggered", i, False)
        .property("note", s, False)
        .build()
    )

    # How the pilot predicts an outcome in flight in order to test a rule
    # against it. The rollout test is not a spatial comparison of the
    # ramp's position -- it is a running forecast: from felt braking
    # effectiveness the subject projects where he will end up, and
    # compares *that* against the landmark. Modeling the test as
    # "is the ramp still ahead?" would miss the mechanism entirely.
    projection = (
        vertex_type(PROJECTION, s)
        .property("value", s, True)          # "where I will be when I stop"
        # What the forecast is built from: "feltDeceleration" |
        # "elapsedTime" | "sightPicture" | "aircraftFamiliarity".
        .property("basedOn", s, False)
        .property("phase", s, False)
        # Continuously updated, or computed once?
        .property("updatedContinuously", b, False)
        # What degrades the forecast. A bounce delays braking onset,
        # which pushes the predicted stop past the ramp, which fails the
        # test -- one causal chain, not two independent rules.
        .property("degradedBy", s, False)
        .property("note", s, False)
        .build()
    )

    commitment_point = (
        vertex_type(COMMITMENT_POINT, s)
        .property("value", s, True)
        .property("phase", s, False)
        # After this point the go-around is no longer available.
        .property("afterWhichNoGoAround", b, False)
        .property("note", s, False)
        .build()
    )

    # A pass/fail decision gate applied before or during an operation.
    # Distinct from PersonalMinimum (a standing limit): a Gate is the
    # moment the limit is evaluated.
    gate = (
        vertex_type(GATE, s)
        .property("value", s, True)             # "go/no-go before departing"
        .property("phase", s, False)
        .property("outcomeIfFailed", s, False)  # "don't launch", "go around"
        # Some gates remove a decision entirely rather than informing it
        # (e.g. "if the wind favored 14, I wouldn't land at all").
        .property("collapsesDecision", b, False)
        .property("note", s, False)
        .build()
    )

    # --- Procedure and technique ---
    procedure = (
        vertex_type(PROCEDURE, s)
        .property("value", s, True)             # "the approach at 17CL"
        .property("phase", s, False)
        # True when this is how the subject personally does it, as
        # opposed to a published sequence.
        .property("isPersonal", b, False)
        .property("note", s, False)
        .build()
    )

    step = (
        vertex_type(STEP, s)
        .property("value", s, True)             # "fly a low pass"
        .property("sequence", i, False)
        .property("phase", s, False)
        .property("optional", b, False)
        .property("note", s, False)
        .build()
    )

    # Many-to-one with Step, on purpose: the low pass serves three
    # distinct purposes and the subject enumerated them as a list.
    purpose = (
        vertex_type(PURPOSE, s)
        .property("value", s, True)
        .property("note", s, False)
        .build()
    )

    # asPracticed / asRecommended exist so the subject's self-correction
    # survives into the graph instead of being normalized into best
    # practice. The *reason* for a divergence is a Rationale vertex
    # (via techniqueJustifiedBy), not a property -- same rule as
    # PersonalMinimum.
    technique = (
        vertex_type(TECHNIQUE, s)
        .property("value", s, True)             # "keep power in until the cliff edge"
        .property("phase", s, False)
        .property("asPracticed", s, False)
        .property("asRecommended", s, False)
        # Does this technique depend on a visual landmark rather than an
        # instrument reading?
        .property("landmarkAnchored", b, False)
        # NOTE: no `requiresSkill` property -- that is the
        # `techniqueRequiresSkill` edge to a Skill vertex.
        .property("note", s, False)
        .build()
    )

    configuration = (
        vertex_type(CONFIGURATION, s)
        .property("value", s, True)             # "three-point attitude", "full flaps"
        .property("phase", s, False)
        .property("note", s, False)
        .build()
    )

    # Where the airplane sits relative to the power curve, and what that
    # buys or costs. The subject's approach-speed tradeoff lives here.
    energy_state = (
        vertex_type(ENERGY_STATE, s)
        .property("value", s, True)             # "slightly behind the power curve"
        .property("airspeedRelation", s, False) # "slightly fast" | "at threshold speed"
        .property("phase", s, False)
        .property("margin", s, False)
        .property("note", s, False)
        .build()
    )

    # --- Judgment ---
    # Two-sided by construction: a Tradeoff has exactly two TradeoffSides,
    # each with its own benefit and risk. Modeling this as a single
    # "best value" property would erase the judgment.
    tradeoff = (
        vertex_type(TRADEOFF, s)
        .property("value", s, True)             # "approach speed"
        .property("dimension", s, False)
        .property("resolution", s, False)       # how the subject settles it
        .property("note", s, False)
        .build()
    )

    tradeoff_side = (
        vertex_type(TRADEOFF_SIDE, s)
        .property("direction", s, True)         # "faster" | "slower"
        .property("benefit", s, False)
        .property("risk", s, False)
        .property("note", s, False)
        .build()
    )

    decision = (
        vertex_type(DECISION, s)
        .property("value", s, True)             # "land or go around"
        .property("phase", s, False)
        .property("outcome", s, False)
        # What decides it when the answer is not obvious.
        .property("decidedBy", s, False)
        .property("note", s, False)
        .build()
    )

    # The single home for "why". Reached from PersonalMinimum, Decision,
    # and Technique rather than duplicated as a string property on each
    # -- reasons are shareable (one rationale can justify several
    # choices) and worth seeing as nodes in the rendered graph.
    rationale = (
        vertex_type(RATIONALE, s)
        .property("value", s, True)
        # What kind of reasoning this is: "safetyMargin" | "comfort" |
        # "capability" | "consequenceAvoidance" | "regulatory" |
        # "divergenceFromRecommended". Lets the graph distinguish a
        # reason grounded in equipment from one grounded in the
        # operator's own comfort -- a distinction the subject draws
        # explicitly.
        .property("kind", s, False)
        .property("note", s, False)
        .build()
    )

    consequence = (
        vertex_type(CONSEQUENCE, s)
        .property("value", s, True)             # "gravel thrown up into the wing"
        .property("likelihood", s, False)
        .property("severity", s, False)
        .property("acceptable", b, False)
        .property("note", s, False)
        .build()
    )

    contingency = (
        vertex_type(CONTINGENCY, s)
        .property("value", s, True)             # "go around and reposition"
        .property("triggeredBy", s, False)
        .property("availability", s, False)     # "until the commitment point"
        .property("note", s, False)
        .build()
    )

    # --- Reflection / experience ---
    experience = (
        vertex_type(EXPERIENCE, s)
        .property("value", s, True)             # "first landing at 17CL"
        .property("when", s, False)
        .property("outcome", s, False)
        # Did what happened differ from what the subject now recommends?
        .property("divergedFromRecommended", b, False)
        .property("note", s, False)
        .build()
    )

    lesson_learned = (
        vertex_type(LESSON_LEARNED, s)
        .property("value", s, True)
        .property("changedBehavior", s, False)
        .property("note", s, False)
        .build()
    )

    skill = (
        vertex_type(SKILL, s)
        .property("value", s, True)             # "tailwheel short-field ops"
        .property("proficiency", s, False)
        .property("currency", s, False)
        .property("note", s, False)
        .build()
    )

    # --- Open-world escape hatch + reification indirection ---
    comment = (
        vertex_type(COMMENT, s)
        .property("description", s, True)
        # "operator" = meta-comment from the demo operator about schema
        # gaps; "subject" = the pilot's own free text.
        .property("kind", s, False)
        .build()
    )
    concept = (
        vertex_type(CONCEPT, s)
        .property("label", s, True)
        .property("note", s, False)
        .build()
    )

    vertices = [
        pilot, aircraft, site,
        site_characteristic, runway, surface, landmark, hazard,
        obstruction, constraint, terrain_feature,
        published_data, published_procedure, working_value,
        condition_factor, *condition_subtype_vts,
        cue, sight_picture, sensation, sound_cue, information_source,
        baseline, projection,
        doctrine, personal_minimum, abort_rule, commitment_point, gate,
        procedure, step, purpose, technique, configuration, energy_state,
        tradeoff, tradeoff_side, decision, rationale, consequence,
        contingency,
        experience, lesson_learned, skill,
        comment, concept,
    ]

    # -----------------------------------------------------------------
    # EDGE TYPES
    # -----------------------------------------------------------------

    # --- Pilot-rooted: everything personal hangs off the subject ---
    pilot_edges = [
        edge_type("flies", s, PILOT, AIRCRAFT)
        .property("isPreferred", b, False)
        .property("reason", s, False)
        .property("hoursOnType", i, False)
        .build(),
        # Explicitly excluded equipment. "I'd never land a tricycle-gear
        # airplane here" -- a personal limit about the operator, not a
        # claim about the aircraft's capability.
        edge_type("excludes", s, PILOT, AIRCRAFT)
        .property("reason", s, False)
        .property("aboutOperatorNotEquipment", b, False)
        .property("note", s, False)
        .build(),
        edge_type("operatesAt", s, PILOT, SITE)
        .property("timesLanded", i, False)
        .property("firstLanded", s, False)
        .property("familiarity", s, False)
        .build(),
        edge_type("holds", s, PILOT, DOCTRINE).build(),
        edge_type("observes", s, PILOT, PERSONAL_MINIMUM).build(),
        edge_type("uses", s, PILOT, PROCEDURE).build(),
        edge_type("hasExperience", s, PILOT, EXPERIENCE).build(),
        edge_type("hasSkill", s, PILOT, SKILL).build(),
        edge_type("reads", s, PILOT, CUE)
        .property("confidence", s, False)
        .build(),
    ]

    # --- Site structure: what the place actually is ---
    site_edges = [
        edge_type("hasCharacteristic", s, SITE, SITE_CHARACTERISTIC).build(),
        edge_type("hasRunway", s, SITE, RUNWAY).build(),
        edge_type("hasSurface", s, SITE, SURFACE).build(),
        edge_type("hasLandmark", s, SITE, LANDMARK).build(),
        edge_type("hasHazard", s, SITE, HAZARD).build(),
        edge_type("hasObstruction", s, SITE, OBSTRUCTION).build(),
        edge_type("hasConstraint", s, SITE, CONSTRAINT).build(),
        edge_type("hasTerrainFeature", s, SITE, TERRAIN_FEATURE).build(),
        edge_type("publishedAs", s, SITE, PUBLISHED_DATA).build(),
        edge_type("hasPublishedProcedure", s, SITE, PUBLISHED_PROCEDURE).build(),
        edge_type("hasWorkingValue", s, SITE, WORKING_VALUE).build(),
        edge_type("presentsCondition", s, SITE, CONDITION_FACTOR)
        .property("typicality", s, False)   # "typical here" | "occasional"
        .build(),
    ]

    # --- Published vs personal: the demo's payload ---
    # These edges are where "what's written down" meets "what an expert
    # actually does". Every one of them is a delta the interview exists
    # to surface.
    published_personal_edges = [
        edge_type("corrects", s, WORKING_VALUE, PUBLISHED_DATA)
        .property("method", s, False)        # "measured on Google Earth"
        .property("discrepancy", s, False)   # "500 ft, in the dangerous direction"
        .property("note", s, False)
        .build(),
        edge_type("establishedBy", s, WORKING_VALUE, INFORMATION_SOURCE).build(),
        edge_type("contradicts", s, TECHNIQUE, PUBLISHED_PROCEDURE)
        .property("reason", s, False)
        .property("acknowledgesTension", b, False)
        .build(),
        edge_type("refines", s, TECHNIQUE, PUBLISHED_PROCEDURE)
        .property("reason", s, False)
        .build(),
        edge_type("confirms", s, TECHNIQUE, PUBLISHED_PROCEDURE).build(),
        edge_type("stricterThan", s, PERSONAL_MINIMUM, PUBLISHED_DATA)
        .property("reason", s, False)
        .build(),
        # "The briefing says wind shear; here's the geometry of why."
        edge_type("elaborates", s, HAZARD, PUBLISHED_DATA)
        .property("addedUnderstanding", s, False)
        .build(),
        edge_type("elaboratesProcedure", s, HAZARD, PUBLISHED_PROCEDURE).build(),
    ]

    # --- Hazards as interactions, not properties ---
    # A hazard arises from a site characteristic AND a condition; either
    # alone is acceptable. This is the structure behind "gusts are a
    # no-go *here*".
    hazard_edges = [
        edge_type("arisesFrom", s, HAZARD, SITE_CHARACTERISTIC)
        .property("contribution", s, False)
        .build(),
        edge_type("arisesFromCondition", s, HAZARD, CONDITION_FACTOR)
        .property("contribution", s, False)
        .build(),
        edge_type("arisesFromTerrain", s, HAZARD, TERRAIN_FEATURE).build(),
        # The key insight at this site: the hazard sits exactly where the
        # pilot is most committed and has least energy.
        edge_type("coincidesWith", s, HAZARD, STEP)
        .property("whyItMatters", s, False)
        .build(),
        edge_type("coincidesWithCommitment", s, HAZARD, COMMITMENT_POINT).build(),
        edge_type("counteredBy", s, HAZARD, TECHNIQUE)
        .property("howItHelps", s, False)
        .build(),
        edge_type("hazardCue", s, HAZARD, CUE).build(),
        edge_type("hazardConsequence", s, HAZARD, CONSEQUENCE).build(),
    ]

    # --- The doctrine chain: general -> site -> measurement -> landmark ---
    # Four different kinds of knowledge in one chain. Doctrine is
    # portable (Pilot-rooted); the landmark is local to the site.
    doctrine_edges = [
        edge_type("appliedAt", s, DOCTRINE, SITE)
        .property("note", s, False)
        .build(),
        edge_type("yields", s, DOCTRINE, ABORT_RULE)
        .property("derivation", s, False)
        .build(),
        edge_type("measuredBy", s, ABORT_RULE, INFORMATION_SOURCE)
        .property("method", s, False)
        .build(),
        # The measurement-to-perception conversion: a computed midpoint
        # becomes a sight picture executable while low, slow, and busy.
        edge_type("expressedAs", s, ABORT_RULE, LANDMARK)
        .property("why", s, False)
        .build(),
        edge_type("triggersDecision", s, ABORT_RULE, DECISION).build(),
        edge_type("testedDuring", s, ABORT_RULE, STEP).build(),
        edge_type("abortRuleAt", s, ABORT_RULE, COMMITMENT_POINT).build(),
    ]

    # --- Gates and minimums ---
    gate_edges = [
        edge_type("appliesGate", s, PILOT, GATE).build(),
        edge_type("gateEvaluates", s, GATE, CONDITION_FACTOR).build(),
        edge_type("gateEnforces", s, GATE, PERSONAL_MINIMUM).build(),
        edge_type("gateDecidedBy", s, GATE, INFORMATION_SOURCE)
        # The low pass is the arbiter for borderline cases.
        .property("isTiebreaker", b, False)
        .build(),
        edge_type("gateAtSite", s, GATE, SITE).build(),
        edge_type("minimumFor", s, PERSONAL_MINIMUM, CONDITION_FACTOR).build(),
        # Compounding: this minimum exists because the factor interacts
        # with a site characteristic, not because the factor alone is bad.
        edge_type("compoundsWith", s, PERSONAL_MINIMUM, SITE_CHARACTERISTIC)
        .property("interaction", s, False)
        .build(),
        edge_type("minimumRationale", s, PERSONAL_MINIMUM, RATIONALE).build(),
        edge_type("minimumAtSite", s, PERSONAL_MINIMUM, SITE)
        .property("tightenedForThisSite", b, False)
        .build(),
    ]

    # --- Condition factor typing ---
    condition_edges = [
        edge_type(edge_label, s, CONDITION_FACTOR, label).build()
        for label, edge_label in CONDITION_SUBTYPES
    ]
    condition_edges += [
        edge_type("assessedVia", s, CONDITION_FACTOR, INFORMATION_SOURCE)
        .property("reliability", s, False)
        .build(),
        edge_type("conditionAffects", s, CONDITION_FACTOR, DECISION).build(),
        edge_type("conditionCue", s, CONDITION_FACTOR, CUE).build(),
        # Heat alone is fine; heat plus the usual wind is not.
        edge_type("conditionCompoundsWith", s, CONDITION_FACTOR, CONDITION_FACTOR)
        .property("interaction", s, False)
        .build(),
    ]

    # --- Perception: cues and their sensory realization ---
    percept_edges = [
        edge_type(edge_label, s, CUE, label).build()
        for label, edge_label in PERCEPT_TYPES
    ]
    percept_edges += [
        edge_type("cueObservedDuring", s, CUE, STEP).build(),
        edge_type("cueIndicates", s, CUE, CONDITION_FACTOR).build(),
        edge_type("cueInforms", s, CUE, DECISION).build(),
        edge_type("cueFrom", s, CUE, INFORMATION_SOURCE).build(),
        edge_type("cueAtLandmark", s, CUE, LANDMARK).build(),
        # A cue is read as a *departure from* an expected baseline, not
        # in absolute terms. "A powerful drop" only means something
        # against "the slight mushy sensation I always feel here."
        edge_type("comparedAgainst", s, CUE, BASELINE)
        .property("deviationDirection", s, False)   # "more than" | "less than"
        .property("deviationSignificance", s, False)
        .build(),
        # The cue that measures a hazard (buffeting mapping the extent of
        # the turbulent zone) as opposed to the cue that IS the hazard.
        edge_type("cueMeasures", s, CUE, HAZARD)
        .property("whatItReveals", s, False)  # "boundaries and strength"
        .build(),
        edge_type("baselineAtSite", s, BASELINE, SITE).build(),
        edge_type("baselineFor", s, BASELINE, CUE).build(),
        edge_type("baselineBuiltBy", s, BASELINE, EXPERIENCE).build(),
        # Perception through the airplane's response rather than through
        # direct observation of the world.
        edge_type("sensedThrough", s, CUE, AIRCRAFT)
        .property("via", s, False)   # "control corrections", "seat of the pants"
        .build(),
    ]

    # --- Projection: forecasting an outcome to test a rule against ---
    projection_edges = [
        edge_type("projects", s, PILOT, PROJECTION).build(),
        edge_type("projectionBasedOn", s, PROJECTION, CUE).build(),
        edge_type("projectionDuring", s, PROJECTION, STEP).build(),
        # The abort rule tests the *forecast*, not the current position.
        edge_type("abortRuleTests", s, ABORT_RULE, PROJECTION)
        .property("comparedTo", s, False)   # "the beginning of the ramp"
        .build(),
        edge_type("projectionComparedToLandmark", s, PROJECTION, LANDMARK).build(),
        # A bounce degrades the stopping forecast, which then fails the
        # test -- the abort is reached *through* the projection.
        edge_type("projectionDegradedBy", s, PROJECTION, CONSEQUENCE)
        .property("how", s, False)
        .build(),
        edge_type("projectionUsesSkill", s, PROJECTION, SKILL).build(),
    ]

    # --- Procedure, steps, purposes, technique ---
    procedure_edges = [
        edge_type("hasStep", s, PROCEDURE, STEP)
        .property("sequence", i, False)
        .build(),
        edge_type("procedureAtSite", s, PROCEDURE, SITE).build(),
        edge_type("procedureForAircraft", s, PROCEDURE, AIRCRAFT).build(),
        # One step, many purposes -- the low pass serves three.
        edge_type("servesPurpose", s, STEP, PURPOSE)
        .property("primary", b, False)
        .build(),
        edge_type("stepInforms", s, STEP, DECISION).build(),
        edge_type("stepProvidesInfoAbout", s, STEP, CONDITION_FACTOR).build(),
        edge_type("stepUsesTechnique", s, STEP, TECHNIQUE).build(),
        edge_type("stepConfiguration", s, STEP, CONFIGURATION).build(),
        edge_type("stepEnergyState", s, STEP, ENERGY_STATE).build(),
        edge_type("stepFollowedBy", s, STEP, STEP).build(),
        edge_type("stepHasContingency", s, STEP, CONTINGENCY).build(),
    ]

    technique_edges = [
        edge_type("techniqueAnchoredTo", s, TECHNIQUE, LANDMARK)
        .property("relation", s, False)   # "hold until", "begin at"
        .build(),
        edge_type("techniqueJustifiedBy", s, TECHNIQUE, RATIONALE).build(),
        edge_type("techniqueRequiresSkill", s, TECHNIQUE, SKILL).build(),
        edge_type("techniqueConfiguration", s, TECHNIQUE, CONFIGURATION).build(),
        edge_type("techniqueEnergyState", s, TECHNIQUE, ENERGY_STATE).build(),
        edge_type("techniqueConsequence", s, TECHNIQUE, CONSEQUENCE).build(),
        edge_type("techniqueForAircraft", s, TECHNIQUE, AIRCRAFT).build(),
    ]

    # --- Judgment: tradeoffs, decisions, contingencies ---
    judgment_edges = [
        # Exactly two sides by convention; each carries its own
        # benefit/risk so neither can be recorded as simply "better".
        edge_type("hasSide", s, TRADEOFF, TRADEOFF_SIDE).build(),
        edge_type("sideRisks", s, TRADEOFF_SIDE, CONSEQUENCE).build(),
        edge_type("sideBuys", s, TRADEOFF_SIDE, PURPOSE).build(),
        edge_type("tradeoffResolvedBy", s, TRADEOFF, PERSONAL_MINIMUM).build(),
        edge_type("tradeoffIn", s, TRADEOFF, STEP).build(),
        edge_type("tradeoffDimension", s, TRADEOFF, ENERGY_STATE).build(),
        edge_type("decisionRationale", s, DECISION, RATIONALE).build(),
        edge_type("decisionOutcome", s, DECISION, CONSEQUENCE).build(),
        edge_type("decisionContingency", s, DECISION, CONTINGENCY).build(),
        edge_type("decisionAtPoint", s, DECISION, COMMITMENT_POINT).build(),
        edge_type("decisionConstrainedBy", s, DECISION, CONSTRAINT).build(),
        edge_type("commitmentAtLandmark", s, COMMITMENT_POINT, LANDMARK).build(),
        edge_type("contingencyRequires", s, CONTINGENCY, ENERGY_STATE)
        # Reserve power exists to be spent on the go-around.
        .property("marginSource", s, False)
        .build(),
        edge_type("contingencyAvailableUntil", s, CONTINGENCY, COMMITMENT_POINT).build(),
        # The escape manoeuvre has technique *inside* it: full power but
        # pitch held constant, accelerating before climbing, so scarce
        # airspeed is not traded for altitude at the worst moment. The
        # engine margin and this technique are one piece of knowledge.
        edge_type("contingencyUsesTechnique", s, CONTINGENCY, TECHNIQUE)
        .property("why", s, False)
        .build(),
        edge_type("contingencyTriggeredByCue", s, CONTINGENCY, CUE).build(),
    ]

    # --- Aircraft suitability and margin ---
    aircraft_edges = [
        edge_type("suitableFor", s, AIRCRAFT, SITE)
        .property("marginNotes", s, False)
        .property("suitability", s, False)   # "preferred" | "adequate" | "excluded"
        .build(),
        # The more powerful engine buys reserve held against the abort --
        # aircraft choice, hazard, and abort rule are one structure.
        edge_type("providesMargin", s, AIRCRAFT, CONTINGENCY)
        .property("how", s, False)
        .build(),
        edge_type("aircraftRequiresSkill", s, AIRCRAFT, SKILL).build(),
        edge_type("aircraftConfiguration", s, AIRCRAFT, CONFIGURATION).build(),
    ]

    # --- Reflection: experience changes practice ---
    experience_edges = [
        edge_type("experienceAt", s, EXPERIENCE, SITE).build(),
        edge_type("experienceInAircraft", s, EXPERIENCE, AIRCRAFT).build(),
        edge_type("taught", s, EXPERIENCE, LESSON_LEARNED).build(),
        # The subject landed off his first low pass and recommends
        # against it: as-practiced diverging from as-recommended.
        edge_type("divergedFrom", s, EXPERIENCE, TECHNIQUE)
        .property("whatDiffered", s, False)
        .property("wouldRepeat", b, False)
        .build(),
        edge_type("lessonModified", s, LESSON_LEARNED, TECHNIQUE).build(),
        edge_type("lessonModifiedMinimum", s, LESSON_LEARNED, PERSONAL_MINIMUM).build(),
        edge_type("lessonModifiedDoctrine", s, LESSON_LEARNED, DOCTRINE).build(),
        edge_type("calibratedBy", s, PERSONAL_MINIMUM, EXPERIENCE).build(),
    ]

    # --- Comment-to-Concept edges (open reference) ---
    comment_edges = [
        edge_type("mentions", s, COMMENT, CONCEPT).build(),
        edge_type("about", s, COMMENT, CONCEPT).build(),
    ]

    # --- Concept-to-vocabulary edges (one per vocabulary label) ---
    concept_edges = [
        edge_type("concept" + label, s, CONCEPT, label).build()
        for label in VOCABULARY_LABELS
    ]

    edges = (
        pilot_edges
        + site_edges
        + published_personal_edges
        + hazard_edges
        + doctrine_edges
        + gate_edges
        + condition_edges
        + percept_edges
        + projection_edges
        + procedure_edges
        + technique_edges
        + judgment_edges
        + aircraft_edges
        + experience_edges
        + comment_edges
        + concept_edges
    )

    return graph_schema(vertices, edges)


def schema_path() -> Path:
    # __file__: src/main/python/chatgraph/domains/aviation/schema_build.py
    # parents[4] is src/main/, so the resolved path is
    # src/main/json/aviation.json. The JSON artifact lives as a peer of
    # the Python sources under src/main/, mirroring Hydra's polyglot
    # src/main/<lang>/ layout. Ancestry for reference:
    #   [0]=aviation [1]=domains [2]=chatgraph [3]=python
    #   [4]=main     [5]=src     [6]=project_root
    return Path(__file__).resolve().parents[4] / "json" / "aviation.json"


def main() -> int:
    encoded = encode_graph_schema(build_schema())
    out = schema_path()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(encoded + "\n")
    # Count off the encoded JSON rather than the schema: build_schema
    # returns a Hydra term, whose shape is Hydra's business, not ours.
    counts = json.loads(encoded)
    print(f"Wrote {out}")
    print(
        f"  {len(counts['vertices'])} vertex types,"
        f" {len(counts['edges'])} edge types"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
