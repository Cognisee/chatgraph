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
import hydra.time as hydratime

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

BankDirection := union{
  arrival: unit,
  departure: unit}

ConnectTimeSource := union{
  # The airline's own scheduling standard.
  operator: unit,
  # The station's published minimum.
  published: unit}

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

FlightLeg := record{
  aircraft: optional<fleet.Registration>,
  # The stand actually assigned, where known. Stand availability is a
  # real constraint on which aircraft can operate a leg.
  arrivalStand: optional<string>,
  date: time.Date,
  departureStand: optional<string>,
  # Estimated or actual times, as they become known. Absent until they
  # are.
  estimatedArrival: optional<hydratime.Timespec>,
  estimatedDeparture: optional<hydratime.Timespec>,
  flight: Flight,
  passengerLoad: optional<PassengerLoad>,
  status: FlightStatus}

FlightNumber := wrap{string}

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

PassengerLoad := record{
  byClass: map<string, int32>,
  # Passengers making an onward connection at the destination. These are
  # the ones whose disruption propagates.
  connecting: optional<int32>,
  total: int32}

Rotation := record{
  aircraft: fleet.Registration,
  date: time.Date,
  legs: list<FlightLeg>}
