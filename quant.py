"""
Quantitative models behind every "tailwind / headwind", "similar stock" and
edge-strength claim in the UI.  Nothing here is hand-assigned.

1. Multi-factor macro model (per stock, OLS with Newey-West HAC errors)
       r_i,t = a + b_MKT*Nifty + b_INR*USDINR + b_OIL*Brent(t-1) + b_SPX*S&P500(t-1)
               + b_UST*dUS10Y(t-1) + b_GOLD*Gold(t-1) + b_HSI*HangSeng + b_VIX*VIX_perp + e
   US-traded factors are lagged one session (they close after India).
   India VIX is orthogonalised to Nifty so b_VIX is pure "fear" exposure.

2. Event study (Brown & Warner market model) on dated geopolitical shocks:
       AR = r_i - (a_i + b_i*r_Nifty),  estimated on [-260, -11] sessions,
       CAR over the event window, SCAR = CAR / (sigma_e * sqrt(L)).

3. Scenario stress tests: factor betas x scenario shocks -> expected return
   relative to Nifty (linear, first-order approximation).

4. Geopolitical score = 0.5*z(mean shock SCAR) + 0.5*z(mean scenario excess)
   then propagated over the supply/ownership graph (Katz-style diffusion):
       s_net = (1-a)(I - aW)^-1 s,  W = row-normalised listed-to-listed adjacency.
   Stance: tailwind if s_net > +0.5, headwind if < -0.5, else mixed.

5. Similarity: correlation of factor-model residuals (idiosyncratic co-movement)
   with Ledoit-Wolf shrinkage, plus hierarchical clustering (average linkage).

6. Edge evidence: residual correlation and Granger-causality (lags 1-3) on
   residuals for every listed->listed edge; Bonferroni over lags, then
   Benjamini-Hochberg FDR q-values across all edges.

7. Risk: GARCH(1,1) forecast vol, realised vol, beta, Jensen alpha, Sharpe,
   Sortino, max drawdown, 95% historical VaR / CVaR, 12-1 momentum,
   6-month log-linear trend slope & R^2.
"""
import math
import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm
import yfinance as yf
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform
from sklearn.covariance import LedoitWolf
from statsmodels.stats.multitest import multipletests
from statsmodels.tsa.stattools import grangercausalitytests

warnings.filterwarnings("ignore")

RF = 0.065            # annual risk-free (approx. Indian 1y T-bill)
MODEL_WINDOW = 504    # ~2 years of sessions for the factor model
NET_ALPHA = 0.35      # diffusion strength through the graph

# name: (yahoo symbol, transform, lag sessions, label)
FACTORS = {
    "MKT": ("^NSEI", "ret", 0, "Nifty 50"),
    "USDINR": ("INR=X", "ret", 0, "USD/INR (+ = weaker rupee)"),
    "BRENT": ("BZ=F", "ret", 1, "Brent crude"),
    "SPX": ("^GSPC", "ret", 1, "S&P 500 (US demand / risk)"),
    "UST10": ("^TNX", "diff", 1, "US 10Y yield (pp change)"),
    "GOLD": ("GC=F", "ret", 1, "Gold"),
    "HSI": ("^HSI", "ret", 0, "Hang Seng (China)"),
    "VIX": ("^INDIAVIX", "logdiff", 0, "India VIX (fear, ex-market)"),
}

