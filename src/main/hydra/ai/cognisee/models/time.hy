# Points in time as operations talks about them.
#
# The absolute instant is Hydra's own `hydra.time.Timespec` -- POSIX
# struct timespec semantics, signed seconds and unsigned nanoseconds
# since the Unix epoch -- so this module does not reinvent it. What it
# adds is the forms that are *not* absolute, because operations is full
# of them.
#
# "0430" at an aerodrome is a different instant every day of the year at
# some latitudes, and controllers say it constantly. A date is coarser
# still. Collapsing these to an instant at capture time discards the
# distinction between what was said and what was meant, and requires
# guessing a zone that the speaker may not have supplied.

module ai.cognisee.models.time

import hydra.time as hydratime

# A calendar date with no time of day, as an ISO 8601 string:
# "2026-09-22". The date an operation is scheduled for, which is not
# always the date each of its legs departs on.
Date := wrap{string}

# A clock time at a place, without a date: "0430". This is how
# operational times are spoken, and it names an instant only once the
# date and zone are known. Kept distinct from an instant so the
# ambiguity stays visible rather than being silently resolved.
LocalTime := record{
  # Minutes past midnight, 0-1439. Ordering within a day is then
  # trivial, and no repeated parsing of "0430" is needed.
  minutesPastMidnight: int32,
  # IANA zone name where known: "Europe/London". Absent when the speaker
  # did not say and it cannot be inferred -- which is common, and worth
  # preserving rather than guessing.
  zone: optional<string>}

# An interval between two instants. Either end may be open: a disruption
# that has begun and not ended has a start and no finish, and that is a
# fact about the situation rather than missing data.
Period := record{
  from: optional<hydratime.Timespec>,
  to: optional<hydratime.Timespec>}

# How a stated time relates to reality. Operational data carries all
# three at once -- a scheduled departure, an estimate revised twice, and
# eventually a time it happened -- and which is being quoted matters
# more than the number.
TimeKind := union{
  # What happened.
  actual: unit,
  # Current best guess, subject to revision.
  estimated: unit,
  # What the plan says.
  scheduled: unit}

# An instant together with what kind of claim it is.
TimeReference := record{
  kind: TimeKind,
  value: hydratime.Timespec}
