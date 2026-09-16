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

import ai.cognisee.models.aviation.weather as weather
import ai.cognisee.models.units as units

# A recovery action taken or considered. Modelling considered options
# alongside taken ones matters: the interesting question in a
# retrospective is usually why an option was rejected, and an option
# that was never recorded cannot be asked about.
Action := record{
  # Legs this action affects. An action is rarely local.
  affectedLegs: list<string>,
  # When the option stops being available. Some options expire: a crew
  # times out, a slot passes, a connection closes. Knowing the window is
  # a large part of the expertise.
  expiresAt: optional<string>,
  kind: ActionKind,
  status: ActionStatus,
  # Whether it was taken, and when.
  takenAt: optional<string>}

ActionKind := union{
  # Cancel a leg outright.
  cancel: unit,
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

ActionStatus := union{
  # Under consideration.
  proposed: unit,
  # Ruled out, with the reason recorded where it was given.
  rejected: unit,
  taken: unit}

# What the disruption cost, as far as it can be counted. Deliberately
# partial: most of what matters about a disruption is not captured by
# these numbers, and recording them as the whole picture would be
# misleading.

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

# Fuel loaded beyond the trip and legal reserves, and why.
#
# Carrying extra fuel is the standard pre-emptive response to a forecast
# hold: it costs money to carry and burns some of itself, but it buys
# time in the air. How much to load is a judgement about a forecast, and
# exactly the kind of call worth eliciting.

Consequence := record{
  # Bags that missed their intended flight.
  bagsMishandled: optional<int32>,
  # Total delay across affected legs.
  delayIncurred: optional<units.Duration>,
  legsCancelled: optional<int32>,
  # Passengers who missed a connection as a result.
  passengersMisconnected: optional<int32>}

# An airport nominated as a diversion alternate, and what makes it
# usable. The list is not fixed: an alternate that is legal on paper may
# be a poor choice at 04:00 because it has no handling agent on duty, no
# fuel uplift, or nowhere to put the passengers -- and that is known
# rather than published.

Disruption := record{
  cause: DisruptionCause,
  # When it was first known about. For a forecast condition this may be
  # hours before it has any effect, which is what makes pre-emptive
  # action possible.
  detectedAt: string,
  # Legs directly affected, before any cascade.
  directlyAffected: list<string>,
  identifier: string,
  severity: DisruptionSeverity}

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

# How far the disruption reaches. This is a judgement rather than a
# measurement, and different controllers will grade the same situation
# differently -- which is itself worth capturing.

DisruptionSeverity := union{
  # Confined to one leg.
  localized: unit,
  # Spreading through a rotation or a bank.
  propagating: unit,
  # Affecting the operation as a whole.
  systemic: unit}

ExtraFuel := record{
  amount: units.Mass,
  # Expected holding time it buys.
  holdingTime: optional<units.Duration>,
  # Why it was loaded, as stated.
  reason: string}

# Something that has gone wrong, or is about to.
