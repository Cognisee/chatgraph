# Airports and their physical layout: the fixed infrastructure that
# operations happen on. Nothing here changes over the course of a day.

module ai.cognisee.models.aviation.site

import ai.cognisee.models.units

# A civil airport, identified by its ICAO code. IATA is carried too
# because operational staff use it in speech far more often.
Airport := record{
  icao: IcaoCode,
  iata: optional<IataCode>,
  name: string,
  runways: list<Runway>}

# Four-letter ICAO location indicator, e.g. "EGLL".
IcaoCode := wrap{string}

# Three-letter IATA code, e.g. "LHR".
IataCode := wrap{string}

# A runway, named by its magnetic heading and side. A single physical
# strip is two runways -- one per direction -- so "12L" and "30R" are
# distinct Runways over shared pavement.
Runway := record{
  designator: RunwayDesignator,
  length: units.Meters,
  surface: SurfaceType,
  # The lowest visibility category the runway is approved for. Absent
  # means no instrument approach is published.
  approachCategory: optional<ApproachCategory>}

# e.g. "12L". The side distinguishes parallel runways.
RunwayDesignator := record{
  heading: RunwayHeading,
  side: optional<RunwaySide>}

# A runway heading in tens of degrees: the magnetic heading rounded to
# the nearest ten with the ones place dropped, so 1-36. Runway 12 points
# at roughly 120 degrees magnetic, but its true alignment may be
# anywhere in the surrounding arc, and the pavement marking is what is
# authoritative -- not the arithmetic.
RunwayHeading := wrap{int32}

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

# Precision approach category. Higher categories permit lower decision
# heights and runway visual range, which is what keeps a hub landing
# aircraft in fog.
ApproachCategory := union{
  nonPrecision: unit,
  catI: unit,
  catII: unit,
  catIIIa: unit,
  catIIIb: unit,
  catIIIc: unit}