# Dated shocks. Date = announcement; the event day is the first Indian
# session on/after `day`. theme 'shock' items feed the geopolitical score.
EVENTS = [
    dict(id="liberation", day="2025-04-03", win=(0, 3), theme="shock",
         name="US 'Liberation Day' reciprocal tariffs (2 Apr 2025)"),
    dict(id="pahalgam", day="2025-04-23", win=(0, 5), theme="shock",
         name="Pahalgam attack → India–Pakistan tension (22 Apr 2025)"),
    dict(id="sindoor", day="2025-05-07", win=(0, 1), theme="shock",
         name="Operation Sindoor strikes (7 May 2025)"),
    dict(id="tariff25", day="2025-07-31", win=(0, 3), theme="shock",
         name="US announces 25% tariff on India (30 Jul 2025)"),
    dict(id="tariff50", day="2025-08-07", win=(0, 3), theme="shock",
         name="Extra 25% 'Russian-oil' tariff → 50% (6 Aug 2025)"),
    dict(id="tariff_eff", day="2025-08-27", win=(0, 3), theme="shock",
         name="50% US tariff takes effect (27 Aug 2025)"),
    dict(id="h1b", day="2025-09-22", win=(0, 3), theme="shock",
         name="US $100k H-1B fee proclamation (19 Sep 2025)"),
    dict(id="pharma", day="2025-09-26", win=(0, 3), theme="shock",
         name="US 100% tariff on branded pharma (25 Sep 2025)"),
    dict(id="rusoil", day="2025-10-23", win=(0, 3), theme="shock",
         name="US sanctions on Rosneft & Lukoil (22 Oct 2025)"),
    dict(id="gst", day="2025-09-04", win=(0, 3), theme="domestic",
         name="GST 2.0 rate cuts announced (3 Sep 2025)"),
]

# Shocks are in factor units (returns as decimals, UST10 in pp, VIX in log pts).
SCENARIOS = [
    dict(id="trade_war", name="US trade war escalation",
         shocks=dict(MKT=-0.04, USDINR=0.02, SPX=-0.08, HSI=-0.05, VIX=0.25)),
    dict(id="oil_shock", name="Middle-East oil shock",
         shocks=dict(MKT=-0.04, BRENT=0.25, USDINR=0.02, GOLD=0.06, VIX=0.30)),
    dict(id="rupee_crash", name="Rupee slide / FPI outflow",
         shocks=dict(MKT=-0.03, USDINR=0.05, UST10=0.30, VIX=0.15)),
    dict(id="risk_on", name="De-escalation / trade deal",
         shocks=dict(MKT=0.04, USDINR=-0.02, SPX=0.04, HSI=0.04, BRENT=-0.10, VIX=-0.25)),
]
STRESS = ["trade_war", "oil_shock", "rupee_crash"]


def _f(x, nd=4):
    if x is None:
        return None
    x = float(x)
    return None if math.isnan(x) or math.isinf(x) else round(x, nd)


# ------------------------------------------------------------------ data
def load_prices(companies, period="3y"):
    syms = [c["sym"] for c in companies.values()]
    raw = yf.download(syms, period=period, interval="1d", auto_adjust=True,
                      progress=False, threads=True)["Close"]
    sym2id = {c["sym"]: cid for cid, c in companies.items()}
    raw = raw.rename(columns=sym2id)
    fac = yf.download([v[0] for v in FACTORS.values()], period=period, interval="1d",
                      auto_adjust=True, progress=False, threads=True)["Close"]
    return raw, fac


def build_factors(fac_raw, idx):
    out = {}
    for name, (sym, tf, lag, _) in FACTORS.items():
        s = fac_raw[sym].dropna()
        if lag:
            # value known before the Indian session opens = last close strictly before that date
            s = s.reindex(idx - pd.Timedelta(days=1), method="ffill")
        else:
            s = s.reindex(idx, method="ffill")
        s.index = idx
        if tf == "ret":
            out[name] = s.pct_change(fill_method=None)
        elif tf == "diff":
            out[name] = s.diff()
        else:
            out[name] = np.log(s).diff()
    F = pd.DataFrame(out)
    # orthogonalise VIX to the market
    ok = F[["VIX", "MKT"]].dropna()
    b = np.polyfit(ok["MKT"], ok["VIX"], 1)
    F["VIX"] = F["VIX"] - (b[0] * F["MKT"] + b[1])
    return F


