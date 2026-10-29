/* Hover glossary: every metric, factor, event and scenario in the UI.
   t = title, d = what it is, r = how to read it / where change shows up. */
const HELP = {
  /* ---------- macro factors (keys = factor ids) ---------- */
  'f:MKT': {t:'Nifty 50 (market factor)', d:'Daily % return of the Nifty 50 index, same session.',
    r:'β is the market beta. β = 1.2 means the stock has typically moved about 1.2% for every 1% Nifty move. High-β stocks fall harder in broad sell-offs and rise more in rallies.'},
  'f:USDINR': {t:'USD/INR (rupee)', d:'Daily % change in rupees per US dollar, same session. Positive = rupee weakened.',
    r:'β > 0: the stock gains when the rupee weakens (dollar earners such as IT, pharma, textile exporters). β < 0: hurt by a weaker rupee (importers, oil marketers, airlines, firms with dollar debt) or sold by FPIs on rupee stress.'},
  'f:BRENT': {t:'Brent crude oil', d:'Daily % return of Brent crude futures, lagged one session (it trades after Indian close).',
    r:'β > 0: benefits from costlier oil (ONGC, Oil India, upstream). β < 0: oil is an input cost (OMCs like IOC/BPCL/HPCL, paints, tyres, airlines, chemicals). Middle-East tension shows up here.'},
  'f:SPX': {t:'S&P 500 (US demand / risk appetite)', d:'Previous US session return of the S&P 500.',
    r:'β > 0: the stock follows US sentiment, typical for companies with US revenue (IT services, ER&D, exporters). US recession fears or a tariff sell-off in the US transmit through this β.'},
  'f:UST10': {t:'US 10-year Treasury yield', d:'Change in the US 10Y yield in percentage points, lagged one session.',
    r:'β < 0: falls when US yields rise. Higher US yields pull foreign capital out of emerging markets, hitting FPI-heavy and long-duration growth stocks. Units: effect per +1.00 pp yield move (a typical day is ±0.05 pp).'},
  'f:GOLD': {t:'Gold', d:'Daily % return of gold futures, lagged one session.',
    r:'β > 0: jewellers (Titan, Kalyan) and gold lenders (Muthoot, Manappuram), or stocks that behave like safe havens. Gold spikes often accompany geopolitical stress.'},
  'f:HSI': {t:'Hang Seng (China)', d:'Daily % return of the Hang Seng index, same session (similar time zone).',
    r:'β > 0: tied to China demand and Asian risk appetite (metals and mining, commodity chemicals). A negative β can indicate China+1 beneficiaries that gain when China weakens.'},
  'f:VIX': {t:'India VIX, fear beyond the market', d:'Daily log change in India VIX after removing the part explained by the Nifty move (orthogonalised).',
    r:'β < 0: the stock sells off more than the market when fear rises (high-beta, speculative, small caps). β > 0: behaves defensively in panics. Sudden geopolitical shocks raise VIX.'},

  /* ---------- regression statistics ---------- */
  'β': {t:'Beta (sensitivity)', d:'Estimated change in the stock\'s daily return per unit move of the factor, holding the other factors fixed (multiple OLS regression on ~2 years of daily data).',
    r:'Sign tells direction, size tells strength. Read it together with t: a big β with |t| < 1.65 is noise.'},
  't': {t:'t-statistic (Newey-West)', d:'β divided by its standard error. Uses heteroskedasticity- and autocorrelation-robust (HAC) errors.',
    r:'|t| ≥ 1.65 * (90%), ≥ 1.96 ** (95%), ≥ 2.58 *** (99%) confidence that the true effect is not zero. Bars are bold when significant at 95%.'},
  'R²': {t:'R² (explained variance)', d:'Share of the stock\'s daily return variance explained by the 8 macro factors together.',
    r:'High R² (> 0.4): the stock is mostly a macro/market play. Low R² (< 0.15): company-specific news dominates.'},
  'alpha': {t:'Alpha (annualised)', d:'The regression constant ×252: return not explained by any factor.',
    r:'Positive alpha with |t| ≥ 2 means persistent outperformance after controlling for macro moves. Past alpha rarely persists.'},

  /* ---------- event study ---------- */
  'CAR': {t:'Cumulative abnormal return', d:'Sum over the event window of (actual return − expected return), where the expected return = a + b × Nifty return, fitted on the 250 sessions before the event (market model).',
    r:'It measures how the stock reacted to the event beyond what the overall market move explains. −4% means it underperformed its normal market-linked behaviour by 4%.'},
  'tEvent': {t:'Event t-statistic (SCAR)', d:'CAR divided by (residual volatility × √window length).',
    r:'|t| ≥ 1.96 means the reaction is unlikely to be ordinary noise for this stock. Stars as elsewhere.'},
  'Window': {t:'Event window', d:'Trading sessions counted from the first Indian session after the announcement. [0,+3] = event day plus the next 3 sessions.',
    r:'Longer windows capture slower digestion but also more unrelated news.'},
  'ev:liberation': {t:'US "Liberation Day" tariffs', d:'2 Apr 2025: US announces reciprocal tariffs on almost all trading partners (26% for India, later paused).',
    r:'A global risk-off and US-demand shock. Exporters to the US and high-β stocks typically show negative CAR.'},
  'ev:pahalgam': {t:'Pahalgam terror attack', d:'22 Apr 2025: attack in J&K raises India–Pakistan military tension.',
    r:'Defence stocks tend to show positive CAR (expected orders). Risk-sensitive sectors may dip.'},
  'ev:sindoor': {t:'Operation Sindoor', d:'7 May 2025: Indian strikes on targets in Pakistan; ceasefire on 10 May.',
    r:'Tests resilience to active conflict. Defence and drone makers typically react positively.'},
  'ev:tariff25': {t:'US 25% tariff on India', d:'30 Jul 2025: US announces a 25% tariff on Indian goods.',
    r:'Goods exporters to the US (textiles, shrimp, auto parts, EMS, gems) should react most. Services are not directly tariffed.'},
  'ev:tariff50': {t:'Extra 25% "Russian oil" tariff', d:'6 Aug 2025: an additional 25% penalty takes the total US tariff on India to 50%.',
    r:'Escalation shock. Watch textiles, seafood, auto components, chemicals and oil refiners (Russian crude buyers).'},
  'ev:tariff_eff': {t:'50% tariff takes effect', d:'27 Aug 2025: the 50% US tariffs become effective.',
    r:'Confirms the shock is real rather than a negotiating threat. The reaction measures residual surprise.'},
  'ev:h1b': {t:'US $100,000 H-1B fee', d:'19 Sep 2025 (Fri): US proclamation imposing a $100k fee on new H-1B visa petitions; first Indian session is 22 Sep.',
    r:'Directly targets Indian IT services and ER&D that rely on onsite staff. A negative CAR here = visa-policy sensitivity.'},
  'ev:pharma': {t:'US 100% branded-pharma tariff', d:'25 Sep 2025: US announces a 100% tariff on branded/patented drugs (generics largely exempt).',
    r:'Tests pharma/CDMO exposure. Generic-heavy firms reacting mildly is consistent with the exemption.'},
  'ev:rusoil': {t:'US sanctions on Rosneft & Lukoil', d:'22 Oct 2025: US sanctions Russia\'s two largest oil companies, threatening India\'s discounted crude supply.',
    r:'Refiners and OMCs that buy Russian crude may react negatively. Upstream producers can benefit if prices rise.'},
  'ev:gst': {t:'GST 2.0 rate cuts', d:'3 Sep 2025: GST Council cuts rates on cars, two-wheelers, ACs, FMCG and other goods (effective 22 Sep).',
    r:'A domestic demand stimulus, shown for contrast and not counted in the geopolitical score. Autos and consumer stocks should show positive CAR.'},

  /* ---------- scenarios ---------- */
  'Impact': {t:'Scenario impact', d:'Σ βₖ × shockₖ − Nifty shock: the first-order expected return of the stock relative to the Nifty if all the scenario\'s factor moves happened at once.',
    r:'Positive = expected to outperform the market in that scenario. It is a linear approximation from daily betas, so read it as a ranking, not a forecast.'},
  'sc:trade_war': {t:'US trade-war escalation', d:'Nifty −4%, rupee −2%, S&P 500 −8%, Hang Seng −5%, VIX up.',
    r:'Hurts US-demand and China-linked exposures. Defensive, domestic-demand stocks hold up better.'},
  'sc:oil_shock': {t:'Middle-East oil shock', d:'Brent +25%, Nifty −4%, rupee −2%, gold +6%, VIX up.',
    r:'Oil producers gain. Oil consumers (OMCs, airlines, paints, tyres) and import-heavy firms lose.'},
  'sc:rupee_crash': {t:'Rupee slide / FPI outflow', d:'Rupee −5%, Nifty −3%, US 10Y +0.30 pp, VIX up.',
    r:'Dollar earners (IT, pharma exporters) cushion. FPI-heavy financials and importers suffer.'},
  'sc:risk_on': {t:'De-escalation / trade deal', d:'Nifty +4%, rupee +2%, global equities up, Brent −10%, VIX down.',
    r:'The reverse case: high-β and tariff-hit names should rebound most.'},
  'Shocks': {t:'Scenario shocks', d:'The hypothetical factor moves that define the scenario: MKT = Nifty, USDINR = rupee (+ = weaker), BRENT = oil, SPX = S&P 500, HSI = Hang Seng, UST10 = US 10Y yield (pp), VIX = India VIX (log points), GOLD = gold.', r:''},

  /* ---------- geopolitical model ---------- */
  'g:scar': {t:'Mean standardised CAR (shocks)', d:'Average event t-statistic across all geopolitical shock events (tariffs, H-1B, conflict, sanctions).',
    r:'Positive = the stock has tended to outperform during geopolitical shocks. Negative = it sells off harder than its market beta implies.'},
  'g:stress': {t:'Mean stress-test excess return', d:'Average scenario impact across the trade-war, oil-shock and rupee-slide scenarios.',
    r:'Positive = the macro exposures cushion the stock in stress, relative to Nifty.'},
  'g:z': {t:'Cross-sectional z-scores', d:'Each measure standardised against all ~500 stocks: (value − mean) / std, clipped at ±3.',
    r:'+1 = one standard deviation more resilient than the average stock.'},
  'g:direct': {t:'Direct score', d:'½ × z(events) + ½ × z(stress), using only the stock\'s own price behaviour.', r:''},
  'g:network': {t:'Network score (final)', d:'The direct score diffused through the supply/ownership graph: s_net = (1−α)(I − αW)⁻¹ s. A company inherits part of the resilience or fragility of its suppliers, customers and owners.',
    r:'> +0.5 → Tailwind, < −0.5 → Headwind, otherwise Mixed. This number drives the badge and the list\'s Geo score column.'},
  'stance': {t:'Geopolitical stance (model)', d:'Classification from the network score, which combines (1) event-study reactions to real 2025 shocks, (2) macro stress tests and (3) graph propagation.',
    r:'Tailwind = has historically held up or benefited. Headwind = historically hurt. Mixed = no clear edge. It is not a price forecast.'},

  /* ---------- risk ---------- */
  'Realised vol (ann.)': {t:'Realised volatility', d:'Standard deviation of daily returns over ~2 years × √252.', r:'25% ≈ a typical large cap. 50%+ = very volatile.'},
  'GARCH(1,1) fcst vol': {t:'GARCH(1,1) forecast volatility', d:'Next-day volatility forecast from a GARCH(1,1) model with Student-t errors, annualised. It reacts to recent turbulence.',
    r:'Above realised vol = the stock is in a currently stressed regime (often after shocks). Below = calmer than usual.'},
  'GARCH persistence α+β': {t:'Volatility persistence', d:'α + β of the GARCH model.', r:'Close to 1 (> 0.97) means volatility shocks fade slowly: turbulence lingers for weeks.'},
  'Beta vs Nifty': {t:'CAPM beta', d:'Covariance with Nifty / variance of Nifty (single-factor).', r:'> 1 amplifies market moves, < 1 dampens them.'},
  "Jensen's α (ann.)": {t:"Jensen's alpha", d:'Annualised return in excess of what CAPM predicts given its beta (r_f = 6.5%).', r:'Positive = outperformed on a risk-adjusted basis over the window.'},
  'Sharpe': {t:'Sharpe ratio', d:'(Annual return − risk-free) / annual volatility.', r:'> 1 good, > 2 excellent, < 0 = lost to risk-free.'},
  'Sortino': {t:'Sortino ratio', d:'Like Sharpe but divides by downside volatility only.', r:'Higher = better reward per unit of downside risk.'},
  'Max drawdown (2Y)': {t:'Maximum drawdown', d:'Largest peak-to-trough fall in the last ~2 years.', r:'How much a holder bought at the worst time would have lost.'},
  '1-day VaR 95%': {t:'Value at Risk (95%, historical)', d:'The daily loss exceeded on only 5% of days (5th percentile of daily returns).', r:'2.5% means about 1 day in 20 loses more than 2.5%.'},
  '1-day CVaR 95%': {t:'Conditional VaR / expected shortfall', d:'Average loss on those worst 5% of days.', r:'Captures tail severity. A big gap above VaR = fat-tailed crash risk.'},
  'Momentum 12-1': {t:'12-1 month momentum', d:'Return from 12 months ago to 1 month ago (skips the last month to avoid short-term reversal).',
    r:'A classic cross-sectional momentum signal: strongly positive names have tended to keep outperforming over the next months.'},
  '6M trend (ann.)': {t:'6-month log-linear trend', d:'Slope of a regression of log(price) on time over ~126 sessions, annualised; R² = how straight the trend is.',
    r:'Large slope with R² > 0.6 = a clean, persistent trend. Low R² = choppy.'},
  'vs 50 / 200 DMA': {t:'Moving-average position', d:'Is today\'s price above (▲) or below (▼) its 50-day and 200-day average?', r:'▲/▲ = uptrend, ▼/▼ = downtrend, mixed = transition.'},

  /* ---------- fundamentals ---------- */
  'Price': {t:'Last price', d:'Last close (NSE, ₹) from Yahoo Finance.', r:''},
  '1D': {t:'1-day change', d:'Close-to-close % change for the latest session.', r:''},
  '1M': {t:'1-month return', d:'% change versus the close ~30 calendar days ago.', r:''},
  '6M': {t:'6-month return', d:'% change versus ~182 days ago.', r:''},
  '1Y': {t:'1-year return', d:'% change versus ~365 days ago. The sidebar shows the median across the sector or segment.', r:''},
  '52W range': {t:'52-week range', d:'Lowest and highest close over the last year.', r:'Near the low = beaten down. Near the high = strength.'},
  'Market cap': {t:'Market capitalisation', d:'Share price × shares outstanding, in ₹ crore (1 Cr = 10 million).', r:'Size buckets: Large ≥ ₹1 lakh Cr, Mid ≥ ₹30k Cr, Small ≥ ₹5k Cr, else Micro. Penny = price under ₹25.'},
  'Revenue (TTM)': {t:'Revenue, trailing 12 months', d:'Sum of the last four quarters of sales.', r:''},
  'P/E (TTM)': {t:'Price / earnings', d:'Price ÷ last 12 months EPS.', r:'How many years of current profit the price pays for. Compare within a segment, not across sectors.'},
  'Fwd P/E': {t:'Forward P/E', d:'Price ÷ analysts\' next-year EPS estimate.', r:'Lower than the trailing P/E = earnings expected to grow.'},
  'P/B': {t:'Price / book', d:'Price ÷ book value per share.', r:'Most meaningful for banks and NBFCs.'},
  'ROE': {t:'Return on equity', d:'Net profit ÷ shareholders\' equity.', r:'> 15% is strong for Indian companies.'},
  'Net margin': {t:'Net profit margin', d:'Net profit ÷ revenue.', r:''},
  'Op. margin': {t:'Operating margin', d:'Operating profit ÷ revenue.', r:'Shows pricing power. Input-cost shocks (oil, metals, tariffs) show up here first.'},
  'Rev. growth': {t:'Revenue growth (YoY)', d:'Latest quarter versus the same quarter last year.', r:''},
  'EPS growth': {t:'Earnings growth (YoY)', d:'Latest quarter EPS versus the same quarter last year.', r:''},
  'Debt / Equity': {t:'Debt to equity', d:'Total debt ÷ equity (Yahoo reports it as a %, so 50 = 0.5×).', r:'High leverage magnifies shocks and rate rises. Not meaningful for banks.'},
  'Div. yield': {t:'Dividend yield', d:'Annual dividend ÷ price.', r:''},
  'Promoter/insider': {t:'Promoter / insider holding', d:'Share held by promoters and insiders.', r:'High = aligned owners. Falling holdings or pledging can be a warning sign.'},
  'Institutions': {t:'Institutional holding', d:'Share held by mutual funds, FPIs, insurers and other institutions.', r:'High FPI ownership makes a stock sensitive to global flows (see USDINR and UST10 betas).'},
  'Analyst view': {t:'Consensus rating', d:'Yahoo consensus recommendation and the number of analysts.', r:''},
  'Analyst target': {t:'Mean target price', d:'Average analyst 12-month target.', r:''},

  /* ---------- similarity & edges ---------- */
  'resid ρ': {t:'Residual correlation', d:'Correlation of the two stocks\' factor-model residuals (Ledoit-Wolf shrinkage): co-movement left after removing market, rupee, oil, US and China effects.',
    r:'High (> 0.3) = they share company- or industry-specific drivers, so news about one tends to move the other.'},
  'raw ρ': {t:'Raw correlation', d:'Plain correlation of daily returns, including the common market move.', r:'Usually much higher than resid ρ, because all stocks share the market.'},
  'cluster': {t:'Hierarchical cluster', d:'Average-linkage clustering on distance √(2(1−ρ)) of residual correlations, cut into ~30 groups.', r:'Stocks the data groups together regardless of their official sector.'},
  'granger': {t:'Edge evidence', d:'For listed→listed links: resid ρ = residual correlation. Granger p = does the provider\'s past residual return help predict the receiver\'s (lags 1–3, F-test)? q = Benjamini-Hochberg false-discovery-rate adjusted across all edges.',
    r:'q < 0.05 ** = statistically detectable lead-lag along this supply or ownership link. It shows predictive association, not proof of causation.'},
  'Geo score': {t:'Geo score (σ)', d:'Network-adjusted geopolitical resilience score in standard deviations (see the Model tab).', r:'Positive = held up or benefited during 2025 shocks and stress tests. Negative = vulnerable.'},
  'sector-median': {t:'Median 1Y return', d:'Median 1-year return of all stocks in this sector or segment.', r:'Quick read on which parts of the market are rising or falling.'},
  'size': {t:'Size filter', d:'Large ≥ ₹1 lakh Cr, Mid ≥ ₹30k Cr, Small ≥ ₹5k Cr, Micro below that; Penny = price under ₹25.', r:''},
  'leg:in': {t:'Incoming edge (blue)', d:'Something flows INTO the selected node: a supplier, service provider, investor/promoter or partner.', r:'Trouble at these nodes travels downstream to the selected company.'},
  'leg:out': {t:'Outgoing edge (orange)', d:'The selected node provides goods, services or capital TO these nodes (customers, subsidiaries).', r:'Demand shocks at these customers hit the selected company\'s revenue.'},
  'ROCE': {t:'Return on capital employed', d:'EBIT ÷ (total assets − current liabilities), from the latest annual statements.', r:'How much operating profit the business earns on all the capital (debt + equity) it uses. > 15% is generally good; compare within a sector. Not meaningful for banks.'},
  'Sales CAGR': {t:'Sales CAGR', d:'Compound annual growth of revenue over the longest span Yahoo provides (usually 3 years: 4 annual reports).', r:'Steady double-digit CAGR = consistent growth. Compare with profit CAGR: profit growing faster means margins are improving.'},
  'Profit CAGR': {t:'Profit CAGR', d:'Compound annual growth of net profit over the longest available span (usually 3 years).', r:'Shown only when both start and end profit are positive.'},
  'dma': {t:'Moving-average signal', d:'▲ = price is above its 50-day (or 100-day) average price, ▼ = below.', r:'Above both = uptrend; below both = downtrend; mixed = trend changing. A simple trend indicator, not a prediction.'},
  '50-day avg': {t:'50-day moving average', d:'Average closing price of the last 50 sessions.', r:'Price above it (▲) = short-term uptrend.'},
  '100-day avg': {t:'100-day moving average', d:'Average closing price of the last 100 sessions.', r:'Price above it (▲) = medium-term uptrend.'},
  'Cash': {t:'Cash & equivalents', d:'Cash and short-term investments on the latest balance sheet.', r:''},
  'Total debt': {t:'Total debt', d:'Short- plus long-term borrowings on the latest balance sheet.', r:''},
  'Beta (Yahoo)': {t:'Beta (Yahoo)', d:'Yahoo\'s market beta; our own estimate is in the Risk model card.', r:''},
  'Employees': {t:'Employees', d:'Full-time employees reported to Yahoo.', r:''},
  'Profit growth': {t:'Profit growth', d:'Change in net profit.', r:''},
  'leg:peer': {t:'Similar company (purple)', d:'Business peers in the same line of work. Purple dashed lines connect them.', r:'Sector-wide news usually moves all of them.'},
};

