# StockAtlas

An Indian business relationship explorer: see who supplies a company, who receives its services, who invests in it and which organisations it partners with.

## Run locally

Python 3.10+:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

Open http://127.0.0.1:5000. `PORT` changes the port. The relationship explorer works without a live market feed; financial and model features require internet access. Models compute in the background and their cache expiry is checked every minute. The default model cache lifetime is 12 hours.

## Explore

- Search any company, ticker, external organisation or market group. Press `/` to focus search; arrow keys and Enter select a suggestion.
- Click map cards to focus another organisation. Previous retraces the exploration.
- Filter supplies, services, ownership and partnerships, then choose incoming, outgoing or both sides.
- Read the connection list and open a relationship for its full description.
- Use **Find a connection** to trace the shortest chain between two organisations. **Follow arrows only** respects direction; partnerships are mutual.
- Save organisations using the star. Saves are local to the current browser.
- Copy a shareable organisation view with **Share this view**.
- Open **Markets & research** for the retained financial, news and model workspace.

## Data and interpretation

`data/universe.py` merges the curated sector files. Edge tuples are `(source, target, type, description)`. Arrows follow goods, services or capital. Partnerships are mutual for exploration. The graph currently covers 497 listed companies, 367 external organisations and 1,507 relationships across 11 sectors.

The dataset has no per-edge source citations, last-verified dates or dependency weights. Some relationships refer to historical transactions, broad client groups or ecosystem ties. Counts measure recorded coverage, not economic importance. A path through a shared customer is a connection, not proof of revenue concentration or causal shock propagation. Check current company filings before drawing investment conclusions.

The local generator obtains market prices from Yahoo Finance via yfinance and stores prices and computed models under `cache/`. The hosted publication reads exported JSON under `site/data/`. The structural API deliberately makes no market-data requests.

## Code

- `app.py`: Flask routes, market-data caching, models and graph path traversal.
- `static/atlas.js`, `static/atlas.css`: dependency explorer, directory, saved organisations, path finder and guide.
- `templates/index.html`: accessible application shell.
- `templates/research.html`: retained market research workspace.
- `quant.py`: factor models, event studies, scenarios, similarity and risk.
- `tests/test_atlas.py`: offline graph and route checks.

```bash
.venv/bin/python -m unittest discover -s tests -v
node --check static/atlas.js
```

For local live research, run `app.py` for the complete background model lifecycle. Importing `app:app` into a separate WSGI server does not start the background workers; configure those separately if changing deployment.

## Public access

### Vercel: static publication

Vercel serves the committed `site/` publication as HTML, JavaScript and JSON. Research does **not** invoke Flask, yfinance or the mathematical models when someone opens a page. The build uses only Python's standard library to copy the publication and assets into `public/`. `vercel.json` selects the Other preset (`framework: null`), sets `outputDirectory: public`, enables clean `/research` URLs, and keeps the Mumbai (`bom1`) region preference. Static assets are delivered through Vercel's CDN; there is no application function to run in Mumbai.

Import the repository root into Vercel and redeploy the latest commit. Remove any old dashboard override that still forces a Flask build. The repository defines the build command and output directory. No start command, server credentials or runtime Python environment are needed.

The published snapshot contains 497 companies, 496 annual financial records and price histories for all 497 companies (up to five years). Dates and missing records are retained. Screener filters, saved companies, relationships, pathfinding, financials, risk results, event studies and predefined/custom scenarios work in the browser using exported data. Company files load on demand. Custom scenario rankings are calculated from the precomputed betas and checked against the original Python results.

Published data is read-only and updates when a new snapshot is committed and deployed. Live headlines, live quotes and server-side event editing are not part of the static publication. The page explains these limits. Chart.js is loaded from its CDN for charts.

To publish the current local calculations without downloading again:

```bash
.venv/bin/python scripts/export_site.py
python3 vercel_build.py
python3 scripts/serve_static.py --port 5078
```

For the first export, create the price-history archive with `--download-history`. To fetch new data, rerun every model, update history, and export:

```bash
.venv/bin/python scripts/export_site.py --refresh --download-history
.venv/bin/python -m unittest discover -s tests -v
python3 vercel_build.py
```

Commit `site/` together with source changes and push. Vercel's build never contacts Yahoo or recomputes models. Cache files remain local and ignored; only the explicit publication under `site/` is tracked. Export aborts when required caches/history are missing or models do not match the current company graph. `site/manifest.json` records dates and coverage. `tests/test_static_export.py` checks the browser adapter with all API requests forbidden and compares scenario/event rankings to Python.

Existing `start_public.sh` and `stop_public.sh` scripts manage a local process and Cloudflare quick tunnel. They require `bin/cloudflared`. Set `ADMIN_TOKEN` for event edits through the tunnel. The redesign itself does not open a tunnel or deploy the application.

## Welcome and bookmarks

The default home (`/#welcome`) explains the application, map directions, research tools, bookmarks, sources and limitations. Both the StockAtlas name and TMRM mark link there. The roadmap distinguishes planned capabilities, including scheduled daily updates and live feeds, from the current implementation. Research's **How to use** link opens the same reference.

Research pages and screener rows have save stars. Saved listed companies offer **Relations** and **Research** actions; external organisations have relationship exploration only. The shared menu synchronises bookmark counts across views and browser tabs using `atlas.saved`.

## Data refresh status

`GET /api/freshness` reports cached price dates, download timestamps, model data dates, computation timestamps, and refresh coverage without triggering downloads. The shared menu highlights the update date and shows progress or partial coverage.

`POST /api/refresh` forces a price download, refreshes fundamentals and statements for every company, reruns all quantitative models and invalidates history/news caches. It is restricted to the existing local/admin edit policy. Concurrent requests reuse the active refresh. Failed provider records retain prior data and the final status explicitly reports partial coverage. Model computations are serialised. This endpoint is a manual refresh mechanism, not an automatic daily scheduler or a streaming quote feed.

The header and favicon reuse the original SVG mark from [tmrm.in](https://tmrm.in/). Copyright credit: The Meta Research Matrix.
