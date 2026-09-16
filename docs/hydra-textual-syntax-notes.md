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

### 2. Module declarations and imports are undocumented

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

## Status of these schemas

**The `.hy` modules are documentation, not executable.** The
Hydra-to-PG encoding is not ready — it is expected in Hydra 0.18.1. Until
then the authoritative schema is the generated JSON under
`src/main/json/`, produced from `schema_build.py` as described in
`CLAUDE.md`. These modules are the design record, and the input to that
projection when it lands.
