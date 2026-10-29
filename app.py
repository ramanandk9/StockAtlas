"""
Indian market relationship explorer (IT, electronics, autos, financials,
energy, industrials, consumer, agriculture, ...).

    .venv/bin/python app.py            -> http://127.0.0.1:5000

Prices/financials: Yahoo Finance via yfinance (cached under ./cache).
Graph structure: data/companies.py + data/sectors/*.py (merged by data/universe.py).
Stances, similarity, edge evidence and risk: statistical models in quant.py.
"""
import hashlib
import json
import math
import os
import threading
import tempfile
import time
import traceback
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import yfinance as yf
from flask import Flask, abort, jsonify, render_template, request

import quant
from data import universe as U

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(tempfile.gettempdir(), "stockatlas-cache") if os.environ.get("VERCEL") else os.path.join(BASE, "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

PRICE_TTL = 15 * 60
INFO_TTL = 6 * 3600
HIST_TTL = 30 * 60
MODEL_TTL = 12 * 3600

CO = U.COMPANIES
ENT = U.ENTITIES
EDGES = U.EDGES
OUT_E, IN_E = {}, {}
for e in EDGES:
    OUT_E.setdefault(e[0], []).append(e)
    IN_E.setdefault(e[1], []).append(e)
# peers are symmetric for highlighting purposes
PEERS = {cid: set(c["peers"]) for cid, c in CO.items()}
for cid, c in CO.items():
    for p in c["peers"]:
        PEERS[p].add(cid)

# models depend on the graph too (network diffusion, edge tests): recompute when edges change
GRAPH_SIG = hashlib.sha1(json.dumps(sorted(EDGES)).encode()).hexdigest()

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.json.sort_keys = False  # keep factor / event order as defined in quant.py
_lock = threading.Lock()
_mem = {}
MODEL = {"status": "pending", "data": None, "error": None, "log": [], "running": False}
MODEL_LOCK = threading.Lock()
REFRESH_LOCK = threading.Lock()
REFRESH_STATE = {"running": False, "status": "idle", "phase": None}


def _clean(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def _disk_get(name, ttl):
    p = os.path.join(CACHE_DIR, name)
    if os.path.exists(p) and time.time() - os.path.getmtime(p) < ttl:
        try:
            with open(p) as f:
                return json.load(f)
        except (OSError, ValueError):
            return None
    return None


def _disk_put(name, obj):
    p = os.path.join(CACHE_DIR, name)
    with tempfile.NamedTemporaryFile(mode="w", dir=CACHE_DIR, prefix=name + ".", delete=False) as f:
        json.dump(obj, f)
        tmp = f.name
    os.replace(tmp, p)


def cap_class(mcap, price):
    if price is not None and price < 25:
        return "Penny"
    if mcap is None:
        return None
    cr = mcap / 1e7
    return "Large" if cr >= 100_000 else "Mid" if cr >= 30_000 else "Small" if cr >= 5_000 else "Micro"


# ---------------------------------------------------------------- prices
def _pct(s, days):
    cutoff = s.index[-1] - pd.Timedelta(days=days)
    past = s[s.index <= cutoff]
    base = past.iloc[-1] if len(past) else s.iloc[0]
    return round(float((s.iloc[-1] / base - 1) * 100), 2)


def _fetch_snapshot():
    close = yf.download([c["sym"] for c in CO.values()], period="1y", interval="1d",
                        auto_adjust=True, progress=False, threads=True)["Close"]
    metrics = {}
    for cid, c in CO.items():
        s = close.get(c["sym"])
        if s is None or s.dropna().shape[0] < 2:
            metrics[cid] = None
            continue
        s = s.dropna()
        px = float(s.iloc[-1])
        dma50 = float(s.iloc[-50:].mean()) if len(s) >= 50 else None
        dma100 = float(s.iloc[-100:].mean()) if len(s) >= 100 else None
        metrics[cid] = dict(
            price=round(px, 2),
            d1=round(float((s.iloc[-1] / s.iloc[-2] - 1) * 100), 2),
            m1=_pct(s, 30), m6=_pct(s, 182), y1=_pct(s, 365),
            hi52=round(float(s.max()), 2), lo52=round(float(s.min()), 2),
            dma50=round(dma50, 2) if dma50 else None, dma100=round(dma100, 2) if dma100 else None,
            spark=[round(float(v), 2) for v in s.resample("W").last().dropna().values],
            asof=str(s.index[-1].date()),
        )
    return dict(metrics=metrics, ts=time.time())


def _refresh_snapshot():
    try:
        data = _fetch_snapshot()
        _disk_put("snapshot2.json", data)
        _mem["snap"] = (time.time(), data)
    except Exception:
        traceback.print_exc()
    finally:
        _mem.pop("snap_refreshing", None)


def snapshot():
    """Stale-while-revalidate: requests never wait on Yahoo once any snapshot exists."""
    hit = _mem.get("snap")
    if hit and time.time() - hit[0] < PRICE_TTL:
        return hit[1]
    with _lock:
        hit = _mem.get("snap")
        if not hit:
            disk = _disk_get("snapshot2.json", 10 ** 9)
            if disk and set(disk["metrics"]) >= set(CO):
                hit = (disk.get("ts", 0), disk)
                _mem["snap"] = hit
        if hit:
            if time.time() - hit[0] >= PRICE_TTL and not _mem.get("snap_refreshing"):
                _mem["snap_refreshing"] = True
                threading.Thread(target=_refresh_snapshot, daemon=True).start()
            return hit[1]
        data = _fetch_snapshot()   # very first run: nothing to serve yet
        _disk_put("snapshot2.json", data)
        _mem["snap"] = (time.time(), data)
        return data


# ---------------------------------------------------------------- fundamentals
INFO_KEYS = [
    "longName", "sector", "industry", "website", "fullTimeEmployees", "marketCap",
    "trailingPE", "forwardPE", "priceToBook", "returnOnEquity", "profitMargins",
    "operatingMargins", "revenueGrowth", "earningsGrowth", "totalRevenue", "totalCash",
    "totalDebt", "debtToEquity", "dividendYield", "beta", "heldPercentInsiders",
    "heldPercentInstitutions", "recommendationKey", "targetMeanPrice",
    "numberOfAnalystOpinions",
]


def _info_store():
    if "info" not in _mem:
        _mem["info"] = _disk_get("info.json", 10 ** 9) or {}
    return _mem["info"]


_bg = ThreadPoolExecutor(max_workers=3)
_bg_pending = set()


def _bg_once(key, fn, *a):
    if key in _bg_pending:
        return
    _bg_pending.add(key)

    def run():
        try:
            fn(*a)
        finally:
            _bg_pending.discard(key)
    _bg.submit(run)


def info(cid, force=False, block=True):
    store = _info_store()
    rec = store.get(cid)
    if rec and not force and time.time() - rec.get("_ts", 0) < INFO_TTL:
        return rec
    if rec and not block:   # serve stale numbers now, refresh behind the scenes
        _bg_once("info:" + cid, info, cid, True)
        return rec
    try:
        raw = yf.Ticker(CO[cid]["sym"]).info or {}
    except Exception:
        return rec or {}
    if not raw.get("marketCap") and not raw.get("longName"):
        return rec or {}  # throttled / empty response: don't cache it for 6h
    rec = {k: _clean(raw.get(k)) for k in INFO_KEYS}
    rec["_ts"] = time.time()
    with _lock:
        store[cid] = rec
        _disk_put("info.json", store)
    return rec


def warm_info():
    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(info, list(CO)))
    warm_fin()


# ---------------------------------------------------------------- annual financials
FIN_TTL = 24 * 3600


def _fin_store():
    if "fin" not in _mem:
        _mem["fin"] = _disk_get("fin.json", 10 ** 9) or {}
    return _mem["fin"]


def _row(df, *names):
    for n in names:
        if df is not None and n in df.index:
            return df.loc[n]
    return None


def _cagr(a, b, years):
    if a is None or b is None or years <= 0 or a <= 0 or b <= 0:
        return None
    return round((b / a) ** (1 / years) - 1, 4)


def _fetch_fin(cid):
    t = yf.Ticker(CO[cid]["sym"])
    inc, bal = t.income_stmt, t.balance_sheet
    try:
        qinc = t.quarterly_income_stmt
    except Exception:
        qinc = None
    if inc is None or inc.empty:
        return None
    cols = sorted(inc.columns)   # oldest -> newest
    rev, ni = _row(inc, "Total Revenue", "Operating Revenue"), _row(inc, "Net Income", "Net Income Common Stockholders")
    ebit, eps = _row(inc, "EBIT", "Operating Income"), _row(inc, "Diluted EPS", "Basic EPS")
    ta, cl = _row(bal, "Total Assets"), _row(bal, "Current Liabilities")
    num_ = lambda s, c: (_clean(float(s[c])) if s is not None and c in s.index and pd.notna(s[c]) else None)
    years = []
    for c in cols:
        y = dict(fy=str(c.date()), revenue=num_(rev, c), netIncome=num_(ni, c), ebit=num_(ebit, c), eps=num_(eps, c))
        a, l = num_(ta, c), num_(cl, c)
        y["roce"] = round(y["ebit"] / (a - l), 4) if y["ebit"] is not None and a and l is not None and a - l > 0 else None
        years.append(y)
    years = [y for y in years if y["revenue"] is not None or y["netIncome"] is not None]
    if not years:
        return None

    def growth(k):
        v = [(y["fy"], y[k]) for y in years if y[k] is not None]
        if len(v) < 2:
            return None, None, 0
        n = (pd.Timestamp(v[-1][0]) - pd.Timestamp(v[0][0])).days / 365.25
        yoy = round(v[-1][1] / v[-2][1] - 1, 4) if v[-2][1] and v[-2][1] > 0 else None
        return yoy, _cagr(v[0][1], v[-1][1], round(n)), round(n)

    s_yoy, s_cagr, s_n = growth("revenue")
    p_yoy, p_cagr, p_n = growth("netIncome")
    quarters = []
    if qinc is not None and not qinc.empty:
        qr, qn = _row(qinc, "Total Revenue", "Operating Revenue"), _row(qinc, "Net Income", "Net Income Common Stockholders")
        for c in sorted(qinc.columns)[-6:]:
            quarters.append(dict(q=str(c.date()), revenue=num_(qr, c), netIncome=num_(qn, c)))
    return dict(years=years, quarters=quarters, salesYoY=s_yoy, salesCagr=s_cagr, salesCagrYears=s_n,
                profitYoY=p_yoy, profitCagr=p_cagr, profitCagrYears=p_n, roce=years[-1]["roce"], _ts=time.time())


def fin(cid, block=True, force=False):
    store = _fin_store()
    rec = store.get(cid)
    if rec and not force and time.time() - rec.get("_ts", 0) < FIN_TTL:
        return rec
    if rec and not block:
        _bg_once("fin:" + cid, fin, cid, True)
        return rec
    try:
        new = _fetch_fin(cid)
    except Exception:
        new = None
    if not new:
        return rec
    with _lock:
        store[cid] = new
        _disk_put("fin.json", store)
    return new


def warm_fin():
    store = _fin_store()
    todo = [c for c in CO if time.time() - (store.get(c) or {}).get("_ts", 0) >= FIN_TTL]
    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(fin, todo))


