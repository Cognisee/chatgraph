# Observed and forecast conditions, and the operating minima they are
# measured against.
#
# Weather enters operational reasoning twice: as an observation that
# something is already true, and as a forecast that it may become true.
# The second drives more decisions than the first, because fuel,
# diversion planning and crew are all committed hours ahead.

module ai.cognisee.models.aviation.weather

import ai.cognisee.models.units as units

# Coverage in oktas, as reported.
CloudCoverage := union{
  broken: unit,
  clear: unit,
  few: unit,
  # Vertical visibility, reported when the sky is obscured and no layer
  # can be identified.
  obscured: unit,
  overcast: unit,
  scattered: unit}

# A cloud layer, which matters because ceiling -- the lowest broken or
# overcast layer -- is what an approach minimum is usually stated
# against.
CloudLayer := record{
  base: units.Length,
  coverage: CloudCoverage}

# A forecast: what conditions are expected, with the confidence the
# forecaster attaches. The probability qualifiers are what make
# pre-emptive decisions hard -- a thirty per cent chance of fog is not
# a fact to plan against, but it is not nothing either.
Forecast := record{
  conditions: WeatherConditions,
  # Confidence qualifier as issued, where the forecast carries one.
  probability: optional<ForecastProbability>,
  # Period the forecast covers.
  validFrom: string,
  validTo: string}

# Forecast confidence, as the terminal aerodrome forecast expresses it.
ForecastProbability := union{
  # A permanent change from the stated time.
  becoming: unit,
  # A probability given as a percentage, typically 30 or 40.
  probability: int32,
  # A temporary fluctuation expected to last less than an hour at a
  # time.
  temporary: unit}

MinimaSource := union{
  # Set by the crew for themselves, above what is required. Personal
  # minima are a documented practice and a good example of knowledge
  # that exists only in the person holding it.
  crew: unit,
  operator: unit,
  published: unit}

# The conditions an operator will not go below. Minima are not a single
# number: they differ by aerodrome, by approach, by aircraft and by
# crew qualification, and an operator's own minima may be higher than
# the published ones.
OperatingMinima := record{
  # The lowest height at which a go-around must be initiated if the
  # runway is not in sight.
  decisionHeight: optional<units.Length>,
  # The visibility along the runway, which is what a low-visibility
  # approach is actually flown against.
  runwayVisualRange: optional<units.Length>,
  # Whose minima these are: the state's, the operator's, or this
  # crew's. They are frequently different, and the highest applies.
  source: MinimaSource}

# Why visibility is reduced. The cause matters because the behaviours
# differ: radiation fog burns off with the sun and can be forecast from
# the previous evening, blowing dust does neither.
VisibilityObstruction := union{
  blowingDust: unit,
  blowingSand: unit,
  fog: unit,
  haze: unit,
  mist: unit,
  precipitation: unit,
  smoke: unit}

# A set of conditions at one place and time, whether observed or
# forecast.
WeatherConditions := record{
  ceiling: optional<units.Length>,
  cloudLayers: list<CloudLayer>,
  obstruction: optional<VisibilityObstruction>,
  # Altimeter setting. Absent in a forecast, which does not carry one.
  pressure: optional<units.Pressure>,
  temperature: optional<units.Temperature>,
  visibility: optional<units.Length>,
  wind: optional<Wind>}

Wind := record{
  direction: units.Angle,
  # Peak gust, where reported. The gust rather than the mean is what
  # governs a crosswind decision.
  gust: optional<units.Speed>,
  speed: units.Speed,
  # Reported when the direction is too variable to state as a single
  # value.
  variable: boolean}
