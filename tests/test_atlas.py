"""Offline checks for the relationship explorer's graph contract."""
import unittest
from unittest.mock import patch
import app


class AtlasTests(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    def test_atlas_is_independent_of_market_downloads(self):
        with patch.object(app, 'snapshot', side_effect=AssertionError('No market data needed')):
            response = self.client.get('/api/atlas')
        self.assertEqual(response.status_code, 200)
        graph = response.get_json()
        ids = {n['id'] for n in graph['nodes']}
        self.assertEqual(len(ids), len(app.CO) + len(app.ENT))
        self.assertTrue(all(e['source'] in ids and e['target'] in ids for e in graph['edges']))

    def test_direction_and_mutual_partnerships(self):
        # Fixture isolates traversal semantics from incidental paths in curated data.
        edges = [('TCS', 'INFY', 'supply', 'Fixture supply'),
                 ('INFY', 'WIPRO', 'partner', 'Fixture partnership')]
        with patch.object(app, 'EDGES', edges):
            forward = self.client.get('/api/paths?source=TCS&target=WIPRO&directed=true').get_json()
            self.assertEqual([n['id'] for n in forward['nodes']], ['TCS', 'INFY', 'WIPRO'])
            reverse = self.client.get('/api/paths?source=WIPRO&target=TCS&directed=true').get_json()
            self.assertFalse(reverse['found'])
            mutual = self.client.get('/api/paths?source=WIPRO&target=INFY&directed=true').get_json()
            self.assertTrue(mutual['found'])
            undirected = self.client.get('/api/paths?source=WIPRO&target=TCS').get_json()
            self.assertTrue(undirected['found'])
            self.assertEqual(undirected['edges'][1]['source'], 'TCS')

    def test_shortest_path_and_type_filter(self):
        edges = [('TCS', 'INFY', 'supply', 'a'), ('INFY', 'WIPRO', 'supply', 'b'),
                 ('TCS', 'WIPRO', 'invest', 'c')]
        with patch.object(app, 'EDGES', edges):
            self.assertEqual(len(self.client.get('/api/paths?source=TCS&target=WIPRO').get_json()['edges']), 1)
            self.assertEqual(len(self.client.get('/api/paths?source=TCS&target=WIPRO&type=supply').get_json()['edges']), 2)

    def test_invalid_and_identical_nodes(self):
        self.assertEqual(self.client.get('/api/paths?source=unknown&target=TCS').status_code, 400)
        self.assertEqual(self.client.get('/api/paths?source=TCS&target=INFY&type=unknown').status_code, 400)
        result = self.client.get('/api/paths?source=TCS&target=TCS').get_json()
        self.assertTrue(result['found'])
        self.assertEqual(result['edges'], [])

    def test_home_and_research(self):
        self.assertIn(b'StockAtlas', self.client.get('/').data)
        self.assertEqual(self.client.get('/research').status_code, 200)


if __name__ == '__main__':
    unittest.main()
