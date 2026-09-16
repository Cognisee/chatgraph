# A magnitude paired with the unit it is expressed in.
#
# Separate from any particular system of units: this module names the
# shape, and a units module supplies the dimensions. Nothing here
# mentions meters or knots, so the same abstraction serves any domain
# that measures things.

module ai.cognisee.models.quantity

# Parameterized over both the magnitude and the unit, so that a quantity
# cannot be built with a unit from the wrong dimension:
# Quantity<decimal, SpeedUnit> will not accept `LengthUnit.feet`.
#
# Parameterizing the value too -- rather than fixing `decimal` -- leaves
# room for an integral count, or for a value carrying error bounds,
# without needing a second shape.
Quantity := forall v, u. record{
  unit: u,
  value: v}
