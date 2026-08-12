# Aviation domain schema — draft for review

**Status: draft for review. No code written yet.** Once approved this
becomes `domains/aviation/schema_build.py` → `src/main/json/aviation.json`.

Proposed domain name: **`aviation`** (CLI: `chatgraph aviation`),
framed in the prose as a **field-operations** schema. Rationale: the CLI
name should be obvious to the demo operator; the *vocabulary* is what
carries transferability to an airline audience.

---

## Design principles

Derived from `aviation-domain-background.md`. Each principle exists
because something in the subject's account would otherwise be lost.

1. **Transferable labels, specific values.** Every vertex label is one
   an airline ops/safety professional recognizes (`Site`, `Hazard`,
   `PersonalMinimum`, `AbortRule`, `Technique`, `Cue`). Nothing says
   "taildragger" or "Citabria" in a *label*; those live in property
   values. The audience reads structure first, airplane type second.

2. **Everything is attributed and first-person.** This is *one pilot's*
   practice, never guidance. Provenance is a first-class dimension, not
   an afterthought — it is what lets two experts' records be compared
   rather than averaged.

3. **Published vs. personal is a modeled relationship**, not a comment.
   The interviewer knows the published record; the demo's payload is the
   delta. `refines` / `contradicts` / `confirms` / `corrects` are edges.

4. **As-practiced can diverge from as-recommended.** The subject landed
   off his first low pass and recommends against it. A schema that only
   holds best practice would flatten the most human moment in the
   account.

5. **Hazards are interactions, not properties.** "Gusts are a no-go
   *here*" — because weather turbulence compounds with bluff-edge rotor.
   The schema must express factor ∧ site-characteristic → hazard.

6. **Landmarks are first-class, alongside numbers.** "Until you cross
   the cliff edge", "the beginning of the ramp". Tacit knowledge attaches
   to sight pictures; a numbers-only schema loses all of it.

7. **Rules can be counterfactual.** "Could I stop by there?" is a
   retained-capability test evaluated while doing something else. Not
   the same as "stops by there", which is false.

8. **Knowledge layers.** General doctrine → site application →
   measurement → landmark → in-flight test. Four different kinds of
   knowledge in one chain; all four must be representable, and the
   portable ones must be reusable across sites.

---

## Vertex types

### Root and identity

| Label | Key properties | Notes |
|---|---|---|
| `Pilot` | `name`, `ratings`, `experienceSummary` | The subject. Graph root, analogous to medical's `Person`. |
| `Aircraft` | `type`, `model`, `gearConfiguration`, `engineHp`, `notes` | `7KCAB Citabria`, `gearConfiguration: tailwheel`. |
| `Site` | `identifier`, `name`, `siteType`, `elevationFt`, `coordinates` | `17CL`. Deliberately `Site`, not `Airport` — an airline's "station". |

### The site as it really is

| Label | Key properties | Notes |
|---|---|---|
| `SiteCharacteristic` | `value`, `category`, `severity` | "very short", "not level", "not straight", "on a bluff". The four governing facts. |
| `Surface` | `type`, `condition`, `notes` | Gravel, rough, variable. |
| `Landmark` | `value`, `useCase`, `visualDescription` | **First-class.** "edge of the cliff", "beginning of the ramp", "the building". |
| `Hazard` | `value`, `mechanism`, `phase`, `severity` | Rotor/turbulence over the bluff. `mechanism` holds *why*. |
| `Obstruction` | `value`, `distanceFt`, `bearing` | Power line 200' E. |
| `Constraint` | `value`, `source`, `kind` | Marine Sanctuary 1000' overflight; no camping; PPR. |

### The published layer

| Label | Key properties | Notes |
|---|---|---|
| `PublishedData` | `field`, `value`, `source`, `asOf` | Runway 1300 ft per FAA. One vertex per published claim. |
| `PublishedProcedure` | `value`, `source`, `summary` | "Remain close to the strip in the pattern." |
| `WorkingValue` | `field`, `value`, `establishedBy`, `confidence` | 800 ft, established by Google Earth measurement. **The corrected value the pilot actually uses.** |

### Conditions and perception

| Label | Key properties | Notes |
|---|---|---|
| `ConditionFactor` | `factor`, `value`, `acceptability` | wind, gusts, visibility, time of day, temperature/DA, loading. |
| `Cue` | `value`, `sensoryChannel`, `whenObserved`, `indicates` | What the pilot actually reads. `sensoryChannel`: visual/aural/kinesthetic. |
| `InformationSource` | `value`, `reliability`, `availability` | Windsock, forecast, **the low pass itself**, Google Earth. |

