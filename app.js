(() => {
  const SYMBOLS = [
    { id: "BTC-USD", base: "BTC", decimals: 2, step: 0.0001 },
    { id: "ETH-USD", base: "ETH", decimals: 2, step: 0.001 },
    { id: "SOL-USD", base: "SOL", decimals: 2, step: 0.01 },
    { id: "XRP-USD", base: "XRP", decimals: 4, step: 1 },
    { id: "DOGE-USD", base: "DOGE", decimals: 5, step: 10 },
    { id: "LINK-USD", base: "LINK", decimals: 3, step: 0.1 },
    { id: "AVAX-USD", base: "AVAX", decimals: 3, step: 0.1 },
    { id: "LTC-USD", base: "LTC", decimals: 2, step: 0.01 },
  ];
  const BOT_DEFS = [
    { id: "pulse", name: "Pulse", blurb: "Micro-momentum 1–8s bursts." },
    { id: "snap", name: "Snap", blurb: "Fade spikes within ms." },
    { id: "grid", name: "Grid", blurb: "Two-way flow around anchor." },
    { id: "scalp", name: "Scalp", blurb: "Sub-second mean reversion." },
  ];
  const state = {
    size: 1000000000, cash: 1000000000, equity: 1000000000, peak: 1000000000, dailyStart: 1000000000,
    status: "active", targetPct: 10, dailyDdPct: 5, maxDdPct: 10, selected: "BTC-USD",
    quotes: {}, ticks: {}, last: {}, positions: [], fills: [],
    equityCurve: [{ t: Date.now(), e: 1000000000 }],
    bots: BOT_DEFS.map(b => ({ ...b, enabled: true, trades: 0, wins: 0, pnl: 0, score: 0 })),
    autopilot: true, riskPct: 1.15, baseRisk: 1.15, feed: "idle",
    adaptations: 0, regime: "booting", fillRate: 0, fillWindow: [], lastFire: {},
    gridAnchor: {}, adaptLog: [], winStreak: 0, lossStreak: 0, lastAdaptTs: 0,
  };
  const $ = (id) => document.getElementById(id);
  const fmtMoney = (n) => (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2) + "%";
  const fmtPx = (n, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const cls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "muted");
  function log(msg) {
    const t = new Date().toLocaleTimeString("en-AU", { hour12: false });
    state.adaptLog.unshift({ t, msg });
    if (state.adaptLog.length > 100) state.adaptLog.length = 100;
    const el = $("log");
    if (el) el.innerHTML = state.adaptLog.map((x) => `<div><span class="subtle">${x.t}</span>  ${x.msg}</div>`).join("");
  }
  function sizeFromRisk(price, stopPct, step) {
    const riskUsd = state.equity * (state.riskPct / 100);
    const stopDist = price * stopPct;
    if (stopDist <= 0) return step;
    return Math.max(step, Math.floor(riskUsd / stopDist / step) * step);
  }
  function markEquity() {
    let mtm = 0;
    for (const p of state.positions) {
      const px = state.last[p.symbol]?.price ?? p.entry;
      mtm += (px - p.entry) * p.qty * (p.side === "buy" ? 1 : -1);
    }
    state.equity = state.cash + mtm;
    state.peak = Math.max(state.peak, state.equity);
    const pnlPct = (state.equity - state.size) / state.size;
    const dailyDd = (state.dailyStart - state.equity) / state.size;
    const maxDd = (state.peak - state.equity) / state.size;
    if (state.status === "active") {
      if (dailyDd >= state.dailyDdPct / 100 || maxDd >= state.maxDdPct / 100) {
        state.status = "failed"; state.autopilot = false; log("DD rail — locked");
      } else if (pnlPct >= state.targetPct / 100) {
        state.status = "passed"; state.autopilot = false; log("Target hit — Pivex $1B edge");
      }
    }
    const now = Date.now();
    const last = state.equityCurve[state.equityCurve.length - 1];
    if (!last || now - last.t > 600) state.equityCurve.push({ t: now, e: state.equity });
    else last.e = state.equity;
    if (state.equityCurve.length > 320) state.equityCurve.shift();
  }
  function scaleRiskFromStreak() {
    let mult = 1;
    if (state.winStreak >= 4) mult = 1.35;
    else if (state.winStreak >= 2) mult = 1.18;
    else if (state.lossStreak >= 3) mult = 0.78;
    else if (state.lossStreak >= 2) mult = 0.88;
    const eq = state.equityCurve;
    const slope = eq.length > 8 ? (eq[eq.length - 1].e - eq[eq.length - 8].e) / state.size : 0;
    if (slope > 0.004) mult *= 1.12;
    if (slope < -0.003) mult *= 0.85;
    state.riskPct = Math.min(2.05, Math.max(0.55, state.baseRisk * mult));
    const re = $("risk"), rl = $("riskLbl");
    if (re) re.value = state.riskPct.toFixed(2);
    if (rl) rl.textContent = state.riskPct.toFixed(2) + "%";
  }
  function closePos(id, reason = "close") {
    const i = state.positions.findIndex((p) => p.id === id);
    if (i < 0) return;
    const p = state.positions[i];
    const px = state.last[p.symbol]?.price ?? p.entry;
    const dir = p.side === "buy" ? 1 : -1;
    const pnl = (px - p.entry) * p.qty * dir;
    state.cash += p.entry * p.qty * (p.side === "buy" ? 1 : -1) + pnl;
    state.positions.splice(i, 1);
    state.fills.unshift({ id: "f" + Math.random().toString(36).slice(2, 8), symbol: p.symbol, side: p.side === "buy" ? "sell" : "buy", qty: p.qty, price: px, ts: Date.now(), strategy: p.strategy, pnl, reason });
    if (state.fills.length > 240) state.fills.length = 240;
    const bot = state.bots.find((b) => b.id === p.strategy);
    if (bot) {
      bot.trades++; bot.pnl += pnl;
      if (pnl > 0) { bot.wins++; state.winStreak++; state.lossStreak = 0; }
      else { state.lossStreak++; state.winStreak = 0; }
    }
    state.fillWindow.push(Date.now());
    scaleRiskFromStreak(); markEquity(); scheduleRender();
  }
  function place(symbol, side, strategy, reason, stopPct, takePct) {
    if (state.status !== "active") return false;
    const tick = state.last[symbol];
    if (!tick) return false;
    const def = SYMBOLS.find((s) => s.id === symbol) || SYMBOLS[0];
    const qty = sizeFromRisk(tick.price, stopPct, def.step);
    if (qty <= 0) return false;
    const existing = state.positions.find((p) => p.symbol === symbol && p.strategy === strategy);
    if (existing) {
      if (existing.side === side) return false;
      closePos(existing.id, "reverse");
    }
    if (state.positions.filter((p) => p.symbol === symbol).length >= 2 || state.positions.length >= 10) return false;
    const px = tick.price, notional = px * qty;
    if (side === "buy") {
      if (state.cash < notional * 0.12) return false;
      state.cash -= notional;
    } else state.cash += notional;
    state.positions.push({ id: "p" + Math.random().toString(36).slice(2, 9), symbol, side, qty, entry: px, stop: side === "buy" ? px * (1 - stopPct) : px * (1 + stopPct), take: side === "buy" ? px * (1 + takePct) : px * (1 - takePct), openedAt: Date.now(), strategy });
    state.fills.unshift({ id: "f" + Math.random().toString(36).slice(2, 8), symbol, side, qty, price: px, ts: Date.now(), strategy, reason });
    if (state.fills.length > 240) state.fills.length = 240;
    state.fillWindow.push(Date.now());
    markEquity();
    return true;
  }
  function cool(key, ms, now) {
    if ((state.lastFire[key] || 0) + ms > now) return false;
    state.lastFire[key] = now;
    return true;
  }
  function ret(buf, ms, now) {
    if (!buf || buf.length < 3) return 0;
    const target = now - ms;
    let oldest = buf[0];
    for (const t of buf) { if (t.ts <= target) oldest = t; else break; }
    if (!oldest || oldest.ts === now) return 0;
    return buf[buf.length - 1].price / oldest.price - 1;
  }
  function runStrategies(symbol, tick) {
    if (!state.autopilot || state.status !== "active") return;
    const enabled = new Set(state.bots.filter((b) => b.enabled).map((b) => b.id));
    if (!enabled.size) return;
    const buf = state.ticks[symbol] || [];
    if (buf.length < 5) return;
    const now = tick.ts || Date.now();
    const r05 = ret(buf, 500, now), r1 = ret(buf, 1000, now), r2 = ret(buf, 2200, now), r4 = ret(buf, 4000, now), r8 = ret(buf, 8000, now);
    const has = (id) => state.positions.some((p) => p.symbol === symbol && p.strategy === id);
    if (enabled.has("pulse") && !has("pulse") && cool("pulse:" + symbol, 1100, now)) {
      if (r2 > 0.00022 && r2 > r8 * 0.6 && r4 > 0) place(symbol, "buy", "pulse", "up", 0.00115, 0.00235);
      else if (r2 < -0.00022 && r2 < r8 * 0.6 && r4 < 0) place(symbol, "sell", "pulse", "dn", 0.00115, 0.00235);
    }
    if (enabled.has("snap") && !has("snap") && cool("snap:" + symbol, 700, now)) {
      if (r05 < -0.00055 || r1 < -0.00072) place(symbol, "buy", "snap", "dip", 0.00105, 0.00165);
      else if (r05 > 0.00055 || r1 > 0.00072) place(symbol, "sell", "snap", "rip", 0.00105, 0.00165);
    }
    if (enabled.has("grid") && cool("grid:" + symbol, 580, now)) {
      let a = state.gridAnchor[symbol] || tick.price;
      if (Math.abs(tick.price / a - 1) > 0.0028) a = tick.price;
      state.gridAnchor[symbol] = a;
      const step = 0.00032;
      if (!has("grid")) {
        if (tick.price <= a * (1 - step)) place(symbol, "buy", "grid", "bid", 0.00155, 0.00085);
        else if (tick.price >= a * (1 + step)) place(symbol, "sell", "grid", "ask", 0.00155, 0.00085);
      }
    }
    if (enabled.has("scalp") && !has("scalp") && cool("scalp:" + symbol, 420, now)) {
      if (r05 < -0.00028 && r1 > -0.00008) place(symbol, "buy", "scalp", "buy", 0.00078, 0.00098);
      else if (r05 > 0.00028 && r1 < 0.00008) place(symbol, "sell", "scalp", "sell", 0.00078, 0.00098);
    }
  }
  function checkExits(symbol, tick) {
    const remain = [], now = Date.now();
    for (const p of state.positions) {
      if (p.symbol !== symbol) { remain.push(p); continue; }
      const age = now - p.openedAt;
      let stop = p.stop, take = p.take;
      if (age > 35000) {
        const mid = (p.entry + (p.side === "buy" ? p.take : p.stop)) / 2;
        if (p.side === "buy") { stop = Math.max(stop, p.entry * 0.9994); take = Math.min(take, mid); }
        else { stop = Math.min(stop, p.entry * 1.0006); take = Math.max(take, mid); }
      }
      const hitStop = p.side === "buy" ? tick.price <= stop : tick.price >= stop;
      const hitTake = p.side === "buy" ? tick.price >= take : tick.price <= take;
      const timedOut = age > 95000;
      if (hitStop || hitTake || timedOut) {
        const dir = p.side === "buy" ? 1 : -1;
        const pnl = (tick.price - p.entry) * p.qty * dir;
        state.cash += p.entry * p.qty * (p.side === "buy" ? 1 : -1) + pnl;
        state.fills.unshift({ id: "f" + Math.random().toString(36).slice(2, 8), symbol, side: p.side === "buy" ? "sell" : "buy", qty: p.qty, price: tick.price, ts: tick.ts || now, strategy: p.strategy, pnl, reason: timedOut ? "time" : hitStop ? "stop" : "take" });
        const bot = state.bots.find((b) => b.id === p.strategy);
        if (bot) {
          bot.trades++; bot.pnl += pnl;
          if (pnl > 0) { bot.wins++; state.winStreak++; state.lossStreak = 0; }
          else { state.lossStreak++; state.winStreak = 0; }
        }
        state.fillWindow.push(Date.now());
        scaleRiskFromStreak();
      } else remain.push(p);
    }
    state.positions = remain;
  }
  function onTick(symbol, tick) {
    const buf = state.ticks[symbol] || [];
    buf.push(tick);
    if (buf.length > 280) buf.shift();
    state.ticks[symbol] = buf;
    state.last[symbol] = tick;
    const q = state.quotes[symbol] || { open24h: tick.price };
    if (!q.open24h) q.open24h = tick.price;
    const c24 = tick.price - q.open24h;
    state.quotes[symbol] = { ...q, price: tick.price, bid: tick.bid, ask: tick.ask, change24h: c24, changePct: q.open24h ? (c24 / q.open24h) * 100 : 0, ts: tick.ts };
    checkExits(symbol, tick);
    runStrategies(symbol, tick);
    markEquity();
  }
  function adaptRegime() {
    if (state.status !== "active") return;
    const now = Date.now();
    if (now - state.lastAdaptTs < 1600) return;
    state.lastAdaptTs = now;
    const scores = {};
    for (const b of state.bots) scores[b.id] = 0;
    for (const s of SYMBOLS) {
      const buf = state.ticks[s.id];
      if (!buf || buf.length < 12) continue;
      const tnow = buf[buf.length - 1].ts;
      const r1 = ret(buf, 1200, tnow), r3 = ret(buf, 3000, tnow), r8 = ret(buf, 8000, tnow), r20 = ret(buf, 20000, tnow);
      const vol = Math.abs(r1) + Math.abs(r3) + Math.abs(r8);
      scores.pulse += r3 * 55 + (r1 * r3 > 0 ? 0.28 : -0.06) + (Math.abs(r3) > 0.0004 ? 0.12 : 0);
      scores.snap += -r1 * 65 + (Math.abs(r1) > 0.00045 ? 0.22 : 0) + (vol > 0.001 ? 0.08 : 0);
      scores.grid += (Math.abs(r20) < 0.0018 ? 0.32 : -0.06) + (vol > 0.00025 && vol < 0.0025 ? 0.15 : 0);
      scores.scalp += (Math.abs(r1) > 0.00018 && Math.abs(r3) < 0.0009 ? 0.28 : -0.04) + (vol > 0.0004 ? 0.1 : 0);
    }
    for (const b of state.bots) {
      b.score = (scores[b.id] || 0) + (b.pnl / Math.max(1, state.size)) * 12;
      if (b.trades >= 3) b.score += (b.wins / b.trades - 0.45) * 0.9;
    }
    const ranked = [...state.bots].sort((a, b) => b.score - a.score);
    const winners = ranked.filter((b) => b.score > 0.05).slice(0, 3);
    const enable = new Set((winners.length ? winners : ranked.slice(0, 2)).map((b) => b.id));
    if (!enable.size) enable.add("grid");
    if (SYMBOLS.some((s) => { const buf = state.ticks[s.id]; return buf && buf.length >= 8 && Math.abs(ret(buf, 2000, buf[buf.length - 1].ts)) > 0.00025; }) && !enable.has("scalp") && !enable.has("snap"))
      enable.add(ranked[0].id === "grid" ? "scalp" : ranked[0].id);
    let changed = false;
    for (const b of state.bots) {
      const next = enable.has(b.id);
      if (b.enabled !== next) { b.enabled = next; changed = true; }
    }
    state.adaptations++;
    state.regime = winners.map((w) => w.name).join(" + ") || ranked[0].name;
    scaleRiskFromStreak();
    if (changed || state.adaptations % 3 === 1) log(`Adapt #${state.adaptations}: ${state.regime} · risk ${state.riskPct.toFixed(2)}% · eq ${fmtMoney(state.equity)}`);
    if (!state.autopilot && state.status === "active") { state.autopilot = true; log("AP re-armed"); }
    scheduleRender();
  }
  let _raf = 0;
  function scheduleRender() {
    if (_raf) return;
    _raf = requestAnimationFrame(() => { _raf = 0; render(); });
  }
  function renderSpark() {
    const svg = $("spark");
    if (!svg) return;
    const pts = state.equityCurve;
    if (pts.length < 2) { svg.innerHTML = ""; return; }
    const min = Math.min(...pts.map((p) => p.e)), max = Math.max(...pts.map((p) => p.e)), span = Math.max(max - min, 1);
    const path = pts.map((p, i) => {
      const x = 4 + (i / (pts.length - 1)) * 392;
      const y = 4 + (1 - (p.e - min) / span) * 64;
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    svg.innerHTML = `<path d="${path}" fill="none" stroke="${pts[pts.length - 1].e >= pts[0].e ? "var(--up)" : "var(--down)"}" stroke-width="1.6"/>`;
  }
  function render() {
    const pnl = state.equity - state.size, pnlPct = (pnl / state.size) * 100;
    const tp = Math.min(100, Math.max(0, (state.equity - state.size) / (state.size * state.targetPct / 100) * 100));
    const now = Date.now();
    state.fillWindow = state.fillWindow.filter((t) => now - t < 10000);
    state.fillRate = state.fillWindow.length / 10;
    const he = $("hdrEquity"); if (he) { he.textContent = fmtMoney(state.equity); he.className = "val mono " + cls(pnl); }
    const se = $("statEquity"); if (se) se.textContent = fmtMoney(state.equity);
    const sp = $("statPnl"); if (sp) { sp.textContent = fmtPct(pnlPct) + " vs start"; sp.className = "s mono " + cls(pnl); }
    const edge = $("statEdge"); if (edge) { edge.textContent = fmtMoney(pnl); edge.className = "v mono " + cls(pnl); }
    const fills = $("statFills"); if (fills) fills.textContent = `${state.fills.length} fills · ${state.fillRate.toFixed(2)}/s`;
    const st = $("statTarget"); if (st) st.textContent = tp.toFixed(0) + "%";
    const bar = $("targetBar"); if (bar) bar.style.width = tp + "%";
    const sa = $("statAdapt"); if (sa) sa.textContent = String(state.adaptations);
    const sr = $("statRegime"); if (sr) sr.textContent = state.regime;
    const feed = $("feedPill"); if (feed) { feed.className = "pill " + (state.feed === "live" ? "live" : state.feed === "polling" ? "on" : "off"); feed.innerHTML = `<span class="dot"></span>${state.feed === "live" ? "Live tape" : state.feed === "polling" ? "Live · REST" : "Connecting"}`; }
    const auto = $("autoPill"); if (auto) { auto.className = "pill " + (state.autopilot ? "on" : "off"); auto.textContent = state.autopilot ? "Autopilot armed" : "Autopilot idle"; }
    const tape = $("tape"); if (tape) tape.innerHTML = [...SYMBOLS, ...SYMBOLS].map((s) => { const q = state.quotes[s.id], pct = q ? q.changePct : 0; return `<span class="tick-item"><span class="sym">${s.base}</span><span>${q ? fmtPx(q.price, s.decimals) : "—"}</span> <span class="${cls(pct)}">${q ? fmtPct(pct) : ""}</span></span>`; }).join("");
    const watch = $("watch"); if (watch) {
      watch.innerHTML = SYMBOLS.map((s) => { const q = state.quotes[s.id], pct = q ? q.changePct : 0; return `<button type="button" data-sym="${s.id}" class="${state.selected === s.id ? "on" : ""}"><span><strong class="mono">${s.base}</strong><br><span class="subtle" style="font-size:11px">${s.id}</span></span><span class="mono" style="text-align:right">${q ? fmtPx(q.price, s.decimals) : "—"}<br><span class="${cls(pct)}" style="font-size:11px">${q ? fmtPct(pct) : ""}</span></span></button>`; }).join("");
      watch.querySelectorAll("button").forEach((btn) => { btn.onclick = () => { state.selected = btn.dataset.sym; scheduleRender(); }; });
    }
    const def = SYMBOLS.find((s) => s.id === state.selected) || SYMBOLS[0], last = state.last[state.selected], tm = $("ticketMeta");
    if (tm) tm.textContent = last ? `${def.id} · last ${fmtPx(last.price, def.decimals)} · risk ${state.riskPct.toFixed(2)}%` : "Waiting for live print…";
    const botsEl = $("bots"); if (botsEl) {
      botsEl.innerHTML = state.bots.map((b) => `<div class="bot"><div class="name">${b.name}${b.enabled ? ' <span class="up" style="font-size:11px">ON</span>' : ' <span class="subtle" style="font-size:11px">off</span>'}</div><button class="switch ${b.enabled ? "on" : ""}" data-bot="${b.id}" type="button"></button><div class="blurb">${b.blurb}</div><div class="metrics mono"><span>P&L <span class="${cls(b.pnl)}">${fmtMoney(b.pnl)}</span></span><span>fills ${b.trades}</span><span>score ${b.score.toFixed(2)}</span></div></div>`).join("");
      botsEl.querySelectorAll(".switch").forEach((sw) => { sw.onclick = () => { const bot = state.bots.find((b) => b.id === sw.dataset.bot); if (bot) { bot.enabled = !bot.enabled; scheduleRender(); } }; });
    }
    const posBody = $("posBody"); if (posBody) {
      if (!state.positions.length) posBody.innerHTML = `<tr><td colspan="8" class="subtle">Waiting on live edge…</td></tr>`;
      else {
        posBody.innerHTML = state.positions.map((p) => {
          const px = state.last[p.symbol]?.price ?? p.entry, dir = p.side === "buy" ? 1 : -1, pnl = (px - p.entry) * p.qty * dir;
          const d = SYMBOLS.find((s) => s.id === p.symbol) || SYMBOLS[0];
          return `<tr><td class="mono">${d.base}</td><td class="${p.side === "buy" ? "up" : "down"}">${p.side}</td><td class="mono">${p.qty}</td><td class="mono">${fmtPx(p.entry, d.decimals)}</td><td class="mono">${fmtPx(px, d.decimals)}</td><td class="mono ${cls(pnl)}">${fmtMoney(pnl)}</td><td>${p.strategy}</td><td><button class="btn ghost" data-close="${p.id}" style="padding:4px 8px;font-size:11px">×</button></td></tr>`;
        }).join("");
        posBody.querySelectorAll("[data-close]").forEach((btn) => { btn.onclick = () => closePos(btn.dataset.close, "manual"); });
      }
    }
    renderSpark();
  }
  async function pullTickers() {
    try {
      const ticks = await Promise.all(SYMBOLS.map(async (s) => {
        try {
          const r = await fetch(`https://api.exchange.coinbase.com/products/${s.id}/ticker`);
          if (!r.ok) return null;
          const j = await r.json();
          return { id: s.id, price: +j.price, bid: +j.bid, ask: +j.ask, ts: Date.now() };
        } catch { return null; }
      }));
      for (const r of ticks) if (r && Number.isFinite(r.price)) onTick(r.id, { price: r.price, bid: r.bid || r.price, ask: r.ask || r.price, ts: r.ts });
      if (state.feed !== "live") state.feed = "polling";
      scheduleRender();
    } catch {}
  }
  function connectWs() {
    let ws;
    try { ws = new WebSocket("wss://ws-feed.exchange.coinbase.com"); }
    catch { state.feed = "polling"; setTimeout(connectWs, 3000); return; }
    ws.onopen = () => {
      state.feed = "live";
      ws.send(JSON.stringify({ type: "subscribe", product_ids: SYMBOLS.map((s) => s.id), channels: ["ticker"] }));
      log("WS live — Pivex $1B turbo armed");
      scheduleRender();
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type !== "ticker" || !msg.product_id || !msg.price) return;
        const price = +msg.price, bid = +(msg.best_bid || msg.price), ask = +(msg.best_ask || msg.price);
        if (!Number.isFinite(price)) return;
        onTick(msg.product_id, { price, bid: Number.isFinite(bid) ? bid : price, ask: Number.isFinite(ask) ? ask : price, ts: msg.time ? Date.parse(msg.time) : Date.now() });
        scheduleRender();
      } catch {}
    };
    ws.onclose = () => { if (state.feed === "live") { state.feed = "polling"; log("WS closed → REST"); setTimeout(connectWs, 1800); } };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  $("btnArm").onclick = () => { state.bots.forEach((b) => (b.enabled = true)); state.autopilot = true; adaptRegime(); log("Max edge armed · $1B"); scheduleRender(); };
  $("btnDisarm").onclick = () => { state.autopilot = false; state.positions.map((p) => p.id).forEach((id) => closePos(id, "flatten")); log("Disarmed"); scheduleRender(); };
  $("btnReset").onclick = () => {
    state.cash = state.size; state.equity = state.size; state.peak = state.size; state.dailyStart = state.size;
    state.status = "active"; state.positions = []; state.fills = []; state.equityCurve = [{ t: Date.now(), e: state.size }];
    state.bots.forEach((b) => { b.trades = 0; b.wins = 0; b.pnl = 0; b.enabled = true; b.score = 0; });
    state.autopilot = true; state.adaptations = 0; state.winStreak = 0; state.lossStreak = 0; state.riskPct = state.baseRisk;
    log("Reset $1B — turbo live · empire scale"); scheduleRender();
  };
  $("btnBuy").onclick = () => { place(state.selected, "buy", "manual", "ticket", 0.0014, 0.0024); scheduleRender(); };
  $("btnSell").onclick = () => { place(state.selected, "sell", "manual", "ticket", 0.0014, 0.0024); scheduleRender(); };
  $("risk").oninput = (e) => { state.baseRisk = +e.target.value; state.riskPct = state.baseRisk; $("riskLbl").textContent = state.riskPct.toFixed(2) + "%"; };
  log("v2.1 turbo boot — Pivex $1B challenge");
  pullTickers(); setInterval(pullTickers, 2200); connectWs(); setInterval(adaptRegime, 2000);
  setInterval(() => { if (state.fillRate > 0.35 && state.status === "active") adaptRegime(); }, 900);
  setInterval(() => { if (state.autopilot && state.status === "active") document.title = `Northline ${fmtPct(((state.equity - state.size) / state.size) * 100)} · $1B`; }, 1200);
  scheduleRender();
})();
