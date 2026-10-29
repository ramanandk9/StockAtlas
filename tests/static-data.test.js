/* Contract checks run against exported files, with all /api requests forbidden. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const site = path.join(root, 'site');
const input = fs.readFileSync(0, 'utf8');
const expected = input ? JSON.parse(input) : [];
const requested = [];
const window = {
  STOCKATLAS_STATIC: true,
  fetch: async url => {
    assert(!url.startsWith('/api/'), 'Static UI must never request an API');
    requested.push(url);
    const filename = path.join(site, decodeURIComponent(url));
    try { return new Response(fs.readFileSync(filename), {headers:{'Content-Type':'application/json'}}); }
    catch { return new Response('missing', {status:404}); }
  }
};
vm.runInNewContext(fs.readFileSync(path.join(root,'static/data-source.js'),'utf8'), {window,location:{origin:'http://snapshot.test'},URL,Response,console});
const json = url => window.StockAtlasData.json(url);
const normalized = value => JSON.parse(JSON.stringify(value));
const near = (a,b) => Math.abs(a-b) < 1e-7;
(async () => {
  const companies = await json('/api/companies');
  assert.equal(companies.length,497);
  assert(companies.filter(c => c.price != null).length > 450);
  const sector = companies[0].sector;
  assert((await json('/api/companies?sector='+encodeURIComponent(sector))).every(c=>c.sector===sector));
  const company = await json('/api/company/TCS');
  const info = await json('/api/info/TCS');
  assert.equal(company.id,'TCS');
  assert(info.marketCap > 0);
  assert((await json('/api/financials/TCS')).years.length > 1);
  assert.equal((await json('/api/model')).canEdit,false);
  assert.equal((await json('/api/model')).status,'ready');
  assert.equal((await json('/api/freshness')).staticSnapshot,true);
  const node = await json('/api/node/TCS');
  assert(node.rows.some(r=>r.other.id==='x:BSNL'));
  const pathResult = await json('/api/paths?source=TEJASNET&target=x%3ABSNL&directed=true');
  assert(pathResult.found);
  assert.deepEqual(normalized(pathResult.nodes.map(n=>n.id)), ['TEJASNET','x:BSNL']);
  assert.equal((await json('/api/paths?source=TCS&target=TCS')).edges.length,0);
  await assert.rejects(()=>json('/api/paths?source=UNKNOWN&target=TCS'));
  for(const period of ['1mo','3mo','6mo','1y','2y','5y','max']) {
    const result = await json(`/api/history/TCS?period=${period}&compare=INFY,WIPRO`);
    assert(result.dates.length > 5);
    for (const values of Object.values(result.series)) assert.equal(values.length,result.dates.length);
    assert.equal(result.sma50.length,result.dates.length);
    assert(result.series.TCS.some(v=>v>0));
    assert(result.sma50.some(v=>v>0));
  }
  const history = await json('/api/history/TCS?period=max');
  const oneMonth = await json('/api/history/TCS?period=1mo');
  assert(history.dates[0] < oneMonth.dates[0]);
  const file = JSON.parse(fs.readFileSync(path.join(site,'data/companies/TCS.json')));
  assert.equal(oneMonth.series.TCS.at(-1),file.history.close.at(-1));
  const marketNews = await json('/api/news?topic=market');
  assert(marketNews.note.includes('snapshot'));
  assert.equal((await window.StockAtlasData.fetch('/api/events',{method:'POST'})).status,400);
  // Compare scenario/custom-shock/event answers to the original Python route.
  for (const fixture of expected) {
    const actual = await json(fixture.url);
    assert.equal(actual.rows.length,fixture.data.rows.length,fixture.url);
    actual.rows.forEach((row,i)=> {
      const expectedRow = fixture.data.rows[i];
      assert.equal(row.id, expectedRow.id,fixture.url);
      assert(near(row.impact,expectedRow.impact),fixture.url);
      assert.equal(row.driver ?? null,expectedRow.driver ?? null);
    });
    assert.deepEqual(normalized(actual.segments),fixture.data.segments);
  }
  assert(requested.every(url=>url.endsWith('.json')));
  console.log(`Static contracts passed: ${companies.length} companies, charts, paths, scopes, models and ${expected.length} Python scenario comparisons; zero API calls.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
