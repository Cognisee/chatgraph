# Disruption and recovery: what goes wrong, what is done about it, and
# what it costs.
#
# This module is where the other modules meet. A disruption is rarely
# confined to the thing that broke -- an aircraft problem becomes a crew
# problem becomes a passenger problem -- and the recovery options trade
# against each other in ways no single system holds.
#
# Note what is deliberately absent: there is no representation here of
# *why* a controller chose one option over another. That reasoning is
# the thing being elicited, and it is not an attribute of the
# disruption.

module ai.cognisee.models.aviation.airline.ops.disruption

import ai.cognisee.models.aviation.airline.ops.staff as staff
import ai.cognisee.models.aviation.weather as weather
import ai.cognisee.models.time as time
import ai.cognisee.models.units as units

# One recovery option: something that could be done, or was done, about
# a disruption.
#
# Note that an action is not the same as a decision. It records what was
# available and what became of it -- including the options considered
# and rejected, which are usually more informative than the one taken,
# and which no operational system retains.
Action := record{
  # Legs this action affects. An action is rarely local.
  affectedLegs: list<string>,
  # Who may actually take this. When it is not operationsControl, the
  # operation's real move is what it tells the decision-maker -- see
  # Advisory.
  authority: DecisionAuthority,
  # When the option stops being available. Some options expire: a crew
  # times out, a slot passes, a connection closes. Knowing the window is
  # a large part of the expertise.
  expiresAt: optional<time.Timespec>,
  kind: ActionKind,
  status: ActionStatus,
  # An action this one replaces. A recovery plan is rarely decided once:
  # "they go around once, they go around twice, and then they have to
  # divert... your decision has to be recalculated." Each attempt
  # consumes fuel and time, so the option set on the third approach is
  # not the option set on the first.
  supersedes: optional<string>,
  # Whether it was taken, and when.
  takenAt: optional<time.Timespec>}

# The recovery levers, roughly in order of how much they cost.
#
# Not exhaustive, and not meant to be: these are the moves that came up
# in the scenarios. A controller reaching for one not listed here is a
# finding, not a gap to paper over.
ActionKind := union{
  # Cancel a leg outright.
  cancel: unit,
  # Move a crew's reporting time, so their duty period does not start
  # while the aircraft they are due to operate is elsewhere. Cheap,
  # time-critical, and invisible to any system watching only aircraft.
  deferReport: unit,
  # Hold a departure for connecting passengers or bags.
  delay: unit,
  # Send an inbound to another airport.
  divert: unit,
  # Fly the leg with a smaller aircraft, shedding seats.
  downgauge: unit,
  # Move passengers to another flight.
  reaccommodate: unit,
  # Bring in a crew from elsewhere, or call out a reserve.
  recrew: unit,
  # Operate the leg with a different aircraft of the same type.
  tailSwap: unit,
  # Operate the leg with a different aircraft type.
  typeSubstitution: unit}

# What became of an option. The rejected case is the valuable one: a
# controller's reason for *not* doing something is where their model of
# the situation shows most clearly.
ActionStatus := union{
  # Under consideration.
  proposed: unit,
  # Ruled out, with the reason recorded where it was given.
  rejected: unit,
  taken: unit}

# A message sent to a decision-maker the operation does not control.
#
# This is an operational fact, not an interpretation: an advisory was
# issued, at this time, by this person, carrying this content. It is
# emphatically *not* a record of the form "Joe advised Sarah to divert
# Foo234" -- that asserts what the advice meant and what it was for, and
# in the diverting-aircraft case it would also be false, since the
# operation cannot advise a diversion at all. Only the captain decides
# that. What the operation does is supply the picture he decides from.
#
# Which is why this type exists. The controller's real judgement in that
# scenario is not the diversion, it is what to say, and the schema would
# otherwise have no place to put it: "he doesn't see the operational
# context... he sees whatever is reported to him. It's very limited
# data. That captain will only know that two other aircraft have landed
# safely."
#
# Note the boundary this stays on the right side of. A message and its
# omissions are events, and events are domain content. What anyone
# believed, intended or inferred is not, and belongs to hydra.logic.
Advisory := record{
  # The action this bears on.
  action: string,
  # What was communicated.
  content: string,
  # Whom it was given to.
  recipient: DecisionAuthority,
  # Who gave it, where known.
  sender: optional<staff.OperationsStaff>,
  sentAt: time.Timespec,
  # Context the operation held and did not pass on, where known.
  # Recording this is the point: the gap between what was known and what
  # was said is where the expertise lives.
  withheld: list<string>}

