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

### 2. Applying a user-defined parameterized type was undocumented

The wiki showed how to *declare* a polymorphic type (`Pair := forall a,
b. (a, b)`) but never how to **apply** one — `<...>` appeared only on
builtins.

**Settled with Josh: angle brackets, the same as the builtins.**

```
Quantity := forall v, u. record{value: v, unit: u}

Length := Quantity<decimal, LengthUnit>
```

The alternative considered was `Quantity @ decimal @ SpeedUnit`. Angle
brackets win on two grounds: `@` is already the annotation marker
(§2.3), so `T @ X` would be ambiguous with an annotated type and need
lookahead to disambiguate; and `list<string>` / `map<k, v>` are the same
construct, so one application syntax means the builtins are not
special-cased.

The one cost is that `<` and `>` are the classic parsing ambiguity with
comparison operators — the reason Rust needs turbofish. Hydra has no
infix comparison at the type level, so it may never bite.

**Documented upstream**, right after the `forall` examples.

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

**Definitions are alphabetical within a module**, and union variants
alphabetical within a definition. A Hydra convention. Grouping by topic
reads better while authoring and worse thereafter — with alphabetical
order a reader can find a name without scanning, and a diff shows a real
change rather than a reshuffle.

**No consecutive capitals in identifiers.** They do not survive
conversion between naming conventions: `catIIIa` becomes `CAT_IIIA` or
`catIiia` or `cat_i_i_i_a` depending on the target, and none of those
convert back. Approach categories are therefore `cat3a`, not `catIIIa`,
even though the source documents use roman numerals. The same rule
bites acronyms — prefer `icaoCode` over `ICAOCode`.

Prose in comments keeps the conventional spelling; only identifiers are
constrained.

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

## Completeness vs. populability

These types are deliberately thorough, and **that is exactly what makes
them hard to populate.** `Runway` requires a designator, a length and a
surface; an expert who says *"I'd rather not use 12L when it's wet"* has
supplied one field and implied a constraint. Nothing in that sentence
gives you a length, and demanding one would force the extractor to
invent it or drop the statement.

This is the central tension in using a well-specified schema for
knowledge capture: **a type that is complete enough to be useful as a
model is too complete to be filled in from conversation.**

Three stages, in the order they will actually happen:

1. **Now — schema as documentation.** Required fields say what a runway
   *is*. Nothing is being populated yet, so completeness costs nothing
   and is worth having on the record.

2. **The loose PG mapping.** When these project to property graphs,
   **make all attributes optional.** A PG schema has no way to say
   "identified by its designator, other fields unknown," so the only
   mapping that survives contact with real extraction is a permissive
   one. This is a known approximation, not an oversight -- record it as
   such, so nobody later reads the optionality as a claim that a runway
   might genuinely lack a length.

3. **Later — `hydra.logic` Assertions.** The module under development
   supports referring to a `Runway` by its designator alone, never
   mentioning the required fields. Assertions are small graphs with
   **labeled nulls** for unknown information: the unknown length is an
   existentially quantified variable rather than an absent field. That
   is the honest representation, and it preserves the distinction the
   optional-everything mapping throws away -- *not stated* versus *known
   not to apply*.

**What this means for authoring now:** keep the types complete. Do not
pre-weaken them to `optional` in anticipation of the extractor, because
the weakening belongs in the projection, not in the model. The schema
should say what is true of the world; the mapping decides what can be
left unsaid.

**One consequence worth watching.** Labeled nulls make identity harder:
two assertions about "runway 12L" are about the same runway only if
something says so. Content-derived ids are one answer, and the web
gate's identity discipline already does something similar. Worth
revisiting when Assertions land.

## Editor support

`tools/textmate/` holds a TextMate bundle giving `.hy` files syntax
highlighting in IntelliJ IDEA (Settings -> Editor -> TextMate Bundles).
Highlighting only -- no navigation or error checking. Its keyword lists
come from the spec's reserved words rather than from our files, so it
covers forms we have not written yet. See that directory's README for
install steps and limits.

Note the extension collides with the Hy Lisp dialect; if a Hy plugin is
installed it will claim `*.hy` first.

## Tooling

`bin/check_hy.py` enforces the conventions above across
`src/main/hydra/`: alphabetical definitions, alphabetical fields,
ASCII only, no consecutive capitals in identifiers. Run it after
editing.

`bin/sort_hy.py <file>...` rewrites a module into alphabetical order,
keeping each comment attached to the definition or field it documents.
Sorting by hand is error-prone -- the checker caught eleven ordering
violations in the first pass of the aviation modules that I had missed
by eye.

## Status of these schemas

**The `.hy` modules are documentation, not executable.** The
Hydra-to-PG encoding is not ready — it is expected in Hydra 0.18.1. Until
then the authoritative schema is the generated JSON under
`src/main/json/`, produced from `schema_build.py` as described in
`CLAUDE.md`. These modules are the design record, and the input to that
projection when it lands.