### Decisions, rules, technique

| Label | Key properties | Notes |
|---|---|---|
| `Doctrine` | `value`, `scope`, `origin`, `heldSince` | **"Always be able to stop by the midpoint."** `scope: allShortStrips` — portable across sites. |
| `PersonalMinimum` | `value`, `factor`, `strictness`, `rationale`, `isPublished:false` | Gusts, perfect vis, day only, tailwheel only, not heavily loaded. |
| `AbortRule` | `value`, `testType`, `triggerLandmark`, `action` | `testType: counterfactual` — the retained-capability distinction. |
| `CommitmentPoint` | `value`, `landmark`, `afterWhichNoGoAround` | Where the go-around stops being available. |
| `Procedure` | `value`, `phase`, `isPersonal` | The approach sequence as this pilot flies it. |
| `Step` | `value`, `sequence`, `phase` | Low pass, standard pattern, three-point, brake hard. |
| `Purpose` | `value` | **Many-to-one with `Step`** — the low pass has three. |
| `Technique` | `value`, `phase`, `asPracticed`, `asRecommended`, `divergenceReason` | Power in until the cliff edge; three-point; stick back. |
| `Tradeoff` | `value`, `dimension` | Approach speed. **Two-sided by construction.** |
| `TradeoffSide` | `direction`, `benefit`, `risk` | faster→buffer/overrun; slower→rollout/less margin. |
| `Decision` | `value`, `phase`, `outcome` | Attempt or don't; land or go around. |
| `Consequence` | `value`, `likelihood`, `severity` | Gravel thrown into the wing; getting stuck overnight. |

### Reflection

| Label | Key properties | Notes |
|---|---|---|
| `Experience` | `value`, `when`, `aircraft`, `outcome` | The first landing; landing off the low pass. |
| `LessonLearned` | `value`, `changedBehavior` | "Probably not a good idea." |
| `Comment` / `Concept` | as in `medical` | Open-world escape hatch, unchanged. |

---

## Edge types

### Structural spine

```
Pilot ─flies→ Aircraft            {preference, reason, isPreferred}
Pilot ─operatesAt→ Site           {timesLanded, firstLanded}
Pilot ─holds→ Doctrine
Pilot ─holds→ PersonalMinimum
Pilot ─uses→ Procedure
Pilot ─had→ Experience

Site ─hasCharacteristic→ SiteCharacteristic
Site ─hasSurface→ Surface
Site ─hasLandmark→ Landmark
Site ─hasHazard→ Hazard
Site ─hasObstruction→ Obstruction
Site ─hasConstraint→ Constraint
Site ─publishedAs→ PublishedData
Site ─publishedProcedure→ PublishedProcedure
```

### Published vs. personal — the demo's payload

```
WorkingValue ─corrects→ PublishedData      {method, discrepancy}
WorkingValue ─establishedBy→ InformationSource
Technique    ─contradicts→ PublishedProcedure  {reason}
Technique    ─refines→ PublishedProcedure
PersonalMinimum ─stricterThan→ PublishedData
Hazard       ─elaborates→ PublishedData    {"briefing says shear; here's the geometry"}
```

### Hazards as interactions (principle 5)

```
Hazard ─arisesFrom→ SiteCharacteristic     {the bluff}
Hazard ─arisesFrom→ ConditionFactor        {sea breeze}
Hazard ─coincidesWith→ Step                {the moment of max commitment}
Hazard ─counteredBy→ Technique             {power in until the cliff edge}

PersonalMinimum ─compoundsWith→ ConditionFactor
    {"gusts alone would be OK elsewhere; gusts + this site's rotor is not"}
```

### The doctrine chain (principle 8) — the richest structure

```
Doctrine ─appliedAt→ Site
    ─yields→ AbortRule
AbortRule ─measuredBy→ InformationSource   {Google Earth}
AbortRule ─expressedAs→ Landmark           {beginning of the ramp}
AbortRule ─triggers→ Decision              {full power, go around}
AbortRule ─testedDuring→ Step
```

`Doctrine` attaches to the `Pilot`, not the `Site` — so a second
interview about a different strip reuses the same doctrine vertex and
grows a new site-specific chain from it. **That is the composability
claim, made structural.**

### Procedure, purpose, technique

```
Procedure ─hasStep→ Step                   {sequence}
Step ─servesPurpose→ Purpose               {1..n — the low pass has three}
Step ─informs→ Decision
Step ─providesInformationAbout→ ConditionFactor
Step ─observedVia→ Cue
Technique ─usedDuring→ Step
Technique ─anchoredTo→ Landmark            {cliff edge}
Technique ─contrastsWith→ StandardProcedure
Technique ─justifiedBy→ Rationale          (as Comment, or a property)
```

