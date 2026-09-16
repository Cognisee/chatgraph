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

# A magnitude paired with the unit it is expressed in. Parameterized
# over both, so that a quantity cannot be built with a unit from the
# wrong dimension: Quantity<decimal, SpeedUnit> will not accept
# `LengthUnit.feet`.
#
# `value` is decimal rather than a float width: these numbers come from
# people and documents, where 1.10 and 1.1 are different statements, and
# decimal preserves that.
Quantity := forall v, u. record{
  value: v,
  unit: u}

Length := Quantity<decimal, LengthUnit>

LengthUnit := union{
  meters: unit,
  feet: unit,
  kilometers: unit,
  # Nautical miles for distances; statute miles appear in US visibility
  # reporting.
  nauticalMiles: unit,
  statuteMiles: unit}

Mass := Quantity<decimal, MassUnit>

MassUnit := union{
  kilograms: unit,
  pounds: unit,
  # Metric tonnes, used for payload and aircraft weights.
  tonnes: unit}

Speed := Quantity<decimal, SpeedUnit>

SpeedUnit := union{
  knots: unit,
  kilometersPerHour: unit,
  metersPerSecond: unit,
  # Mach is dimensionless, but appears wherever speed does at altitude,
  # so it belongs in the same union.
  mach: unit}

Temperature := Quantity<decimal, TemperatureUnit>

TemperatureUnit := union{
  celsius: unit,
  fahrenheit: unit}

Pressure := Quantity<decimal, PressureUnit>

# Altimeter settings are hectopascals in most of the world and inches of
# mercury in the US and Canada; the difference is a routine source of
# level busts.
PressureUnit := union{
  hectopascals: unit,
  inchesOfMercury: unit,
  millibars: unit}

Duration := Quantity<decimal, DurationUnit>

DurationUnit := union{
  seconds: unit,
  minutes: unit,
  hours: unit}

# An angle in degrees, 0-359. Whether it is referenced to magnetic or
# true north is a property of the context, and is recorded there.
Degrees := wrap{int32}