# ------------------------------------------------------------------ models
def factor_model(R, F):
    res, resid = {}, {}
    Fw = F.iloc[-MODEL_WINDOW:]
    for cid in R.columns:
        y = R[cid].iloc[-MODEL_WINDOW:]
        d = pd.concat([y.rename("y"), Fw], axis=1).dropna()
        if len(d) < 200:
            continue
        X = sm.add_constant(d[list(FACTORS)])
        m = sm.OLS(d["y"], X).fit(cov_type="HAC", cov_kwds={"maxlags": 5})
        res[cid] = dict(
            n=int(m.nobs), r2=_f(m.rsquared, 3), alpha_ann=_f(m.params["const"] * 252, 4),
            alpha_t=_f(m.tvalues["const"], 2),
            betas={k: _f(m.params[k], 4) for k in FACTORS},
            tstats={k: _f(m.tvalues[k], 2) for k in FACTORS},
            resid_vol_ann=_f(m.resid.std() * math.sqrt(252), 4),
        )
        resid[cid] = m.resid
    return res, pd.DataFrame(resid)


def event_study(R, mkt):
    idx = R.index
    out = {}
    for ev in EVENTS:
        pos = idx.searchsorted(pd.Timestamp(ev["day"]))
        if pos >= len(idx) or pos < 270:
            continue
        w0, w1 = ev["win"]
        est = slice(pos - 260, pos - 10)
        win = slice(pos + w0, min(pos + w1 + 1, len(idx)))
        L = win.stop - win.start
        m_est, m_win = mkt.iloc[est], mkt.iloc[win]
        for cid in R.columns:
            y_est = R[cid].iloc[est]
            ok = y_est.notna() & m_est.notna()
            if ok.sum() < 120:
                continue
            b, a = np.polyfit(m_est[ok], y_est[ok], 1)
            sig = float(np.std(y_est[ok] - (a + b * m_est[ok]), ddof=2))
            ar = R[cid].iloc[win] - (a + b * m_win)
            if ar.isna().all() or sig == 0:
                continue
            car = float(ar.sum())
            scar = car / (sig * math.sqrt(L))
            out.setdefault(cid, {})[ev["id"]] = dict(car=_f(car, 4), t=_f(scar, 2))
    return out


def scenarios(fm):
    out = {}
    for cid, m in fm.items():
        b = m["betas"]
        row = {}
        for sc in SCENARIOS:
            tot = sum((b.get(k) or 0) * v for k, v in sc["shocks"].items())
            row[sc["id"]] = _f(tot - sc["shocks"].get("MKT", 0), 4)   # excess vs Nifty
        out[cid] = row
    return out


def _z(s):
    s = pd.Series(s, dtype=float)
    z = (s - s.mean()) / (s.std() or 1)
    return z.clip(-3, 3)


def geo_scores(ev, sc, companies, edges):
    shock_ids = [e["id"] for e in EVENTS if e["theme"] == "shock"]
    ev_mean = {cid: np.nanmean([d[k]["t"] for k in shock_ids if k in d and d[k]["t"] is not None])
               for cid, d in ev.items()}
    sc_mean = {cid: np.mean([d[k] for k in STRESS if d.get(k) is not None]) for cid, d in sc.items()}
    ids = sorted(set(ev_mean) & set(sc_mean))
    ze, zs = _z({i: ev_mean[i] for i in ids}), _z({i: sc_mean[i] for i in ids})
    s = (0.5 * ze.fillna(0) + 0.5 * zs.fillna(0))

    # graph diffusion among listed nodes
    pos = {cid: k for k, cid in enumerate(ids)}
    n = len(ids)
    W = np.zeros((n, n))
    wt = {"supply": 1.0, "service": 1.0, "invest": 0.6, "partner": 0.6}
    for a, b, t, _ in edges:
        if a in pos and b in pos:
            W[pos[a], pos[b]] += wt[t]
            W[pos[b], pos[a]] += wt[t]
    for i in range(n):
        if W[i].sum() == 0:
            W[i, i] = 1.0
    W = W / W.sum(axis=1, keepdims=True)
    s_vec = s.reindex(ids).values
    s_net = (1 - NET_ALPHA) * np.linalg.solve(np.eye(n) - NET_ALPHA * W, s_vec)

    out = {}
    for cid in ids:
        v = float(s_net[pos[cid]])
        out[cid] = dict(
            shock_scar=_f(ev_mean[cid], 3), stress_excess=_f(sc_mean[cid], 4),
            z_events=_f(ze[cid], 3), z_stress=_f(zs[cid], 3),
            direct=_f(s[cid], 3), network=_f(v, 3),
            stance="tailwind" if v > 0.5 else "headwind" if v < -0.5 else "mixed",
        )
    return out


