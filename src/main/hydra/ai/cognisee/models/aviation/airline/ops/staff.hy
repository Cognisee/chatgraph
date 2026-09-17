# The people who run the operation, as against the people who operate
# the aircraft. Flight and cabin crew are in the crew module, where they
# belong with the duty and qualification constraints that govern them;
# this module is for the staff whose output is decisions rather than
# sectors.
#
# They are modelled at all because the interesting facts are about who
# knew what. A decision made at the hub and a decision made at an
# outstation are made from different information, and the difference is
# not incidental -- it is frequently the whole explanation for why an
# option was or was not taken.
#
# Note the asymmetry with crew: these roles carry no duty-limit type.
# That is not an oversight. ICAO's fatigue Standards name flight and
# cabin crew only, and the UAE implements exactly that, so there is no
# regulated limit to model here. The absence is itself a finding.

module ai.cognisee.models.aviation.airline.ops.staff


import ai.cognisee.models.aviation.site as site
import ai.cognisee.models.time as time

# The roles that participate in operational decisions.
#
# Listed because who holds a decision, and who merely advises on it, is
# a recurring question in the scenarios. The station manager case is the
# one most easily missed: they are the person who negotiates the local
# exception, and that is frequently the move that saves the night.
OperationsRole := union{
  # Flight dispatch: flight planning, fuel, and the operational flight
  # plan. Licensed in many jurisdictions, including the UAE.
  dispatcher: unit,
  # Holds the operation as a whole for a shift, and escalation point for
  # decisions a controller will not take alone.
  dutyManager: unit,
  # Watches a portion of the network and initiates recovery action.
  networkController: unit,
  other: string,
  # Owns the airline's interests at one airport, and the person who
  # negotiates the local exception -- a curfew waiver, a stand, a slot.
  stationManager: unit}

# Someone who participates in operational decisions.
OperationsStaff := record{
  identifier: string,
  role: OperationsRole,
  # Which shift, where it is recorded. Handovers are where context is
  # lost, so knowing a decision spanned one is worth having.
  shift: optional<Shift>,
  # Where this person works from. A hub controller and a station manager
  # see the same disruption differently, and where they sit is most of
  # the reason.
  station: optional<site.IcaoCode>}

# A working period. Recorded because handovers are where operational
# context is lost, so knowing that a decision spanned one is worth
# having when reconstructing why it went the way it did.
Shift := record{
  end: time.Timespec,
  identifier: optional<string>,
  start: time.Timespec}
