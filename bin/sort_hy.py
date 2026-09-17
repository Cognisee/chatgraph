"""Sort a .hy module's definitions, and each definition's fields,
alphabetically -- keeping every comment attached to what it documents."""
import re, sys, pathlib

def sort_fields(block):
    m = re.search(r'^([A-Za-z][A-Za-z0-9_]*) := (union|record)\{(.*)\}\s*$',
                  "\n".join(block), re.S | re.M)
    if not m:
        return block
    pre = "\n".join(block)[:m.start(3)]
    body = m.group(3)
    groups, cur = [], []
    for ln in body.split("\n"):
        if not ln.strip():
            continue
        cur.append(ln)
        if re.match(r'\s{2}[a-z][A-Za-z0-9_]*:', ln):
            groups.append(cur); cur = []
    if not groups:
        return block
    def fname(g):
        return re.match(r'\s{2}([a-z][A-Za-z0-9_]*):', g[-1]).group(1)
    groups.sort(key=fname)
    flat = []
    for i, g in enumerate(groups):
        flat.extend(g[:-1])
        flat.append(g[-1].rstrip().rstrip(',') + ("," if i < len(groups)-1 else ""))
    return (pre + "\n" + "\n".join(flat) + "}").split("\n")

def sort_module(path):
    t = pathlib.Path(path).read_text()
    first = re.search(r'^[A-Za-z][A-Za-z0-9_]* :=', t, re.M)
    # header runs to the comment block preceding the first definition
    lines = t[:first.start()].rstrip("\n").split("\n")
    while lines and lines[-1].startswith("#"):
        lines.pop()
    header = "\n".join(lines).rstrip() + "\n\n"
    body = t[len("\n".join(lines)):]
    # Split at the start of the comment block documenting each
    # definition, not at the definition line. Splitting at the
    # definition sweeps its doc comment into the *previous* block as
    # trailing lines, where sort_fields -- which rebuilds a block from a
    # regex ending at the closing brace -- silently discards it. That
    # loses every doc comment but the first, on every run.
    lines = body.split("\n")
    starts = []
    for i, line in enumerate(lines):
        if re.match(r'^[A-Za-z][A-Za-z0-9_]* :=', line):
            j = i
            while j > 0 and lines[j-1].startswith("#"):
                j -= 1
            starts.append(j)
    blocks = [lines[a:b] for a, b in zip(starts, starts[1:] + [len(lines)])]
    def dname(b):
        for l in b:
            m = re.match(r'^([A-Za-z][A-Za-z0-9_]*) :=', l)
            if m: return m.group(1)
        return ""
    blocks = [sort_fields(b) for b in blocks if dname(b)]
    blocks.sort(key=dname)
    pathlib.Path(path).write_text(
        header + "\n\n".join("\n".join(b).strip() for b in blocks) + "\n")

def _selftest():
    """Sorting must never lose a comment. Run with --selftest.

    This existed because it did: an earlier splitter cut blocks at the
    definition line, which swept each doc comment into the *previous*
    block, where it was silently dropped. It cost ~50 comments across
    the schema before anyone noticed, because nothing failed.
    """
    import tempfile
    src = ("# Header.\n\nmodule test.x\n\n"
           "# Doc for Bravo.\nBravo := record{\n  b: string}\n\n"
           "# Doc for Alpha.\nAlpha := record{\n  a: string}\n\n"
           "# Doc for Charlie.\nCharlie := record{\n  c: string}\n")
    with tempfile.TemporaryDirectory() as d:
        f = pathlib.Path(d) / "t.hy"
        f.write_text(src)
        sort_module(f)
        first = f.read_text()
        sort_module(f)
        assert first == f.read_text(), "sort is not idempotent"
        for name in ("Alpha", "Bravo", "Charlie"):
            assert f"# Doc for {name}.\n{name} :=" in first, \
                f"lost or detached doc comment for {name}"
        names = re.findall(r'^([A-Za-z][A-Za-z0-9_]*) :=', first, re.M)
        assert names == sorted(names), f"not sorted: {names}"
    print("sort_hy selftest ok")

if sys.argv[1:2] == ["--selftest"]:
    _selftest()
else:
    for p in sys.argv[1:]:
        sort_module(p); print("sorted", pathlib.Path(p).name)