def similarity(resid, R, k=8, clusters=30):
    good = [c for c in resid.columns if resid[c].notna().sum() >= 200]
    X = resid[good].fillna(0.0)
    X = (X - X.mean()) / X.std().replace(0, 1)
    cov = LedoitWolf().fit(X.values).covariance_
    d = np.sqrt(np.diag(cov))
    C = cov / np.outer(d, d)
    np.fill_diagonal(C, 1.0)
    raw = R[good].iloc[-MODEL_WINDOW:].corr(min_periods=120)
    Dm = np.sqrt(np.clip(2 * (1 - C), 0, None))
    np.fill_diagonal(Dm, 0)
    Z = linkage(squareform(Dm, checks=False), method="average")
    lab = fcluster(Z, t=clusters, criterion="maxclust")
    sim = {}
    for i, a in enumerate(good):
        order = np.argsort(-C[i])
        top = [(good[j], _f(C[i, j], 3), _f(raw.loc[a, good[j]], 3)) for j in order if j != i][:k]
        sim[a] = top
    return sim, {a: int(lab[i]) for i, a in enumerate(good)}, pd.DataFrame(C, index=good, columns=good)


def edge_evidence(edges, resid, C):
    out = {}
    for a, b, t, _ in edges:
        if a not in resid or b not in resid:
            continue
        d = pd.concat([resid[b], resid[a]], axis=1).dropna()
        if len(d) < 200:
            continue
        try:
            g = grangercausalitytests(d.values, maxlag=3)
            p = min(g[l][0]["ssr_ftest"][1] for l in g)
            g2 = grangercausalitytests(d.values[:, ::-1], maxlag=3)
            p2 = min(g2[l][0]["ssr_ftest"][1] for l in g2)
        except Exception:
            p = p2 = None
        rc = C.loc[a, b] if a in C.index and b in C.index else None
        # Preserve precision until after FDR; rounding tiny p-values to zero
        # before adjustment incorrectly makes the adjusted q-value zero too.
        out[f"{a}|{b}|{t}"] = dict(resid_corr=_f(rc, 3), granger_p=float(p) if p is not None else None,
                                  granger_rev_p=float(p2) if p2 is not None else None, n=len(d))
    # Benjamini-Hochberg FDR across all edge tests (min over 3 lags is Bonferroni-adjusted first)
    keys = [k for k, v in out.items() if v["granger_p"] is not None]
    if keys:
        raw = [min(1.0, out[k]["granger_p"] * 3) for k in keys]
        q = multipletests(raw, method="fdr_bh")[1]
        for k, v in zip(keys, q):
            out[k]["granger_q"] = _f(v, 4)
    return out


