# Open questions on the aviation schema

Things I could not settle from public sources, or where I made a choice
that deserves a second opinion. Numbered so they can be referred to.
Several are good candidates for the Thursday interview.

## Modelling choices I am unsure about

**1. Is `Bank` a real operational object?** I have modelled a connecting
bank as a first-class type with a name and a time window. But it may be
an analyst's description of a pattern rather than something an operator
names and manages. Two independent sources reverse-engineered four banks
at a major hub from schedule data; neither found the airline publishing them.
*Good question for a controller: do you name your banks?*

**2. Does an aircraft's location belong on the airframe?**
`Aircraft.location` sits with the airframe, but position is operational
state that changes hourly, not a property of the thing. It may belong on
`FlightLeg` or a separate current-state type. Left where it is because
controllers do ask "where is that tail", but it is the wrong shape.

**3. `AerodromeCode` on the variant: code letter, or the dimensions?**
The code is derived from wingspan and outer main gear span. Keeping the
derived letter is what people say; keeping the dimensions is what is
true. Currently the letter, as a string on `AircraftVariant` and as an
enum on `Stand` -- which is an inconsistency worth resolving.

**4. Deferral intervals as free text.** `Deferral.remaining` is a
string. The real thing is either flight cycles or calendar days, with
different arithmetic. Probably wants two cases; left as text until it is
clear the scenarios need it.

**5. No representation of *conjunction* as a signal.** Scenario 3 turns
on five individually unremarkable conditions that together mean the bank
is about to go. The schema can represent the five conditions and the
intervention, but not the claim that *this combination* is diagnostic.
That claim is elicited knowledge rather than operational fact, so it may
belong in a knowledge layer rather than here -- but it is the heart of
the scenario and currently has nowhere to live. **This is the most
significant gap.**

**6. Time.** ~~Every timestamp is a `string`.~~ **Resolved.** Absolute
instants now use **`hydra.time.Timespec`** -- Hydra's own kernel type,
POSIX `struct timespec` semantics, signed seconds and unsigned
nanoseconds since the epoch. `ai.cognisee.models.time` adds only the
forms Timespec cannot express: `LocalTime` (a clock time with no date,
which is how operational times are spoken and is genuinely ambiguous
until a date and zone are known), `Date`, `Period`, and `TimeKind`
(scheduled / estimated / actual).

Open sub-question: is `LocalTime` as minutes-past-midnight plus an
optional IANA zone the right shape, or should the zone be mandatory with
an explicit "not stated" case?

## Questions for an operations expert

**7. Who holds which decision?** Nothing models authority -- who may
cancel, who may hold a departure, at what threshold it escalates. The
research found this is not documented publicly anywhere. It is probably
a real part of the domain rather than an omission.

**8. Is minimum ground time treated as achievable?** `Turnaround`
carries a published minimum, with a comment saying experienced staff
schedule above it. Confirming that is true, and by how much, would be
worth a line of elicited knowledge.

**9. What actually decides who gets offloaded?** `Passenger` carries
class, tier, connection and special handling, and deliberately takes no
position on how they are weighed. The weighing is exactly what to ask
about.

**10. Which dependencies in a turnaround actually bind?**
`GroundActivity.dependsOn` can express a critical path, but which chain
binds varies with aircraft, stand and load. An expert knows; the
schedule does not say.

## Things deliberately left out

- **Anything modelling why a decision was made.** Rationale, cues,
  heuristics, confidence, provenance. This is a domain schema; the
  knowledge layer is a separate concern and was explicitly scoped out.
- **Cargo**, beyond baggage. No scenario needs it.
- **Fares, revenue, and commercial policy.** Route profitability appears
  in the research as an explicit tiebreaker in recovery decisions, but
  modelling it well is a different project.
- **Maintenance planning.** Only the airworthiness state that starts a
  disruption is modelled, not the programme behind it.
