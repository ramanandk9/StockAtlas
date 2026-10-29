"""Preview exported files with clean /research URLs; no application/API is loaded."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse


class StaticHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path, separator, query = self.path.partition('?')
        if path.rstrip('/') == '/research':
            self.path = '/research.html' + (separator + query if separator else '')
        super().do_GET()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=5078)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / 'public'
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(StaticHandler, directory=str(root)))
    print(f'Static files only: http://127.0.0.1:{args.port}', flush=True)
    server.serve_forever()
