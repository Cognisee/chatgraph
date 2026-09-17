# Physical quantities, carrying the unit they were stated in.
#
# Aviation is not unit-consistent, and cannot be made so by choosing a
# side. Altitude is in feet almost everywhere but meters in China and
# parts of the former Soviet Union; runway length is meters in most of
# the world and feet in the United States; fuel is kilograms for some
# operators and pounds for others, on the same airframe. Visibility is
# meters in most states and statute miles in the US.
#
# So a quantity records its unit rather than assuming one. Converting is
# a separate operation, and a lossy one -- the value an expert actually
# said is the value worth keeping.

module ai.cognisee.models.units

import ai.cognisee.models.quantity as quantity

# A bearing or heading. See AngleUnit: the reference is part of the
# unit, because a heading without one is ambiguous.
Angle := quantity.Quantity<decimal, AngleUnit>

# Degrees are the only angular unit in operational use here -- nobody
# quotes a heading in radians -- but the *reference* is a real
# distinction and a real source of error: 090 true and 090 magnetic are
# different directions, and the variation between them changes with
# place and time. Carrying it in the unit makes the two
# non-interchangeable.
#
# `grid` appears in polar operations, where meridians converge too
# sharply for magnetic or true headings to be practical.
AngleUnit := union{
  degreesGrid: unit,
  degreesMagnetic: unit,
  degreesTrue: unit,
  radians: unit}

# An elapsed time or a limit. Most operational durations are quoted in
# minutes, and duty limits in hours.
Duration := quantity.Quantity<decimal, DurationUnit>

# Seconds appear in turnaround measurement; everything a controller says
# aloud is minutes or hours.
DurationUnit := union{
  hours: unit,
  minutes: unit,
  seconds: unit}

# A distance, altitude, or dimension.
Length := quantity.Quantity<decimal, LengthUnit>

# Mixed by convention rather than by region alone: the same controller
# will quote a runway in meters and an altitude in feet without
# noticing.
LengthUnit := union{
  feet: unit,
  kilometers: unit,
  meters: unit,
  # Nautical miles for distances; statute miles appear in US visibility
  # reporting.
  nauticalMiles: unit,
  statuteMiles: unit}

# A weight: fuel, payload, or the aircraft itself.
Mass := quantity.Quantity<decimal, MassUnit>

# Kilograms and pounds both appear in fuel figures, sometimes for the
# same airframe under different operators -- which is why the unit
# travels with the number.
MassUnit := union{
  kilograms: unit,
  pounds: unit,
  # Metric tonnes, used for payload and aircraft weights.
  tonnes: unit}

# An altimeter setting, or any other operational pressure.
Pressure := quantity.Quantity<decimal, PressureUnit>

# Altimeter settings are hectopascals in most of the world and inches of
# mercury in the US and Canada; the difference is a routine source of
# level busts.
PressureUnit := union{
  hectopascals: unit,
  inchesOfMercury: unit,
  millibars: unit}

# An airspeed, groundspeed, or wind speed.
Speed := quantity.Quantity<decimal, SpeedUnit>

# Knots almost everywhere in operational speech; the metric units appear
# in reported weather in some states.
SpeedUnit := union{
  kilometersPerHour: unit,
  knots: unit,
  # Mach is dimensionless, but appears wherever speed does at altitude,
  # so it belongs in the same union.
  mach: unit,
  metersPerSecond: unit}

# An air or surface temperature. Bears on performance more than on
# comfort: high temperatures cut available payload.
Temperature := quantity.Quantity<decimal, TemperatureUnit>

# Celsius operationally worldwide. Fahrenheit appears in US public
# reporting, which is where it reaches an interview.
TemperatureUnit := union{
  degreesCelsius: unit,
  degreesFahrenheit: unit}
