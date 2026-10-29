"use strict";
let welcomeObserver;
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const types = {
  supply: { label: "Supplies", color: "#245da8", verb: "supplies goods to" },
  service: {
    label: "Services",
    color: "#7450b0",
    verb: "provides services to",
  },
  invest: { label: "Ownership", color: "#885909", verb: "invests in or owns" },
  partner: { label: "Partnerships", color: "#146c59", verb: "partners with" },
};
const titles = {
  welcome: [
    "Welcome to StockAtlas",
    "Company relationships and research",
    "Welcome",
  ],
  explore: [
    "Follow the connections.",
    "Discover who supplies, supports and powers the companies you know.",
    "Relationship explorer",
  ],
  directory: [
    "Discover the companies.",
    "Browse Indian businesses by sector and explore the relationships around them.",
    "Relationship directory",
  ],
  paths: [
    "Find the connecting thread.",
    "See how two organisations connect through the wider business network.",
    "Find a connection",
  ],
  saved: [
    "Your corner of the atlas.",
    "Pick up where your curiosity left off. Saved companies stay in this browser.",
    "Saved companies",
  ],
  guide: [
    "A little context goes a long way.",
    "Learn to follow a relationship, read an arrow and ask better questions.",
    "How to read the map",
  ],
};
let A,
  byId,
  state = {
    view: "explore",
    id: "TCS",
    type: "all",
    direction: "all",
    limit: 4,
    rows: 6,
    sector: "all",
    page: 1,
  },
  trail = [],
  searchIndex = -1,
  searchMatches = [],
  pathVersion = 0;
let saved;
try {
  saved = new Set(JSON.parse(localStorage.getItem("atlas.saved") || "[]"));
} catch {
  saved = new Set();
}
const avatar = (n) =>
  `<span class="avatar" aria-hidden="true">${esc(
    n.name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase(),
  )}</span>`;
const badge = (t) =>
  `<span class="badge" style="--type-color:${types[t].color}"><i></i> ${types[t].label}</span>`;
const unique = (a) => [...new Set(a)];
const relationSentence = (e) =>
  `${byId.get(e.source).name} ${types[e.type].verb} ${byId.get(e.target).name}`;
