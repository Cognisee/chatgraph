# Turnaround: everything that happens to an aircraft between arrival and
# departure, and the baggage that moves through it.
#
# The turnaround is where a schedule is won or lost. Most of its
# activities run in parallel, so the duration is set by whichever chain
# is longest rather than by their sum -- and which chain that is varies
# with the aircraft, the stand and the load. That variation is exactly
# the knowledge a system measuring elapsed time cannot represent.

module ai.cognisee.models.aviation.airline.ops.ground

import ai.cognisee.models.time as time
import ai.cognisee.models.units as units

# A single bag and its itinerary. Modelled individually because the
# operationally interesting question is per-bag: this bag, on that
# connection, against a cutoff.
#
# Carries only what is fixed when the bag is accepted. Where it is now
# and what has happened to it are scans, in the state module -- see
# BagScan.
Bag := record{
  # Where the bag is meant to end up.
  destination: string,
  identifier: string,
  # True when the bag has to move between two flights at a hub. This is
  # the case that generates most mishandling.
  transfer: boolean}

# The time after which a bag can no longer be accepted for a departing
# flight. This is a harder constraint than the passenger cutoff and
# earlier in the sequence, which is why a passenger can make a
# connection their bag does not.
BaggageCutoff := record{
  # Minutes before scheduled departure.
  beforeDeparture: units.Duration,
  # Whether the cutoff can be pushed, and by whom. Some can; the ones
  # governed by loading physics cannot.
  waivable: boolean}

# One piece of work in a turnaround.
GroundActivity := record{
  # When it actually happened, as it becomes known.
  actualEnd: optional<time.Timespec>,
  actualStart: optional<time.Timespec>,
  # Activities this one cannot start before. The critical path runs
  # through these dependencies, and an experienced controller knows
  # which ones actually bind on a given day.
  dependsOn: list<string>,
  kind: GroundActivityKind,
  # When the plan says it should happen.
  plannedEnd: time.Timespec,
  plannedStart: time.Timespec}

# The work of a turnaround. Which of these lies on the critical path
# varies with the aircraft, the stand and the load -- an experienced
# controller knows which one binds today, and the schedule does not
# say.
GroundActivityKind := union{
  boarding: unit,
  catering: unit,
  cleaning: unit,
  deboarding: unit,
  fueling: unit,
  # Loading of hold baggage and cargo.
  loading: unit,
  pushback: unit,
  # Potable water and lavatory servicing.
  servicing: unit,
  # A maintenance check carried out on the stand.
  technicalCheck: unit,
  unloading: unit}

# The planned and actual ground time for one leg.
Turnaround := record{
  activities: list<GroundActivity>,
  # The leg arriving, and the leg the same aircraft then operates.
  inboundLeg: string,
  # The minimum ground time the operator publishes for this aircraft at
  # this station. A planning figure rather than an achievable one: it
  # assumes everything goes right, which is why experienced staff
  # schedule above it.
  minimumGroundTime: units.Duration,
  outboundLeg: string,
  stand: optional<string>}