# A diversion airport, and whether it can actually take the aircraft.
#
# The fields are what turns a legal alternate into a usable one. An
# airport that is legally adequate but has no handling agent on duty at
# 3am, or no fuel, is a place the aircraft can land and then not leave
# -- which converts a delay into a stranded aircraft and a hotel
# problem.
Alternate := record{
  # Accommodation, if the diversion becomes an overnight.
  accommodationAvailable: optional<boolean>,
  airport: string,
  # Forecast conditions there, which have to be better than at the
  # destination for the alternate to be worth anything.
  forecast: optional<weather.Forecast>,
  # Fuel available for uplift at the expected time.
  fuelAvailable: optional<boolean>,
  # Ground handling available at the expected time.
  handlingAvailable: optional<boolean>}

# One try at something that may need several, and what it cost.
#
# The go-around sequence is the canonical case: "they go around once,
# they go around twice, and then they have to divert." Recording only
# the outcome loses the structure that matters -- the aircraft
# diverting on the third approach is not solving the same problem as
# the one diverting on the first, because two approaches' worth of fuel
# and elapsed time are gone.
Attempt := record{
  # What was tried.
  action: string,
  # Fuel consumed by this attempt, where known. Each failed approach
  # narrows what remains possible.
  fuelBurned: optional<units.Mass>,
  # 1 for the first try.
  ordinal: int32,
  outcome: AttemptOutcome,
  # When this attempt concluded.
  resolvedAt: optional<time.Timespec>}

# How one attempt ended. Abandoned is kept separate from failed on
# purpose: giving up on an approach that would probably have worked, to
# preserve fuel for a diversion, is a decision rather than a failure.
AttemptOutcome := union{
  # Abandoned before completion, by choice rather than by failure.
  abandoned: unit,
  # Tried and did not work; another attempt or another option follows.
  failed: unit,
  succeeded: unit}

# How many aircraft an airport can actually take per hour right now, as
# against how many the schedule assumes.
#
# The quantity that turns weather into a network problem: "your incoming
# flow rate would fall from 35 aircrafts per hour into 10, 15." Low
# visibility does not stop the operation, it halves it, and the
# arithmetic of that shortfall against the arrival bank forces every
# decision downstream.
#
# Deliberately not in the site module, which holds only fixed
# infrastructure. A runway's existence is a fact about the airport; its
# throughput this afternoon is a fact about the day.
Capacity := record{
  airport: string,
  # Movements per hour the schedule is built on.
  baseline: optional<int32>,
  # Movements per hour currently achievable.
  current: int32,
  # The period this figure applies to. Capacity restrictions are
  # forecast ahead as often as they are observed.
  from: time.Timespec,
  # Whether this is observed or expected. A forecast restriction is what
  # makes pre-emptive cancellation possible.
  kind: CapacityKind,
  # What is limiting it, where it is known: separation in low
  # visibility, a closed runway, a flow restriction.
  limitedBy: optional<string>,
  to: optional<time.Timespec>}

# Whether a capacity figure is observed or forecast. The distinction is
# what makes pre-emptive cancellation possible -- and contentious, since
# acting on a forecast means cancelling flights that might have
# operated.
CapacityKind := union{
  forecast: unit,
  observed: unit}

