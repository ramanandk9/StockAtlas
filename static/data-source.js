/* The static publication reads immutable JSON. Local Flask keeps its API. */
(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  let bundlePromise;
  const companyPromises = new Map();
  const load = async url => {
    const response = await nativeFetch(url);
    if (!response.ok) throw Error(`Snapshot file unavailable: ${url}`);
    return response.json();
  };
  const bundle = () => bundlePromise ||= load('/data/research.json');
  const company = id => {
    if (!companyPromises.has(id)) {
      companyPromises.set(id, load(`/data/companies/${encodeURIComponent(id)}.json`).catch(error => {
        companyPromises.delete(id); throw error;
      }));
    }
    return companyPromises.get(id);
  };
  const scope = (rows, params) => rows.filter(row => {
    const segment = params.get('seg');
    return segment && segment !== 'all' ? row.seg === segment : !params.get('sector') || row.sector === params.get('sector');
  });
  const rounded = (v, n = 4) => Number(v.toFixed(n));

  function pathSearch(atlas, params) {
    const nodes = new Map(atlas.nodes.map(n => [n.id, n]));
    const source = params.get('source'), target = params.get('target');
    const directed = params.get('directed') === 'true', type = params.get('type') || 'all';
    if (!nodes.has(source) || !nodes.has(target) || (type !== 'all' && !Object.hasOwn(atlas.types, type))) throw Error('Invalid connection search');
    const adjacency = new Map();
    const add = (a, b, edge) => { if (!adjacency.has(a)) adjacency.set(a, []); adjacency.get(a).push([b, edge]); };
    for (const edge of atlas.edges) {
      if (type !== 'all' && edge.type !== type) continue;
      add(edge.source, edge.target, edge);
      if (!directed || edge.type === 'partner') add(edge.target, edge.source, edge);
    }
    const previous = new Map([[source, null]]), queue = [source];
    for (let i = 0; i < queue.length && !previous.has(target); i++) {
      for (const [next, edge] of adjacency.get(queue[i]) || []) {
        if (previous.has(next)) continue;
        previous.set(next, [queue[i], edge]); queue.push(next);
      }
    }
    if (!previous.has(target)) return {found: false, nodes: [], edges: [], directed};
    const chain = [target], edges = [];
    let cursor = target;
    while (previous.get(cursor)) {
      const [parent, edge] = previous.get(cursor);
      edges.push(edge); chain.push(parent); cursor = parent;
    }
    return {found: true, nodes: chain.reverse().map(id => nodes.get(id)), edges: edges.reverse(), directed};
  }

  function nodeDetails(data, id) {
    const byId = new Map(data.companies.map(n => [n.id, n]));
    for (const n of data.atlas.nodes) if (!byId.has(n.id)) byId.set(n.id, {...n, category: n.segment});
    if (!byId.has(id)) throw Error('Unknown organisation');
    const rows = data.atlas.edges.filter(e => e.source === id || e.target === id).flatMap(e => {
      const edge = {...e, typeLabel: data.atlas.types[e.type], evidence: data.edgeEvidence[e.id] || null};
      const result = [];
      if (e.target === id) result.push({dir: 'in', other: byId.get(e.source), edge});
      if (e.source === id) result.push({dir: 'out', other: byId.get(e.target), edge});
      return result;
    });
    return {node: byId.get(id), rows, peers: (data.peers[id] || []).map(p => ({...byId.get(p), rcorr: (data.similar[id] || []).find(x => x[0] === p)?.[1] ?? null})), geo: data.geo[id] || null};
  }

  function impact(data, params) {
    const kind = params.get('kind') || 'scenario';
    let shocks;
    if (kind === 'custom') {
      shocks = Object.fromEntries(Object.keys(data.model.factors || {}).filter(k => params.has(k)).map(k => [k, Number(params.get(k))]));
      if (Object.values(shocks).some(v => !Number.isFinite(v))) throw Error('Invalid shock');
    } else shocks = (data.model.scenarios.find(s => s.id === params.get('id')) || data.model.scenarios[0])?.shocks || {};
    const rows = [];
    for (const row of scope(data.companies, params)) {
      let result;
      if (kind === 'event') {
        const event = data.eventStudy[row.id]?.[params.get('id')];
        if (event?.car != null) result = {impact: event.car, t: event.t};
      } else {
        const f = data.factorModels[row.id];
        if (!f) continue;
        const contributions = Object.entries(shocks).map(([k, v]) => [k, ((f.betas[k] || 0) - (k === 'MKT' ? 1 : 0)) * v]);
        const driver = contributions.reduce((best, current) => !best || Math.abs(current[1]) > Math.abs(best[1]) ? current : best, null)?.[0] || null;
        const total = Object.entries(shocks).reduce((sum, [k,v]) => sum + (f.betas[k] || 0) * v, 0) - (shocks.MKT || 0);
        result = {impact: rounded(total), driver, driverT: f.tstats[driver] ?? null, r2: f.r2};
      }
      if (result) { const {spark, ...brief} = row; rows.push({...brief, ...result}); }
    }
    rows.sort((a,b) => b.impact - a.impact);
    const segments = new Map();
    for (const row of rows) { if (!segments.has(row.segName)) segments.set(row.segName, []); segments.get(row.segName).push(row.impact); }
    return {rows, segments: [...segments].map(([name, v]) => [name, rounded(v.reduce((a,b)=>a+b,0)/v.length), v.length]).sort((a,b)=>b[1]-a[1]), factors: data.model.factors};
  }

  const weekStart = date => {
    const day = new Date(date + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
    return day.toISOString().slice(0,10);
  };
  function seriesFor(history, weekly) {
    const map = new Map();
    history.dates.forEach((date,i) => map.set(weekly ? weekStart(date) : date, history.close[i]));
    return map;
  }
  async function historyData(id, params) {
    const ids = [id, ...new Set((params.get('compare') || '').split(',').filter(Boolean).filter(c => c !== id))].slice(0,7);
    const data = await bundle();
    const known = new Set(data.companies.map(c => c.id));
    const validIds = ids.filter(cid => known.has(cid));
    const period = params.get('period') || '1y';
    const days = {'1mo':31,'3mo':92,'6mo':183,'1y':366,'2y':731,'5y':1827,max:Infinity}[period];
    if (days == null) throw Error('Invalid history period');
    const weekly = period === '5y' || period === 'max';
    const histories = await Promise.all(validIds.map(async cid => [cid, (await company(cid)).history]));
    const maps = new Map(histories.map(([cid,h]) => [cid, seriesFor(h, weekly)]));
    const allDates = [...new Set([...maps.values()].flatMap(m => [...m.keys()]))].sort();
    const mainHistory = histories.find(([cid]) => cid === id)?.[1];
    const lastDate = mainHistory?.dates.at(-1);
    const anchor = lastDate ? new Date(lastDate + 'T00:00:00Z').getTime() : 0;
    const cutoff = Number.isFinite(days) ? new Date(anchor - days * 86400000).toISOString().slice(0,10) : '';
    const dates = allDates.filter(date => date >= cutoff && (!lastDate || date <= lastDate));
    const filled = new Map();
    for (const [cid,map] of maps) {
      let previous = null;
      filled.set(cid, allDates.map(date => { if (map.has(date)) previous = map.get(date); return previous; }));
    }
    const indexes = dates.map(date => allDates.indexOf(date));
    const main = filled.get(id) || [];
    const average = length => {
      let total = 0, valid = 0;
      return main.map((v,i) => {
        if (v != null) {total += v; valid++;}
        if (i >= length && main[i-length] != null) {total -= main[i-length]; valid--;}
        return valid === length ? rounded(total/length,2) : null;
      });
    };
    const average50 = average(weekly ? 10 : 50), average100 = average(weekly ? 20 : 100);
    return {dates, series: Object.fromEntries([...filled].map(([cid,values])=>[cid,indexes.map(i=>values[i])])),
      sma50: indexes.map(i=>average50[i]), sma100: indexes.map(i=>average100[i])};
  }

  async function json(url) {
    const parsed = new URL(url, location.origin);
    const route = parsed.pathname, params = parsed.searchParams;
    const data = await bundle();
    if (route === '/api/atlas') return data.atlas;
    if (route === '/api/tree') return data.tree;
    if (route === '/api/freshness') return data.freshness;
    if (route === '/api/model') return data.model;
    if (route === '/api/companies') return scope(data.companies, params);
    if (route === '/api/paths') return pathSearch(data.atlas, params);
    if (route === '/api/impact') return impact(data, params);
    if (route === '/api/eventgrid') return scope(data.companies, params).map(c => ({id:c.id, name:c.name, mcap:c.mcap, ev:data.eventStudy[c.id] || {}})).sort((a,b)=>(b.mcap||0)-(a.mcap||0));
    if (route === '/api/news') return {items: [], note: 'Live news is not included in this published snapshot. Visit the original news provider for current headlines.'};
    const match = route.match(/^\/api\/(node|company|info|financials|history)\/(.+)$/);
    if (match) {
      const [,type,encoded] = match, id = decodeURIComponent(encoded);
      if (type === 'node') return nodeDetails(data,id);
      if (type === 'history') return historyData(id,params);
      return (await company(id))[type];
    }
    throw Error('This action requires the local data-generation program.');
  }
  window.StockAtlasData = {
    json: url => window.STOCKATLAS_STATIC ? json(url) : nativeFetch(url).then(r => { if(!r.ok) throw Error(`${url} ${r.status}`); return r.json(); }),
    fetch: async (url, options) => {
      if (!window.STOCKATLAS_STATIC) return nativeFetch(url, options);
      try {
        if (options?.method && options.method !== 'GET') throw Error('Published snapshots are read-only.');
        return new Response(JSON.stringify(await json(url)), {headers: {'Content-Type':'application/json'}});
      } catch (error) { return new Response(JSON.stringify({error:error.message}), {status: 400, headers:{'Content-Type':'application/json'}}); }
    }
  };
})();
