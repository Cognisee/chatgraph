# Domain background: Las Trancas (17CL) and backcountry strip operations

Orientation document for the `aviation` chatgraph domain. It exists so
that any session — human or LLM — can start with a working understanding
of the demo scenario without re-researching it.

**This file is background, not a spec.** Like `docs/medical-schema.md`,
it is loaded by *no code*. The committed schema JSON
(`src/main/json/aviation.json`) is the single source of truth for the
graph; if this document and the JSON ever disagree, the JSON wins.

**This file is not an operational document.** Nothing here is current,
verified, or suitable for flight planning. Las Trancas requires a
briefing obtained directly from the airfield, and published data for
this strip is demonstrably inconsistent (see below). Do not fly anything
off this page.

---

## Why this scenario

The demo interviews a pilot about how they operate into **one specific
airstrip they know first-hand**, and captures that knowledge as a typed
property graph in real time.

The scenario was chosen because it puts genuine tacit knowledge at the
center. The subject (Joshua Shinavier) is an instrument-rated pilot with
taildragger, backcountry, and aerobatic experience, and has personally
operated into Las Trancas. The interview therefore elicits knowledge he
actually holds, rather than a reconstruction from documentation — which
is the entire premise of the product being demonstrated.

### Relevance to an airline audience

The demo is being recorded for a major airline whose real use cases are
in **maintenance and avionics**. Las Trancas is not that. The connection
is *structural*, and it is the argument the demo is making:

- **Site-specific knowledge that overrides general procedure.** Every
  carrier has stations where the published procedure is necessary but
  not sufficient — the approach where terrain does something the
  forecast doesn't capture, the gate whose pushback is unlike anywhere
  else. That knowledge lives in crew heads, not manuals. 17CL is the
  same category, in miniature and vivid.
- **Published data diverges from operational reality.** At 17CL this is
  unusually stark and independently verifiable (below): the FAA record
  disagrees with the field by roughly 40% on runway length. An
  airline's equivalent — a manual that lags the line — is the same
  problem with more zeros attached.
- **Calibrated judgment that is documented nowhere.** Personal limits,
  abort triggers, and commitment points are built by experience. The
  airline's version is the retiring captain whose knowledge never
  reached the FOM. That is their stated knowledge-loss problem.
- **The pilot write-up is where maintenance troubleshooting begins.**
  Operating environment drives maintenance: unimproved surfaces, salt
  air, and hard use produce distinct wear. Pilot-side observation is
  the first link in the maintenance chain.

The schema is deliberately named in **transferable operational terms**
(`Site`, `SiteHazard`, `PersonalLimit`, `AbortTrigger`, `Technique`,
`Cue`) rather than GA-specific ones. Las Trancas specifics live in
*property values*, not in labels. An airline safety or ops professional
should recognize every label on screen even though every value is about
a taildragger on a coastal bluff.

---

## The airstrip

**Las Trancas (FAA identifier 17CL)** — a private, backcountry airstrip
on the California coast near Davenport / Bonny Doon, Santa Cruz County,
roughly 6 nm northwest of Davenport, on a bluff above the Pacific just
north of Monterey Bay.

### Basic data

| Item | Value |
|---|---|
| Identifier | 17CL |
| Location | Davenport / Bonny Doon, CA (Santa Cruz County) |
| Coordinates | 37.0886 N, -122.2737 W |
| Elevation | 125 ft MSL (FAA); ~135 ft per RAF airfield record |
| Runway | 14/32, gravel |
| Traffic pattern | **Rwy 32 left / Rwy 14 right** (non-standard right traffic for 14) |
| CTAF | 122.9 |
| Use | Private; **prior permission required** |
| Owner | Big Creek Lumber Co. (McCrary family) |
| Services | None. No fuel, no maintenance, unattended |
| Instrument procedures | None published |

### Published length is inconsistent — and that is a demo asset

Sources disagree materially on the single most consequential number:

