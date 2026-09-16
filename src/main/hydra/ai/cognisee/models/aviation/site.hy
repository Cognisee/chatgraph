# Airports and their physical layout: the fixed infrastructure that
# operations happen on. Nothing here changes over the course of a day.

module ai.cognisee.models.aviation.site

import ai.cognisee.models.units as units

# A civil airport, identified by its ICAO code. IATA is carried too
# because operational staff use it in speech far more often.
Airport := record{
  icao: IcaoCode,
  iata: optional<IataCode>,
  name: string,
  runways: list<Runway>,
  terminals: list<Terminal>}

# Four-letter ICAO location indicator, e.g. "EGLL".
IcaoCode := wrap{string}

# Three-letter IATA code, e.g. "LHR".
IataCode := wrap{string}

# A runway, named by its heading and side. A single physical strip is
# two runways -- one per direction -- so "12L" and "30R" are distinct
# Runways over shared pavement.
Runway := record{
  designator: RunwayDesignator,
  length: units.Length,
  surface: SurfaceType,
  # The lowest visibility category the runway is approved for. Absent
  # means no instrument approach is published.
  approachCategory: optional<ApproachCategory>}

# e.g. "12L". The side distinguishes parallel runways.
RunwayDesignator := record{
  heading: RunwayHeading,
  side: optional<RunwaySide>,
  reference: HeadingReference}

# A runway heading in tens of degrees: the heading rounded to the
# nearest ten with the ones place dropped, so 1-36. Runway 12 points at
# roughly 120 degrees, but its true alignment may be anywhere in the
# surrounding arc, and the pavement marking is authoritative -- not the
# arithmetic.
#
# Most states number runways by magnetic heading, but some -- notably at
# high latitudes, where magnetic variation is large and moves quickly --
# use true. The reference is a property of the aerodrome, so it is
# recorded on the runway rather than assumed here.
RunwayHeading := wrap{int32}

HeadingReference := union{
  magnetic: unit,
  true_: unit}

RunwaySide := union{
  left: unit,
  center: unit,
  right: unit}

SurfaceType := union{
  asphalt: unit,
  concrete: unit,
  gravel: unit,
  grass: unit,
  dirt: unit}

# Lowest approach minima the runway is approved for, in ICAO terms.
# Higher categories permit lower decision height and runway visual
# range, which is what keeps a hub landing aircraft in fog.
#
# The CAT I-III ladder is defined by ICAO Annex 6 and is used
# internationally. `other` carries approach types this ladder does not
# name -- GLS, and state-specific authorisations such as the FAA's
# special CAT II/III and EASA's lower-than-standard minima -- as the
# name used locally, rather than forcing them into a category they do
# not belong to.
ApproachCategory := union{
  nonPrecision: unit,
  catI: unit,
  catII: unit,
  catIIIa: unit,
  catIIIb: unit,
  catIIIc: unit,
  other: string}

Terminal := record{
  name: string,
  concourses: list<Concourse>}

# A pier or satellite within a terminal. Which concourse a stand belongs
# to determines how far a connecting passenger walks, and whether they
# change buildings -- at a hub that is the difference between a
# connection making and missing.
Concourse := record{
  name: string,
  stands: list<Stand>}

# An aircraft parking position. Distinct from a gate: the stand is where
# the aircraft parks, the gate is the passenger door serving it. A
# remote stand has no gate, and passengers reach it by bus.
Stand := record{
  identifier: string,
  # Largest aerodrome reference code the stand accepts. This is the
  # constraint that makes wide-body parking scarce.
  maxAerodromeCode: AerodromeCode,
  # False for a remote stand.
  contact: boolean,
  # Passenger boarding bridges serving the stand. Zero when remote. A
  # second or third bridge, and in particular an upper-deck bridge,
  # changes how fast a large aircraft can be boarded.
  bridges: int32}

# ICAO aerodrome reference code letter. Bounds wingspan and outer main
# gear span, and so determines which aircraft a stand, taxiway or runway
# can take.
AerodromeCode := union{
  codeA: unit,
  codeB: unit,
  codeC: unit,
  codeD: unit,
  codeE: unit,
  codeF: unit}
