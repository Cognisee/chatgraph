# Aircraft: the types an operator flies, the individual airframes, and
# the cabin arrangements fitted to them.
#
# The distinction between a type, a variant and a tail matters
# operationally. A substitution decision is usually framed as "can this
# tail fly that rotation", but the constraints come from three different
# levels: the type fixes crew qualification, the variant fixes range and
# capacity, and the tail fixes cabin product and maintenance state.

module ai.cognisee.models.aviation.airline.fleet

import ai.cognisee.models.aviation.site as site
import ai.cognisee.models.time as time
import ai.cognisee.models.units as units

# An individual airframe, identified by its registration. The tail is
# what actually gets assigned to a rotation.
#
# Deliberately immutable. Position, airworthiness and open defects all
# change many times a day against an airframe that lasts decades, so
# they are observations in the state module rather than fields here --
# see AircraftPosition, AircraftStatus and DefectRecord. What remains is
# what is true of the tail for as long as it is that tail.
Aircraft := record{
  cabin: CabinConfiguration,
  registration: Registration,
  # Where this airframe may or may not be flown. Empty means no
  # restriction is recorded, which is not the same as none existing.
  # A property of the airframe's certification and fit, so it belongs
  # here: it changes on the scale of the aircraft itself, not the day.
  restrictions: list<DestinationRestriction>,
  variant: AircraftVariant}

# An aircraft type as certified: the level at which a pilot type rating
# applies. A 777 rating covers every 777 variant; it does not cover an
# A380. This is the constraint that makes crew non-substitutable across
# types during a disruption.
AircraftType := record{
  # ICAO type designator, e.g. "A388", "B77W".
  icaoType: string,
  manufacturer: string,
  # The common name an operator uses in speech: "A380", "triple seven".
  name: string}

# A specific model within a type, which is what fixes range, capacity
# and performance. The 777-300ER and the 777-200LR share a type rating
# and almost nothing else operationally.
AircraftVariant := record{
  # Aerodrome reference code the variant requires: the ICAO Annex 14
  # size class, not a location identifier. Code F is what limits an
  # A380 to a small number of stands.
  #
  # The code, not the wingspan and gear span it is drawn from. A code is
  # an identifier; the dimension bounds behind it are reference data to
  # be looked up, not facts to duplicate onto every airframe. Same enum
  # as Stand.maxAerodromeCode, so the two are directly comparable --
  # which is the whole point of the classification.
  aerodromeCode: site.AerodromeCode,
  aircraftType: AircraftType,
  maximumRange: units.Length,
  maximumTakeoffMass: units.Mass,
  name: string}

# Whether the aircraft can currently be dispatched.
AirworthinessStatus := union{
  # In scheduled or unscheduled maintenance.
  maintenance: unit,
  # Grounded and not expected back soon: a long repair, a cabin
  # retrofit, or storage.
  outOfService: unit,
  serviceable: unit,
  # Technically unserviceable and awaiting a decision or a part. This is
  # the state that starts a substitution problem.
  unserviceable: unit}

# The physical cabin fitted to one airframe. Two aircraft of the same
# variant may carry different products, and that difference is not
# visible in a seat count: an aircraft with no first class cannot take a
# first class passenger load, however many seats it has.
CabinConfiguration := record{
  cabins: list<CabinSection>,
  name: string,
  totalSeats: int32}

# One class of service within a cabin.
CabinSection := record{
  # Which deck, on a two-deck aircraft. Absent when the aircraft has
  # one deck.
  deck: optional<Deck>,
  seats: int32,
  travelClass: TravelClass}

# Which deck of a two-deck aircraft a cabin section sits on. Only the
# A380 makes this a real distinction, and it matters operationally
# because boarding and deboarding the two decks run in parallel through
# separate bridges -- when the stand has them.
Deck := union{
  lower: unit,
  main: unit,
  upper: unit}

# A deferred or active technical defect.
Defect := record{
  # Whether the defect is deferrable under the minimum equipment list,
  # and until when.
  deferral: optional<Deferral>,
  description: string,
  # Free text: the ATA chapter the defect belongs to, where known.
  system: optional<string>}

# Permission to operate with a known defect unrepaired, and the clock
# attached to it.
#
# The mechanism by which a technical problem becomes a scheduling
# problem: the aircraft keeps flying, but a repair deadline now
# constrains where it can be at a given date, and that constraint is
# invisible to anyone looking only at today's serviceability.
Deferral := record{
  category: DeferralCategory,
  # When the defect must be rectified by. The deadline is the primitive
  # fact; how much is left is a view of it against the current time, and
  # a view that is wrong a moment later. Absent when the interval is
  # counted in cycles or hours rather than days, since those have no
  # calendar deadline until you know the flying plan.
  expiresAt: optional<time.Timespec>,
  # How the interval is counted, and how much of it remains.
  remaining: RectificationInterval}

# The MEL rectification category, which fixes how long a defect may be
# carried. A closed, four-valued scheme, so an enum rather than the
# letter as text.
#
# The standard intervals, excluding the day of discovery: category A is
# as specified in the MEL item itself and has no standard period;
# B is three consecutive calendar days, C is ten, D is 120.
DeferralCategory := union{
  # Interval specified in the MEL item; no standard period.
  categoryA: unit,
  # Three consecutive calendar days.
  categoryB: unit,
  # Ten consecutive calendar days.
  categoryC: unit,
  # 120 consecutive calendar days.
  categoryD: unit}

# Where an aircraft or crew member may or may not go.
#
# Raised twice, unprompted, as a routine binding constraint rather than
# an edge case: "certain crew cannot fly to certain countries. You have
# certain aircraft cannot fly to certain countries." Usually overflight
# permits, insurance or registration for aircraft; visas, licence
# recognition or nationality for crew.
#
# One type serves both because they were named in one breath as the same
# kind of constraint, and because the substitution logic is identical:
# it removes candidates from a pool.
DestinationRestriction := record{
  # Countries or aerodromes, as stated. Free text rather than an ICAO
  # code because the restriction is often expressed at country level.
  destinations: list<string>,
  kind: RestrictionKind,
  # Why the restriction exists, where stated. Usually a certification or
  # an equipment fit; occasionally a bilateral or a sanction.
  reason: optional<string>}

# What remains of a rectification interval, in the unit it is counted
# in.
#
# The kinds are not interchangeable and the difference decides a
# recovery option. Calendar days tick whether or not the aircraft flies,
# so a tail parked over a weekend still burns its category B clock;
# cycles and hours tick only when it operates, so parking it stops the
# clock. Whether "ground it until we can fix it" buys anything depends
# entirely on which of these is counting.
RectificationInterval := union{
  calendarDays: int32,
  # One cycle is one takeoff and landing.
  flightCycles: int32,
  flightHours: int32}

# An aircraft registration, e.g. "G-ABCD". Unique to one airframe, and
# the identifier controllers actually use.
Registration := wrap{string}

# Whether a restriction names what is allowed or what is forbidden.
#
# The distinction is not cosmetic. "You only have a certain list of tails
# that can fly into that country" is an allowlist, and a short allowlist
# behaves quite differently from a long blocklist when you are hunting
# for a substitute at two in the morning.
RestrictionKind := union{
  permitted: unit,
  prohibited: unit}

# Cabin class, as it bears on recovery rather than on revenue. What a
# controller needs it for is downgrade and reaccommodation: whether a
# substitute aircraft can seat the premium passengers already booked.
TravelClass := union{
  business: unit,
  economy: unit,
  first: unit,
  premiumEconomy: unit}
