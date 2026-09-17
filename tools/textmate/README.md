# Hydra syntax highlighting for IntelliJ IDEA

A TextMate bundle for `.hy` files -- Hydra's native textual syntax.
Highlighting only: no go-to-definition, no error checking. That would
need a real language plugin, which is a much larger job (see "Why not a
plugin" below).

Tested against IntelliJ IDEA 2021.2.3, which has bundled TextMate
support.

## Install

1. **Settings → Editor → TextMate Bundles**
2. **+**, and select `tools/textmate/hydra.tmbundle` in this repository
3. Apply. Open any `.hy` file.

If files still render as plain text, check
**Settings → Editor → File Types** for a `*.hy` pattern claimed by
another type, and remove it. Note the extension collides with the Hy
Lisp dialect, so a Hy plugin -- if installed -- will win.

## What gets highlighted

| Element | Example |
|---|---|
| Module and import declarations | `module a.b.c`, `import a.b.d as d` |
| Namespace aliases | the `units` in `units.Length` |
| Definition names | `Runway` in `Runway := record{...}` |
| Type references | `AerodromeCode`, `units.Length` |
| Field and variant names | `length:`, `degreesMagnetic:` |
| Primitive types | `string`, `int32`, `decimal`, `unit` |
| Constructors | `record`, `union`, `wrap`, `list`, `optional` |
| Keywords | `forall`, `let`, `in`, `case`, `inject`, `project` |
| Term constants | `true`, `none`, `given`, `NaN` |
| Numeric literals | `42:int32` scoped apart from a bare `3.14` decimal |
| Operators | `:=`, `→`, `⇒`, `λ`, `Λ`, `∀`, `@`, `⟨⟩` |
| Comments | `#` to end of line |
| Strings and backtick-escaped names | `"text"`, `` `a.b` `` |

Keyword lists come from the reserved words in the
[syntax specification](https://github.com/CategoricalData/hydra/blob/main/docs/specification/syntax.md)
(§2.6), not from what our own files happen to use -- so forms we have
not written yet are still covered.

## Known limits

- **Purely lexical.** `units.Length` is coloured as a qualified
  reference whether or not `units` is imported or `Length` exists.
- **The syntax is still stabilizing.** We have already hit three forms
  that were wrong or undocumented upstream (see
  `docs/hydra-textual-syntax-notes.md`), so this grammar will need
  revising as the spec settles.
- **Term-level coverage is thin.** These schema modules are types only,
  so the term patterns are written from the spec rather than tested
  against real code.

## Why not a plugin

A proper language plugin -- BNF grammar, Grammar-Kit, lexer, PSI tree,
annotator -- would buy go-to-definition across modules, unresolved
reference warnings, rename refactoring and a structure view. That is
genuinely useful for a multi-module schema, and it is days of work
rather than an hour.

It is also awkward on 2021.2.3 specifically: current Grammar-Kit and the
Gradle IntelliJ plugin target much newer platforms, so you would be
pinning old versions against documentation that assumes 2024 or later.

If the syntax settles and Hydra adopts it for its own sources, a plugin
is arguably an upstream contribution rather than something to maintain
here.