| Source | Stated length |
|---|---|
| FAA / AirNav / AirportGuide | **1,300 ft × 30 ft** |
| RAF airfield briefing | **800 ft × 25 ft** |
| RAF "featured airstrip" article | **800 ft** |
| RAF "preserves" article | **900 ft** (post-grading) |
| OurAirports user comment | "1500 foot dirt landing strip" |
| Recent field comment (Feb 2026) | "Runway is 800', in good condition, slight turn to the right" |
| **Subject's own working figure** | **800 ft** — independently measured on Google Earth, and the number actually planned against |

The RAF briefing and recent first-hand reports converge on **~800 ft
usable**, against an FAA record of 1,300 ft — a discrepancy of roughly
40%, in the direction that matters. A pilot planning from the FAA record
alone would arrive with a badly wrong picture.

Note the provenance of the working figure: the subject did not take 800
ft from the FAA record or from the briefing — he **measured it himself
on Google Earth** and planned against that. That is a small, concrete
instance of the behavior the demo is about. Faced with published data he
had reason to distrust, an experienced operator went and independently
established the number, then carried the corrected value in his head
thereafter. The 800 ft figure is the *output of expert judgment*, not a
looked-up fact — and nothing in any document records either the
corrected number or the act of correcting it. Worth capturing explicitly
in the graph (a `PublishedData` value, the working value, and *how the
working value was established*), and worth saying out loud on camera.

This is the demo's thesis in one row of a table: **the published layer is
not the operational layer, and only experience closes the gap.** Expect
the interview to produce a `PublishedData` vertex and a
`divergesFrom` relationship to what the subject actually uses.

### Terrain and hazards (from published/briefing sources)

- **Steep ~100 ft cliffs on three sides.** The strip sits on a bluff
  above the beach, with drop-offs at both runway ends. Displaced or
  overrun terrain is not forgiving — off either end is a cliff.
- **Wind shear and rotor on short approach.** The RAF briefing warns
  explicitly of low-level turbulence and wind shear, **including a rotor
  at the approach end of 32, any time the wind is blowing.** Runway 32 is
  the normally favored runway, so the hazard is on the usual approach.
- **FAA remark:** `TURBULENCE SW END DURING NW WIND IN EXCESS OF 15 KTS.`
- **FAA remark:** `P-LINE 200' E OF RWY.` In FAA remark shorthand
  `P-LINE` is conventionally **power line** (one secondary source glosses
  it as "pipeline"; a power line 200 ft east of a bluff-top runway is
  both the conventional reading and the operationally significant one).
  Treat as an obstruction to be confirmed in the briefing.
- **Runway is not straight or flat.** Field reports describe a "slight
  turn to the right" and note it is **downhill past the halfway mark in
  the 14 direction** — i.e. runway 14 combines a downslope second half
  with a cliff at the far end.
- **Surface:** gravel, rough, formerly weed-encroached; graded and
  stabilized by RAF volunteer work (2023 onward). Condition varies with
  maintenance and season.
- **Airspace/environmental constraints:** adjacent to a Monterey Bay
  National Marine Sanctuary area with a 1,000 ft overflight restriction,
  and Big Basin State Park with popular Waddell Beach just north.
  Briefing instructs pilots to **remain close to the strip in the
  pattern** — which tightens an already tight pattern.
- **Aircraft suitability:** the briefing calls for familiarity with
  mountain flying technique, slow flight, and primitive-strip procedure.
  Big tires helpful; parking is on mowed ice plant over sandy soil.

### Access and etiquette

- **A briefing from the airfield is required**, individually requested
  and acknowledged, before landing. Prior permission / manager contact is
  also on the FAA record.
- **No camping** per the owners in the airfield briefing (note: RAF
  articles describe authorized airplane-only camping; the airfield
  briefing is the controlling and more restrictive source, and the
  policy has evidently changed over time — another instance of stale
  published data).
- Volunteer runway upkeep is encouraged; visiting pilots are invited to
  help maintain the strip.

### History

