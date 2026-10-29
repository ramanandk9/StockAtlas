"""Package the committed snapshot. No market downloads or model runs at build time."""
from pathlib import Path
import json
import shutil

if __name__ == '__main__':
    root = Path(__file__).resolve().parent
    source = root / 'site'
    required = ['index.html', 'research.html', 'data/research.json', 'manifest.json']
    for filename in required:
        if not (source / filename).is_file():
            raise SystemExit(f'Missing site/{filename}. Generate and commit a snapshot with scripts/export_site.py.')
    manifest = json.loads((source / 'manifest.json').read_text())
    if manifest['companies'] < 1:
        raise SystemExit('Refusing to build an empty research publication.')
    output = root / 'public'
    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(source, output)
    shutil.copytree(root / 'static', output / 'static')
    print(f"Static StockAtlas: {manifest['companies']} companies; prices through {manifest['priceAsOf']}")