# What a disruption cost, once it is over.
#
# Counted rather than valued. Converting these into money requires
# commercial policy that is out of scope here, and controllers reason in
# these units anyway -- misconnected passengers and lost legs, not
# dirhams.
Consequence := record{
  # Bags that missed their intended flight.
  bagsMishandled: optional<int32>,
  # Total delay across affected legs.
  delayIncurred: optional<units.Duration>,
  legsCancelled: optional<int32>,
  # Passengers who missed a connection as a result.
  passengersMisconnected: optional<int32>}

# Who holds a decision, which is not always the operation.
#
# The diversion case is clearest: "it's always captain's discretion...
# the only person who will make the decision if he is diverting the
# aircraft or not is the captain." Operations can advise, and can choose
# what to tell him, but cannot decide.
#
# This matters because an action whose authority lies elsewhere is not a
# plan. It is a prediction plus an attempt to influence, and modelling
# it as an ordinary option would misrepresent what the operation can
# actually do.
DecisionAuthority := union{
  # The pilot in command. Diversion, and any decision bearing on the
  # safety of the flight.
  commander: unit,
  # Outside the airline entirely: air traffic control, an airport
  # authority, a regulator.
  external: string,
  # The operation itself.
  operationsControl: unit,
  # A local station, typically negotiating an exception.
  stationManager: unit}

# Something that has gone wrong, as first recognised.
#
# The detection time is load-bearing. For a forecast condition it can
# precede any actual effect by hours, and that gap is exactly where
# pre-emptive action lives -- which is why a disruption is dated from
# when it was *known*, not from when it bit.
Disruption := record{
  cause: DisruptionCause,
  # When it was first known about. For a forecast condition this may be
  # hours before it has any effect, which is what makes pre-emptive
  # action possible.
  detectedAt: time.Timespec,
  # Legs directly affected, before any cascade.
  directlyAffected: list<string>,
  identifier: string,
  severity: DisruptionSeverity}

# What went wrong, at the granularity a controller would use when
# handing over. The cause matters less for classification than for what
# it implies about duration: a technical defect has an unknown fix time,
# a flow restriction usually has a stated one.
DisruptionCause := union{
  # A defect that makes an aircraft unserviceable.
  aircraftTechnical: unit,
  # Airspace closure, flow restriction, or a diversion of traffic.
  airspace: unit,
  # A crew unavailable, out of hours, or out of position.
  crew: unit,
  # Ground handling: staffing, equipment, or a process failure.
  groundHandling: unit,
  # Stands, gates or runway capacity.
  infrastructure: unit,
  # Security or a police action.
  security: unit,
  weather: unit}

# How far a disruption has spread, which is a judgement rather than a
# measurement. The propagating case is the one that requires action
# now: localized problems can be absorbed, systemic ones are already
# beyond recovery, and the window in between is where controllers earn
# their keep.
DisruptionSeverity := union{
  # Confined to one leg.
  localized: unit,
  # Spreading through a rotation or a bank.
  propagating: unit,
  # Affecting the operation as a whole.
  systemic: unit}

# Fuel loaded above the trip requirement, and why.
#
# A pre-emptive decision made hours before the situation it hedges
# against, and one of the few places where a controller's expectation is
# written down at the time. The stated reason is the interesting field:
# it is a prediction, recorded before the outcome is known.
ExtraFuel := record{
  amount: units.Mass,
  # Expected holding time it buys.
  holdingTime: optional<units.Duration>,
  # Why it was loaded, as stated.
  reason: string}

# Rooms available to the operation at a station, and rooms needed.
#
# A constraint invisible until it binds, and then dominant: "you don't
# have enough places in hotel for the passengers." It caps how many
# overnight cancellations a station can absorb regardless of what the
# aircraft and crew picture allows -- and it is shared with every other
# airline making the same call on the same night, so it is a race as
# well as a limit.
HotelCapacity := record{
  # Rooms the operation can actually obtain, where known. Contracted
  # allocation plus whatever can be found, which is why this is often
  # uncertain at the moment the decision is made.
  available: optional<int32>,
  # Rooms already committed tonight.
  committed: optional<int32>,
  # The night this applies to.
  date: time.Date,
  # Rooms the current plan would need.
  required: optional<int32>,
  station: string}