function helpHTML(key, extra){
  const h = HELP[key];
  if(!h) return null;
  return `<div class="t">${h.t}</div><div class="d" style="color:var(--text);margin:6px 0">${h.d}</div>` +
    (h.r ? `<div class="sub" style="font-size:12px">${h.r}</div>` : '') +
    (extra ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:12px"><b>For this stock:</b> ${extra}</div>` : '');
}

/* plain-language reading of one factor beta for one stock */
function factorExtra(k, b, t){
  if(b == null) return '';
  const sig = Math.abs(t || 0) >= 1.96 ? 'statistically significant (95%)' : Math.abs(t || 0) >= 1.65 ? 'weakly significant (90%)' : 'not statistically significant, so treat as noise';
  const f = x => (x > 0 ? '+' : '') + x.toFixed(2) + '%';
  // implied % move of the stock for an illustrative factor move (betas are in return-per-unit-factor)
  const shock = {MKT:['a +1% Nifty day', b * 1], USDINR:['a 1% rupee depreciation', b * 1], BRENT:['a +10% jump in Brent', b * 10],
    SPX:['a −2% S&P 500 day', -b * 2], UST10:['a +0.10 pp rise in the US 10Y yield', b * 10], GOLD:['a +5% gold rally', b * 5],
    HSI:['a −3% Hang Seng day', -b * 3], VIX:['a +10% jump in India VIX beyond the market', b * 10]}[k];
  if(!shock) return '';
  return `${shock[0]} has gone with a <b>${f(shock[1])}</b> move in this stock (β ${b.toFixed(3)}, t ${t?.toFixed(2)}), ${sig}.`;
}
