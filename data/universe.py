"""
Merge data/companies.py (IT universe) with every data/sectors/*.py file into
one graph: SEGMENTS, COMPANIES (id -> dict), ENTITIES (id -> (name, cat)),
EDGES [(src, dst, type, label)].  Bad references are dropped with a warning.
"""
import importlib
import pkgutil
import warnings

from data import companies as it

# outside entities that are now listed companies in a sector file
ALIASES = {"x:LT": "LT", "x:TATAMOTORS": "TMPV", "x:MAHINDRA": "M&M"}

SEGMENTS, COMPANIES, ENTITIES, EDGES = {}, {}, {}, []
# force specific segments into a shared super-section regardless of file
SECTOR_OVERRIDE = {"defence_ship": "Defence & Aerospace"}
EDGE_TYPES = it.EDGE_TYPES
SECTOR_OF_SEG = {}


def _absorb(mod, sector):
    seg_sector = getattr(mod, "SEGMENT_SECTOR", {})
    for k, v in mod.SEGMENTS.items():
        SEGMENTS.setdefault(k, v)
        SECTOR_OF_SEG.setdefault(k, SECTOR_OVERRIDE.get(k) or seg_sector.get(k) or sector)
    for c in getattr(mod, "C", None) or getattr(mod, "COMPANIES", []):
        if c["id"] in COMPANIES:
            continue  # same company written by two sector files: first wins
        c = dict(c)
        c.setdefault("sym", f'{c["id"]}.NS')
        COMPANIES[c["id"]] = c
    for k, v in getattr(mod, "ENTITIES", {}).items():
        ENTITIES.setdefault(k, tuple(v))
    EDGES.extend(tuple(e) for e in getattr(mod, "EDGES", []))


_absorb(it, "Technology")
SECTOR_NAMES = {
    "autos": "Automobiles", "finance": "Financials", "energy_metals": "Energy & Materials",
    "industrials": "Industrials & Infrastructure", "consumer_pharma": "Consumer & Healthcare",
}
try:
    from data import sectors as _pkg
    for m in sorted(pkgutil.iter_modules(_pkg.__path__), key=lambda m: m.name):
        _absorb(importlib.import_module(f"data.sectors.{m.name}"),
                SECTOR_NAMES.get(m.name, m.name.replace("_", " ").title()))
except ImportError:
    pass

for a, real in ALIASES.items():
    if real in COMPANIES:
        ENTITIES.pop(a, None)

_seen, _clean = set(), []
for s, d, t, label in EDGES:
    s, d = ALIASES.get(s, s), ALIASES.get(d, d)
    ok = all(n in COMPANIES or n in ENTITIES for n in (s, d)) and t in EDGE_TYPES and s != d
    if not ok:
        warnings.warn(f"dropping edge {s} -> {d} ({t})")
        continue
    if (s, d, t) in _seen:
        continue
    _seen.add((s, d, t))
    _clean.append((s, d, t, label))
EDGES[:] = _clean

for c in COMPANIES.values():
    c["peers"] = [p for p in c.get("peers", []) if p in COMPANIES and p != c["id"]]
    c["sector"] = SECTOR_OF_SEG[c["seg"]]

# drop entities nobody references
_used = {n for e in EDGES for n in e[:2]}
for k in [k for k in ENTITIES if k not in _used]:
    del ENTITIES[k]


def sectors():
    """[(sector, [seg_key, ...])] in first-seen order."""
    out = {}
    for k in SEGMENTS:
        out.setdefault(SECTOR_OF_SEG[k], []).append(k)
    return list(out.items())
