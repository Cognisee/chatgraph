# Notes on Hydra's textual syntax

Working notes from authoring the `.hy` schema modules under
`src/main/hydra/`. Two audiences: us, so the conventions are written
down; and the Hydra wiki, since some of this is a correction or a gap
worth contributing back.

Reference material:

- [Textual syntax by example](https://github.com/CategoricalData/hydra/wiki/Textual-syntax-by-example) (wiki)
- [Syntax specification](https://github.com/CategoricalData/hydra/blob/main/docs/specification/syntax.md) (normative)

**The syntax is still stabilizing.** The wiki page says so itself, and
we have already hit one case where it is out of date.

## Corrections to contribute upstream

*(All three corrections below have been applied to
`external/wiki/Textual-syntax-by-example.md` and are uncommitted, pending
review.)*

### 1. `wrap` takes braces, not parentheses

The wiki page currently shows:

```
Meters := wrap(int32)
```

and at the term level:

```
wrap(example.Meters){100:int32}
```

**The correct type-level form is `wrap{...}`:**

```
Meters := wrap{int32}
```

Confirmed by Josh. The wiki is wrong here. Whether the *term*-level form
also changed is not confirmed — we have only authored types so far.

### 2. Applying a user-defined parameterized type is undocumented

The wiki shows how to *declare* a polymorphic type:

```
Pair := forall a, b. (a, b)
```

It never shows how to **apply** one. `<...>` appears only on builtins
(`list<t>`, `map<k, v>`, `optional<t>`, `either<a, b>`); no example in
either document writes `SomeUserType<arg>`.

We are assuming the natural extension — the same angle brackets:

```
Quantity := forall v, u. record{value: v, unit: u}

Length := Quantity<decimal, LengthUnit>
```

**Unconfirmed.** If application uses different syntax, or if the printer
does not yet emit it, `units.hy` needs changing. The alternative shapes
would be term-level type application spelled `⟨...⟩` (§2.3 reserves
those brackets for *terms*, so probably not), or no surface syntax at
all yet.

Worth documenting upstream once settled: declaring a polymorphic type
without being able to apply it is not much use, so the page likely wants
one line showing application right after the `forall` examples.

### 3. Module declarations and imports are undocumented

Neither the wiki page nor the normative spec mentions modules, module
declarations, or imports at all. `grep -i 'module\|import\|namespace'`
over the spec returns nothing.

What we are using, per Josh:

```
module ai.cognisee.models.aviation.site

import ai.cognisee.models.units as units
```

Reverse-DNS namespaces, one module per file, hierarchy allowed.

**`import ... as` is a convention Josh introduced here**, to bind a short
local alias so references read `units.Meters` rather than repeating the
whole namespace. Since §2.4 parses dotted names greedily,
`ai.cognisee.models.units.Meters` is already unambiguous without any
import — so the alias is for brevity, not disambiguation.

**When contributing upstream, use a neutral namespace** — not
`ai.cognisee`.

**Status: written to the wiki.** `external/wiki/Textual-syntax-by-example.md`
now has a §5 "Modules" covering `module`, `import` and `import ... as`,
using `com.example.geometry` as the example namespace. Uncommitted, for
review.

## Conventions we have settled

**Comments are `#`.** The spec says so (§2.2); the wiki's worked example
uses `--`, which is a second inconsistency worth fixing there.

**`#` is for throwaway comments only.** Per Josh: there is no convention
for *doc* comments yet. This matters for us, because these modules are
documentation first — the prose is the point, and spec §2.2 says
comments "are lost on a round trip, exactly like non-canonical
whitespace."

So the descriptive text in our `.hy` files is currently **not
recoverable by any tool**. Two ways that could resolve later:

- Type-level annotations (`@{description = "..."}`), which the wiki
  shows only on *terms*. If they work on type definitions, the prose
  would round-trip.
- A doc-comment convention, once Hydra settles one.

Until then we accept the loss and keep prose in `#` comments, because
the alternative — dropping the prose — defeats the purpose of authoring
these as documentation.

## Syntax quick reference, as used here

```
module a.b.c                      # first line
import a.b.d

Name := record{field: type, other: optional<type>}
Name := union{variantA: unit, variantB: string}
Name := wrap{int32}
```

Types: `string`, `boolean`, `int8`–`int64`, `uint8`–`uint64`, `bigint`,
`float32`/`float64`, `decimal`, `binary`, `unit`, `void`.

Compounds: `list<t>`, `set<t>`, `map<k, v>`, `optional<t>`, `(a, b)`,
`either<a, b>`, `a → b`, `effect<t>`.

Closing brace sits on the last field's line. Fields use `:` for their
type; `=` is term-level.

## Modelling conventions

**US spelling.** Identifiers and prose both. `meters`, not `metres` —
the code was already right; the prose had drifted.

**International neutrality.** These schemas must not assume a
jurisdiction. Aviation regulation is ICAO-harmonised at the core and
divergent at the edges, and the divergences are exactly where
operational knowledge lives.

Concretely:

- **Quantities carry their unit** rather than assuming one
  (`ai.cognisee.models.units`). Altitude is feet almost everywhere but
  meters in China and parts of the former Soviet Union; runway length is
  meters in most of the world and feet in the US; fuel is kilograms for
  some operators and pounds for others on the same airframe; altimeter
  settings are hectopascals or inches of mercury. Recording the unit the
  expert used is also the honest thing to do: converting is lossy, and
  the number they said is the number worth keeping.
- **State-specific concepts are named, not assumed.** Approach minima
  use the ICAO CAT I-III ladder because it is international, with an
  `other: string` case carrying the authorisations that ladder does not
  name (GLS; the FAA's special CAT II/III; EASA's lower-than-standard
  minima) under the name used locally.
- **Where a convention varies by state, record which applies.** Runway
  numbering is magnetic in most states and true in some high-latitude
  ones, so `RunwayDesignator` carries a `HeadingReference` rather than
  assuming.
- **Prefer ICAO vocabulary** where the two regimes diverge, since that
  is what an international operator's own documentation uses. Note this
  is about *taxonomy*, not coverage: the FAR does describe aerodromes
  (Part 139 certification, Part 77 obstructions, Part 157
  construction). Where it differs, it differs by carving the same
  reality up differently — the ICAO aerodrome reference code has no FAR
  equivalent, because the FAA uses airplane design groups (ADG I-VI) in
  AC 150/5300-13 for the same wingspan and gear-span constraints. Pick
  ICAO's, and name the other if it turns up.

  Much of the vocabulary is shared outright. "Aerodrome" is the
  technical term in US usage too — TAF is Terminal *Aerodrome* Forecast
  — and appears throughout METAR/TAF and NOTAMs. FAR/AIM is a sound
  grounding source; it simply is not the *only* one.

## Status of these schemas

**The `.hy` modules are documentation, not executable.** The
Hydra-to-PG encoding is not ready — it is expected in Hydra 0.18.1. Until
then the authoritative schema is the generated JSON under
`src/main/json/`, produced from `schema_build.py` as described in
`CLAUDE.md`. These modules are the design record, and the input to that
projection when it lands.
