# Turnaround: everything that happens to an aircraft between arrival and
# departure, and the baggage that moves through it.
#
# The turnaround is where a schedule is won or lost. Most of its
# activities run in parallel, so the duration is set by whichever chain
# is longest rather than by their sum -- and which chain that is varies
# with the aircraft, the stand and the load. That variation is exactly
# the knowledge a system measuring elapsed time cannot represent.

module ai.cognisee.models.aviation.airline.ops.ground

import ai.cognisee.models.units as units
import hydra.time as hydratime

# A single bag and where it is in its journey. Modelled individually
# because the operationally interesting question is per-bag: this bag,
# on that connection, against a cutoff.
Bag := record{
  # The leg the bag is currently travelling on or waiting for.
  currentLeg: optional<string>,
  # Where the bag is meant to end up.
  destination: string,
  identifier: string,
  status: BagStatus,
  # True when the bag has to move between two flights at a hub. This is
  # the case that generates most mishandling.
  transfer: boolean}

BagStatus := union{
  # Handed over at check-in, not yet loaded.
  accepted: unit,
  delivered: unit,
  loaded: unit,
  # Known to have missed its intended flight.
  mishandled: unit,
  # Loaded onto a later flight after missing its connection.
  reflighted: unit}

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
  actualEnd: optional<hydratime.Timespec>,
  actualStart: optional<hydratime.Timespec>,
  # Activities this one cannot start before. The critical path runs
  # through these dependencies, and an experienced controller knows
  # which ones actually bind on a given day.
  dependsOn: list<string>,
  kind: GroundActivityKind,
  # When the plan says it should happen.
  plannedEnd: hydratime.Timespec,
  plannedStart: hydratime.Timespec}

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
