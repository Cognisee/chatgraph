# Open questions on the aviation schema

Things I could not settle from public sources, or where I made a choice
that deserves a second opinion. Several are good candidates for the
pending MOC interview.

Resolved questions are removed rather than struck through; what they
settled is recorded in the schema itself, or in the invariant and
exclusions sections below.

## Modelling choices I am unsure about

**Is `Bank` a real operational object?** I have modelled a connecting
bank as a first-class type with a name and a time window. But it may be
an analyst's description of a pattern rather than something an operator
names and manages. Two independent sources reverse-engineered four banks
at a major hub from schedule data; neither found the airline publishing them.
*Good question for a controller: do you name your banks?*

**`AerodromeCode` on the variant: code letter, or the dimensions?**
The code is derived from wingspan and outer main gear span. Keeping the
derived letter is what people say; keeping the dimensions is what is
true. Currently the letter, as a string on `AircraftVariant` and as an
enum on `Stand` -- which is an inconsistency worth resolving.

**Deferral intervals as free text.** `Deferral.remaining` is a
string. The real thing is either flight cycles or calendar days, with
different arithmetic. Probably wants two cases; left as text until it is
clear the scenarios need it.

**LocalTime shape.** Absolute instants use `hydra.time.Timespec`, and
`ai.cognisee.models.time` adds only what it cannot express. One question
left: is `LocalTime` as minutes-past-midnight plus an *optional* IANA
zone right, or should the zone be mandatory with an explicit "not
stated" case?

## Questions for an operations expert

**Where does authority escalate?** `DecisionAuthority` now names who
holds a decision, confirmed for the diversion case: it is always the
captain's. What is still unknown is the *threshold* -- who may cancel,
who may hold a departure, and at what point a controller stops deciding
and starts asking. Not documented publicly anywhere.

**Is minimum ground time treated as achievable?** `Turnaround`
carries a published minimum, with a comment saying experienced staff
schedule above it. Confirming that is true, and by how much, would be
worth a line of elicited knowledge.

**What actually decides who gets offloaded?** There is no `Passenger`
type: `PassengerLoad` holds counts by class and a connecting figure,
which is enough to see that a leg is a problem and not enough to say
who comes off it. Whether the schema needs individual passengers
depends on the answer -- and the weighing (class, tier, onward
connection, special handling) is exactly what to ask about before
modelling it.

**Which dependencies in a turnaround actually bind?**
`GroundActivity.dependsOn` can express a critical path, but which chain
binds varies with aircraft, stand and load. An expert knows; the
schedule does not say.

**Can a controller say what they chose not to tell the captain?**
`Advisory.withheld` is the most valuable field in the schema and the
hardest to populate: the judgement may never have been conscious. If it
cannot be answered directly, it may have to be reconstructed by asking
what the captain turned out not to know.

**Does a curfew exception have a standing process or is it personal?**
`Curfew.exceptionAuthority` assumes someone can be asked. Whether that
is a defined escalation or a relationship a particular station manager
happens to have is worth knowing -- the second is precisely the
knowledge that walks out of the door.

**What is the real flow rate under each condition?** `Capacity`
holds baseline and current movements per hour. The numbers heard so far
(35 falling to 10-15) came from one conversation about one airport;
whether controllers carry a table of these or recognise them by feel is
itself a finding.

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

## Things deliberately left out

- **Anything modelling why a decision was made.** Rationale, cues,
  heuristics, confidence, provenance. This is a domain schema; the
  knowledge layer is a separate concern and was explicitly scoped out.
  `Advisory` is the near miss worth naming: it records what was said and
  what was omitted, which is a communication event, not a reason. The
  line held is that an act is domain content and a belief is not.
- **Epistemic state generally.** What an agent knows, believes, or holds
  as probable belongs to `hydra.logic`, not here.
- **Cargo**, beyond baggage. No scenario needs it.
- **Fares, revenue, and commercial policy.** Route profitability appears
  in the research as an explicit tiebreaker in recovery decisions, but
  modelling it well is a different project.
- **Maintenance planning.** Only the airworthiness state that starts a
  disruption is modelled, not the programme behind it.
