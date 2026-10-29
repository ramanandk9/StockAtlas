"""Export cached research as a static site. Network access is opt-in."""
import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import sys
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app as backend


def read_cache(name):
    path = Path(backend.CACHE_DIR) / name
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run the local data refresh before exporting.")
    return json.loads(path.read_text())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(',', ':'), ensure_ascii=False, allow_nan=False))


def download_history():
    """Fetch a five-year archive once; page visits never download from Yahoo."""
    import pandas as pd
    import yfinance as yf
    path = Path(backend.CACHE_DIR) / 'history_export.json'
    previous = json.loads(path.read_text()) if path.exists() else {}
    companies = list(backend.CO)
    for offset in range(0, len(companies), 60):
        ids = companies[offset:offset + 60]
        raw = yf.download([backend.CO[c]['sym'] for c in ids], period='5y', interval='1d',
                          auto_adjust=True, progress=False, threads=5)['Close']
        if isinstance(raw, pd.Series):
            raw = raw.to_frame(backend.CO[ids[0]]['sym'])
        for cid in ids:
            series = raw.get(backend.CO[cid]['sym'])
            if series is None or len(series.dropna()) < 2:
                continue  # preserve prior records when the provider has a gap
            series = series.dropna()
            previous[cid] = dict(dates=[str(d.date()) for d in series.index],
                                 close=[round(float(v), 4) for v in series], fetchedAt=time.time())
        write_json(path, previous)
        print(f"History: {min(offset + 60, len(companies))}/{len(companies)} processed", flush=True)
    return previous


def export(destination):
    snap, models = read_cache('snapshot2.json'), read_cache('models.json')
    info, financials = read_cache('info.json'), read_cache('fin.json')
    if set(models.get('universe', [])) != set(backend.CO) or models.get('graph_sig') != backend.GRAPH_SIG:
        raise SystemExit('Models do not match the current company universe/graph. Recalculate before exporting.')
    if not any(m and m.get('price') is not None for m in snap.get('metrics', {}).values()):
        raise SystemExit('Price cache has no usable records.')
    history_path = Path(backend.CACHE_DIR) / 'history_export.json'
    histories = json.loads(history_path.read_text()) if history_path.exists() else {}
    if not histories:
        raise SystemExit('No price history archive. Run export_site.py --download-history first.')
    destination.mkdir(parents=True, exist_ok=True)
    client = backend.app.test_client()

    def api(path):
        response = client.get(path, environ_overrides={'REMOTE_ADDR': '203.0.113.1'})
        if response.status_code != 200:
            raise RuntimeError(f'Export failed for {path}: {response.status_code}')
        return response.get_json()

    # Cached export must never start downloads or recompute models as a side effect.
    with ExitStack() as stack:
        stack.enter_context(patch.object(backend, 'snapshot', return_value=snap))
        stack.enter_context(patch.object(backend, 'info', side_effect=lambda cid, **_: info.get(cid, {})))
        stack.enter_context(patch.object(backend, 'fin', side_effect=lambda cid, **_: financials.get(cid, {})))
        stack.enter_context(patch.object(backend, '_bg_once', side_effect=RuntimeError('Unexpected background download')))
        stack.enter_context(patch.dict(backend._mem, {'info': info, 'fin': financials, 'snap': (time.time(), snap)}, clear=True))
        stack.enter_context(patch.dict(backend.MODEL, {'status': 'ready', 'data': models, 'running': False, 'error': None}))
        bundle = dict(version=1, exportedAt=time.time(), atlas=api('/api/atlas'),
                      tree=api('/api/tree'), companies=api('/api/companies'), model=api('/api/model'),
                      freshness=api('/api/freshness'), factorModels=models.get('factor_model', {}),
                      eventStudy=models.get('event_study', {}), geo=models.get('geo', {}),
                      edgeEvidence=models.get('edges', {}), similar=models.get('similar', {}), peers={c: sorted(p) for c, p in backend.PEERS.items()})
        bundle['model'].update(canEdit=False, staticSnapshot=True)
        bundle['freshness'].update(staticSnapshot=True, exportedAt=bundle['exportedAt'])
        write_json(destination / 'data' / 'research.json', bundle)
        for cid in backend.CO:
            write_json(destination / 'data' / 'companies' / f'{cid}.json', dict(
                company=api('/api/company/' + cid), info=api('/api/info/' + cid),
                financials=financials.get(cid, {}), history=histories.get(cid, dict(dates=[], close=[]))))
        with backend.app.test_request_context('/'):
            for template, filename in [('index.html', 'index.html'), ('research.html', 'research.html')]:
                html = backend.render_template(template, static_export=True)
                (destination / filename).write_text("\n".join(line.rstrip() for line in html.splitlines()) + "\n")
        manifest = dict(exportedAt=bundle['exportedAt'], priceAsOf=bundle['freshness']['priceAsOf'],
                        modelsAsOf=models.get('asof'), companies=len(backend.CO),
                        fundamentals=len(info), financials=len(financials), histories=len(histories),
                        historyWindow='5y', missingHistories=[c for c in backend.CO if c not in histories])
        write_json(destination / 'manifest.json', manifest)
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true', help='Fetch fresh fundamentals/prices and rerun all models before exporting')
    parser.add_argument('--download-history', action='store_true', help='Download five years of prices before exporting')
    parser.add_argument('--output', type=Path, default=ROOT / 'site')
    args = parser.parse_args()
    if args.refresh:
        backend._refresh_status(running=True, status='running', startedAt=time.time(), phase='Starting publication refresh')
        backend.refresh_all_data()
        if not backend.REFRESH_STATE.get('pricesUpdated') or not backend.REFRESH_STATE.get('modelsUpdated'):
            raise SystemExit('Refresh did not produce fresh prices and models; publication aborted.')
    if args.download_history:
        download_history()
    export(args.output)
