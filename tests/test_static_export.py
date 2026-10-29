"""Verify the publication and browser adapter against the Python model route."""
import json
from pathlib import Path
import shutil
import subprocess
import unittest
from unittest.mock import patch
import app

ROOT = Path(__file__).resolve().parents[1]


class StaticExportTests(unittest.TestCase):
    def test_published_snapshot_and_browser_contract(self):
        data = json.loads((ROOT / 'site/data/research.json').read_text())
        self.assertEqual(len(data['companies']), len(app.CO))
        self.assertFalse(data['model']['canEdit'])
        self.assertTrue(data['freshness']['staticSnapshot'])
        for filename in ['index.html', 'research.html']:
            html = (ROOT / 'site' / filename).read_text()
            self.assertNotIn('{{', html)
            self.assertIn('window.STOCKATLAS_STATIC = true', html)
        by_id = {c['id']: c for c in data['companies']}
        models = {'factor_model': data['factorModels'], 'event_study': data['eventStudy']}
        scenarios = data['model']['scenarios']
        event = data['model']['events'][0]['id']
        urls = [f"/api/impact?kind=scenario&id={s['id']}" for s in scenarios]
        urls += ['/api/impact?kind=custom&MKT=-0.05&OIL=0.1&INR=0.03',
                 '/api/impact?kind=custom&MKT=0.02&sector=Information%20Technology',
                 f'/api/impact?kind=event&id={event}']
        fixtures = []
        with patch.dict(app.MODEL, {'data': models}), patch.object(app, 'brief', side_effect=lambda cid: dict(by_id[cid])):
            client = app.app.test_client()
            for url in urls:
                response = client.get(url)
                self.assertEqual(response.status_code, 200)
                fixtures.append({'url': url, 'data': response.get_json()})
        if not shutil.which('node'):
            self.skipTest('Node is required for browser data contract checks')
        result = subprocess.run(['node', str(ROOT / 'tests/static-data.test.js')],
                                input=json.dumps(fixtures), text=True, capture_output=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        print(result.stdout.strip())


if __name__ == '__main__':
    unittest.main()
