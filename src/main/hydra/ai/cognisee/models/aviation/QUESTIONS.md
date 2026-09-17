# Open questions on the aviation schema

Things I could not settle from public sources, or where I made a choice
that deserves a second opinion. Several are good candidates for the
pending MOC interview.

Each question has a stable tag (`Q-BANK`, `Q-FLOWRATE`, ...) so it can
be cited from an interview plan, a commit message or another document.
Tags are deliberately not numbers: resolved questions are removed rather
than struck through, and numbering would renumber everything below each
removal, breaking any citation made earlier. A tag is retired with its
question and never reused.

What a resolved question settled is recorded in the schema itself, or in
the invariant and exclusions sections below.

## Index

| Tag | Question | For |
|---|---|---|
| `Q-BANK` | Is a connecting bank a real operational object? | controller |
| `Q-AUTHORITY` | Where does decision authority escalate? | controller |
| `Q-GROUNDTIME` | Is published minimum ground time treated as achievable? | controller |
| `Q-OFFLOAD` | What decides who gets offloaded? | controller |
| `Q-CRITICALPATH` | Which turnaround dependencies actually bind? | controller |
| `Q-WITHHELD` | Can a controller say what they chose not to tell? | controller |
| `Q-EXCEPTION` | Is a curfew exception a process or a relationship? | controller |
| `Q-FLOWRATE` | What is the real flow rate under each condition? | controller |

## Modelling choices I am unsure about

**Q-BANK. Is `Bank` a real operational object?** I have modelled a
connecting bank as a first-class type with a name and a time window. But
it may be an analyst's description of a pattern rather than something an
operator names and manages. Two independent sources reverse-engineered
four banks at a major hub from schedule data; neither found the airline
publishing them. *Good question for a controller: do you name your
banks?*

## Questions for an operations expert

**Q-AUTHORITY. Where does authority escalate?** `DecisionAuthority` now
names who holds a decision, confirmed for the diversion case: it is
always the captain's. What is still unknown is the *threshold* -- who
may cancel, who may hold a departure, and at what point a controller
stops deciding and starts asking. Not documented publicly anywhere.

**Q-GROUNDTIME. Is minimum ground time treated as achievable?**
`Turnaround` carries a published minimum, with a comment saying
experienced staff schedule above it. Confirming that is true, and by how
much, would be worth a line of elicited knowledge.

**Q-OFFLOAD. What actually decides who gets offloaded?** There is no
`Passenger` type: `PassengerLoad` holds counts by class and a connecting
figure, which is enough to see that a leg is a problem and not enough to
say who comes off it. Whether the schema needs individual passengers
depends on the answer -- and the weighing (class, tier, onward
connection, special handling) is exactly what to ask about before
modelling it.

**Q-CRITICALPATH. Which dependencies in a turnaround actually bind?**
`GroundActivity.dependsOn` can express a critical path, but which chain
binds varies with aircraft, stand and load. An expert knows; the
schedule does not say.

**Q-WITHHELD. Can a controller say what they chose not to tell the
captain?** `Advisory.withheld` is the most valuable field in the schema
and the hardest to populate: the judgement may never have been
conscious. If it cannot be answered directly, it may have to be
reconstructed by asking what the captain turned out not to know.

**Q-EXCEPTION. Does a curfew exception have a standing process, or is it
personal?** `Curfew.exceptionAuthority` assumes someone can be asked.
Whether that is a defined escalation or a relationship a particular
station manager happens to have is worth knowing -- the second is
precisely the knowledge that walks out of the door.

**Q-FLOWRATE. What is the real flow rate under each condition?**
`Capacity` holds baseline and current movements per hour. The numbers
heard so far (35 falling to 10-15) came from one conversation about one
airport; whether controllers carry a table of these or recognise them by
feel is itself a finding.

## A modeling invariant: entities are immutable

**A slower-changing entity never carries a faster-changing fact as a
field.** An airframe lasts decades; where it is parked changes hourly.
Hanging the second off the first makes the entity a record that is never
correct for long, and -- worse for an elicitation system -- destroys the
ability to say what was known at the time a decision was taken.