# ---------------------------------------------------------------- news (Google News RSS)
NEWS_TTL = 30 * 60


def _news(query, n=12):
    import urllib.parse
    import urllib.request
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime
    key = "news:" + query
    hit = _mem.get(key)
    if hit and time.time() - hit[0] < NEWS_TTL:
        return hit[1]
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        dict(q=query + " when:30d", hl="en-IN", gl="IN", ceid="IN:en"))
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=8) as r:
            root = ET.fromstring(r.read())
    except Exception:
        return hit[1] if hit else []
    items = []
    for it in root.iter("item"):
        title = it.findtext("title") or ""
        src = it.findtext("source") or ""
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3]
        try:
            ts = parsedate_to_datetime(it.findtext("pubDate")).timestamp()
        except Exception:
            ts = None
        items.append(dict(title=title, link=it.findtext("link"), source=src, ts=ts))
    items.sort(key=lambda x: -(x["ts"] or 0))
    _mem[key] = (time.time(), items[:n])
    return items[:n]


# ---------------------------------------------------------------- user-added events
EVENTS_FILE = os.path.join(CACHE_DIR, "custom_events.json") if os.environ.get("VERCEL") else os.path.join(BASE, "data", "custom_events.json")


def _load_custom_events():
    try:
        with open(EVENTS_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def _apply_custom_events():
    custom = _load_custom_events()
    quant.EVENTS[:] = [e for e in quant.EVENTS if not e.get("custom")] + custom
    return custom


_apply_custom_events()


def _can_edit():
    """Edits from this machine are allowed; through the public tunnel they need ADMIN_TOKEN."""
    tok = os.environ.get("ADMIN_TOKEN")
    if tok and request.headers.get("X-Admin-Token") == tok:
        return True
    return request.remote_addr in ("127.0.0.1", "::1") and "Cf-Connecting-Ip" not in request.headers


# ---------------------------------------------------------------- models
def _events_sig():
    return hashlib.sha1(json.dumps(quant.EVENTS, sort_keys=True).encode()).hexdigest()


def run_models(force=False):
    with MODEL_LOCK:
        return _run_models(force)


def _run_models(force=False):
    disk = _disk_get("models.json", 10 ** 9)
    usable = disk and set(disk.get("universe", [])) == set(CO) and disk.get("graph_sig") == GRAPH_SIG
    if usable and not force:
        fresh = time.time() - os.path.getmtime(os.path.join(CACHE_DIR, "models.json")) < MODEL_TTL
        if fresh and disk.get("events_sig") == _events_sig():
            MODEL.update(status="ready", data=disk)
            return True
    if usable and not MODEL["data"]:
        MODEL.update(status="ready", data=disk)   # serve yesterday's models while today's compute
    MODEL.update(running=True, log=[])
    if not MODEL["data"]:
        MODEL["status"] = "running"
    try:
        res = quant.run(CO, EDGES, log=lambda m: (MODEL["log"].append(m), print(m)))
        res["universe"] = sorted(CO)
        res["graph_sig"] = GRAPH_SIG
        res["events_sig"] = _events_sig()
        res["computed_at"] = time.time()
        _disk_put("models.json", res)
        MODEL.update(status="ready", data=res, error=None)
        return True
    except Exception as e:  # keep the site usable without models
        traceback.print_exc()
        MODEL.update(error=str(e))
        if not MODEL["data"]:
            MODEL["status"] = "error"
        return False
    finally:
        MODEL["running"] = False


def M(key, cid=None, default=None):
    d = MODEL["data"]
    if not d:
        return default
    v = d.get(key, {})
    return v.get(cid, default) if cid is not None else v


def refresh_models():
    """Recheck cache expiry while the server stays up, without blocking pages."""
    while True:
        if not MODEL["running"] and not REFRESH_STATE["running"]:
            run_models()
        time.sleep(60)


def _refresh_status(**values):
    with REFRESH_LOCK:
        REFRESH_STATE.update(values)
        _disk_put("refresh_status.json", dict(REFRESH_STATE))


def refresh_all_data():
    """Force real provider downloads; retain old records when a source fails."""
    started = REFRESH_STATE["startedAt"]
    warnings = []

    def financials():
        def one(cid):
            inf = info(cid, force=True)
            statements = fin(cid, force=True) or {}
            return int(inf.get("_ts", 0) >= started), int(statements.get("_ts", 0) >= started)
        count = good_info = good_fin = 0
        with ThreadPoolExecutor(max_workers=3) as pool:
            for i, f in pool.map(one, CO):
                count += 1
                good_info += i
                good_fin += f
                if count % 10 == 0 or count == len(CO):
                    _refresh_status(companiesProcessed=count, fundamentalsUpdated=good_info, financialsUpdated=good_fin)
        return good_info, good_fin

    try:
        _refresh_status(phase="Downloading prices and financials")
        with ThreadPoolExecutor(max_workers=1) as background:
            fund = background.submit(financials)
            try:
                fresh = _fetch_snapshot()
                if not any(fresh["metrics"].values()):
                    raise ValueError("Provider returned no usable prices")
                _disk_put("snapshot2.json", fresh)
                _mem["snap"] = (time.time(), fresh)
                _refresh_status(pricesUpdated=True)
            except Exception as error:
                warnings.append("Prices: " + str(error))
            _refresh_status(phase="Recomputing all models")
            models_ok = run_models(force=True)
            if not models_ok:
                warnings.append("Models: " + str(MODEL["error"]))
            _refresh_status(modelsUpdated=models_ok, phase="Finishing financial statement downloads")
            good_info, good_fin = fund.result()
            if good_info < len(CO) or good_fin < len(CO):
                warnings.append(f"Fresh fundamentals: {good_info}/{len(CO)}; statements: {good_fin}/{len(CO)}. Unavailable records retain prior data.")
        # Subsequent chart requests must read the newly downloaded provider data.
        for key in list(_mem):
            if key.startswith("hist_") or key.startswith("news:"):
                _mem.pop(key, None)
        _refresh_status(running=False, status="partial" if warnings else "ready", phase="Complete", completedAt=time.time(), warnings=warnings)
    except Exception as error:
        traceback.print_exc()
        _refresh_status(running=False, status="error", phase="Refresh failed", completedAt=time.time(), warnings=warnings + [str(error)])


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    if not _can_edit():
        abort(403)
    with REFRESH_LOCK:
        if REFRESH_STATE["running"]:
            return jsonify(REFRESH_STATE), 202
        REFRESH_STATE.update(running=True, status="running", phase="Starting", startedAt=time.time(), completedAt=None,
                             companiesProcessed=0, fundamentalsUpdated=0, financialsUpdated=0,
                             pricesUpdated=False, modelsUpdated=False, warnings=[])
    threading.Thread(target=refresh_all_data, daemon=True).start()
    return jsonify(REFRESH_STATE), 202


@app.route("/api/freshness")
def api_freshness():
    snap = (_mem.get("snap") or (None, None))[1] or _disk_get("snapshot2.json", 10 ** 9) or {}
    models = MODEL["data"] or _disk_get("models.json", 10 ** 9) or {}
    dates = [m["asof"] for m in snap.get("metrics", {}).values() if m and m.get("asof")]
    refresh = REFRESH_STATE if REFRESH_STATE["status"] != "idle" else (_disk_get("refresh_status.json", 10 ** 9) or REFRESH_STATE)
    return jsonify(priceAsOf=max(dates) if dates else None, oldestPriceAsOf=min(dates) if dates else None,
                   pricesFetchedAt=snap.get("ts"), modelsAsOf=models.get("asof"), modelsComputedAt=models.get("computed_at"),
                   pricedCompanies=len(dates), totalCompanies=len(CO), refresh=dict(refresh))


# ---------------------------------------------------------------- serializers
def brief(cid):
    c = CO[cid]
    m = snapshot()["metrics"].get(cid) or {}
    inf = _info_store().get(cid) or {}
    g = M("geo", cid) or {}
    fn = _fin_store().get(cid) or {}
    return dict(
        id=cid, name=c["name"], kind="company", seg=c["seg"], segName=U.SEGMENTS[c["seg"]],
        sector=c["sector"], stance=g.get("stance"), geoScore=g.get("network"),
        price=m.get("price"), d1=m.get("d1"), m1=m.get("m1"), m6=m.get("m6"), y1=m.get("y1"),
        spark=m.get("spark"), cap=cap_class(inf.get("marketCap"), m.get("price")),
        mcap=inf.get("marketCap"), pe=inf.get("trailingPE"), pb=inf.get("priceToBook"),
        roe=inf.get("returnOnEquity"), revGrowth=inf.get("revenueGrowth"), epsGrowth=inf.get("earningsGrowth"),
        de=inf.get("debtToEquity"), divYield=inf.get("dividendYield"), opm=inf.get("operatingMargins"),
        roce=fn.get("roce"), salesCagr=fn.get("salesCagr"), profitCagr=fn.get("profitCagr"),
        dma50=m.get("dma50"), dma100=m.get("dma100"), exch=exch_link(c["sym"]),
    )


def exch_link(sym):
    return dict(name="NSE", url="https://www.nseindia.com/get-quotes/equity?symbol=" + urllib.parse.quote(sym.partition(".")[0]))


def node(nid):
    if nid in CO:
        return brief(nid)
    name, cat = ENT[nid]
    return dict(id=nid, name=name, kind="entity", category=cat)


def edge_json(e):
    s, d, t, label = e
    return dict(id=f"{s}|{d}|{t}", source=s, target=d, type=t, typeLabel=U.EDGE_TYPES[t],
                label=label, evidence=M("edges", f"{s}|{d}|{t}"))


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/research")
def research():
    return render_template("research.html")


def atlas_node(nid):
    """Structural data must stay usable when market-data providers are offline."""
    if nid in CO:
        c = CO[nid]
        return dict(id=nid, name=c["name"], kind="company", sector=c["sector"],
                    segment=U.SEGMENTS[c["seg"]], description=c["desc"])
    name, category = ENT[nid]
    return dict(id=nid, name=name, kind="entity", sector="External entities",
                segment=category, description="An external organisation or market group in the curated relationship map.")


@app.route("/api/atlas")
def api_atlas():
    nodes = []
    for nid in [*CO, *ENT]:
        nodes.append(dict(atlas_node(nid), incoming=len(IN_E.get(nid, [])),
                          outgoing=len(OUT_E.get(nid, []))))
    return jsonify(nodes=nodes, edges=[dict(id=f"{s}|{d}|{t}", source=s, target=d,
                   type=t, label=label) for s, d, t, label in EDGES],
                   sectors=list(dict.fromkeys(c["sector"] for c in CO.values())),
                   types=U.EDGE_TYPES)


@app.route("/api/paths")
def api_paths():
    """Shortest connection chain; direction is explicit, never inferred causality."""
    from collections import deque
    source, target = request.args.get("source"), request.args.get("target")
    known = set(CO) | set(ENT)
    if source not in known or target not in known:
        abort(400, "Choose two organisations in the relationship map.")
    directed = request.args.get("directed", "false") == "true"
    kind = request.args.get("type", "all")
    if kind != "all" and kind not in U.EDGE_TYPES:
        abort(400, "Unknown relationship type.")
    adjacency = {}
    for s, d, t, label in EDGES:
        if kind != "all" and t != kind:
            continue
        edge = dict(source=s, target=d, type=t, label=label)
        adjacency.setdefault(s, []).append((d, edge))
        if not directed or t == "partner":
            adjacency.setdefault(d, []).append((s, edge))
    previous = {source: None}
    queue = deque([source])
    while queue and target not in previous:
        current = queue.popleft()
        for nxt, edge in adjacency.get(current, []):
            if nxt not in previous:
                previous[nxt] = (current, edge)
                queue.append(nxt)
    if target not in previous:
        return jsonify(found=False, nodes=[], edges=[], directed=directed)
    chain, edges, cur = [target], [], target
    while previous[cur] is not None:
        parent, edge = previous[cur]
        edges.append(edge)
        chain.append(parent)
        cur = parent
    return jsonify(found=True, nodes=[atlas_node(n) for n in reversed(chain)],
                   edges=list(reversed(edges)), directed=directed)


@app.route("/api/tree")
def api_tree():
    snap = snapshot()["metrics"]

    def med(ids, k):
        v = [snap[i][k] for i in ids if snap.get(i) and snap[i].get(k) is not None]
        return round(float(pd.Series(v).median()), 1) if v else None

    out = []
    for sector, segs in U.sectors():
        rows = []
        all_ids = []
        for k in segs:
            ids = [cid for cid, c in CO.items() if c["seg"] == k]
            all_ids += ids
            rows.append(dict(key=k, label=U.SEGMENTS[k], count=len(ids), y1=med(ids, "y1"), m1=med(ids, "m1")))
        out.append(dict(sector=sector, count=len(all_ids), y1=med(all_ids, "y1"), segments=rows))
    return jsonify(dict(tree=out, total=len(CO), model=MODEL["status"]))


def _scope_ids(args):
    seg, sector = args.get("seg"), args.get("sector")
    if seg and seg != "all":
        return [cid for cid, c in CO.items() if c["seg"] == seg]
    if sector:
        return [cid for cid, c in CO.items() if c["sector"] == sector]
    return list(CO)


@app.route("/api/companies")
def api_companies():
    return jsonify([brief(i) for i in _scope_ids(request.args)])


@app.route("/api/info/<path:cid>")
def api_info(cid):
    if cid not in CO:
        abort(404)
    c = CO[cid]
    rec = dict(info(cid, block=False) or {})
    m = snapshot()["metrics"].get(cid) or {}
    fn = _fin_store().get(cid) or {}
    rec.update(roce=fn.get("roce"), salesCagr=fn.get("salesCagr"), profitCagr=fn.get("profitCagr"),
               salesCagrYears=fn.get("salesCagrYears"), profitCagrYears=fn.get("profitCagrYears"),
               exch=exch_link(c["sym"]))
    g = M("geo", cid) or {}
    rec.update(id=cid, name=c["name"], segName=U.SEGMENTS[c["seg"]], sector=c["sector"], desc=c["desc"],
               stance=g.get("stance"), geoScore=g.get("network"), metrics=m, risk=M("risk", cid),
               cap=cap_class(rec.get("marketCap"), m.get("price")))
    return jsonify(rec)


@app.route("/api/company/<path:cid>")
def api_company(cid):
    if cid not in CO:
        abort(404)
    c = CO[cid]

    def rel(e, other):
        return dict(node(other), edge=edge_json(e))

    cluster = M("cluster", cid)
    clus_members = [k for k, v in (M("cluster") or {}).items() if v == cluster and k != cid] if cluster else []
    return jsonify(dict(
        brief(cid), desc=c["desc"], sym=c["sym"],
        incoming=[rel(e, e[0]) for e in IN_E.get(cid, [])],
        outgoing=[rel(e, e[1]) for e in OUT_E.get(cid, [])],
        peers=[brief(p) for p in sorted(PEERS[cid])],
        narrative=c["geo"][1],
        geo=M("geo", cid), factor=M("factor_model", cid), events=M("event_study", cid),
        scenario=M("scenario", cid), risk=M("risk", cid),
        similar=[dict(brief(o), rcorr=rc, corr=rw) for o, rc, rw in (M("similar", cid) or []) if o in CO],
        cluster=[brief(x) for x in clus_members[:12]],
        model=MODEL["status"],
    ))


@app.route("/api/graph")
def api_graph():
    focus = request.args.get("focus")
    if focus:
        if focus not in CO and focus not in ENT:
            abort(404)
        core = {focus}
        nodes = {focus} | {e[1] for e in OUT_E.get(focus, [])} | {e[0] for e in IN_E.get(focus, [])}
        if focus in CO:
            nodes |= PEERS[focus]
    else:
        core = set(_scope_ids(request.args))
        nodes = set(core)
        for n in core:
            nodes |= {e[1] for e in OUT_E.get(n, [])} | {e[0] for e in IN_E.get(n, [])}
    edges = [edge_json(e) for e in EDGES if e[0] in nodes and e[1] in nodes
             and (e[0] in core or e[1] in core or focus)]
    ns = []
    for n in nodes:
        d = node(n)
        d["core"] = n in core
        d.pop("spark", None)
        ns.append(d)
    peers = {n: sorted(PEERS[n] & nodes) for n in nodes if n in CO}
    return jsonify(dict(nodes=ns, edges=edges, peers=peers))


@app.route("/api/node/<path:nid>")
def api_node(nid):
    """Right-panel table data for any node (company or outside entity)."""
    if nid not in CO and nid not in ENT:
        abort(404)
    rows = []
    for e in IN_E.get(nid, []):
        rows.append(dict(dir="in", other=node(e[0]), edge=edge_json(e)))
    for e in OUT_E.get(nid, []):
        rows.append(dict(dir="out", other=node(e[1]), edge=edge_json(e)))
    peers = [dict(brief(p), rcorr=next((rc for o, rc, _ in (M("similar", nid) or []) if o == p), None))
             for p in sorted(PEERS.get(nid, []))]
    return jsonify(dict(node=node(nid), rows=rows, peers=peers, geo=M("geo", nid)))


@app.route("/api/model")
def api_model():
    d = MODEL["data"] or {}
    evs = sorted(d.get("events") or [], key=lambda e: e["day"], reverse=True)   # latest news first
    return jsonify(dict(status=MODEL["status"], running=MODEL["running"], log=MODEL["log"][-5:], error=MODEL["error"],
                        asof=d.get("asof"), factors=d.get("factors"), events=evs,
                        pendingEvents=[e for e in quant.EVENTS if e["id"] not in {x["id"] for x in evs}],
                        canEdit=_can_edit(),
                        scenarios=d.get("scenarios"), params=d.get("params"),
                        segmentEvents=d.get("segment_events"),
                        segments=U.SEGMENTS))


@app.route("/api/history/<path:cid>")
def api_history(cid):
    if cid not in CO:
        abort(404)
    period = request.args.get("period", "1y")
    if period not in {"1mo", "3mo", "6mo", "1y", "2y", "5y", "max"}:
        abort(400)
    compare = [x for x in request.args.get("compare", "").split(",") if x in CO][:6]
    key = f"hist_{cid}_{period}_{'-'.join(compare)}"
    hit = _mem.get(key)
    if hit and time.time() - hit[0] < HIST_TTL:
        return jsonify(hit[1])
    ids = [cid] + [x for x in compare if x != cid]
    weekly = period in {"5y", "max"}
    # fetch ~150 extra sessions so the 50/100-day averages exist from the first visible day
    days = {"1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731}.get(period)
    kw = dict(start=(pd.Timestamp.today() - pd.Timedelta(days=days + 160)).strftime("%Y-%m-%d")) if days else dict(period=period)
    raw = yf.download([CO[i]["sym"] for i in ids], interval="1wk" if weekly else "1d",
                      auto_adjust=True, progress=False, threads=True, **kw)
    close = raw["Close"]
    if isinstance(close, pd.Series):
        close = close.to_frame(CO[cid]["sym"])
    close = close.dropna(how="all")
    main = close.get(CO[cid]["sym"])
    n50, n100 = (10, 20) if weekly else (50, 100)   # weekly bars: 10/20 weeks ~ 50/100 sessions
    sma = {k: main.ffill().rolling(n).mean() for k, n in (("sma50", n50), ("sma100", n100))} if main is not None else {}
    if days:
        close = close[close.index >= pd.Timestamp.today().normalize() - pd.Timedelta(days=days)]
    fmt = lambda s: [None if pd.isna(v) else round(float(v), 2) for v in s.values]
    series = {}
    for i in ids:
        s = close.get(CO[i]["sym"])
        if s is not None:
            series[i] = fmt(s.ffill())
    data = dict(dates=[str(d.date()) for d in close.index], series=series,
                **{k: fmt(v.reindex(close.index)) for k, v in sma.items()})
    _mem[key] = (time.time(), data)
    return jsonify(data)


@app.route("/api/search")
def api_search():
    """Suggestions: names / tickers whose start (or any word's start) matches, biggest companies first."""
    q = request.args.get("q", "").strip().lower()
    if not q:
        return jsonify([])
    hits = []
    for cid, c in CO.items():
        nm = c["name"].lower()
        if cid.lower().startswith(q) or nm.startswith(q):
            rank = 0
        elif any(w.startswith(q) for w in nm.replace("-", " ").replace("(", " ").split()):
            rank = 1
        elif q in nm or q in cid.lower():
            rank = 2
        else:
            continue
        hits.append((rank, cid))
    out = [dict(brief(cid), rank=r) for r, cid in hits]
    out.sort(key=lambda x: (x["rank"] > 1, -(x["mcap"] or 0)))
    for x in out:
        x.pop("spark", None)
    return jsonify(out[: int(request.args.get("n", 50))])


@app.route("/api/financials/<path:cid>")
def api_financials(cid):
    if cid not in CO:
        abort(404)
    return jsonify(fin(cid, block=False) or {})


@app.route("/api/news")
def api_news():
    cid = request.args.get("cid")
    if cid:
        if cid not in CO:
            abort(404)
        name = CO[cid]["name"].replace(" Ltd", "")
        return jsonify(dict(items=_news(f'"{name}" share OR stock')))
    topics = {
        "market": "Sensex Nifty stock market India",
        "geo": "India geopolitics tariff sanctions markets",
        "economy": "India economy RBI inflation rupee",
        "global": "crude oil dollar global markets",
    }
    t = request.args.get("topic", "market")
    return jsonify(dict(items=_news(topics.get(t, topics["market"]), 20), topics=list(topics)))


@app.route("/api/impact")
def api_impact():
    """Rank companies by modelled impact: a stress scenario, a custom shock set, or a past event (CAR)."""
    ids = _scope_ids(request.args)
    kind = request.args.get("kind", "scenario")
    rows = []
    if kind == "event":
        eid = request.args.get("id")
        ev = M("event_study") or {}
        for cid in ids:
            x = (ev.get(cid) or {}).get(eid)
            if x and x.get("car") is not None:
                rows.append(dict(brief(cid), impact=x["car"], t=x["t"]))
    else:
        if kind == "custom":
            shocks = {k: float(v) for k, v in request.args.items() if k in quant.FACTORS}
        else:
            sc = next((s for s in quant.SCENARIOS if s["id"] == request.args.get("id")), quant.SCENARIOS[0])
            shocks = sc["shocks"]
        fm = M("factor_model") or {}
        for cid in ids:
            f = fm.get(cid)
            if not f:
                continue
            b, t = f["betas"], f["tstats"]
            tot = sum((b.get(k) or 0) * v for k, v in shocks.items()) - shocks.get("MKT", 0)
            # main driver = factor with the biggest contribution to the excess return
            contrib = {k: ((b.get(k) or 0) - (k == "MKT")) * v for k, v in shocks.items()}   # relative to Nifty
            drv = max(contrib, key=lambda k: abs(contrib[k])) if contrib else None
            rows.append(dict(brief(cid), impact=round(tot, 4), driver=drv,
                             driverT=t.get(drv) if drv else None, r2=f.get("r2")))
    for r in rows:
        r.pop("spark", None)
    rows.sort(key=lambda r: -r["impact"])
    seg = {}
    for r in rows:
        seg.setdefault(r["segName"], []).append(r["impact"])
    segs = sorted(([k, round(sum(v) / len(v), 4), len(v)] for k, v in seg.items()), key=lambda x: -x[1])
    return jsonify(dict(rows=rows, segments=segs, factors={k: v[3] for k, v in quant.FACTORS.items()}))


@app.route("/api/eventgrid")
def api_eventgrid():
    """Company-wise event reactions for one segment / sector (biggest companies first)."""
    ids = _scope_ids(request.args)
    ev = M("event_study") or {}
    rows = [dict(id=c, name=CO[c]["name"], mcap=(_info_store().get(c) or {}).get("marketCap"), ev=ev.get(c, {}))
            for c in ids]
    rows.sort(key=lambda r: -(r["mcap"] or 0))
    return jsonify(rows)


@app.route("/api/events", methods=["POST"])
def api_events_add():
    if not _can_edit():
        abort(403)
    d = request.get_json(force=True) or {}
    name, day = str(d.get("name", "")).strip()[:120], str(d.get("day", "")).strip()
    try:
        ts = pd.Timestamp(day)
        w1 = max(0, min(10, int(d.get("win", 3))))
    except (ValueError, TypeError):
        abort(400)
    if not name or ts > pd.Timestamp.today():
        abort(400)
    custom = _load_custom_events()
    eid = "u_" + hashlib.sha1((name + day).encode()).hexdigest()[:8]
    custom = [e for e in custom if e["id"] != eid] + [dict(
        id=eid, day=str(ts.date()), win=[0, w1], theme="shock" if d.get("shock", True) else "domestic",
        name=name, custom=True, note=str(d.get("note", ""))[:300])]
    with open(EVENTS_FILE, "w") as f:
        json.dump(custom, f, indent=1)
    _apply_custom_events()
    if not MODEL["running"]:
        threading.Thread(target=run_models, kwargs=dict(force=True), daemon=True).start()
    return jsonify(dict(ok=True, id=eid))


@app.route("/api/events/<eid>", methods=["DELETE"])
def api_events_del(eid):
    if not _can_edit():
        abort(403)
    custom = [e for e in _load_custom_events() if e["id"] != eid]
    with open(EVENTS_FILE, "w") as f:
        json.dump(custom, f, indent=1)
    _apply_custom_events()
    if not MODEL["running"]:
        threading.Thread(target=run_models, kwargs=dict(force=True), daemon=True).start()
    return jsonify(dict(ok=True))


@app.after_request
def _gzip(resp):
    """Compress JSON / HTML: the company list and model payloads shrink ~5-8x over the tunnel."""
    import gzip
    if (resp.status_code != 200 or resp.direct_passthrough or "gzip" not in request.headers.get("Accept-Encoding", "")
            or resp.headers.get("Content-Encoding") or resp.mimetype not in ("application/json", "text/html")):
        return resp
    data = resp.get_data()
    if len(data) < 1024:
        return resp
    resp.set_data(gzip.compress(data, 5))
    resp.headers["Content-Encoding"] = "gzip"
    resp.headers["Vary"] = "Accept-Encoding"
    return resp


if __name__ == "__main__":
    print(f"Universe: {len(CO)} companies, {len(ENT)} outside entities, {len(EDGES)} edges")
    threading.Thread(target=warm_info, daemon=True).start()
    threading.Thread(target=refresh_models, daemon=True).start()
    port = int(os.environ.get("PORT", 5000))
    try:  # production WSGI server when available (used behind the Cloudflare tunnel)
        from waitress import serve
        print(f"Serving on http://127.0.0.1:{port} (waitress)")
        serve(app, host="127.0.0.1", port=port, threads=8)
    except ImportError:
        app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
