# Physical quantities, carrying their unit.
#
# Aviation is not unit-consistent, and cannot be made so by choosing a
# side. Altitude is in feet almost everywhere but meters in China and
# parts of the former Soviet Union; runway length is meters in most of
# the world and feet in the United States; fuel is kilograms for some
# operators and pounds for others, on the same airframe. Visibility is
# meters in most states and statute miles in the US.
#
# So a quantity records the unit it was stated in rather than assuming
# one. Converting is a separate operation, and a lossy one -- the value
# an expert said is the value worth keeping.

module ai.cognisee.models.units

Length := record{
  value: decimal,
  unit: LengthUnit}

LengthUnit := union{
  meters: unit,
  feet: unit,
  # Nautical miles, for distances; statute miles appear in US
  # visibility reporting.
  nauticalMiles: unit,
  statuteMiles: unit,
  kilometers: unit}

Mass := record{
  value: decimal,
  unit: MassUnit}

MassUnit := union{
  kilograms: unit,
  pounds: unit,
  # Metric tonnes, used for payload and aircraft weights.
  tonnes: unit}

Speed := record{
  value: decimal,
  unit: SpeedUnit}

SpeedUnit := union{
  knots: unit,
  kilometersPerHour: unit,
  metersPerSecond: unit,
  # Mach number is dimensionless, but appears wherever speed does at
  # altitude, so it belongs in the same union.
  mach: unit}

Temperature := record{
  value: decimal,
  unit: TemperatureUnit}

TemperatureUnit := union{
  celsius: unit,
  fahrenheit: unit}

Pressure := record{
  value: decimal,
  unit: PressureUnit}

# Altimeter settings are hectopascals in most of the world and inches of
# mercury in the US and Canada; the difference is a routine source of
# level busts.
PressureUnit := union{
  hectopascals: unit,
  inchesOfMercury: unit,
  millibars: unit}

# Duration in minutes. Unit-neutral: minutes are minutes everywhere, and
# operational times are quoted in them.
Minutes := wrap{int32}

# An angle in degrees, 0-359. Whether it is referenced to magnetic or
# true north is a property of the context, and is recorded there.
Degrees := wrap{int32}