Fast facts become **observations**: their own type in
`ops/state.hy`, linking to the entity by identifier and carrying their
own timestamp. One type per fact rather than a generic
`Observation<subject, value>`, because these are observed by different
means at different cadences -- a position from a movement message, an
airworthiness change from engineering, a bag from a scanner -- and a
type parameter would hide that provenance.

Applied so far:

| Was | Now |
|---|---|
| `Aircraft.location` | `AircraftPosition` |
| `Aircraft.status` | `AircraftStatus` |
| `Aircraft.openDefects` | `DefectRecord` (with `clearedAt`, keeping history) |
| `Bag.currentLeg`, `Bag.status` | `BagScan` |
| `CrewMember.baseStation` (documented as position) | stays as *base*; position is `CrewPosition` |

What legitimately keeps mutable-looking fields: `FlightLeg` (a
single-day entity whose fields change no faster than it does),
`GroundActivity` (the occurrence itself), `Capacity` and
`HotelCapacity` (already time-bounded observations).

## A capture rule: resolve what you can while you still can

**Ambiguity that can be resolved at capture time is resolved then, not
persisted.** The test is not whether the speaker stated something, but
whether the information needed to work it out is still available.

`LocalTime.zone` is the worked case. A controller almost never says the
zone, so it is unstated in exactly the way a date is -- but the zone is
recoverable from the station, the speaker or the surrounding
conversation *at the moment of capture*, and unrecoverable a week later.
So it is mandatory, and inferred. The date, which often genuinely cannot
be recovered, stays out of the type.

The general form: an unresolved value is not a faithfully preserved
ambiguity. It is an unusable one -- nothing downstream can order,
compare or convert it -- and the context that would have resolved it is
gone. Preserve what was *said* in the transcript; persist what is *true*
in the graph.

## A typing rule: closed vocabularies are not strings

**If the set of values is fixed and known, it is an enum; if it is a
count, it is a number; if it is an identifier with a type, it is that
type.** A string is for genuinely free text -- a description, a stated
reason, a name.

Applied so far:

| Was | Now |
|---|---|
| `AircraftVariant.aerodromeCode: string` | `site.AerodromeCode` |
| `Deferral.category: string` ("A".."D") | `DeferralCategory` |
| `Deferral.remaining: string` ("3 days") | `RectificationInterval` (days / cycles / hours) |
| six station fields commented "as an ICAO code" | `site.IcaoCode` |
| `LocalTime.zone: optional<string>` | `TimeZone`, mandatory |

What legitimately stays a string: `Defect.description`, `ExtraFuel.reason`,
`Advisory.content`, `DestinationRestriction.destinations` (stated at
country level, not as codes), `Curfew.exceptionAuthority`, and the
`other:` case of a union, which exists precisely to carry what the
enum does not name.

Still open: several identifier fields (`legs`, `affectedLegs`,
`dependsOn`, stand references) are strings holding foreign keys. That is
a deliberate flattening -- the alternative is a reference type or a
direct object, and which to use depends on how the graph is finally
encoded. See the note in the exclusions below.

## Things deliberately left out

- **Anything modelling why a decision was made.** Rationale, cues,
  heuristics, confidence, provenance. This is a domain schema; the
  knowledge layer is a separate concern and was explicitly scoped out.
  `Advisory` is the near miss worth naming: it records what was said and
  what was omitted, which is a communication event, not a reason. The
  line held is that an act is domain content and a belief is not.
- **Epistemic state generally.** What an agent knows, believes, or holds
  as probable belongs to `hydra.logic`, not here.
- **A reference type for cross-entity identifiers.** Fields naming
  another entity (`Action.affectedLegs`, `Pairing.legs`,
  `GroundActivity.dependsOn`, the stand references) are strings holding
  what amounts to a foreign key. The alternatives are a wrapper type per
  referent or a direct object reference, and the right choice depends on
  how these modules are finally encoded into a property graph -- which
  is what Hydra 0.18.1 is expected to settle. Left flat until then,
  deliberately rather than by oversight.
- **Cargo**, beyond baggage. No scenario needs it.
- **Fares, revenue, and commercial policy.** Route profitability appears
  in the research as an explicit tiebreaker in recovery decisions, but
  modelling it well is a different project.
- **Maintenance planning.** Only the airworthiness state that starts a
  disruption is modelled, not the programme behind it.
