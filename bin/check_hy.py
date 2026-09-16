import sys, pathlib, re
bad = 0
for f in sorted(pathlib.Path("src/main/hydra").rglob("*.hy")):
    text = f.read_text()
    names = re.findall(r'^([A-Za-z][A-Za-z0-9_]*) :=', text, re.M)
    if names != sorted(names):
        bad = 1
        print(f"  {f.name}: definitions out of order")
        for a, b in zip(names, sorted(names)):
            if a != b:
                print(f"     first divergence: {a!r} should be {b!r}")
                break
    # union variants alphabetical
    for m in re.finditer(r'^([A-Za-z][A-Za-z0-9_]*) := (?:union|record)\{(.*?)\}', text, re.M | re.S):
        tname, body = m.group(1), m.group(2)
        fields = re.findall(r'^\s{2}([a-z][A-Za-z0-9_]*):', body, re.M)
        if fields != sorted(fields):
            bad = 1
            print(f"  {f.name}: fields of {tname} out of order -> {fields}")
    # non-ASCII
    for i, line in enumerate(text.splitlines(), 1):
        if any(ord(c) > 127 for c in line):
            bad = 1
            print(f"  {f.name}:{i}: non-ASCII")
    # consecutive capitals in identifiers
    for i, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("#"):
            continue
        for ident in re.findall(r'\b[A-Za-z][A-Za-z0-9_]*\b', line):
            if re.search(r'[A-Z]{2,}', ident):
                bad = 1
                print(f"  {f.name}:{i}: consecutive capitals in {ident!r}")
print("  all clean" if not bad else "")
sys.exit(bad)