### Tradeoffs and conditions

```
Tradeoff ─hasSide→ TradeoffSide            {exactly 2 by convention}
TradeoffSide ─risks→ Consequence
TradeoffSide ─buys→ Purpose
Tradeoff ─resolvedBy→ PersonalMinimum      {risk tolerance}

ConditionFactor ─assessedVia→ InformationSource
ConditionFactor ─gatedBy→ PersonalMinimum
ConditionFactor ─affects→ Decision
```

### Aircraft and reflection

```
Aircraft ─suitableFor→ Site                {marginNotes}
Aircraft ─providesMargin→ Purpose          {reserve power for the go-around}
Pilot ─excludes→ Aircraft                  {reason: "personal comfort, not capability"}

Experience ─taught→ LessonLearned
LessonLearned ─modified→ Technique
Experience ─divergedFrom→ Technique        {landed off the low pass}
```

---

## Worked examples

**1. The runway length correction**

```
Site{17CL} ─publishedAs→ PublishedData{field:"runwayLength", value:"1300 ft", source:"FAA"}
                              ↑ corrects {method:"Google Earth measurement"}
WorkingValue{field:"runwayLength", value:"800 ft", establishedBy:"self-measured"}
    ─establishedBy→ InformationSource{Google Earth, reliability:"high"}
```

**2. The doctrine chain**

```
Pilot ─holds→ Doctrine{"always able to stop by midpoint", scope:"allShortStrips",
                       origin:"self-authored", heldSince:"long ago"}
   └─appliedAt→ Site{17CL}
       └─yields→ AbortRule{testType:"counterfactual", action:"full power, go around"}
            ├─measuredBy→ InformationSource{Google Earth}
            ├─expressedAs→ Landmark{"beginning of the ramp"}
            └─testedDuring→ Step{rollout}
```

**3. The compound gate**

```
PersonalMinimum{"no gusty conditions", factor:"gusts", isPublished:false}
    ─compoundsWith→ ConditionFactor{"sea breeze over bluff"}
    ─rationale: "weather turbulence + non-laminar air = risk I won't take"
Hazard{rotor} ─arisesFrom→ SiteCharacteristic{bluff}
              ─arisesFrom→ ConditionFactor{any wind}
```

**4. As-practiced vs. as-recommended**

```
Technique{"low pass then go around", asRecommended:"always go around",
          asPracticed:"landed off it the first time",
          divergenceReason:"conditions looked agreeable"}
    ←─divergedFrom─ Experience{"first landing at 17CL"}
        └─taught→ LessonLearned{"probably not a good idea"}
```

---

## Open design questions

1. **`Rationale` as a vertex or a property?** Medical uses free-text
   properties plus the `Comment` hatch. Reasons matter a lot here
   ("*why* do you fly a long pattern?"). Leaning: `note`/`rationale`
   properties on the edges that need them, reserving `Comment` for the
   genuinely unmodellable — matching medical's discipline.

2. **`Phase` as a vertex or an enum property?** You asked for all phases
   of flight with the approach emphasized. Leaning: a `phase` **property**
   (`planning|enroute|overflight|pattern|final|landing|rollout|ground|departure`)
   on the types that need it, rather than a `FlightPhase` vertex —
   cheaper, and avoids a hub vertex everything hangs off.

3. **How much aggregate structure?** Medical has reification buckets
   (`HeadacheTriggers`). Do we want a `SiteAssessment` bucket grouping
   the condition factors evaluated on a given day? Leaning **no** for a
   2–5 minute interview — it adds a hop without adding meaning.

4. **`StandardProcedure` vs `PublishedProcedure`.** Currently two ideas:
   the AFH textbook short-field technique (general aviation practice)
   and the 17CL briefing (site-specific). Both are "what's written
   down," but from different authorities. Leaning: **one type**,
   `PublishedProcedure`, with a `source` property (`AFH` | `briefing` |
   `FAA`) — the interesting relation is `contradicts`/`refines`
   regardless of which authority.

5. **Should `Doctrine` be seeded, or emerge?** It's the composability
   showpiece. Emerging live is more honest and better television.
   Leaning: let it emerge.

---

## Scale estimate

~28 vertex types, ~40 edge types. Substantially smaller than medical
(77 vertices) because a 2–5 minute interview cannot fill a large schema,
and an under-filled graph looks worse on camera than a small dense one.
Every type above is expected to be *hit* by the target interview.