Built circa 1967 by **Bud McCrary**, a sustainable-forestry pioneer and
co-owner of Big Creek Lumber, who flew a 1964 Skylane from it to survey
timber holdings and spot fires over the Santa Cruz Mountains. He designed
his own VASI for the strip. After his death the McCrary family partnered
with the **Recreational Aviation Foundation (RAF)**, which holds a lease
ensuring maintenance and continued access. RAF volunteers (Jeremy Lezin,
Barry Porter, Ken Locke-Paddon and others) have graded and widened the
strip and added modest amenities.

---

## The subject's account (first-hand)

Recorded from the subject (Joshua Shinavier) as the envisioned flow of
the interview, before any schema design. **This is the primary material
the schema must be able to hold.** It is first-hand experience, not
derived from the published sources above; where the two touch, that is
noted.

It is written here as continuous prose because that is how it was
given. The actual demo is a *conversation* — the interviewing agent
elicits this material through questions, and the subject should expect
to arrive at it in a different order, with digressions.

### Framing: this is one pilot's practice, not guidance

**Critical to the demo's premise, and to how the agent must be
prompted.** What is being captured is **how this individual personally
flies this approach** — not a recommendation, not a general procedure,
not a guide for other pilots. Other pilots will have other minimums and
other techniques, and that is expected and fine.

Two consequences:

