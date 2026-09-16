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
    blocks, cur = [], []
    for line in body.split("\n"):
        if re.match(r'^[A-Za-z][A-Za-z0-9_]* :=', line) and any(
                re.match(r'^[A-Za-z][A-Za-z0-9_]* :=', l) for l in cur):
            blocks.append(cur); cur = [line]
        else:
            cur.append(line)
    blocks.append(cur)
    def dname(b):
        for l in b:
            m = re.match(r'^([A-Za-z][A-Za-z0-9_]*) :=', l)
            if m: return m.group(1)
        return ""
    blocks = [sort_fields(b) for b in blocks if dname(b)]
    blocks.sort(key=dname)
    pathlib.Path(path).write_text(
        header + "\n\n".join("\n".join(b).strip() for b in blocks) + "\n")

for p in sys.argv[1:]:
    sort_module(p); print("sorted", pathlib.Path(p).name)
