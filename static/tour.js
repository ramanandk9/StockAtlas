/* Guided walkthrough. Asked on every page load; can be restarted with the "Tour" button.
   Each step: {title, text, el: selector | () => Element | null (centred), before: async () => {...}}.
   Steps that need a particular screen switch to it themselves, so Back/Next work from anywhere. */
(function(){
  const DEMO = 'TATASTEEL';                     // stock used to demonstrate the analysis screen
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const card = txt => [...document.querySelectorAll('.card h3')].find(h => h.textContent.trim().startsWith(txt))?.closest('.card');

  async function ensureList(){
    if(S.view !== 'list' || !document.querySelector('tbody tr[data-cid]')){
      S.view = 'list'; S.seg = null; S.sector = null; leaveEntry(); setHash(null); renderTree(); await loadList();
    }
  }
  async function ensureDemo(){ if(!(S.view === 'detail' && cur?.id === DEMO)) await openCompany(DEMO); }

  const STEPS = [
    {title: 'Welcome to India Market Map 👋', el: null,
     text: 'This site maps about 500 listed Indian companies across IT, electronics, autos, banks, energy, defence, consumer, agriculture and more. It shows <b>who depends on whom</b>, and uses statistical models to judge how each stock has handled <b>geopolitical shocks</b>. This tour takes about 2 minutes. Use <b>Next</b> / <b>Back</b> (or the ← → keys) and <b>Esc</b> to exit.'},
    {title: 'Sectors and segments', el: '#tree', before: ensureList,
     text: 'The left pane groups companies into <b>sectors</b> (bold), each split into <b>segments</b>. The number next to each name is the <b>median 1-year return</b>, a quick read on which parts of the market are rising or falling. Click a sector to expand it and list its companies.'},
    {title: 'Drill into a segment', el: () => document.querySelector('#tree .sector.open') || '#tree',
     before: async () => { await ensureList(); const s = document.querySelector('#tree [data-sector="Information Technology"]'); if(s && !document.querySelector('#tree .sector.open')) s.click(); await sleep(600); },
     text: 'Expanded sector: <i>Information Technology</i>. Its segments (Large / Mid / Small cap, ER&amp;D, Products…) each have their own median return. Clicking a segment narrows the list, the dependency map and the filters to it.'},
    {title: 'Search', el: '#q',
     text: 'Type a company name or NSE ticker (e.g. <i>TATA</i>, <i>HAL</i>). Suggestions from <b>all sectors</b> appear as you type, biggest companies first. ↑↓ + Enter opens one; Enter alone lists every match.'},
    {title: 'Sort and filter bar', el: '#toolbar', before: ensureList,
     text: 'The bar above the table sorts by <b>market cap</b> (default), P/E, ROE, ROCE, sales or profit growth, debt, dividend and more. You can also filter by ratio limits, e.g. P/E ≤ 25 and ROE ≥ 15%.'},
    {title: 'Geopolitical stance filter', el: '#f-geo', before: ensureList,
     text: '<b>Tailwind / Mixed / Headwind</b> is not an opinion. It comes from the model: how the stock actually reacted to real 2025 shocks (US tariffs, H-1B fee, India–Pakistan conflict, Russia-oil sanctions) plus macro stress tests, spread through its supply chain. Filter to see who has historically held up.'},
    {title: 'Size filter', el: '#f-cap', before: ensureList,
     text: 'Filter by market cap: Large ≥ ₹1 lakh Cr, Mid ≥ ₹30k Cr, Small ≥ ₹5k Cr, Micro below that. <b>Penny</b> = price under ₹25.'},
    {title: 'Three views', el: '.tabs', before: ensureList,
     text: '<b>List</b>: the stock table. <b>Dependency map</b>: explore supply chains freely. <b>Who benefits?</b>: rank companies by who gains or loses if crude, the rupee or trade conditions change. <b>News</b>: latest market headlines. <b>Model</b>: plain-language explanation plus a heatmap of how segments and companies reacted to each news event.'},
    {title: 'The stock table', el: 'thead', before: ensureList,
     text: 'Click a column header to sort too. The orange <b>NSE ↗</b> tag opens the stock\'s official NSE page. ▲/▼ next to 50D / 100D shows whether the price is above its 50- and 100-day averages. Any label with a <u style="text-decoration-style:dotted">dotted underline</u> explains itself on hover, and that works across the whole site.'},
    {title: 'Hover and click a row', el: () => document.querySelector('tbody tr[data-cid]'), before: ensureList,
     text: '<b>Hover</b> a row for a quick financial card (price, P/E, ROE, margins, volatility, geo score). <b>Click</b> a row to open its full analysis. Next, the tour opens Tata Steel as an example.'},
    {title: 'A stock screen', el: () => document.querySelector('.hdr'), before: ensureDemo,
     text: 'This is the full analysis for Tata Steel. Use <b>⚙ Customize screen</b> to hide, show or reorder every section; your layout is remembered for all stocks.'},
    {title: 'Back / Forward = undo / redo', el: '#navbar', before: ensureDemo,
     text: 'As you jump from stock to stock, <b>◀ Back</b> and <b>Forward ▶</b> step through the screens you opened, like undo/redo. The <b>History</b> trail lets you jump to any earlier one. Shortcuts: <b>Alt+←</b>, <b>Alt+→</b>, <b>Backspace</b>, or the browser Back button.'},
    {title: 'Key numbers', el: () => card('Key numbers'), before: ensureDemo,
     text: 'Live fundamentals from Yahoo Finance. Click <b>✎ Edit</b> to choose which numbers appear (ROCE, sales and profit CAGR, 50/100-day averages, cash, debt…). Hover any label for what it means.'},
    {title: 'Dependency map', el: '#egoflow', before: ensureDemo,
     text: 'Use <b>Fit screen</b> or <b>− / +</b> to zoom. <b>Left</b>: what the company relies on (suppliers, raw materials, owners, partners). <b>Right</b>: who relies on it (customers, subsidiaries). Each arrow\'s label says <b>what</b> flows: "Coking coal", "Automotive flat steel", "Promoter". Dashed = ownership, dotted = partnership. <b>Similar companies</b> sit below. Click a company card to open its screen; click an outside entity (e.g. coking coal) to re-centre the map.'},
    {title: 'Relationship table', el: '#panel', before: ensureDemo,
     text: 'The right panel lists the same relationships as a table, with statistical evidence for each link. Not needed? <b>✕ Hide panel</b> gives the page more room; <b>▤ Relationships</b> brings it back.'},
    {title: 'Geopolitical model', el: () => card('Geopolitical model'), before: ensureDemo,
     text: 'A plain-language summary: did this stock hold up better or worse than most during real shocks and what-if tests? Open “Show the numbers behind it” for the full calculation.'},
    {title: 'Macro sensitivity', el: () => card('Macro sensitivity'), before: ensureDemo,
     text: 'What usually happens to the stock when crude oil, the rupee, gold or the market move. Only the key factors are shown; “Show all 8 factors” adds the rest.'},
    {title: 'Event study', el: () => card('Event study'), before: ensureDemo,
     text: 'For each real event (tariff announcements, H-1B fee, Operation Sindoor, sanctions, GST cut): how much the stock moved <b>beyond what the market move explains</b> (CAR), and whether that was statistically unusual (t). Hover an event for what happened and who should react.'},
    {title: 'Stress tests and risk', el: () => card('Stress tests'), before: ensureDemo,
     text: 'What the macro exposures imply under a trade war, an oil shock, a rupee slide or a de-escalation, relative to Nifty. Below that is the risk model: GARCH forecast volatility, beta, Sharpe/Sortino, max drawdown, VaR/CVaR, momentum and trend.'},
    {title: 'Charts and statistical twins', el: () => card('Statistically similar'), before: ensureDemo,
     text: 'Stocks whose <b>company-specific</b> moves (after removing market and macro effects) track this one: news about them tends to move it too. Next to it is a chart comparing performance against related companies, plus a price chart with 1M–max ranges above.'},
    {title: 'Dependency map view', el: '#flowmain',
     before: async () => { if(S.view !== 'graph'){ leaveEntry(); await showFlow(DEMO); } await sleep(800); },
     text: 'The <b>Dependency map</b> tab lets you walk supply chains freely: pick any company in the box at the top, then click cards to re-centre. Every step is recorded for ◀ Back.'},
    {title: 'Model tab', el: () => card('Reaction to each') || card('In plain words'),
     before: async () => { if(S.view !== 'model'){ S.view = 'model'; leaveEntry(); setHash(null); await showModel(); } await sleep(400); },
     text: 'A plain-language explanation (technical details tucked away), and a heatmap of how every <b>segment or company</b> reacted to each news event, latest first. The site owner can add new events so the model stays current.'},
    {title: 'You\'re all set 🎉', el: '#tour-btn', before: ensureList,
     text: 'Replay this walkthrough any time with the <b>❓ Walkthrough</b> button in the top-right corner. Prices refresh every 15 minutes; fundamentals every 6 hours. Relationship data is curated from public information and may be incomplete. Not investment advice.'},
  ];

  let i = 0, active = false, box, tipEl, back;
  function build(){
    back = document.createElement('div'); back.id = 'tour-back';
    box = document.createElement('div'); box.id = 'tour-spot';
    tipEl = document.createElement('div'); tipEl.id = 'tour-tip';
    document.body.append(back, box, tipEl);
  }
  async function resolveEl(step){
    for(let k = 0; k < 40; k++){
      let e = typeof step.el === 'function' ? step.el() : step.el ? document.querySelector(step.el) : null;
      if(typeof e === 'string') e = document.querySelector(e);
      if(!step.el || e) return e;
      await sleep(150);
    }
    return null;
  }
  function place(target){
    const pad = 6, vw = innerWidth, vh = innerHeight;
    if(!target){
      box.style.display = 'none'; back.style.display = 'block';
      tipEl.style.left = Math.max(12, (vw - tipEl.offsetWidth) / 2) + 'px';
      tipEl.style.top = Math.max(12, (vh - tipEl.offsetHeight) / 2) + 'px';
      return;
    }
    back.style.display = 'none'; box.style.display = 'block';
    const r = target.getBoundingClientRect();
    const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
    const w = Math.min(vw - left - 4, r.width + 2 * pad), h = Math.min(vh - top - 4, r.height + 2 * pad);
    Object.assign(box.style, {top: top + 'px', left: left + 'px', width: w + 'px', height: h + 'px'});
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let tx, ty;
    if(top + h + th + 14 < vh){ ty = top + h + 10; tx = left; }                 // below
    else if(top - th - 10 > 0){ ty = top - th - 10; tx = left; }                // above
    else if(left + w + tw + 14 < vw){ tx = left + w + 10; ty = top; }           // right
    else if(left - tw - 10 > 0){ tx = left - tw - 10; ty = top; }               // left
    else { tx = (vw - tw) / 2; ty = vh - th - 12; }                             // overlap, pinned bottom
    tipEl.style.left = Math.min(Math.max(12, tx), vw - tw - 12) + 'px';
    tipEl.style.top = Math.min(Math.max(12, ty), vh - th - 12) + 'px';
  }
  let curTarget = null;
  async function show(k){
    i = Math.max(0, Math.min(STEPS.length - 1, k));
    const step = STEPS[i];
    tipEl.innerHTML = `<div class="sub">Step ${i + 1} of ${STEPS.length}</div><div class="sub">Loading…</div>`;
    if(step.before){ try { await step.before(); } catch(e){ console.warn('tour step', e); } }
    if(!active || STEPS[i] !== step) return;
    curTarget = await resolveEl(step);
    if(curTarget) curTarget.scrollIntoView({block: 'center', behavior: 'instant'});
    hideTip();
    tipEl.innerHTML = `
      <div class="tour-head"><span class="sub">Step ${i + 1} of ${STEPS.length}</span>
        <div class="tour-bar"><i style="width:${(i + 1) / STEPS.length * 100}%"></i></div></div>
      <div class="tour-title">${step.title}</div>
      <div class="tour-text">${step.text}</div>
      <div class="tour-btns">
        <button class="btn" id="tour-skip">${i === STEPS.length - 1 ? 'Close' : 'Skip tour'}</button>
        <span style="flex:1"></span>
        <button class="btn" id="tour-prev" ${i === 0 ? 'disabled' : ''}>Back</button>
        <button class="btn tour-next" id="tour-next">${i === STEPS.length - 1 ? 'Finish' : 'Next'}</button>
      </div>`;
    document.getElementById('tour-skip').onclick = end;
    document.getElementById('tour-prev').onclick = () => show(i - 1);
    document.getElementById('tour-next').onclick = () => i === STEPS.length - 1 ? end() : show(i + 1);
    requestAnimationFrame(() => place(curTarget));
  }
  function start(){
    closeAsk();
    if(!box) build();
    active = true; window.TOUR_ACTIVE = true;
    document.body.classList.add('touring');
    tipEl.style.display = 'block';
    show(0);
  }
  function end(){
    active = false; window.TOUR_ACTIVE = false;
    document.body.classList.remove('touring');
    [box, tipEl, back].forEach(x => x && (x.style.display = 'none'));
  }
  window.addEventListener('resize', () => active && place(curTarget));
  document.addEventListener('scroll', () => active && place(curTarget), true);
  document.addEventListener('keydown', e => {
    if(!active) return;
    if(e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); end(); }
    else if(e.key === 'ArrowRight' && !e.altKey){ e.preventDefault(); e.stopImmediatePropagation(); i === STEPS.length - 1 ? end() : show(i + 1); }
    else if(e.key === 'ArrowLeft' && !e.altKey){ e.preventDefault(); e.stopImmediatePropagation(); show(i - 1); }
    else if(e.key === 'Backspace' || e.altKey){ e.stopImmediatePropagation(); }   // don't navigate stocks mid-tour
  }, true);

  /* ---- "want a walkthrough?" popup, shown on every page load ---- */
  function closeAsk(){ document.getElementById('tour-ask')?.remove(); }
  function ask(){
    if(document.getElementById('tour-ask') || active) return;
    const m = document.createElement('div');
    m.id = 'tour-ask';
    m.innerHTML = `<div class="tour-modal">
      <div class="tour-title">Want a quick walkthrough?</div>
      <div class="tour-text">A ${STEPS.length}-step guided tour of the sector tree, stock screens, dependency maps, the geopolitical model and navigation. About 2 minutes.</div>
      <div class="tour-btns"><span style="flex:1"></span>
        <button class="btn" id="tour-no">No thanks</button>
        <button class="btn tour-next" id="tour-yes">Yes, show me</button></div></div>`;
    document.body.appendChild(m);
    document.getElementById('tour-yes').onclick = start;
    document.getElementById('tour-no').onclick = closeAsk;
    m.onclick = e => { if(e.target === m) closeAsk(); };
    document.getElementById('tour-yes').focus();
  }
  /* first visit only: remember in a cookie that the offer was shown */
  const COOKIE = 'imm_tour_seen';
  function seen(){ try { return document.cookie.split('; ').some(c => c === COOKIE + '=1'); } catch { return false; } }
  function markSeen(){
    try { document.cookie = `${COOKIE}=1; max-age=${60 * 60 * 24 * 365}; path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch {}
  }
  function askOnce(){ if(seen()) return; markSeen(); ask(); }
  window.TOUR = {start, ask, askOnce, end};
})();
