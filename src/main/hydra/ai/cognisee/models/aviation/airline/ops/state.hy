# Observations: what was true of something at a particular moment.
#
# The schema treats entities as immutable wherever it can. An airframe
# is a decades-lived thing; where it is parked changes hourly. Hanging
# the second off the first makes the airframe a record that is never
# correct for long, and destroys the ability to say what was known at
# the time a decision was taken -- which for an elicitation system is
# the whole point.
#
# So the rule this module exists to enforce: a slower-changing entity
# never carries a faster-changing fact as a field. The fast fact becomes
# an observation here, linking to the entity by identifier and carrying
# its own timestamp.
#
# Each fact gets its own type rather than sharing a generic observation
# record. They are observed by different means at different cadences --
# a position from a movement message, an airworthiness change from
# engineering, a bag from a scanner -- and collapsing them would hide
# that provenance behind a type parameter.

module ai.cognisee.models.aviation.airline.ops.state

import ai.cognisee.models.aviation.airline.fleet as fleet
import ai.cognisee.models.aviation.site as site
import ai.cognisee.models.time as time

# Where an aircraft was at a moment in time.
#
# Absent station means airborne, which is a genuine observation rather
# than missing data: an aircraft between two stations has a position
# that is not a place on the ground.
AircraftPosition := record{
  aircraft: fleet.Registration,
  observedAt: time.Timespec,
  # The station. Absent while airborne.
  station: optional<site.IcaoCode>}

# Whether an aircraft could be dispatched, as at a moment in time.
#
# The transition is what matters operationally, not the state: an
# aircraft becoming unserviceable at 0300 with a rotation starting at
# 0600 is a different problem from the same aircraft unserviceable for a
# week. Timestamping the observation keeps that recoverable.
AircraftStatus := record{
  aircraft: fleet.Registration,
  observedAt: time.Timespec,
  status: fleet.AirworthinessStatus}

# Where a bag was, and in what state, when it was last seen.
#
# Bags are observed discretely, by scan, and the gaps between scans are
# operationally meaningful -- a bag not seen since check-in is a
# different problem from one scanned at the aircraft side. Modelling
# position as a scan rather than as a field makes the gap visible.
BagScan := record{
  # The bag's identifier.
  bag: string,
  # The leg it was travelling on or waiting for, where known.
  leg: optional<string>,
  observedAt: time.Timespec,
  status: BagStatus}

# Where a bag has got to. The mishandled and reflighted cases are
# separated on purpose: one is a failure still to be resolved, the other
# is that failure already absorbed onto a later flight, and the recovery
# work differs entirely.
BagStatus := union{
  # Handed over at check-in, not yet loaded.
  accepted: unit,
  delivered: unit,
  loaded: unit,
  # Known to have missed its intended flight.
  mishandled: unit,
  # Loaded onto a later flight after missing its connection.
  reflighted: unit}

# Where a crew member was at a moment in time.
#
# Distinct from their base, which changes on a scale of years. A crew
# out of position is one of the commonest reasons a leg cannot be
# covered, and it is a fact about today rather than about the person.
CrewPosition := record{
  crewMember: string,
  observedAt: time.Timespec,
  # The station.
  station: site.IcaoCode}

# A defect recorded against an airframe, and its life.
#
# Defects open and close continuously against an aircraft that outlives
# all of them, so the open set is an observation rather than a property
# of the tail. Carrying clearedAt rather than deleting the record keeps
# the history, which is where the pattern of a troublesome aircraft
# shows up.
DefectRecord := record{
  aircraft: fleet.Registration,
  # When the defect was rectified. Absent means still open.
  clearedAt: optional<time.Timespec>,
  defect: fleet.Defect,
  reportedAt: time.Timespec}
