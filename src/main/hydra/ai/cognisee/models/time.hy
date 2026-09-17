# Points in time as operations talks about them.
#
# `Timespec` is duplicated from Hydra's own kernel module `hydra.time`,
# rather than imported: these modules are documentation for now, and a
# cross-package dependency would buy nothing until the projection is
# real. When it is, this type should be replaced by the kernel's.
#
# What the rest of the module adds is the forms an absolute instant
# cannot express, because operations is full of them. "0430" at an
# aerodrome is a different instant every day of the year at some
# latitudes, and controllers say it constantly. A date is coarser still.
# Collapsing these to an instant at capture time discards the difference
# between what was said and what was meant.
#
# Zones are the exception, and are mandatory throughout. A time with an
# unspecified zone is not a preserved ambiguity, it is an unusable
# number: nothing downstream can order it, compare it or convert it, and
# the context needed to resolve it is gone by then. So the zone is
# inferred at capture -- from the station, the speaker, the surrounding
# conversation -- and never persisted unknown. What stays deliberately
# absent is the date, because that often genuinely cannot be recovered.

module ai.cognisee.models.time

# A calendar date with no time of day, as an ISO 8601 string:
# "2026-09-22". The date an operation is scheduled for, which is not
# always the date each of its legs departs on.
Date := wrap{string}

# A clock time at a place, without a date: "0430". This is how
# operational times are spoken, and it names an instant only once the
# date is known. Kept distinct from an instant because the date is
# genuinely absent from what was said, and inventing one would assert
# something the speaker did not.
#
# The zone, by contrast, is mandatory. Both are unstated in speech, but
# they differ in what can be done about it: a zone can be inferred from
# the station or the speaker at capture time, while a date often cannot
# be recovered at all. So the zone is resolved when the information is
# still to hand, and the date stays out of this type.
LocalTime := record{
  # Minutes past midnight, 0-1439. Ordering within a day is then
  # trivial, and no repeated parsing of "0430" is needed.
  minutesPastMidnight: int32,
  # The zone the clock time is read against. Mandatory: a local time
  # without one is not a time, it is a number, and persisting it defers
  # an ambiguity that only gets harder to resolve. The speaker usually
  # does not say the zone, so it is inferred at capture -- from the
  # station, the speaker's location, the surrounding context -- where
  # that inference is still cheap and checkable.
  zone: TimeZone}

# An interval between two instants. Either end may be open: a disruption
# that has begun and not ended has a start and no finish, and that is a
# fact about the situation rather than missing data.
Period := record{
  from: optional<Timespec>,
  to: optional<Timespec>}

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
  value: Timespec}

# A time zone, as an IANA name: "Europe/London", "America/Denver".
#
# Wrapped rather than left a bare string because it is an identifier
# from a defined registry, not free text -- and because the alternative
# ways of writing a zone are all worse. A UTC offset loses the rule that
# generated it, so it cannot survive a daylight-saving boundary; an
# abbreviation like "GST" is not unique across the world.
#
# Not an enum: the IANA database has several hundred entries and is
# revised as states change their rules, so enumerating it here would
# guarantee this module falls out of date.
TimeZone := wrap{string}

# The POSIX struct timespec, with the same semantics: an instant in time
# as a number of seconds and nanoseconds since the Unix Epoch
# (1970-01-01T00:00:00Z). The actual resolution is implementation- and
# filesystem-defined.
#
# DUPLICATED from `hydra.time.Timespec`. Replace with the kernel type
# once these modules become executable.
Timespec := record{
  # Nanoseconds within the second, in the range [0, 999999999];
  # unsigned, as the value is never negative.
  nanoseconds: uint32,
  # Whole seconds since the Unix Epoch; signed, so instants in the far
  # past or distant future are representable.
  seconds: int64}