def risk(P, mkt_ret):
    from arch import arch_model
    out = {}
    for cid in P.columns:
        p = P[cid].dropna()
        if len(p) < 260:
            continue
        r = p.pct_change().dropna()
        r2 = r.iloc[-MODEL_WINDOW:]
        vol = r2.std() * math.sqrt(252)
        mu = r2.mean() * 252
        dn = r2[r2 < 0].std() * math.sqrt(252)
        dd = (p / p.cummax() - 1).iloc[-MODEL_WINDOW:].min()
        var95 = -np.percentile(r2, 5)
        cvar95 = -r2[r2 <= -var95].mean()
        mom = p.iloc[-22] / p.iloc[-253] - 1 if len(p) > 253 else None
        y = np.log(p.iloc[-126:].values)
        x = np.arange(len(y))
        slope, icpt = np.polyfit(x, y, 1)
        fit = icpt + slope * x
        trend_r2 = 1 - ((y - fit) ** 2).sum() / ((y - y.mean()) ** 2).sum()
        m = pd.concat([r2, mkt_ret], axis=1).dropna()
        beta = np.cov(m.iloc[:, 0], m.iloc[:, 1])[0, 1] / m.iloc[:, 1].var() if len(m) > 100 else None
        jensen = (mu - RF - beta * (m.iloc[:, 1].mean() * 252 - RF)) if beta is not None else None
        try:
            am = arch_model(r2 * 100, vol="GARCH", p=1, q=1, dist="t", rescale=False)
            fr = am.fit(disp="off", show_warning=False)
            gvol = math.sqrt(fr.forecast(horizon=1).variance.values[-1, 0]) / 100 * math.sqrt(252)
            persist = fr.params.get("alpha[1]", 0) + fr.params.get("beta[1]", 0)
        except Exception:
            gvol, persist = None, None
        out[cid] = dict(
            vol=_f(vol), garch_vol=_f(gvol), garch_persist=_f(persist, 3),
            beta=_f(beta, 3), jensen_alpha=_f(jensen), sharpe=_f((mu - RF) / vol if vol else None, 2),
            sortino=_f((mu - RF) / dn if dn else None, 2), max_dd=_f(dd), var95=_f(var95), cvar95=_f(cvar95),
            mom_12_1=_f(mom), trend_slope_ann=_f(math.exp(slope * 252) - 1), trend_r2=_f(trend_r2, 3),
            above_50dma=bool(p.iloc[-1] > p.iloc[-50:].mean()), above_200dma=bool(p.iloc[-1] > p.iloc[-200:].mean()),
        )
    return out


def run(companies, edges, log=print):
    log("quant: downloading 3y prices + macro factors…")
    P, fac = load_prices(companies)
    P = P.dropna(axis=1, how="all")
    mkt_px = fac["^NSEI"].dropna()
    idx = mkt_px.index
    P = P.reindex(idx)
    R = P.pct_change(fill_method=None)
    F = build_factors(fac, idx)
    log("quant: factor models…")
    fm, resid = factor_model(R, F)
    log("quant: event studies…")
    ev = event_study(R, F["MKT"])
    sc = scenarios(fm)
    log("quant: geopolitical scores + network diffusion…")
    geo = geo_scores(ev, sc, companies, edges)
    log("quant: residual similarity + clustering…")
    sim, clus, C = similarity(resid, R)
    log("quant: edge evidence (Granger)…")
    edg = edge_evidence(edges, resid, C)
    log("quant: risk / GARCH…")
    rk = risk(P, F["MKT"].iloc[-MODEL_WINDOW:])

    # segment-level event CARs (cross-sectional mean & t)
    seg_ev = {}
    for e in EVENTS:
        by = {}
        for cid, d in ev.items():
            if e["id"] in d and d[e["id"]]["car"] is not None:
                by.setdefault(companies[cid]["seg"], []).append(d[e["id"]]["car"])
        for seg, v in by.items():
            v = np.array(v)
            t = v.mean() / (v.std(ddof=1) / math.sqrt(len(v))) if len(v) > 2 and v.std(ddof=1) > 0 else None
            seg_ev.setdefault(seg, {})[e["id"]] = dict(car=_f(v.mean()), t=_f(t, 2), n=len(v))

    return dict(
        asof=str(idx[-1].date()),
        factors={k: v[3] for k, v in FACTORS.items()},
        events=EVENTS, scenarios=SCENARIOS,
        factor_model=fm, event_study=ev, scenario=sc, geo=geo,
        similar=sim, cluster=clus, edges=edg, risk=rk, segment_events=seg_ev,
        params=dict(model_window=MODEL_WINDOW, net_alpha=NET_ALPHA, rf=RF),
    )