1. **The subject is not driving the session.** He is not trying to
   produce a coherent guide, and should not be expected to volunteer a
   complete or well-ordered account. **The interviewer does the
   eliciting.** Gaps, digressions, and out-of-order answers are normal
   and are the interviewer's problem to work with, not the subject's to
   pre-empt. Any prose in this document that reads as advice ("you
   should...", "avoid the temptation to...") is an artifact of how the
   monologue was first given — read it as *what he does and why*, not as
   instruction.
2. **First-person framing throughout.** The graph should read as *this
   pilot's* limits, cues, and techniques. Personal minimums are personal;
   the value of the record comes precisely from its being one identified
   expert's practice, attributable and traceable — not an anonymized
   consensus. This is also what makes records from multiple experts
   composable later: each is attributable, so they can be compared
   rather than averaged.

### The governing facts

The runway is **very short, not entirely level, not entirely straight,
and perched on the edge of a steep bluff.** Those four facts together —
not any one alone — are what put the field outside textbook practice.

**Any sea breeze blowing over the bluff creates hazardous turbulence in
exactly the wrong place**: at the point where you are crossing the cliff
edge, trying to get low enough to touch down and make best use of the
short usable portion of runway. The hazard is co-located with the moment
of maximum commitment and minimum energy. This is the key insight of the
whole account — the published briefing warns of "wind shear and rotor on
short approach," but the *geometry* of why that matters here is the part
that requires experience.

**Gate condition:** if you do not have the relevant experience, or do
not have a suitable aircraft, do not attempt a landing here.

### The preparatory low pass

The second thing a pilot should know is **the importance of a
preparatory low pass.**

- Fly the approach first, coming in **slightly fast**, low over the
  field, then **go around**.
- Purposes (the subject offered "at least two" and then gave three):
  1. It gives better information about **wind direction along the
     approach** than the ground-based windsock can.
  2. It lets you **experience the turbulence** at the approach end.
  3. It lets you **survey the runway surface** for unexpected objects.
- Execute the go-around conventionally: full power, standard go-around.

**Self-correction, recorded deliberately:** on the day he first landed
there, the subject went in for a low pass, found conditions agreeable,
and simply landed off it. He explicitly recommends *against* this —
"that is probably not a good idea." **As-practiced diverges from
as-recommended, and the subject knows it.** The schema must be able to
represent both, and the reasoning for the gap; a schema that can only
hold best practice would flatten the most human moment in the account.

### Pattern and approach

**Avoid the temptation to tighten the pattern** because the airstrip is
small. Fly a **standard pattern with a long, stabilized approach.** The
counterintuition is the point: a demanding strip pushes pilots toward a
tight pattern, and that is backwards — the long stabilized approach is
what calibrates you to the irregular wind so you can land successfully.

(Note a tension with the published briefing, which instructs pilots to
"remain close to the strip when in the pattern" for
Sanctuary/noise reasons. Both constraints are real and they pull against
each other. Worth surfacing on camera — resolving competing constraints
from different authorities is exactly the judgment an airline audience
recognizes.)

**Short-field technique is required**, which means operating **slightly
behind the power curve**, to a degree that depends on risk tolerance.
The tradeoff is explicitly two-sided:

- **Faster** → better buffer against turbulence, but risks overrunning.
- **Slower** → protects the rollout, less margin against the turbulence.

This tradeoff is where the judgment actually lives, and it deserves
active elicitation during the interview.

### The commitment rule

**Personal threshold: the beginning of the ramp area**, roughly
midfield. (Corrected from an earlier statement of "the building" — the
building sits just *beyond* the ramp, and the ramp edge is the actual
decision landmark.)

The rule has a subtlety worth preserving exactly, because it is easy to
state wrongly:

> He does not actually stop before the ramp — he wants to roll onto the
> ramp to park. **The test is whether he *could* stop before that
> point.**

That is a **counterfactual test, not an observed outcome.** The pilot is
continuously evaluating a hypothetical ("could I stop by there if I had
to?") while executing a different intention (rolling out to park). If
the answer becomes no, the response is **full power and go around.** He
has never failed the test.

This distinction matters for the schema: a naive model would record
"stops before the ramp," which is *false* and would misrepresent the
technique. The rule is about **retained capability**, not about the
actual stopping point.

**Provenance — two layers, and the layering is the interesting part.**

*The general rule* is not specific to 17CL at all:

> **"My personal rule for short airstrips is that I must always be able
> to stop before the midpoint of the runway. It's just a rule I made up
> a long time ago and have stuck to."**

That is a **portable personal doctrine** — self-authored, not taught,
not published, applied across every short strip the subject operates
into, and held stable over years. Note what it is *not*: it is not
derived from POH landing-distance figures, and it is not recomputed per
field. It is a self-imposed standing margin.

*The site-specific instantiation* is where Google Earth comes in. The
general rule says "the midpoint." Applying it at 17CL required knowing
where the midpoint actually **is** — which the subject established by
**analysis of the runway on Google Earth**, the same tool and the same
habit that produced the corrected 800 ft length. The output is the
**beginning of the ramp area** as a visual landmark.

So the structure is:

```
general doctrine (portable, self-authored, years old)
    → applied to a specific site
    → requires a measurement (Google Earth)
    → yields a visual landmark (ramp edge)
    → executed in real time as a counterfactual test
```

Each step is a different *kind* of knowledge, and the schema should be
able to hold all four. This is the single richest structure in the
account: a general principle, a site measurement, a perceptual proxy,
and an in-flight test — and **none of the four appears in any document
anywhere.** The visual landmark in particular is a deliberate
substitution of a sight picture for arithmetic, which is what makes the
rule executable while low, slow, and in turbulence.

He is explicit that this is a *personal* limit, not a published one.

### Touchdown and rollout

1. **Keep the power in until you cross the edge of the cliff** — this is
   the direct counter to the turbulence hazard, and it is tied to a
   *physical landmark*, not an altitude or airspeed. It appears in no
   manual.
2. **Then ease off** and make a **three-point landing.**
3. **Immediately reduce power to idle and pull back on the stick** to
   anchor the tailwheel.
4. **Brake hard.**
5. **Expect the brakes to throw gravel upward toward the wing** — an
   unavoidable hazard of any short gravel strip. (Note the maintenance
   bridge: this is prop and airframe wear originating in an operational
   decision, and it is precisely the kind of pilot-side observation that
   begins a maintenance chain.)

### Personal minimums — the go/no-go *before* the flight

A layered set of gates, applied before ever launching toward the field.
These are **personal minimums**, not published limits, and they are
strictly more conservative than anything in the briefing.

- **Any gusty conditions are a no-go** — independent of the geometry of
  the site. The reasoning is explicitly about *compounding*: stiff
  crosswinds are typical at 17CL and are accepted, but adding
  weather-driven turbulence on top of the non-laminar air produced by
  wind over the bluff edge is a risk the subject declines to take. Note
  the structure — it is not "gusts are dangerous" but **"gusts plus this
  site's geometry are dangerous."** The hazard is an interaction, not a
  single factor.
- **Perfect visibility required.** No marginal conditions.
- **Day only, and never close to sunset.** Two independent reasons:
  lighting quality during the approach, and not wanting to get stuck at
  the field overnight. (The second is an *operational consequence*
  constraint rather than a flying one — the field has no services, and
  the owners request no camping.)

### The low pass: what it is and is not

The low pass does not sample the same air the landing will encounter —
it is flown slightly fast, clean, power on, with an escape already
planned, whereas the landing is slower, lower, and committed. The
subject's framing of why it is still the right tool:

> It is the next best thing to flying the actual approach and then
> pressing the "play again" button if you hit the cliff.

Key points:

- It is the **best available source of information about actual
  conditions at the time of the approach** — better than any forecast
  and better than the ground-based windsock.
- Its primary decision function is **whether to make the attempt at
  all.** It is not merely a survey; it is a gate.
- The imperfection of the sample is understood and accepted, because the
  alternative — discovering the conditions during a committed approach —
  has no undo.

### Runway selection

**Trivial in practice: the approach is always from the southeast.**

If wind conditions were so unusual as to favor an approach from the
northwest, that is itself a no-go — the subject would not land. This
collapses what looks like a decision into another gate, and is a good
example of experience *removing* a decision rather than informing it.

### Departure

Comparatively standard, and a lesser concern: **the usual wind
conditions do not produce the same turbulence at the departure end.**
The hazard structure at this site is asymmetric — the bluff-edge rotor
problem is an approach problem. Worth brief coverage in the interview for
completeness, not extended treatment.

### Aircraft

- **Usual aircraft: Bellanca/American Champion 7KCAB Citabria.**
- **Also landed there in a 7ECA Citabria**, but prefers the 7KCAB for
  the **extra safety margin from its more powerful engine.**

Note the shape of this preference: both aircraft are capable of the
field, and the subject has flown both in. The choice is not about
capability but about **margin** — the more powerful engine buys
performance held in reserve against the specific hazard of this site
(the go-around from low and slow over a bluff, in turbulence). Reserve
power is exactly what the abort rule spends when it fires.

**Tailwheel only — a personal rule.** The subject would **never** land a
tricycle-gear airplane at 17CL. Two stated reasons, and the second is
the operative one:

1. Typical trainers (Cessna 172, 150) lack the short-field capability of
   a Citabria.
2. **He is simply more comfortable doing short-field operations in
   taildraggers.**

He has *seen* tricycle-gear airplanes land at 17CL — so this is
explicitly **not** a claim that it cannot be done, and **not** a general
recommendation against it. It is a limit derived from **his own comfort
and experience**, and he is careful to mark it as such. This is a clean
example of a personal minimum that is about the *operator*, not the
*equipment or the site* — a distinction the schema should preserve, and
one an airline audience will recognize as currency/recency-of-experience
reasoning.

### Density altitude, loading, and how the gates interact

- **Seaside airport**, so density altitude is not usually the concern it
  would be at a mountain strip — but it is not ignored.
- **Would not land on a particularly hot day *unless the winds were
  lighter than usual*.** Note the structure again: heat alone is not the
  gate; **heat combined with the usual wind** is. The gates compound,
  exactly as gusts do.
- **The low pass is the tiebreaker.** If conditions are marginal enough
  to raise the question but not bad enough to cancel, the practice
  approach is what decides. The low pass is not only a survey and a
  gate — it is also the **arbiter for borderline cases**, the mechanism
  that converts an unresolved judgment into a decision.
- **Loading: never been tempted to fly in heavily loaded.** Stated as
  something that has never even become a live question, rather than as a
  computed limit — a constraint applied so far upstream it never reaches
  the decision.

### Provenance of the weather minimums

Unlike the midfield rule (a self-authored doctrine plus a Google Earth
measurement), the weather minimums come from **risk-margin reasoning
about this specific site**, plus one piece of local environmental
knowledge:

- They are aimed at an **ample margin of safety at an airport that is
  more difficult and hazardous than most** — i.e. the minimums are
  deliberately tightened *because of the site*, not carried in
  unchanged from elsewhere.
- **Borderline coastal visibility can turn into unacceptably low
  visibility quickly.** This is specific, local, predictive knowledge —
  not "low visibility is bad" but "*here*, marginal conditions are
  unstable and deteriorate fast." It is a claim about the **rate of
  change** of conditions, which is why the gate is set at *perfect*
  visibility rather than at some marginal-but-legal threshold.

That last point pairs with the daylight rule: both are about **not being
caught out by a situation that develops faster than the options to
escape it.**

### Perceptual knowledge (from a practice interview)

Elicited in a practice interview specifically targeting perceptual,
hard-to-verbalize knowledge. **This is the demo's most valuable
material** and it drove several schema changes.

#### The airplane is the instrument, not the eyes

Asked what he *looks at* on the low pass, the subject reframed the
question:

> "I'm not so much looking at anything — other than occasionally
> glancing at the windsock — so much as **feeling how the wind is
> affecting my approach.** What corrections am I making? How much of a
> headwind is there, and how are these factors changing as I descend
> toward the runway?"

The primary sensing channel is **kinesthetic, mediated by the
aircraft's response** — wind is read from the corrections it demands and
from how those demands change with altitude. Visual cues are secondary.
An interviewer (or schema) that assumes perception is mostly visual will
mis-model this pilot entirely.

#### Two kinds of sensation: threat vs. instrument

A crucial distinction the subject draws:

- **The drop is the threat.** "A slight *less than 1g* sensation as if
  you are falling." Directly consequential — it bears on whether he
  makes the runway threshold.
- **The buffeting is information.** The feel of rough air is not itself
  dangerous; it **maps the hazard**: "It tells you the boundaries of the
  turbulent area, and how strong the turbulence is."

Rough air is used as a *sensing instrument* to locate and size the
turbulent zone; sink is the hazard being sized. Two sensations, two
entirely different roles.

#### Deviation from a calibrated baseline — not raw detection

The abort trigger on approach is **not** "sink." It is sink *beyond what
he expects*:

> "I'm accustomed to feeling a **slight mushy sensation** just before
> reaching the cliff edge, but a **powerful drop** would certainly
> prompt me to apply full power."

Mushy is *normal here*. The trigger is a departure from a personal,
site-specific expectation built over repeated landings. This is a
markedly expert structure: he is not detecting a hazard from first
principles but comparing against a calibrated baseline — and a pilot
without that baseline has nothing to compare against. **The knowledge is
the baseline itself.**

#### The go-around has technique inside it

Not merely "full power":

> "I would **keep my pitch constant** so as to make the best possible use
> of the extra power, gaining speed but then pulling up and going around
> once I were over the runway."

Deliberately *not* pitching up — accelerate first, climb only once over
the runway. A low-energy escape flown so as not to trade scarce airspeed
for altitude at the worst possible moment. **This is where the 7KCAB
engine preference cashes out**: the reserve power and this technique are
one piece of knowledge, not two.

#### The occluded landmark — timing across a lost sight picture

Asked how he knows he is at the cliff edge:

> "That's a visual judgement; **the cliff edge passes out of your field
> of view when you get close**, but you see it for long enough that
> **timing tells you when you have crossed.**"

The landmark **stops being visible at the moment it must be acted on.**
The mechanism is: see it → lose it under the nose → estimate from
elapsed time → act. A few seconds of dead reckoning against an occluded
reference.

This single landmark anchors **three** actions — hold power until it,
ease off after it, and **begin the flare after it**. It is the pivot of
the entire approach. No written procedure would capture this: a manual
says "cross the threshold at X," never "you will lose sight of it, so
count."

#### The rollout test is a predicted stopping distance

The commitment test is **not** a spatial comparison of the ramp's
position. It is a continuous *forecast*:

> "I can tell through experience with the airplane **how effective my
> braking is, how soon it will stop me, and how far along the runway I
> will be when I do stop.**"

From felt braking effectiveness he projects a stopping point and
compares it against the ramp. The forecast is **chained to landing
quality**:

> "This also depends on the quality of the landing. **If I were to
> bounce, I would not be able to brake as soon, and might simply go
> around.**"

A bounce does not trigger the abort directly — it degrades the stopping
forecast, which then fails the test. One causal chain, not two
independent rules.

Note also: he **never actually stops.** "I ease off at the very end when
I reach taxi speed, rather than actually stopping." The counterfactual
test is evaluated against an outcome that never occurs on any flight.

#### The touchdown is determinate, not perceptual

Asked what tells him the airplane is ready to be put down:

> "The airplane is ready to be put down **if I have managed my speed and
> power correctly, and if I am low enough over the runway threshold when
> I cross.** The airplane should simply glide onto the runway — **it's
> pure geometry.** The flare begins after I am safely over the cliff
> edge."

By the last few seconds there is nothing left to perceive. If the
approach was flown correctly, the touchdown follows deterministically.
**The skill has migrated upstream**: a novice experiences the flare as
the demanding moment; this pilot has made it the automatic consequence
of getting the geometry right earlier. Smoothness matters here
specifically because braking must begin promptly.

#### The perceptual knowledge is NOT transferable

Asked whether the air over the bluff has a signature he would recognize
at other coastal strips:

> "It is **very specific to 17CL**. Other cliff edges *might* be
> similar, but this is a very unusual, idiosyncratic airport — **there
> is no other strip like it in Northern California.**"

This is the honest answer and it *sharpens* the argument. The
portable/local split is real, and the subject draws it himself:

- **Portable:** the midpoint doctrine (every short strip).
- **Local:** the cue baseline, the landmark timing, the feel of the air.

Site-specific perceptual knowledge is exactly what cannot be written
into a general manual and cannot be transferred by reading. It must be
built at that site, by that pilot — which is precisely why the airline's
retiring-expert problem is hard, and why capturing it is worth
something.

#### The one no-land decision

The only time he flew there and did not land was **before his first
landing**: he flew the low pass and continued to Half Moon Bay. That is
the one occasion on which he had **no baseline** to compare against.
Note too that the diversion had a *destination* — a companion to the
daylight rule, which is likewise about never being without an option.

---

## Design commitment: the interviewer knows the published record

**The interviewing agent is primed with the publicly available
information about 17CL** — the FAA record and remarks, the RAF briefing
content, the runway-length discrepancy, the published hazards — and may
reference it while interviewing.

This is a deliberate departure from the `medical` domain, where the
agent knows only the schema. It changes what the interview can do:

- **It separates common knowledge from personal expertise.** When the
  agent can say "the briefing warns about rotor at the approach end of
  32," the subject's answer is necessarily *the part that isn't in the
  briefing*. The delta is elicited directly instead of having to be
  inferred.
- **It lets the interviewer surface conflicts.** The clearest case: the
  briefing says remain close to the strip in the pattern; the subject
  flies a standard, long, stabilized approach. An agent that knows both
  can ask about the tension. An agent that knows neither cannot.
- **It models what a real expert debriefer does.** A skilled
  interviewer arrives having read the manual, so the expert's time is
  spent on what the manual doesn't say. That is the actual Cognitive
  Task Analysis practice this demo is claiming to automate.
- **It is a better demo.** The audience watches the agent distinguish
  "what anyone can look up" from "what this pilot knows," which is
  precisely the value proposition.

**Schema consequence.** Knowledge in the graph needs a *provenance
dimension* — whether a given fact is published, personal, or a
correction of the published record — and relationships that can express
`confirms`, `contradicts`, `refines`, and `addsTo` against published
data. The runway length is the worked example: published 1,300 ft,
personally measured 800 ft, and the act of measurement itself is the
knowledge.

**Recording consequence.** The subject may be asked about published
facts he does not have memorized. That is fine and should not be
smoothed over — "I don't know what the FAA says, but what I actually use
is..." is a strong moment, not a stumble.

### Question-type variety (agent-prompt requirement)

The interview is **2–5 minutes maximum**. Within that window the agent
must deliberately vary its *question types* rather than settling into
one mode. The agent prompt should name these types explicitly and
instruct the agent to achieve a healthy mixture:

| Type | Purpose | Example |
|---|---|---|
| **Open elicitation** | Let the subject choose what matters | "Walk me through how you arrive at Las Trancas." |
| **Cue probe** | Surface perceptual, hard-to-verbalize knowledge | "What are you looking at on the low pass?" |
| **Contrast with published** | Separate common knowledge from personal | "The briefing says stay close to the strip in the pattern — is that how you fly it?" |
| **Counterfactual** | Expose thresholds and abort logic | "What would you see that would make you go around?" |
| **Provenance** | Trace how a limit was arrived at | "Where did that midfield number come from?" |
| **Contrast with self** | Surface as-practiced vs as-recommended | "Is that what you actually did the first time?" |

**Rules of engagement for the published-knowledge questions**
(the "quiz" mode): one or two across the whole interview is good, more
is not. When used, the published fact is stated **briefly** — a clause,
not a paragraph — and immediately handed back as a question. The agent
references the published record to *open* a question, never to
demonstrate its own knowledge. The subject explicitly endorsed this
pattern: state the prescribed procedure, ask whether he agrees, and let
him explain that it is not how he flies it and why.

---

## What makes this a *tacit knowledge* scenario

The published record gives a pilot: a length (wrong), a surface, a
pattern direction, a turbulence warning, and a power line. What it does
not give — and what the interview is designed to elicit:

- **Which cues the pilot actually reads** on the way in to decide whether
  today is a landing day (what the ocean surface is doing, what the trees
  or the windsock show, how the air feels on the overfly).
- **Where the rotor actually is** and what it does to the airplane at a
  specific point on final, as opposed to a general "wind shear" caution.
- **The commitment point** — where a go-around stops being available,
  given cliffs at both ends and terrain constraints.
- **The abort trigger** — the concrete rule ("if not X by Y, go
  around") that fires *before* the commitment point.
- **Personal limits** distinct from published ones, and how experience
  moved them.
- **Which runway, under which wind**, and the reasoning behind a choice
  the published data only hints at (32 favored; 14 usable in a south
  wind but downhill past midfield toward a cliff).
- **Technique deltas from the textbook** — how the AFH short/soft-field
  procedure is modified for this specific strip, and why.

That set is precisely what a Cognitive Task Analysis would try to
surface, and precisely what does not appear in any document above.

---

## Sources

Public sources consulted (August 2026):

- [AirNav 17CL](https://www.airnav.com/airport/17CL) — FAA record,
  remarks, ownership.
- [RAF: Featured Airstrip — Las Trancas](https://www.theraf.org/featured-airstrip-las-trancas)
- [RAF: RAF Preserves California Oceanside Airstrip](https://www.theraf.org/raf-preserves-california-oceanside-airstrip)
- [RAF: Guests Gather to Enjoy California's Las Trancas](https://www.theraf.org/guests-gather-to-enjoy-californias-las-trancas)
- [OurAirports 17CL](https://ourairports.com/airports/17CL/) — user comments.
- [AirportGuide 17CL](https://airportguide.com/airport/info/17CL) — runway data.
- [FlightAware 17CL remarks](https://flightaware.com/resources/airport/17CL/remarks) — FAA remarks verbatim.

Non-public source: the **RAF Airfield.Guide briefing for 17CL**
(login-gated) was supplied by the subject. Its operationally relevant
content is summarized above; it is not reproduced in full here, as it is
the airfield owner's advisory distributed under an acknowledgement
requirement, and includes site access details that do not belong in a
source repository.

### Known gap

The [r/flying discussion thread on Las
Trancas](https://www.reddit.com/r/flying/comments/1aonl11/las_trancas_airstrip/)
could not be retrieved — Reddit blocked every access path available from
this environment (network-reputation block, AS7922). Any first-hand pilot
commentary in that thread is **not** reflected in this document. If it
contains useful cues or technique reports, paste them in and this file
can be updated.
