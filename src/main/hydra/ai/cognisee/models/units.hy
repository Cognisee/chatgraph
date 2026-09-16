# Physical quantities. Wrapper types rather than bare numbers, so that a
# distance cannot be silently assigned to a duration, and so the unit is
# carried in the type rather than in a field name or a comment.

module ai.cognisee.models.units

Meters := wrap{int32}

Feet := wrap{int32}

Kilograms := wrap{int32}

Knots := wrap{int32}

# Degrees Celsius.
Celsius := wrap{int32}

Minutes := wrap{int32}

# Degrees true or magnetic, 0-359. Which of the two is a property of the
# context, not of the number.
Degrees := wrap{int32}
