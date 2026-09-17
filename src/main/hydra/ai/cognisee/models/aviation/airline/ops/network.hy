# The schedule: flights, the rotations that string them together, and
# the connections passengers make between them.
#
# The distinction between a scheduled flight and the day's operation of
# it is load-bearing. A flight number is a schedule entity that recurs;
# a flight leg is one instance on one day, with an aircraft, a crew and
# actual times. Controllers talk about both and mean different things.

module ai.cognisee.models.aviation.airline.ops.network

import ai.cognisee.models.aviation.airline.fleet as fleet
import ai.cognisee.models.aviation.site as site
import ai.cognisee.models.time as time
import ai.cognisee.models.units as units

# A connecting bank: a cluster of arrivals timed to feed a cluster of
# departures. Hub schedules are built around these, which is why a
# single late inbound can threaten dozens of connections at once rather
# than one.
#
# QUESTION: do operators name and manage banks as first-class objects,
# or is a bank an analyst's description of a pattern in the schedule?
# This is on the list to ask an operations controller.
Bank := record{
  # Whether this is an arrival or a departure cluster.
  direction: BankDirection,
  # Local times bounding the cluster.
  endTime: time.LocalTime,
  name: string,
  startTime: time.LocalTime}

# Whether a bank gathers arrivals or releases departures. A hub day
# alternates between the two, and a disruption in an arrival bank
# surfaces as a problem in the departure bank that follows it.
BankDirection := union{
  arrival: unit,
  departure: unit}

# Whose minimum connect time this is. The distinction matters in
# recovery: the published figure is what the airline can be held to,
# the operator's own is usually more conservative, and knowing which
# one a controller is working to tells you how much room they think
# they have.
ConnectTimeSource := union{
  # The airline's own scheduling standard.
  operator: unit,
  # The station's published minimum.
  published: unit}

# One passenger itinerary across two legs at a hub, and the time
# available to make it.
#
# The unit in which hub disruption is actually felt. A late inbound is
# not itself a problem; it becomes one through the connections it
# breaks, which is why the same delay costs nothing on one bank and
# cascades on the next.
Connection := record{
  # Minutes between the inbound's scheduled arrival and the outbound's
  # scheduled departure.
  availableTime: units.Duration,
  inbound: FlightLeg,
  outbound: FlightLeg,
  # How many passengers are booked on this connection, where known.
  passengers: optional<int32>,
  # Whether checked baggage has to transfer as well. Baggage and
  # passengers are not interchangeable: a passenger can be walked to a
  # gate, a bag cannot, and the bag's cutoff is earlier.
  transferBaggage: boolean}

# A scheduled flight: the recurring schedule entity, not any particular
# day's operation of it.
#
# Kept distinct from FlightLeg because controllers use both words and
# mean different things. A flight is what the timetable sells; a leg is
# what actually departs, with a tail number and a crew. Collapsing them
# loses the ability to say that today's operation diverges from plan,
# which is the only thing recovery is about.
Flight := record{
  destination: site.IcaoCode,
  # Marketing carrier code plus number, e.g. "XY203".
  number: FlightNumber,
  origin: site.IcaoCode,
  # The variant the schedule was built around. The aircraft actually
  # assigned may differ, and that difference is the substitution
  # problem.
  plannedVariant: optional<fleet.AircraftVariant>,
  scheduledArrival: time.LocalTime,
  scheduledDeparture: time.LocalTime}

# One operation of a flight on one day: a specific aircraft, a specific
# crew, and times that move.
#
# This is the object a controller manipulates. Everything in the
# disruption module attaches here rather than to Flight, because you
# cannot cancel a timetable entry -- you cancel today's leg.
FlightLeg := record{
  aircraft: optional<fleet.Registration>,
  # The stand actually assigned, where known. Stand availability is a
  # real constraint on which aircraft can operate a leg.
  arrivalStand: optional<string>,
  date: time.Date,
  departureStand: optional<string>,
  # Estimated or actual times, as they become known. Absent until they
  # are.
  estimatedArrival: optional<time.Timespec>,
  estimatedDeparture: optional<time.Timespec>,
  flight: Flight,
  passengerLoad: optional<PassengerLoad>,
  status: FlightStatus}

# A marketing flight number, carrier code included, e.g. "XY203".
#
# Wrapped rather than left as a bare string because it identifies the
# commercial product and not the operation: codeshares mean several
# numbers can name one leg, and a number outlives any aircraft that
# ever flew it.
FlightNumber := wrap{string}

# Where a leg has got to. Deliberately coarse: these are the states a
# controller needs to distinguish to decide what is still possible, not
# a full movement-message vocabulary.
FlightStatus := union{
  airborne: unit,
  arrived: unit,
  boarding: unit,
  cancelled: unit,
  # Pushed back and taxiing.
  departed: unit,
  diverted: unit,
  # On the ground at the origin, not yet boarding.
  scheduled: unit}

# The least time in which a passenger or bag can be expected to make a
# connection at a station.
#
# A planning figure, and like most planning figures it is optimistic in
# the cases that matter -- it assumes an on-stand arrival, a working
# bridge and no immigration queue. Which is why an experienced
# controller treats a connection at exactly MCT as already broken.
MinimumConnectTime := record{
  # Where the connection happens.
  airport: site.IcaoCode,
  # Narrower cases: between terminals, or between specific concourses.
  # Absent when the figure applies station-wide.
  fromArea: optional<string>,
  # Whether this is the published standard or an operator's own, which
  # may be more conservative.
  source: ConnectTimeSource,
  toArea: optional<string>,
  value: units.Duration}

# Who is on board, in the terms that bear on a recovery decision.
#
# The connecting count is the operationally significant one: local
# passengers absorb a delay, connecting passengers propagate it into
# other flights. A full aircraft of locals is an easier problem than a
# half-full one feeding a bank.
PassengerLoad := record{
  byClass: map<string, int32>,
  # Passengers making an onward connection at the destination. These are
  # the ones whose disruption propagates.
  connecting: optional<int32>,
  total: int32}

# The chain of legs one aircraft flies through a day.
#
# The reason disruption spreads. An aircraft that goes out of service
# in the morning does not break one flight, it breaks every leg
# remaining in its rotation, and recovering it means deciding where in
# that chain to absorb the loss.
Rotation := record{
  aircraft: fleet.Registration,
  date: time.Date,
  legs: list<FlightLeg>}
