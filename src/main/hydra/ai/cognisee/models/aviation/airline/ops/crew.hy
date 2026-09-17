# Crew: who is qualified to fly what, and how long they may work.
#
# Crew is the constraint most often missed by systems that reason about
# aircraft alone. A type rating is legally binding, so a crew qualified
# on one type cannot operate another however urgent the need; and duty
# limits are hard stops that arrive on a clock, not on request. Both
# turn an aircraft problem into a crew problem within hours.

module ai.cognisee.models.aviation.airline.ops.crew

import ai.cognisee.models.aviation.airline.fleet as fleet
import ai.cognisee.models.time as time
import ai.cognisee.models.units as units

# A crew member. Flight deck and cabin are modelled together because
# both are dispatch constraints, but their qualifications differ in
# kind: a pilot's rating is per aircraft type, a cabin crew member's
# competence is per type and per door.
CrewMember := record{
  # Where the crew member currently is, as an ICAO code. Positioning a
  # reserve crew from the hub to an outstation costs a day.
  baseStation: string,
  identifier: string,
  # Types the member is currently qualified and current on.
  qualifications: list<Qualification>,
  role: CrewRole}

# The minimum crew a leg requires, which is not a service-level choice.
#
# Cabin crew minima are set by the number of floor-level emergency
# exits, not by the passenger load: an aircraft with sixteen exits needs
# sixteen cabin crew even when it is flying nearly empty. So a crew
# shortage grounds an aircraft outright rather than degrading service.
CrewRequirement := record{
  cabinCrew: int32,
  flightDeck: int32,
  variant: fleet.AircraftVariant}

CrewRole := union{
  cabinCrew: unit,
  captain: unit,
  firstOfficer: unit,
  # A relief pilot carried on long sectors so the operating crew can
  # rest in flight.
  reliefPilot: unit,
  seniorCabinCrew: unit}

DutyExtension := record{
  authority: ExtensionAuthority,
  # How much additional time the extension permits.
  duration: units.Duration}

# A duty period and its limits. The limit is a hard stop: a crew that
# reaches it stops, and the flight waits for a replacement or does not
# go.
DutyPeriod := record{
  crewMember: CrewMember,
  # Whether the limit may be extended, and under what authority. Some
  # extensions are at the commander's discretion; others require the
  # operator's, and some are not available at all.
  extension: optional<DutyExtension>,
  # The latest the duty may legally end. This is the number a controller
  # is watching.
  latestFinish: time.Timespec,
  # When the duty began, as stated.
  reportTime: time.Timespec}

ExtensionAuthority := union{
  # The commander may extend in flight, within limits.
  commander: unit,
  # Requires the operator's approval, usually with reporting attached.
  operator: unit}

# A crew pairing: the sequence of duties a crew flies together before
# returning to base. Breaking a pairing to cover one flight displaces
# every duty after it, which is why crew recovery is rarely local.
Pairing := record{
  crew: list<CrewMember>,
  identifier: string,
  legs: list<string>}

# Qualification on an aircraft type. Type ratings are per type, not per
# variant: a 777 rating covers every 777. Cross-crew qualification
# between types exists within some manufacturer families but takes
# weeks of training, so it is never a disruption-recovery option.
Qualification := record{
  aircraftType: fleet.AircraftType,
  # When currency lapses without a further sector or simulator check.
  # A qualified but non-current crew member cannot operate.
  currentUntil: optional<time.Date>,
  role: CrewRole}
