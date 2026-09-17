# Airports and their physical layout: the fixed infrastructure that
# operations happen on. Nothing here changes over the course of a day.

module ai.cognisee.models.aviation.site

import ai.cognisee.models.time as time
import ai.cognisee.models.units as units

# ICAO aerodrome reference code letter. Bounds wingspan and outer main
# gear span, and so determines which aircraft a stand, taxiway or runway
# can take. The FAA uses airplane design groups (ADG I-VI) for the same
# constraints; this is the international form.
AerodromeCode := union{
  codeA: unit,
  codeB: unit,
  codeC: unit,
  codeD: unit,
  codeE: unit,
  codeF: unit}

# A civil airport, identified by its ICAO code. IATA is carried too
# because operational staff use it in speech far more often.
Airport := record{
  # Movement restrictions at this aerodrome. Empty means none recorded,
  # which is not the same as none existing.
  curfews: list<Curfew>,
  iata: optional<IataCode>,
  icao: IcaoCode,
  name: string,
  runways: list<Runway>,
  terminals: list<Terminal>}

# Lowest approach minima the runway is approved for, in ICAO terms.
# Higher categories permit lower decision height and runway visual
# range, which is what keeps a hub landing aircraft in fog.
#
# The CAT I-III ladder is defined by ICAO Annex 6 and is used
# internationally. The variants are spelled with arabic numerals --
# cat3a, not catIIIa -- because runs of consecutive capitals do not
# survive conversion between naming conventions. The documents write
# them in roman numerals; the identifiers do not have to.
#
# `other` carries approach types this ladder does not name -- GLS, and
# state-specific authorizations such as the FAA's special CAT II/III and
# EASA's lower-than-standard minima -- as the name used locally, rather
# than forcing them into a category they do not belong to.
ApproachCategory := union{
  cat1: unit,
  cat2: unit,
  cat3a: unit,
  cat3b: unit,
  cat3c: unit,
  nonPrecision: unit,
  other: string}

# A pier or satellite within a terminal. Which concourse a stand belongs
# to determines how far a connecting passenger walks, and whether they
# change buildings -- at a hub that is the difference between a
# connection making and missing.
Concourse := record{
  name: string,
  stands: list<Stand>}

# A time window in which an aerodrome will not accept movements.
#
# Raised unprompted as a standing priority, especially in Europe. The
# exceptionAuthority field is the point: her worked example is a station
# manager negotiating to get away fifteen minutes past the limit, so a
# curfew is a hard limit with a soft edge. Modelling only the hard limit
# would lose the move that matters.
#
# What follows from missing one is the cascade the scenarios are about:
# an aircraft stuck overnight, passengers needing hotel rooms that may
# not exist, and a tail out of its rotation until morning.
Curfew := record{
  # Which movements it restricts.
  appliesTo: CurfewScope,
  # Whether an exception can be sought, and from whom, where known.
  exceptionAuthority: optional<string>,
  # Local clock times bounding the window.
  from: time.LocalTime,
  to: time.LocalTime}

# Which movements a curfew binds. Asymmetric restrictions are common --
# an airport that will accept a late arrival but not release a departure
# -- and the asymmetry is exactly what determines whether an aircraft is
# merely late or stranded.
CurfewScope := union{
  arrivals: unit,
  both: unit,
  departures: unit}

# Three-letter IATA code, e.g. "LHR".
IataCode := wrap{string}

# Four-letter ICAO location indicator, e.g. "EGLL".
IcaoCode := wrap{string}

# A runway, named by its heading and side. A single physical strip is
# two runways -- one per direction -- so "12L" and "30R" are distinct
# Runways over shared pavement.
Runway := record{
  # The lowest visibility category the runway is approved for. Absent
  # means no instrument approach is published.
  approachCategory: optional<ApproachCategory>,
  designator: RunwayDesignator,
  length: units.Length,
  surface: SurfaceType}

# e.g. "12L". The side distinguishes parallel runways.
RunwayDesignator := record{
  heading: RunwayHeading,
  side: optional<RunwaySide>}

# A runway heading in tens of degrees: the heading rounded to the
# nearest ten with the ones place dropped, so 1-36. Runway 12 points at
# roughly 120 degrees, but its true alignment may be anywhere in the
# surrounding arc, and the pavement marking is authoritative -- not the
# arithmetic.
#
# Most states number runways by magnetic heading, but some -- notably at
# high latitudes, where magnetic variation is large and moves quickly --
# use true. The alignment carries its own reference, so a designator
# does not have to assume one.
RunwayHeading := record{
  # The alignment the designation was derived from, which says whether
  # it is a magnetic or a true reference.
  alignment: units.Angle,
  # The two-digit number as painted, 1-36.
  designation: int32}

# Which of a parallel pair a runway is. Part of the designator rather
# than an attribute of the pavement: 27L and 27R are separate runways
# with separate declared distances and, often, separate approach
# minima.
RunwaySide := union{
  center: unit,
  left: unit,
  right: unit}

# An aircraft parking position. Distinct from a gate: the stand is where
# the aircraft parks, the gate is the passenger door serving it. A
# remote stand has no gate, and passengers reach it by bus.
Stand := record{
  # Passenger boarding bridges serving the stand. Zero when remote. A
  # second or third bridge, and in particular an upper-deck bridge,
  # changes how fast a large aircraft can be boarded.
  bridges: int32,
  # False for a remote stand.
  contact: boolean,
  identifier: string,
  # Largest aerodrome reference code the stand accepts. This is the
  # constraint that makes wide-body parking scarce.
  maxAerodromeCode: AerodromeCode}

# What a runway is made of. Bears on braking action and on which
# aircraft may use it at all, both of which tighten sharply once the
# surface is wet.
SurfaceType := union{
  asphalt: unit,
  concrete: unit,
  dirt: unit,
  grass: unit,
  gravel: unit}

# A passenger building. Modelled because connection times are stated
# between areas rather than between flights: a transfer within one
# terminal and a transfer across two are different problems wearing the
# same clothes.
Terminal := record{
  concourses: list<Concourse>,
  name: string}