function connected(id) {
  return A.edges.filter((e) => e.source === id || e.target === id);
}
function filteredEdges() {
  return connected(state.id).filter(
    (e) =>
      (state.type === "all" || state.type === e.type) &&
      (state.direction === "all" ||
        e.type === "partner" ||
        (state.direction === "in"
          ? e.target === state.id
          : e.source === state.id)),
  );
}
function other(e) {
  return byId.get(e.source === state.id ? e.target : e.source);
}
function notify(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => ($("#toast").hidden = true), 3200);
}
function toggleSave(id) {
  saved.has(id) ? saved.delete(id) : saved.add(id);
  try {
    localStorage.setItem("atlas.saved", JSON.stringify([...saved]));
  } catch {
    notify("Browser storage is unavailable; saves last for this visit.");
  }
  $("#saved-count").textContent = saved.size;
  window.dispatchEvent(new Event("stockatlas:saved-change"));
  if (state.view === "saved" || state.view === "explore") render();
  else
    document.querySelectorAll(`[data-save]`).forEach((b) => {
      if (b.dataset.save === id) {
        b.classList.toggle("saved", saved.has(id));
        b.textContent = saved.has(id) ? "★" : "☆";
        b.setAttribute(
          "aria-label",
          `${saved.has(id) ? "Unsave" : "Save"} ${byId.get(id).name}`,
        );
      }
    });
}
function route() {
  const bits = location.hash.slice(1).split("/");
  const view = bits[0] || "welcome";
  state.view = titles[view] ? view : "welcome";
  if (bits[1]) {
    let id;
    try {
      id = decodeURIComponent(bits.slice(1).join("/"));
    } catch {}
    if (byId.has(id)) state.id = id;
    else notify("That organisation is not in this atlas.");
  }
  render();
}
function openNode(id) {
  if (!byId.has(id)) return;
  if (state.id !== id) {
    trail.push(state.id);
    trail = trail.slice(-12);
  }
  state.id = id;
  state.type = "all";
  state.direction = "all";
  state.limit = 4;
  state.rows = 6;
  const hash = "#explore/" + encodeURIComponent(id);
  if (location.hash === hash) {
    state.view = "explore";
    render();
  } else location.hash = hash;
  closeSearch();
}
function render() {
  pathVersion++;
  const t = titles[state.view];
  document.title = `${t[2]} — StockAtlas`;
  $("#main").setAttribute("aria-label", t[2]);
  $("#main").classList.toggle("welcome-mode", state.view === "welcome");
  document.body.classList.toggle("welcome-landing", state.view === "welcome");
  document.querySelector(".stock-navigation").hidden = state.view === "welcome";
  document.querySelectorAll("[data-view]").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === state.view);
    if (a.dataset.view === state.view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const exploring = ["explore", "directory", "paths"].includes(state.view);
  document.querySelectorAll("[data-primary]").forEach((a) => {
    const selected =
      a.dataset.primary === "explore"
        ? exploring
        : a.dataset.primary === state.view;
    a.classList.toggle("active", selected);
    if (selected) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("#explore-tools").hidden = !exploring;
  $("#saved-count").textContent = saved.size;
  $("#content").innerHTML =
    state.view === "welcome"
      ? $("#welcome-template").innerHTML
      : state.view === "explore"
        ? explorer()
        : state.view === "directory" || state.view === "saved"
          ? directory()
          : state.view === "paths"
            ? pathForm()
            : guide();
  welcomeObserver?.disconnect();
  if (state.view === "welcome") {
    const counts = {
      companies: A.nodes.filter((n) => n.kind === "company").length,
      entities: A.nodes.filter((n) => n.kind === "entity").length,
      relationships: A.edges.length,
      sectors: A.sectors.length,
    };
    document
      .querySelectorAll("[data-welcome-count]")
      .forEach(
        (el) =>
          (el.textContent =
            counts[el.dataset.welcomeCount].toLocaleString("en-IN")),
      );
    if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      welcomeObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            welcomeObserver.unobserve(entry.target);
          }
        }
      }, { threshold: 0.08 });
      document.querySelectorAll(".welcome-coverage, .welcome-section-heading, .welcome-feature-grid article, .welcome-instructions, .welcome-roadmap, .welcome-closing").forEach((el) => {
        el.classList.add("welcome-reveal");
        welcomeObserver.observe(el);
      });
    }
  }
  if (state.view === "explore") requestAnimationFrame(drawLines);
}
function stats() {
  return `<section class="stats" aria-label="Atlas coverage">${[
    [
      A.nodes.filter((n) => n.kind === "company").length,
      "Listed companies",
      "Across the Indian market",
      "▦",
    ],
    [
      A.edges.length.toLocaleString(),
      "Mapped relationships",
      "Goods, services & capital",
      "⌘",
    ],
    [
      A.sectors.length,
      "Business sectors",
      "From technology to agriculture",
      "◷",
    ],
    [
      A.nodes.filter((n) => n.kind === "entity").length,
      "External organisations",
      "Global firms & market groups",
      "◎",
    ],
  ]
    .map(
      ([v, l, n, i]) =>
        `<div class="stat"><div class="stat-label">${l}</div><div class="stat-value">${v}</div><div class="stat-note">${n}</div></div>`,
    )
    .join("")}</section>`;
}
function nodeCard(n, e, focus = false) {
  return `<button class="node-card ${focus ? "focus" : ""}" ${focus ? 'data-focus="true"' : `data-open="${esc(n.id)}"`} title="${esc(n.name)}${e ? " · " + esc(e.label) : ""}" ${focus ? 'aria-label="Current focus: ' + esc(n.name) + '"' : ""}>${avatar(n)}<span class="node-copy"><strong>${esc(n.name)}</strong><small>${esc(n.kind === "company" ? n.id : n.segment)}</small></span>${e ? `<i class="node-dot" style="--type-color:${types[e.type].color}"></i>` : ""}</button>`;
}
function explorer() {
  const n = byId.get(state.id),
    edges = filteredEdges();
  const incoming = edges.filter((e) => e.target === n.id),
    outgoing = edges.filter((e) => e.source === n.id);
  const partners = outgoing.filter((e) => e.type === "partner");
  for (const e of partners) {
    if (!incoming.some((x) => other(x).id === other(e).id)) incoming.push(e);
  }
  const left = unique(incoming.map((e) => other(e).id)),
    right = unique(outgoing.map((e) => other(e).id));
  const col = (ids, es, side) =>
    ids.length
      ? ids
          .slice(0, state.limit)
          .map((id) =>
            nodeCard(
              byId.get(id),
              es.find((e) => other(e).id === id),
            ),
          )
          .join("") +
        (ids.length > state.limit
          ? `<button class="more-nodes" data-more-map>+ ${ids.length - state.limit} more connections</button>`
          : "")
      : `<div class="map-empty">No ${side} connections<br>in this selection.</div>`;
  return `${stats()}<div class="explorer-grid"><div class="explorer-primary"><section class="panel"><div class="panel-head"><div><h2>${esc(n.name)}</h2><p>Click a company to follow its connections.</p></div><span class="micro-label">INTERACTIVE MAP</span></div><div class="filters" aria-label="Relationship type"><button class="chip ${state.type === "all" ? "active" : ""}" data-type="all" aria-pressed="${state.type === "all"}">All connections <span>${connected(n.id).length}</span></button>${Object.entries(
    types,
  )
    .map(
      ([k, v]) =>
        `<button class="chip ${state.type === k ? "active" : ""}" data-type="${k}" aria-pressed="${state.type === k}" style="--type-color:${v.color}"><i></i>${v.label}</button>`,
    )
    .join(
      "",
    )}</div><div class="map-toolbar"><div class="segmented" aria-label="Connection direction">${[
    ["all", "Both sides"],
    ["in", "Incoming"],
    ["out", "Outgoing"],
  ]
    .map(
      ([k, v]) =>
        `<button data-direction="${k}" class="${state.direction === k ? "active" : ""}" aria-pressed="${state.direction === k}">${v}</button>`,
    )
    .join(
      "",
    )}</div><div>${trail.length ? '<button class="text-button" data-back>← Previous</button>' : ""}<button class="text-button" data-reset>↺ Reset</button></div></div><div class="map"><div class="map-labels"><span>Suppliers & backers</span><span>Your focus</span><span>Customers & holdings</span></div><div class="map-body"><svg class="map-lines" aria-hidden="true"></svg><div class="map-column" data-side="left">${col(left, incoming, "incoming")}</div><div class="map-column" data-side="center">${nodeCard(n, null, true)}</div><div class="map-column" data-side="right">${col(right, outgoing, "outgoing")}</div></div></div><div class="map-caption"><div class="legend">${Object.entries(
    types,
  )
    .map(
      ([k, v]) =>
        `<span style="--type-color:${v.color}"><i></i>${v.label}</span>`,
    )
    .join(
      "",
    )}</div><span>Arrows follow goods, services or capital. Partnerships are mutual.</span></div></section><section class="panel connections"><div class="panel-head"><div><h2>The connections, explained</h2><p>What actually flows between these organisations?</p></div><span class="connection-count">${edges.length} relationships</span></div><div class="connection-list">${
    edges.length
      ? edges
          .slice(0, state.rows)
          .map(
            (e) =>
              `<button class="connection-row" data-edge="${esc(e.id)}">${avatar(other(e))}<span class="connection-copy"><strong>${esc(relationSentence(e))}</strong><p>${esc(e.label)}</p></span>${badge(e.type)}<span class="row-arrow">↗</span></button>`,
          )
          .join("")
      : '<div class="empty">No connections match these filters. Try another relationship type or both sides.</div>'
  }</div>${edges.length > state.rows ? `<div class="connection-footer"><button class="expand-connections" data-more-rows>Show ${Math.min(20, edges.length - state.rows)} more relationships ↓</button></div>` : ""}</section></div>${detail(n)}</div><div class="section-title"><h2>Start with a question</h2><a class="text-button" href="#directory">Browse all companies ↗</a></div><div class="starter-grid">${[
    [
      "DIXON",
      "◈",
      "Who powers your electronics?",
      "Explore the electronics supply chain",
    ],
    [
      "MARUTI",
      "⚙",
      "What goes into a car?",
      "Meet the suppliers behind mobility",
    ],
    [
      "TCS",
      "⌘",
      "Who connects the digital world?",
      "Follow services, clients & ownership",
    ],
  ]
    .filter(([id]) => byId.has(id))
    .map(
      ([id, icon, title, sub]) =>
        `<button class="starter" data-open="${id}"><span><strong>${title}</strong><small>${sub}</small></span><span>↗</span></button>`,
    )
    .join("")}</div>`;
}
function detail(n) {
  const es = connected(n.id),
    ins = unique(es.filter((e) => e.target === n.id).map((e) => e.source)),
    outs = unique(es.filter((e) => e.source === n.id).map((e) => e.target));
  const sectors = unique(
    es.map((e) => other(e).sector).filter((s) => s !== "External entities"),
  );
  return `<aside class="panel detail-card" aria-label="Focused organisation"><div class="detail-top">${avatar(n)}<button class="icon-button ${saved.has(n.id) ? "saved" : ""}" data-save="${esc(n.id)}" aria-label="${saved.has(n.id) ? "Unsave" : "Save"} ${esc(n.name)}" aria-pressed="${saved.has(n.id)}">${saved.has(n.id) ? "★" : "☆"}</button></div><span class="micro-label">${n.kind === "company" ? "LISTED COMPANY" : "EXTERNAL ORGANISATION"}</span><h2>${esc(n.name)}</h2><div class="ticker-line">${n.kind === "company" ? esc(n.id) + " · NSE" : esc(n.segment)}</div><div style="margin-top:12px"><span class="pill">${esc(n.sector)}</span></div><p class="description">${esc(n.description)}</p><div class="detail-metrics"><div><strong>${ins.length}</strong><span>Incoming connections</span></div><div><strong>${outs.length}</strong><span>Outgoing connections</span></div></div><div class="insight"><strong>Connected sectors</strong>${sectors.length ? `Its mapped connections reach ${sectors.length} business ${sectors.length === 1 ? "sector" : "sectors"}. Follow a connection to discover the wider network.` : "Explore its connections to understand the wider business network."}</div><a class="button primary wide" href="#paths">Find a connection ⇄</a>${n.kind === "company" ? `<a class="button wide" href="/research#${encodeURIComponent(n.id)}">Financials & research ↗</a>` : ""}<p class="detail-note">These are mapped relationships, not measured dependency percentages. A connection does not establish revenue concentration or investment merit.</p></aside>`;
}
function drawLines() {
  const body = $(".map-body"),
    svg = $(".map-lines");
  if (!body || !svg) return;
  const bounds = body.getBoundingClientRect(),
    center = $('[data-side="center"] .node-card').getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
  let paths = "<defs>";
  Object.entries(types).forEach(([k, v]) => {
    paths += `<marker id="arrow-${k}" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto-start-reverse"><path d="M0 0L5 2.5L0 5" fill="${v.color}"/></marker>`;
  });
  paths += "</defs>";
  for (const side of ["left", "right"])
    document
      .querySelectorAll(`[data-side="${side}"] [data-open]`)
      .forEach((el) => {
        const r = el.getBoundingClientRect(),
          e = filteredEdges().find(
            (e) =>
              other(e).id === el.dataset.open &&
              (side === "left"
                ? e.target === state.id || e.type === "partner"
                : e.source === state.id),
          );
        if (!e) return;
        const x1 = (side === "left" ? r.right : center.right) - bounds.left,
          x2 = (side === "left" ? center.left : r.left) - bounds.left,
          y1 =
            (side === "left"
              ? r.top + r.height / 2
              : center.top + center.height / 2) - bounds.top,
          y2 =
            (side === "left"
              ? center.top + center.height / 2
              : r.top + r.height / 2) - bounds.top;
        paths += `<path d="M${x1} ${y1} C${(x1 + x2) / 2} ${y1},${(x1 + x2) / 2} ${y2},${x2} ${y2}" stroke="${types[e.type].color}" stroke-opacity=".8" stroke-width="1.5" fill="none" marker-end="url(#arrow-${e.type})" ${e.type === "partner" ? `marker-start="url(#arrow-${e.type})" stroke-dasharray="4 3"` : ""}/>`;
      });
  svg.innerHTML = paths;
}
function directory() {
  let nodes = A.nodes.filter((n) => n.kind === "company");
  if (state.view === "saved") nodes = A.nodes.filter((n) => saved.has(n.id));
  if (state.sector !== "all")
    nodes = nodes.filter((n) => n.sector === state.sector);
  nodes.sort(
    (a, b) =>
      b.incoming + b.outgoing - (a.incoming + a.outgoing) ||
      a.name.localeCompare(b.name),
  );
  const pageCount = Math.max(1, Math.ceil(nodes.length / 25));
  state.page = Math.min(state.page, pageCount);
  const visible = nodes.slice((state.page - 1) * 25, state.page * 25);
  const isSaved = state.view === "saved";
  return `<section class="panel"><div class="panel-head"><div><p>${nodes.length} ${state.view === "saved" ? (nodes.length === 1 ? "saved organisation" : "saved organisations") : "listed companies"} · sorted by mapped connections</p></div><span class="micro-label">EXPLORE BY SECTOR</span></div><div class="toolbar"><label for="sector">Sector</label><select id="sector"><option value="all">All sectors</option>${[...A.sectors, "External entities"].map((s) => `<option ${s === state.sector ? "selected" : ""}>${esc(s)}</option>`).join("")}</select><span class="muted" style="font-size:10px">Connection counts describe map coverage, not economic importance.</span></div>${nodes.length ? `<div class="directory-scroll"><table class="directory"><thead><tr><th>Company</th><th class="hide-mobile">Sector</th><th>Connections</th>${isSaved ? "<th>Open</th>" : ""}<th>Save</th></tr></thead><tbody>${visible.map((n) => `<tr><td><button class="company-link" data-open="${esc(n.id)}">${avatar(n)}<span><strong>${esc(n.name)}</strong><small>${esc(n.id)}</small></span></button></td><td class="hide-mobile muted">${esc(n.sector)}</td><td>${n.incoming + n.outgoing}</td>${isSaved ? `<td><div class="saved-actions"><a class="button primary" href="#explore/${encodeURIComponent(n.id)}" aria-label="Relations for ${esc(n.name)}">Relations</a>${n.kind === "company" ? `<a class="button" href="/research#${encodeURIComponent(n.id)}" aria-label="Research for ${esc(n.name)}">Research</a>` : `<button class="button" disabled title="Research is available for listed companies only" aria-label="Research unavailable for ${esc(n.name)}">Research</button>`}</div></td>` : ""}<td><button class="icon-button ${saved.has(n.id) ? "saved" : ""}" data-save="${esc(n.id)}" aria-label="${saved.has(n.id) ? "Unsave" : "Save"} ${esc(n.name)}">${saved.has(n.id) ? "★" : "☆"}</button></td></tr>`).join("")}</tbody></table></div><div class="toolbar"><button class="button" data-page="-1" ${state.page === 1 ? "disabled" : ""}>← Previous</button><span class="muted">Page ${state.page} of ${pageCount}</span><button class="button" data-page="1" ${state.page === pageCount ? "disabled" : ""}>Next →</button></div>` : `<div class="empty"><h3>${state.view === "saved" ? "Keep a few companies close." : "No companies in this selection."}</h3>${state.view === "saved" ? "Use the star beside an organisation to save it here." : "Choose another sector to keep exploring."}<br><a class="button primary" href="#directory">Explore the directory ↗</a></div>`}</section>`;
}
function pathForm() {
  const n = byId.get(state.id);
  return `<section class="panel"><div class="panel-head"><div><p>Find the shortest chain in the curated map, including external organisations.</p></div><span class="micro-label">CONNECTION FINDER</span></div><form id="path-form"><div class="form-grid"><div class="form-field"><label for="path-source">Start with</label><input list="organisations" id="path-source" value="${esc(n.id)}" required placeholder="Company name or ticker"></div><div class="form-field"><label for="path-target">Connect to</label><input list="organisations" id="path-target" required placeholder="Try Infosys or INFY"></div></div><datalist id="organisations">${A.nodes.map((n) => `<option value="${esc(n.id)}">${esc(n.name)}</option>`).join("")}</datalist><div class="path-options"><label><input type="checkbox" id="directed"> Follow arrows only</label><label>Relationship <select id="path-type"><option value="all">All types</option>${Object.entries(
    types,
  )
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
    .join(
      "",
    )}</select></label><button class="button primary" type="submit">Find connection →</button></div></form><div id="path-result" aria-live="polite"><div class="empty">Choose two organisations to discover what connects them.<br>By default, the search can travel in either direction. Every step shows the original relationship.</div></div></section><div class="insight" style="margin-top:20px"><strong>A connection is a starting point, not proof of dependency.</strong>A chain can pass through shared investors, customers or broad market groups. It does not show how much revenue is exposed or predict how a shock will spread.</div>`;
}
function resolveNode(value) {
  const q = value.trim().toLowerCase();
  return A.nodes.find(
    (n) => n.id.toLowerCase() === q || n.name.toLowerCase() === q,
  );
}
async function findPath(event) {
  event.preventDefault();
  const source = resolveNode($("#path-source").value),
    target = resolveNode($("#path-target").value),
    result = $("#path-result");
  if (!source || !target) {
    result.innerHTML =
      '<div class="error">Choose a company name or ticker from the suggestions for both fields.</div>';
    return;
  }
  const version = ++pathVersion;
  result.innerHTML = '<div class="loading">Following the connections…</div>';
  try {
    const q = new URLSearchParams({
      source: source.id,
      target: target.id,
      directed: $("#directed").checked,
      type: $("#path-type").value,
    });
    const r = await fetch("/api/paths?" + q);
    if (!r.ok)
      throw Error(
        "Connection search is temporarily unavailable. Please try again.",
      );
    const d = await r.json();
    if (version !== pathVersion || !result.isConnected) return;
    if (!d.found) {
      result.innerHTML =
        '<div class="empty"><h3>No chain found in this map.</h3>Try all relationship types or turn off “Follow arrows only”.<br>This means no mapped path exists; the organisations may still be connected outside our coverage.</div>';
      return;
    }
    result.innerHTML = `<div class="path-result"><h3 style="margin-bottom:20px">${d.edges.length === 0 ? "This is the same organisation." : `${d.edges.length} ${d.edges.length === 1 ? "step" : "steps"} connect these organisations`}</h3>${d.nodes.map((n, i) => `${i ? `<div class="path-edge">${badge(d.edges[i - 1].type)}<br><b>${esc(relationSentence(d.edges[i - 1]))}</b><br>${esc(d.edges[i - 1].label)}${d.edges[i - 1].source !== d.nodes[i - 1].id && d.edges[i - 1].type !== "partner" ? "<br>↶ This step travels against the arrow." : ""}</div>` : ""}<button class="path-node wide" data-open="${esc(n.id)}">${avatar(n)}<span>${esc(n.name)} <small class="muted">${esc(n.kind === "company" ? n.id : n.segment)}</small></span><span style="margin-left:auto">↗</span></button>`).join("")}</div>`;
  } catch (e) {
    if (version === pathVersion && result.isConnected)
      result.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}
function guide() {
  return `<div class="guide-grid"><section class="panel guide-card"><span class="micro-label">01 · START WITH ONE COMPANY</span><h2 style="margin-top:14px">Explore a business in context.</h2><p>Search for a company you know. The centre card is your focus. The left side shows organisations that supply goods, provide services or invest in it. The right side shows recipients of its goods, services or capital.</p><p>Click another company to make it the focus. Use Previous to retrace your exploration.</p></section><section class="panel guide-card"><span class="micro-label">02 · READ THE ARROWS</span><h2 style="margin-top:14px">Follow what flows.</h2><p>An arrow follows goods, services or capital from source to recipient. A supplier → customer arrow means the customer receives goods from the supplier. It does not mean the supplier is dependent on the customer to a known degree.</p><p>Partnerships are mutual and use dashed arrows. Their left or right placement does not indicate a dependency direction.</p></section>${Object.entries(
    types,
  )
    .map(
      ([k, v]) =>
        `<section class="panel guide-card">${badge(k)}<h2>${{ supply: "Goods & components", service: "Expertise & infrastructure", invest: "Ownership & investment", partner: "Working together" }[k]}</h2><p>${{ supply: "Materials, parts, equipment or products move from one business to another. Look at the connection description to understand what is supplied.", service: "Software, consulting, engineering, financial or network services connect businesses. A client group can represent a market rather than one named customer.", invest: "Capital, a parent holding or promoter relationship connects an investor to a company. Some entries describe historical transactions or support rather than current control.", partner: "A joint venture, strategic alliance or ecosystem relationship connects organisations. A partnership does not by itself establish ownership or exclusive supply." }[k]}</p></section>`,
    )
    .join(
      "",
    )}<section class="panel guide-card"><h2>What the map can tell you</h2><p>Discover potential shared customers, suppliers, investors and sectors. Trace a chain to form a research question. Use the connection details to understand each step, then verify it in recent company filings.</p><a href="#explore" class="button primary" style="margin-top:16px">Start exploring ↗</a></section><section class="panel guide-card"><h2>What still needs checking</h2><p>The graph is manually curated and incomplete. Relationship records currently have no source citations, verification dates or revenue weights. Connections may be broad, historical or changed.</p><p>Counts measure recorded connections, not dependency strength. Prices, correlations and modelled scenarios are separate research signals, not proof that one company causes another to move.</p></section></div>`;
}
function showRelation(id) {
  const e = A.edges.find((e) => e.id === id);
  if (!e) return;
  $("#relation-content").innerHTML =
    `${badge(e.type)}<h2 class="relation-heading">${esc(byId.get(e.source).name)}<br><span class="muted">${esc(types[e.type].verb)}</span><br>${esc(byId.get(e.target).name)}</h2><p class="relation-text">${esc(e.label)}</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="button primary" data-dialog-open="${esc(e.source)}">Explore ${esc(byId.get(e.source).name)} ↗</button><button class="button" data-dialog-open="${esc(e.target)}">Explore ${esc(byId.get(e.target).name)} ↗</button></div><p class="relation-note" style="margin-top:22px">Curated relationship · Source citation and verification date are not recorded. This may represent a historical, broad or non-exclusive relationship. Check current company filings before relying on it.</p>`;
  $("#relation-dialog").showModal();
}
function closeSearch() {
  $("#search-results").hidden = true;
  $("#search").setAttribute("aria-expanded", "false");
  $("#search").removeAttribute("aria-activedescendant");
  searchIndex = -1;
}
function search() {
  const q = $("#search").value.trim().toLowerCase();
  searchIndex = -1;
  if (!A || !q) {
    closeSearch();
    return;
  }
  searchMatches = A.nodes
    .filter(
      (n) => n.id.toLowerCase().includes(q) || n.name.toLowerCase().includes(q),
    )
    .sort(
      (a, b) =>
        Number(b.id.toLowerCase() === q) - Number(a.id.toLowerCase() === q) ||
        Number(b.name.toLowerCase().startsWith(q)) -
          Number(a.name.toLowerCase().startsWith(q)) ||
        b.incoming + b.outgoing - (a.incoming + a.outgoing),
    )
    .slice(0, 8);
  $("#search-results").innerHTML = searchMatches.length
    ? searchMatches
        .map(
          (n, i) =>
            `<button class="search-option" id="search-option-${i}" role="option" aria-selected="false" data-open="${esc(n.id)}">${avatar(n)}<span><strong>${esc(n.name)}</strong><small>${esc(n.sector)} · ${esc(n.id)}</small></span><span>↗</span></button>`,
        )
        .join("")
    : '<div class="empty" style="padding:20px">No organisations found. Try another name or ticker.</div>';
  $("#search-results").hidden = false;
  $("#search").setAttribute("aria-expanded", "true");
}
document.addEventListener("click", (event) => {
  const el = event.target.closest("button,a");
  if (!el) return;
  if (el.dataset.dialogOpen) {
    $("#relation-dialog").close();
    openNode(el.dataset.dialogOpen);
  } else if (el.dataset.open) openNode(el.dataset.open);
  else if (el.dataset.save) toggleSave(el.dataset.save);
  else if (el.dataset.type) {
    state.type = el.dataset.type;
    state.limit = 4;
    state.rows = 6;
    render();
  } else if (el.dataset.direction) {
    state.direction = el.dataset.direction;
    render();
  } else if (el.hasAttribute("data-more-map")) {
    state.limit += 6;
    render();
  } else if (el.hasAttribute("data-more-rows")) {
    state.rows += 20;
    render();
  } else if (el.hasAttribute("data-back")) {
    const id = trail.pop();
    if (id) {
      state.id = id;
      state.type = "all";
      state.direction = "all";
      state.limit = 4;
      state.rows = 6;
      location.hash = "#explore/" + encodeURIComponent(id);
    }
  } else if (el.hasAttribute("data-reset")) {
    state.type = "all";
    state.direction = "all";
    state.limit = 4;
    state.rows = 6;
    render();
  } else if (el.dataset.edge) showRelation(el.dataset.edge);
  else if (el.dataset.page) {
    state.page += Number(el.dataset.page);
    render();
  } else if (el.hasAttribute("data-focus"))
    $(".detail-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
});
document.addEventListener("change", (e) => {
  if (e.target.id === "sector") {
    state.sector = e.target.value;
    state.page = 1;
    render();
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "path-form") findPath(e);
});
$("#search").addEventListener("input", search);
$("#search").addEventListener("focus", () => {
  if ($("#search").value) search();
});
$("#search").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSearch();
    return;
  }
  if (["ArrowDown", "ArrowUp"].includes(e.key)) {
    e.preventDefault();
    if ($("#search-results").hidden) search();
    searchIndex = Math.min(
      searchMatches.length - 1,
      Math.max(0, searchIndex + (e.key === "ArrowDown" ? 1 : -1)),
    );
    document.querySelectorAll(".search-option").forEach((el, i) => {
      el.classList.toggle("selected", i === searchIndex);
      el.setAttribute("aria-selected", i === searchIndex);
      if (i === searchIndex) {
        $("#search").setAttribute("aria-activedescendant", el.id);
        el.scrollIntoView({ block: "nearest" });
      }
    });
  }
  if (
    e.key === "Enter" &&
    searchMatches.length &&
    !$("#search-results").hidden
  ) {
    e.preventDefault();
    openNode(searchMatches[Math.max(0, searchIndex)].id);
    $("#search").value = "";
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) closeSearch();
});
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) &&
    !$("#relation-dialog").open
  ) {
    e.preventDefault();
    $("#search").focus();
  }
});
$(".dialog-close").onclick = () => $("#relation-dialog").close();
$("#relation-dialog").addEventListener("click", (e) => {
  if (e.target === $("#relation-dialog")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
});
$("#share").onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    notify("Link copied. Share your current atlas view.");
  } catch {
    notify("Copy the address from your browser to share this view.");
  }
};
window.addEventListener("hashchange", () => {
  state.page = 1;
  state.sector = "all";
  route();
});
window.addEventListener("resize", () => requestAnimationFrame(drawLines));
async function init() {
  try {
    const r = await fetch("/api/atlas");
    if (!r.ok) throw Error("The atlas could not be loaded.");
    A = await r.json();
    byId = new Map(A.nodes.map((n) => [n.id, n]));
    saved = new Set([...saved].filter((id) => byId.has(id)));
    $("#search-hint").textContent =
      `${A.nodes.filter((n) => n.kind === "company").length} companies. Thousands of possibilities.`;
    route();
  } catch (e) {
    $("#content").innerHTML =
      `<div class="error">${esc(e.message)} Check your connection and <button class="button" id="retry">try again</button>.</div>`;
    $("#retry").onclick = init;
    $("#search-hint").textContent = "Unable to load the atlas";
  }
}
init();

// Keep the explorer's saved data consistent with bookmarks edited in another tab.
window.addEventListener("storage", (event) => {
  if (event.key !== "atlas.saved" && event.key !== null) return;
  try {
    const ids = JSON.parse(event.newValue || "[]");
    saved = new Set(
      Array.isArray(ids)
        ? ids.filter((id) => typeof id === "string" && (!byId || byId.has(id)))
        : [],
    );
  } catch {
    saved = new Set();
  }
  if (A) render();
});
