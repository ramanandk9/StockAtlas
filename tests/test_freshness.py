import unittest
from unittest.mock import patch
import app


class FreshnessTests(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    def test_freshness_reports_real_data_dates_without_downloading(self):
        cached = {'metrics': {'TCS': {'asof': '2026-10-28'}, 'INFY': {'asof': '2026-10-29'}}, 'ts': 12345}
        with patch.dict(app._mem, {'snap': (12345, cached)}, clear=True), \
             patch.dict(app.MODEL, {'data': {'asof': '2026-10-28', 'computed_at': 12000}}), \
             patch.dict(app.REFRESH_STATE, {'status': 'idle', 'running': False}, clear=True), \
             patch.object(app, '_disk_get', return_value=None), \
             patch.object(app, '_fetch_snapshot', side_effect=AssertionError('Should not download')):
            data = self.client.get('/api/freshness').get_json()
        self.assertEqual(data['priceAsOf'], '2026-10-29')
        self.assertEqual(data['oldestPriceAsOf'], '2026-10-28')
        self.assertEqual(data['modelsAsOf'], '2026-10-28')
        self.assertEqual(data['pricesFetchedAt'], 12345)
        self.assertEqual(data['modelsComputedAt'], 12000)

    def test_public_requests_cannot_trigger_refresh(self):
        with patch.object(app.threading, 'Thread') as thread:
            response = self.client.post('/api/refresh', environ_overrides={'REMOTE_ADDR': '203.0.113.1'})
        self.assertEqual(response.status_code, 403)
        thread.assert_not_called()

    def test_duplicate_refresh_does_not_spawn_another_worker(self):
        with patch.dict(app.REFRESH_STATE, {'running': True, 'status': 'running'}), \
             patch.object(app.threading, 'Thread') as thread:
            response = self.client.post('/api/refresh')
        self.assertEqual(response.status_code, 202)
        thread.assert_not_called()


if __name__ == '__main__':
    unittest.main()
