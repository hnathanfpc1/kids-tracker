/* Kids Tracker: shared schedule logic plus the family page and the admin page. */
(() => {
  "use strict";
  const PAGE = document.body.dataset.page;          // "family" or "admin"
  const CFG = window.KT_CONFIG || {};
  const CONFIGURED = /^https:\/\//.test(CFG.url || "") && CFG.key && !/PASTE_/.test(CFG.key);

  // ---------- Dates (whole days as numbers, so no time zone drift) ----------
  const DAY = 86400000;
  const pad = n => String(n).padStart(2, "0");
  const toNum = s => { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
  const toStr = n => new Date(n * DAY).toISOString().slice(0, 10);
  const ymd = (y, m, d) => Math.round(Date.UTC(y, m, d) / DAY);
  const wd = n => new Date(n * DAY).getUTCDay();
  const yearOf = n => new Date(n * DAY).getUTCFullYear();
  const fmt = (n, o) => new Date(n * DAY).toLocaleDateString("en-US", Object.assign({ timeZone: "UTC" }, o));
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const todayNum = () => { const t = new Date(); return toNum(`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`); };
  const thisMonth = () => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; };
  const SD = { month: "short", day: "numeric" };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let T0 = todayNum();

  // ---------- State ----------
  const st = {
    settings: { myName: "Heather", coName: "Brett", anchor: null, trackFrom: null },
    swaps: new Map(),   // "YYYY-MM-DD" -> { date, had: me|co|other, with, reason, note, pnote }
    breaks: {},         // year -> { firstDay, lastDay, spL, spR, tgL, tgR, xmL, xmR, school: [], summer: [] }
    link: null,         // admin only: active share link row
    period: "ytd",
    view: { admin: thisMonth(), family: thisMonth() },
    holYear: new Date().getFullYear(),
    day: null, pick: null, draft: null,
  };
  const S = () => st.settings;

  // One neutral set of reasons, the same wording on both pages.
  const REASONS = { work: "Work", travel: "Travel", coverage: "Coverage requested", other: "Trade or other" };
  const reasonLabel = rec => (rec && REASONS[rec.reason]) || "";
  const nameOf = (who, rec) => who === "me" ? S().myName : who === "co" ? S().coName : ((rec && rec.with) || "Someone else");
  const famWhy = rec => rec ? [reasonLabel(rec), rec.note].filter(Boolean).join(". ") : "";

  // ---------- Holidays from the custody agreement ("me" = Mother/Wife, "co" = Father/Husband) ----------
  const HOL = {
    sum: { s: "Summer week", n: "Summer week" }, spring: { s: "Spring break", n: "Spring break" },
    tg: { s: "Thanksgiving", n: "Thanksgiving" }, xm1: { s: "Christmas", n: "Christmas, first part" },
    xm2: { s: "Christmas", n: "Christmas, second part" }, md: { s: "Mother's Day", n: "Mother's Day weekend" },
    fd: { s: "Father's Day", n: "Father's Day weekend" },
  };
  const nthSunday = (y, m, k) => { const f = ymd(y, m, 1); return f + ((7 - wd(f)) % 7) + 7 * (k - 1); };
  function holidayPeriods(y) {
    const b = st.breaks[y] || {}, odd = y % 2 === 1, ok = k => isDate(b[k]), out = [];
    (Array.isArray(b.summer) ? b.summer : []).forEach(s => {
      if (s && isDate(s.start) && (s.who === "me" || s.who === "co")) { const a = toNum(s.start); out.push({ key: "sum", who: s.who, start: a, end: a + 6 }); }
    });
    // Spring: Husband even years, Wife odd. Ends 6 p.m. the evening before school, so that night returns to the rotation.
    const spW = odd ? "me" : "co";
    if (ok("spL") && ok("spR") && toNum(b.spR) - 2 >= toNum(b.spL)) out.push({ key: "spring", who: spW, start: toNum(b.spL), end: toNum(b.spR) - 2 });
    else out.push({ key: "spring", who: spW, missing: true });
    // Thanksgiving: Father odd years, Mother even. Dismissal until school resumes.
    const tgW = odd ? "co" : "me";
    if (ok("tgL") && ok("tgR") && toNum(b.tgR) - 1 >= toNum(b.tgL)) out.push({ key: "tg", who: tgW, start: toNum(b.tgL), end: toNum(b.tgR) - 1 });
    else out.push({ key: "tg", who: tgW, missing: true });
    // Christmas: odd years Mother has the first part (to 2 p.m. Dec 26), Father the second. Even years reverse.
    const p1 = odd ? "me" : "co", p2 = odd ? "co" : "me", d25 = ymd(y, 11, 25);
    if (ok("xmL") && ok("xmR") && toNum(b.xmR) - 1 >= toNum(b.xmL)) {
      const L = toNum(b.xmL), R = toNum(b.xmR) - 1;
      if (L <= d25) out.push({ key: "xm1", who: p1, start: L, end: Math.min(d25, R) });
      if (R > d25) out.push({ key: "xm2", who: p2, start: Math.max(d25 + 1, L), end: R });
    } else { out.push({ key: "xm1", who: p1, missing: true }); out.push({ key: "xm2", who: p2, missing: true }); }
    // Mother's / Father's Day weekends: Friday after school to Monday drop-off = Fri, Sat, Sun nights.
    const md = nthSunday(y, 4, 2), fd = nthSunday(y, 5, 3);
    out.push({ key: "md", who: "me", start: md - 2, end: md });
    out.push({ key: "fd", who: "co", start: fd - 2, end: fd });
    return out;
  }

  let holMap = new Map(), schoolMap = new Map(), firsts = new Map(), lasts = new Map();
  function rebuild() {
    T0 = todayNum();
    const m = new Map(), y0 = new Date().getFullYear();
    const years = new Set(Object.keys(st.breaks).map(Number));
    for (let y = y0 - 2; y <= y0 + 3; y++) years.add(y);
    [...years].sort((a, b) => a - b).forEach(y => holidayPeriods(y).filter(p => !p.missing).forEach(p => {
      for (let n = p.start; n <= p.end; n++) { const c = m.get(n); if (!c || c.key === "sum") m.set(n, { who: p.who, key: p.key }); }
    }));
    holMap = m;
    const s = new Map(); firsts = new Map(); lasts = new Map();
    Object.entries(st.breaks).forEach(([y, b]) => {
      if (isDate(b.firstDay)) firsts.set(Number(y), toNum(b.firstDay));
      if (isDate(b.lastDay)) lasts.set(Number(y), toNum(b.lastDay));
      (Array.isArray(b.school) ? b.school : []).forEach(d => {
        if (!d || !isDate(d.s)) return;
        const a = toNum(d.s), e = isDate(d.e) ? Math.max(a, toNum(d.e)) : a;
        for (let n = a; n <= e && n < a + 120; n++) if (wd(n) !== 0 && wd(n) !== 6) s.set(n, { t: d.t === "half" ? "half" : "off", l: d.l || (d.t === "half" ? "Half day" : "No school") });
      });
    });
    schoolMap = s;
  }
  const rotation = n => { const wk = Math.floor((n - toNum(S().anchor)) / 7); return ((wk % 2) + 2) % 2 === 0 ? "me" : "co"; };
  const scheduled = n => { const h = holMap.get(n); return h ? h.who : rotation(n); };
  const recOf = n => st.swaps.get(toStr(n));
  const actual = n => { const r = recOf(n); return r ? r.had : scheduled(n); };
  const holderKey = n => { const a = actual(n); return a === "other" ? "other:" + nameOf(a, recOf(n)) : a; };
  function schoolOn(n) {
    const sd = schoolMap.get(n);
    if (sd) return sd;
    if (wd(n) === 0 || wd(n) === 6) return { t: "weekend" };
    for (const [y, f] of firsts) { const l = lasts.get(y + 1); if (n >= f && n <= (l != null ? l : f + 300)) return { t: "school" }; }
    for (const [y, l] of lasts) { const f = firsts.get(y); if (n > l && n < (f != null ? f : l + 76)) return { t: "off", l: "Summer break" }; }
    return { t: "unknown" };
  }
  // When a handoff into day n happens. Regular Friday switch: after school, or 5 p.m. with no school.
  function handoffTime(n) {
    if (recOf(n) || recOf(n - 1)) return "";
    const hol = holMap.get(n), prev = holMap.get(n - 1), sc = schoolOn(n);
    const school = sc.t === "school" || sc.t === "half";
    if (hol && (!prev || prev.key !== hol.key)) {
      if (hol.key === "xm2") return "at 2 p.m.";
      if (hol.key === "spring" && hol.who === "me") return "at 6 p.m.";
      if (hol.key === "sum") return "";
      return school ? "after school" : "";
    }
    if (prev && (!hol || hol.key !== prev.key)) {
      if (prev.key === "spring") return "at 6 p.m.";
      if (prev.key === "sum") return "";
      return school ? "after school" : "";
    }
    if (wd(n) === 5) return school ? "after school" : "at 5 p.m.";
    return "";
  }
  function switchGroups(a, b) {
    const out = []; let cur = null;
    for (let n = a; n <= b; n++) {
      const r = recOf(n);
      if (!r) { cur = null; continue; }
      const k = [r.had, r.with, r.reason, r.note].join("|");
      if (cur && cur.k === k && cur.end === n - 1) cur.end = n;
      else { cur = { k, start: n, end: n, rec: r }; out.push(cur); }
    }
    return out;
  }
  // Weekdays with the same school label, bridging the weekend between them.
  function schoolGroups(a, b) {
    const out = []; let cur = null;
    for (let n = a; n <= b; n++) {
      const s = schoolMap.get(n), k = s ? s.t + "|" + s.l : "";
      if (k) {
        if (cur && cur.k === k && cur.end >= n - 3) cur.end = n;
        else { cur = { k, t: s.t, l: s.l, start: n, end: n }; out.push(cur); }
      } else if (wd(n) !== 0 && wd(n) !== 6) cur = null;
    }
    return out;
  }
  const range = (a, b) => b > a ? `${fmt(a, SD)} to ${fmt(b, SD)}` : fmt(a, { weekday: "short", ...SD });

  // ---------- UI helpers ----------
  let tT;
  const toast = m => { const el = $("toast"); el.textContent = m; el.hidden = false; clearTimeout(tT); tT = setTimeout(() => { el.hidden = true; }, 3200); };
  const closeAll = () => document.querySelectorAll(".scrim").forEach(s => { s.hidden = true; });

  // ---------- Calendar ----------
  function renderCal(mode) {
    const v = st.view[mode], first = ymd(v.y, v.m, 1), last = ymd(v.y, v.m + 1, 0);
    $(mode === "admin" ? "aMonth" : "fMonth").textContent = fmt(first, { month: "long", year: "numeric" });
    const h = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<div class="dow">${d}</div>`);
    for (let n = first - wd(first); n <= last + (6 - wd(last)); n++) {
      const a = actual(n), rec = recOf(n), hol = holMap.get(n), sc = schoolOn(n), nm = nameOf(a, rec);
      const cls = ["day", a];
      if (rec) cls.push("swap");
      if (n < first || n > last) cls.push("out");
      if (n === T0) cls.push("today");
      const lab = [fmt(n, { weekday: "long", month: "long", day: "numeric" }), nm, rec ? "switched" : "", hol ? HOL[hol.key].n : "",
        sc.t === "off" ? "No school: " + sc.l : sc.t === "half" ? sc.l : ""].filter(Boolean).join(", ");
      h.push(`<button type="button" class="${cls.join(" ")}" data-n="${n}" data-mode="${mode}" aria-label="${esc(lab)}">
        <span class="top"><span class="d num">${fmt(n, { day: "numeric" })}${hol ? ` <span class="star" aria-hidden="true">&#9733;</span>` : ""}</span>
          <span class="badges">${sc.t === "half" ? `<span class="half" aria-hidden="true">&frac12;</span>` : ""}${rec ? `<span class="sw" aria-hidden="true">&#8644;</span>` : ""}</span></span>
        ${hol ? `<span class="hol">${esc(HOL[hol.key].s)}</span>` : ""}
        <span class="who"><span class="wl">${esc(nm)}</span><span class="ws" aria-hidden="true">${esc(nm.charAt(0))}</span></span>
        ${sc.t === "off" ? `<span class="nos" aria-hidden="true"><span class="wl">No school</span><span class="ws">Off</span></span>` : ""}</button>`);
    }
    $(mode === "admin" ? "aGrid" : "fGrid").innerHTML = h.join("");
    $(mode === "admin" ? "aLegend" : "fLegend").innerHTML = [
      `<span><i class="k-me"></i>${esc(S().myName)}</span>`, `<span><i class="k-co"></i>${esc(S().coName)}</span>`, `<span><i class="k-ot"></i>Someone else</span>`,
      `<span><span class="sw-k">&#8644;</span>Switched</span>`, `<span><b>&#9733;</b> Holiday schedule</span>`, `<span><i class="k-nos"></i>No school</span>`, `<span><b>&frac12;</b> Half day</span>`,
    ].join("");
  }
  function navMonth(mode, step) {
    if (!step) st.view[mode] = thisMonth();
    else { const x = new Date(Date.UTC(st.view[mode].y, st.view[mode].m + step, 1)); st.view[mode] = { y: x.getUTCFullYear(), m: x.getUTCMonth() }; }
  }

  // ======================================================================
  // FAMILY PAGE
  // ======================================================================
  function renderNow() {
    const a = actual(T0), rec = recOf(T0), key = holderKey(T0);
    let end = T0; while (end < T0 + 60 && holderKey(end + 1) === key) end++;
    const nx = end + 1, nName = nameOf(actual(nx), recOf(nx)), ht = handoffTime(nx);
    const hol = holMap.get(T0), sc = schoolOn(T0), why = famWhy(rec);
    const thru = end === T0 ? "Tonight only." : `Through ${fmt(end, { weekday: "long", month: "short", day: "numeric" })}.`;
    const next = `${nName} picks up ${nx === T0 + 1 ? "tomorrow" : fmt(nx, { weekday: "long", month: "short", day: "numeric" })}${ht ? " " + ht : ""}.`;
    const schoolTxt = sc.t === "school" ? "School today" : sc.t === "half" ? sc.l + " today" : sc.t === "off" ? "No school today: " + sc.l : sc.t === "weekend" ? "Weekend" : "";
    const box = $("famNow");
    box.className = "now " + a;
    box.innerHTML = `<span class="eyebrow">Right now</span>
      <span class="who-big">With ${esc(nameOf(a, rec))}</span>
      <p>${esc(thru)} ${esc(next)}</p>
      ${rec ? `<p><strong>&#8644; Switched</strong> (usually ${esc(nameOf(scheduled(T0)))}'s day)${why ? ": " + esc(why) : ""}</p>` : ""}
      ${hol ? `<p><strong>${esc(HOL[hol.key].n)}</strong> (${esc(nameOf(hol.who))}'s holiday this year)</p>` : ""}
      ${schoolTxt ? `<span class="school">${esc(schoolTxt)}</span>` : ""}`;
  }
  function renderNotes() {
    const v = st.view.family, first = ymd(v.y, v.m, 1), last = ymd(v.y, v.m + 1, 0), items = [], seen = new Set();
    switchGroups(first, last).forEach(g => {
      const w = famWhy(g.rec);
      items.push({ k: g.start, h: `<li><span class="dt">${range(g.start, g.end)}</span><span>&#8644; Switched to <span class="chip ${g.rec.had}">${esc(nameOf(g.rec.had, g.rec))}</span>${esc(w)}</span></li>` });
    });
    for (let y = v.y - 1; y <= v.y; y++) holidayPeriods(y).filter(p => !p.missing && p.end >= first && p.start <= last).forEach(p => {
      const id = p.key + p.start; if (seen.has(id)) return; seen.add(id);
      items.push({ k: p.start, h: `<li><span class="dt">${range(p.start, p.end)}</span><span>&#9733; ${esc(HOL[p.key].n)} <span class="chip ${p.who}">${esc(nameOf(p.who))}</span></span></li>` });
    });
    schoolGroups(first, last).forEach(g => items.push({ k: g.start, h: `<li><span class="dt">${range(g.start, g.end)}</span><span>${g.t === "half" ? esc(g.l) : "No school: " + esc(g.l)}</span></li>` }));
    items.sort((a, b) => a.k - b.k);
    $("fNotes").innerHTML = items.length ? items.map(i => i.h).join("") : `<li style="color:var(--muted)">No switches, holidays or days off school this month.</li>`;
  }
  function renderUp() {
    const end = T0 + 42, byDay = new Map();
    const add = (n, html) => { if (!byDay.has(n)) byDay.set(n, []); byDay.get(n).push(html); };
    for (let n = T0 + 1; n <= end; n++) {
      if (holderKey(n) === holderKey(n - 1)) continue;
      let e = n; while (e < n + 60 && holderKey(e + 1) === holderKey(n)) e++;
      const a = actual(n), ht = handoffTime(n);
      add(n, `<p><span class="chip ${a}">${esc(nameOf(a, recOf(n)))}</span>${ht ? "picks up " + ht + ", " : ""}${e === n ? "for the night" : "through " + fmt(e, { weekday: "short", ...SD })}</p>`);
    }
    switchGroups(T0 + 1, end).forEach(g => {
      const w = famWhy(g.rec);
      add(g.start, `<p class="sub2">&#8644; Switched${g.end > g.start ? " through " + fmt(g.end, { weekday: "short", ...SD }) : ""}, usually ${esc(nameOf(scheduled(g.start)))}'s${w ? ": " + esc(w) : ""}</p>`);
    });
    for (let y = yearOf(T0) - 1; y <= yearOf(T0) + 1; y++)
      holidayPeriods(y).filter(p => !p.missing && p.start > T0 && p.start <= end).forEach(p => add(p.start, `<p><strong>&#9733; ${esc(HOL[p.key].n)}</strong> begins, ${esc(nameOf(p.who))}'s year</p>`));
    schoolGroups(T0 + 1, end).forEach(g => add(g.start, `<p class="sub2">${g.t === "half" ? esc(g.l) : "No school" + (g.end > g.start ? " through " + fmt(g.end, { weekday: "short", ...SD }) : "") + ": " + esc(g.l)}</p>`));
    const days = [...byDay.keys()].sort((a, b) => a - b);
    $("fUp").innerHTML = days.length ? days.map(n => `<li><div class="when num">${fmt(n, SD)}<small>${fmt(n, { weekday: "long" })}</small></div><div class="lines">${byDay.get(n).join("")}</div></li>`).join("")
      : `<li><p class="empty">Nothing changes in the next six weeks.</p></li>`;
  }
  function openFamDay(n) {
    const a = actual(n), rec = recOf(n), hol = holMap.get(n), sc = schoolOn(n);
    $("fdTitle").textContent = fmt(n, { weekday: "long", month: "long", day: "numeric" });
    const lines = [`<p><span class="chip ${a}">${esc(nameOf(a, rec))}</span>has the kids that night</p>`];
    if (rec) {
      lines.push(`<p><strong>&#8644; Switched.</strong> Usually ${esc(nameOf(scheduled(n)))}'s day.</p>`);
      if (reasonLabel(rec)) lines.push(`<p>Why: ${esc(reasonLabel(rec))}</p>`);
      if (rec.note) lines.push(`<p>Note: ${esc(rec.note)}</p>`);
    }
    if (hol) lines.push(`<p>&#9733; ${esc(HOL[hol.key].n)} (${esc(nameOf(hol.who))}'s holiday this year)</p>`);
    if (sc.t === "off") lines.push(`<p>No school: ${esc(sc.l)}</p>`);
    else if (sc.t === "half") lines.push(`<p>${esc(sc.l)}</p>`);
    else if (sc.t === "school") lines.push(`<p>School day</p>`);
    if (holderKey(n - 1) !== holderKey(n)) { const ht = handoffTime(n); lines.push(`<p>Handoff: ${esc(nameOf(actual(n - 1), recOf(n - 1)))} to ${esc(nameOf(a, rec))}${ht ? ", " + esc(ht) : ""}</p>`); }
    $("fdBody").innerHTML = lines.join("");
    $("famDayScrim").hidden = false;
  }
  function renderFamily() { rebuild(); renderNow(); renderCal("family"); renderNotes(); renderUp(); }

  let lastLoad = 0;
  function famMessage(text) { $("famMsgText").textContent = text; $("famMsg").hidden = false; $("famContent").hidden = true; }
  async function loadFamily() {
    if (!CONFIGURED) return famMessage("This page isn't set up yet.");
    const m = location.hash.match(/k=([A-Za-z0-9]+)/);
    if (!m) return famMessage("Open this page from the link Heather sent you.");
    try {
      const r = await fetch(`${CFG.url}/rest/v1/rpc/get_schedule`, {
        method: "POST", headers: { apikey: CFG.key, "Content-Type": "application/json" }, body: JSON.stringify({ p_token: m[1] }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      if (!data) return famMessage("This link isn't active anymore. Ask Heather for the new one.");
      const s = data.settings || {};
      if (!isDate(s.anchor)) return famMessage("The schedule isn't set up yet.");
      st.settings = { myName: s.my_name || "Heather", coName: s.co_name || "Brett", anchor: s.anchor, trackFrom: s.anchor };
      st.breaks = {}; (data.breaks || []).forEach(b => { st.breaks[b.year] = b.data || {}; });
      st.swaps = new Map();
      (data.swaps || []).forEach(w => { if (isDate(w.day)) st.swaps.set(w.day, { date: w.day, had: w.had, with: w.caregiver || "", reason: w.reason || "", note: w.note || "", pnote: "" }); });
      lastLoad = Date.now();
      renderFamily();
      $("updated").textContent = "Updated " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      $("famMsg").hidden = true; $("famContent").hidden = false;
    } catch (e) {
      if (!lastLoad) famMessage("Couldn't load the schedule. Check your connection and refresh the page.");
    }
  }

  // ======================================================================
  // ADMIN PAGE
  // ======================================================================
  let sb = null, entering = false, signinEmail = "";
  const views = ["vLoading", "vSetup", "vSignin", "vNotAdmin", "vApp"];
  const show = id => { views.forEach(v => { $(v).hidden = v !== id; }); $("topBtns").hidden = id !== "vApp"; };
  const famUrl = tok => new URL("./", location.href).href + "#k=" + tok;
  const fail = (what, e) => { console.error(e); toast(`Couldn't ${what}: ${(e && e.message) || "check your connection"}.`); };

  function renderTotals() {
    const from = isDate(S().trackFrom) ? toNum(S().trackFrom) : toNum(S().anchor), v = st.view.admin;
    let start, end = T0;
    if (st.period === "month") { start = ymd(v.y, v.m, 1); end = Math.min(T0, ymd(v.y, v.m + 1, 0)); }
    else if (st.period === "ytd") start = ymd(new Date().getFullYear(), 0, 1);
    else start = from;
    start = Math.max(start, from);
    let me = 0, co = 0, ot = 0, meCov = 0, coCov = 0; const otBy = new Map();
    for (let n = start; n <= end; n++) {
      const a = actual(n);
      if (a === "other") { ot++; const nm = nameOf(a, recOf(n)); otBy.set(nm, (otBy.get(nm) || 0) + 1); continue; }
      a === "me" ? me++ : co++;
      if (a !== scheduled(n)) a === "me" ? meCov++ : coCov++;
    }
    const tot = me + co + ot, pct = x => tot ? Math.round(x / tot * 1000) / 10 : 0;
    $("meLbl").textContent = S().myName; $("coLbl").textContent = S().coName;
    $("meN").textContent = me; $("coN").textContent = co;
    $("mePct").textContent = tot ? pct(me) + "%" : "No nights yet"; $("coPct").textContent = tot ? pct(co) + "%" : "";
    $("meBar").style.width = (tot ? pct(me) : 50) + "%"; $("otBar").style.width = pct(ot) + "%"; $("coBar").style.width = (tot ? pct(co) : 50) + "%";
    const net = meCov - coCov, items = [];
    items.push(tot ? `<li>${fmt(start, SD)} to ${fmt(end, { ...SD, year: "numeric" })}, <strong class="num">${tot}</strong> nights</li>` : `<li>Nothing counted in this period yet</li>`);
    if (ot) items.push(`<li>${[...otBy].map(([nm, c]) => `${esc(nm)} kept them <strong class="num" style="color:var(--ot)">${c}</strong>`).join(", ")} (${pct(ot)}%)</li>`);
    items.push(`<li>${esc(S().myName)} covered <strong class="num">${meCov}</strong> for ${esc(S().coName)}</li>`);
    items.push(`<li>${esc(S().coName)} covered <strong class="num">${coCov}</strong> for ${esc(S().myName)}</li>`);
    items.push(`<li>Net <strong class="num">${net > 0 ? "+" : ""}${net}</strong>${net ? " to " + esc(net > 0 ? S().myName : S().coName) : ""}</li>`);
    $("facts").innerHTML = items.join("");
    document.querySelectorAll("[data-period]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.period === st.period)));
  }
  function renderLog() {
    const rows = [...st.swaps.values()].sort((a, b) => a.date < b.date ? 1 : -1);
    $("logCount").textContent = `${rows.length} day${rows.length === 1 ? "" : "s"}`;
    $("log").innerHTML = rows.length ? rows.map(r => {
      const n = toNum(r.date);
      return `<li><div class="when num">${fmt(n, SD)}<small>${fmt(n, { weekday: "short", year: "numeric" })}</small></div>
        <div class="what"><p><span class="chip ${r.had}">${esc(nameOf(r.had, r))}</span>${n > T0 ? `<span class="chip plain">Upcoming</span>` : ""}</p>
        <p>${esc(reasonLabel(r) || "Change")}</p>${r.note ? `<p class="sub2">${esc(r.note)}</p>` : ""}${r.pnote ? `<p class="sub2"><strong>Private:</strong> ${esc(r.pnote)}</p>` : ""}</div>
        <button type="button" class="link-btn" data-edit="${n}">Edit</button></li>`;
    }).join("") : `<li style="display:block"><p class="empty">No changes yet. Tap a day on the calendar to log one.</p></li>`;
  }
  function renderHol() {
    const y = st.holYear, b = st.breaks[y] || {}; $("holYear").textContent = y;
    const rows = holidayPeriods(y).map(p => {
      const nights = p.missing ? 0 : p.end - p.start + 1;
      return { k: p.missing ? 9e9 : p.start, html: `<li>${p.missing ? `<div class="when">Dates<small>needed</small></div>` : `<div class="when num">${fmt(p.start, SD)}<small>${p.end > p.start ? "to " + fmt(p.end, SD) : fmt(p.start, { weekday: "short" })}</small></div>`}
        <div class="what"><p>&#9733; ${esc(HOL[p.key].n)}</p><p class="sub2">${p.missing ? "Add the school dates" : `${nights} night${nights === 1 ? "" : "s"}`}</p></div>
        <span class="chip ${p.who}">${esc(nameOf(p.who))}</span></li>` };
    });
    (Array.isArray(b.school) ? b.school : []).forEach(d => {
      if (!d || !isDate(d.s)) return;
      const a = toNum(d.s), e = isDate(d.e) ? toNum(d.e) : a;
      rows.push({ k: a, html: `<li><div class="when num">${fmt(a, SD)}<small>${e > a ? "to " + fmt(e, SD) : fmt(a, { weekday: "short" })}</small></div>
        <div class="what"><p>${esc(d.l || "")}</p></div><span class="chip plain">${d.t === "half" ? "Half day" : "No school"}</span></li>` });
    });
    [["firstDay", "First day of school"], ["lastDay", "Last day of school"]].forEach(([k, l]) => {
      if (isDate(b[k])) rows.push({ k: toNum(b[k]), html: `<li><div class="when num">${fmt(toNum(b[k]), SD)}<small>${fmt(toNum(b[k]), { weekday: "short" })}</small></div><div class="what"><p>${l}</p></div><span class="chip plain">School</span></li>` });
    });
    rows.sort((a, c) => a.k - c.k);
    $("holList").innerHTML = rows.map(r => r.html).join("");
    const first = y % 2 === 1 ? S().myName : S().coName, second = y % 2 === 1 ? S().coName : S().myName;
    $("sumHint").textContent = `Summer ${y}: each of you gets two one-week periods. ${first} picks first and gives notice by March 1, then ${second} by March 15.`;
  }
  function renderShare() {
    const tok = st.link && st.link.token;
    $("shareStatus").textContent = tok ? "On" : "Off";
    $("famUrl").textContent = tok ? famUrl(tok) : "No active link. Make one to share.";
    $("copyLink").disabled = !tok; $("offLink").hidden = !tok;
    $("previewFam").hidden = !tok; if (tok) $("previewFam").href = famUrl(tok);
    $("newLink").textContent = tok ? "Make a new link" : "Make a link";
  }
  function renderAdmin() { rebuild(); renderCal("admin"); renderTotals(); renderLog(); renderHol(); renderShare(); }

  async function loadAdmin() {
    const res = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("breaks").select("*"),
      sb.from("swaps").select("*"),
      sb.from("swap_details").select("*"),
      sb.from("share_links").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1),
    ]);
    const err = res.find(r => r.error); if (err) throw err.error;
    const [s, b, w, d, l] = res.map(r => r.data);
    st.settings = s ? { myName: s.my_name, coName: s.co_name, anchor: s.anchor, trackFrom: s.track_from }
      : { myName: "Heather", coName: "Brett", anchor: toStr(T0 - ((wd(T0) + 2) % 7)), trackFrom: toStr(T0) };
    st.breaks = {}; (b || []).forEach(r => { st.breaks[r.year] = r.data || {}; });
    const det = new Map((d || []).map(r => [r.day, r]));
    st.swaps = new Map();
    (w || []).forEach(r => { const x = det.get(r.day) || {}; st.swaps.set(r.day, { date: r.day, had: r.had, with: r.caregiver || "", reason: x.reason || "", note: x.note || "", pnote: x.pnote || "" }); });
    st.link = (l && l[0]) || null;
    return !!s;
  }
  async function enter() {
    if (entering) return; entering = true;
    try {
      show("vLoading");
      const { data: role, error } = await sb.rpc("my_role");
      if (error) throw error;
      if (role !== "admin") { show("vNotAdmin"); return; }
      const hasSettings = await loadAdmin();
      show("vApp"); renderAdmin();
      if (!hasSettings) openSettings();
    } catch (e) { fail("load your tracker", e); show("vSignin"); }
    finally { entering = false; }
  }

  // Day sheet
  function openDay(n) {
    st.day = n; const sw = recOf(n), sch = scheduled(n), hol = holMap.get(n), sc = schoolOn(n);
    $("dayTitle").textContent = fmt(n, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    $("daySched").textContent = `Scheduled: ${nameOf(sch)}${hol ? " (" + HOL[hol.key].n + ")" : "'s week"}${sc.t === "off" ? ". No school: " + sc.l : ""}`;
    $("pickMe").textContent = S().myName; $("pickCo").textContent = S().coName;
    $("note").value = sw ? sw.note : ""; $("pnote").value = sw ? sw.pnote : "";
    $("caregiver").value = sw && sw.with ? sw.with : "Grandma";
    $("removeBtn").hidden = !sw; $("thru").value = toStr(n); $("thru").min = toStr(n);
    $("reasons").innerHTML = "";
    setPick(sw ? sw.had : (sch === "me" ? "co" : "me"), sw && sw.reason);
    $("dayScrim").hidden = false;
  }
  function setPick(who, reason) {
    st.pick = who;
    [["pickMe", "me"], ["pickCo", "co"], ["pickOt", "other"]].forEach(([id, w]) => $(id).setAttribute("aria-pressed", String(who === w)));
    $("careField").hidden = who !== "other";
    const same = who === scheduled(st.day) && !recOf(st.day);
    $("sameNote").hidden = !same; ["reasonField", "thruField", "noteField", "pnoteField"].forEach(id => { $(id).hidden = same; }); $("saveDay").disabled = same;
    const cur = document.querySelector('input[name="reason"]:checked');
    const keys = Object.keys(REASONS), sel = keys.includes(reason) ? reason : (cur ? cur.value : "coverage");
    $("reasons").innerHTML = keys.map(k => `<label><input type="radio" name="reason" value="${k}" id="r-${k}"${k === sel ? " checked" : ""}> ${esc(REASONS[k])}</label>`).join("");
  }
  async function saveDay() {
    const a = st.day, tv = $("thru").value, b = isDate(tv) ? Math.max(a, toNum(tv)) : a, who = st.pick;
    if (b - a > 120) return toast("Log up to 120 days at a time.");
    const r = document.querySelector('input[name="reason"]:checked');
    const reason = r ? r.value : "other", note = $("note").value.trim(), pnote = $("pnote").value.trim();
    const w = who === "other" ? ($("caregiver").value.trim() || "Someone else") : "";
    const ups = [], dets = [], dels = [], now = new Date().toISOString();
    for (let n = a; n <= b; n++) {
      const ds = toStr(n);
      if (scheduled(n) === who) { if (st.swaps.has(ds)) dels.push(ds); continue; }
      ups.push({ day: ds, had: who, caregiver: w || null, updated_at: now });
      dets.push({ day: ds, reason, note: note || null, pnote: pnote || null });
    }
    $("saveDay").disabled = true;
    try {
      if (dels.length) { const { error } = await sb.from("swaps").delete().in("day", dels); if (error) throw error; }
      if (ups.length) {
        let { error } = await sb.from("swaps").upsert(ups); if (error) throw error;
        ({ error } = await sb.from("swap_details").upsert(dets)); if (error) throw error;
      }
      dels.forEach(ds => st.swaps.delete(ds));
      ups.forEach((u, i) => st.swaps.set(u.day, { date: u.day, had: who, with: w, reason, note, pnote }));
      closeAll(); renderAdmin();
      toast(ups.length ? `Saved ${ups.length} day${ups.length === 1 ? "" : "s"}. The family link shows it now.` : "Back to the regular schedule.");
    } catch (e) { fail("save", e); }
    finally { $("saveDay").disabled = false; }
  }
  async function removeDay() {
    const ds = toStr(st.day);
    try {
      const { error } = await sb.from("swaps").delete().eq("day", ds); if (error) throw error;
      st.swaps.delete(ds); closeAll(); renderAdmin(); toast("Change removed.");
    } catch (e) { fail("remove that change", e); }
  }

  // Settings
  function openSettings() {
    $("sMy").value = S().myName; $("sCo").value = S().coName; $("sAnchor").value = S().anchor || ""; $("sFrom").value = S().trackFrom || "";
    $("setScrim").hidden = false;
  }
  async function saveSettings() {
    const next = { myName: $("sMy").value.trim() || "Heather", coName: $("sCo").value.trim() || "Brett",
      anchor: isDate($("sAnchor").value) ? $("sAnchor").value : S().anchor, trackFrom: isDate($("sFrom").value) ? $("sFrom").value : S().trackFrom };
    if (!isDate(next.anchor) || !isDate(next.trackFrom)) return toast("Pick both dates first.");
    try {
      const { error } = await sb.from("settings").upsert({ id: 1, my_name: next.myName, co_name: next.coName, anchor: next.anchor, track_from: next.trackFrom });
      if (error) throw error;
      st.settings = next; closeAll(); renderAdmin(); toast("Settings saved.");
    } catch (e) { fail("save settings", e); }
  }

  // Dates editor
  function openBrk() {
    const y = st.holYear, b = st.breaks[y] || {};
    $("brkTitle").textContent = `School dates ${y}`;
    [["first", "firstDay"], ["last", "lastDay"], ["spL", "spL"], ["spR", "spR"], ["tgL", "tgL"], ["tgR", "tgR"], ["xmL", "xmL"], ["xmR", "xmR"]]
      .forEach(([id, k]) => { $("b_" + id).value = isDate(b[k]) ? b[k] : ""; });
    st.draft = {
      sum: (Array.isArray(b.summer) ? b.summer : []).map(s => ({ ...s })),
      school: (Array.isArray(b.school) ? b.school : []).map(d => ({ ...d })),
    };
    renderDraft(); $("brkScrim").hidden = false;
  }
  function renderDraft() {
    const d = st.draft;
    $("schoolRows").innerHTML = d.school.map((r, i) => `<div class="row-in">
      <input type="date" id="sc-s-${i}" data-sc="${i}" data-f="s" value="${esc(r.s || "")}" aria-label="Start">
      <input type="date" id="sc-e-${i}" data-sc="${i}" data-f="e" value="${esc(r.e || "")}" aria-label="End (optional)">
      <select id="sc-t-${i}" data-sc="${i}" data-f="t" aria-label="Type"><option value="off"${r.t !== "half" ? " selected" : ""}>No school</option><option value="half"${r.t === "half" ? " selected" : ""}>Half day</option></select>
      <input class="lab" type="text" id="sc-l-${i}" data-sc="${i}" data-f="l" value="${esc(r.l || "")}" aria-label="Label" placeholder="e.g. Teacher workday">
      <button type="button" class="btn" data-rmsc="${i}">Remove</button></div>`).join("") || `<p class="sub">None for this year yet.</p>`;
    $("sumRows").innerHTML = d.sum.map((s, i) => `<div class="row-in">
      <input type="date" id="su-d-${i}" data-su="${i}" data-f="start" value="${esc(s.start || "")}" aria-label="First night">
      <select id="su-w-${i}" data-su="${i}" data-f="who" aria-label="Parent"><option value="me"${s.who === "me" ? " selected" : ""}>${esc(S().myName)}</option><option value="co"${s.who === "co" ? " selected" : ""}>${esc(S().coName)}</option></select>
      <button type="button" class="btn" data-rmsu="${i}">Remove</button></div>`).join("") || `<p class="sub">No summer weeks picked yet.</p>`;
    $("addSum").hidden = d.sum.length >= 4;
  }
  async function saveBrk() {
    const y = st.holYear, g = id => (isDate($("b_" + id).value) ? $("b_" + id).value : "");
    const data = { ...(st.breaks[y] || {}),
      firstDay: g("first"), lastDay: g("last"), spL: g("spL"), spR: g("spR"), tgL: g("tgL"), tgR: g("tgR"), xmL: g("xmL"), xmR: g("xmR"),
      summer: st.draft.sum.filter(s => isDate(s.start)).map(s => ({ start: s.start, who: s.who === "co" ? "co" : "me" })),
      school: st.draft.school.filter(d => isDate(d.s)).map(d => ({ s: d.s, e: isDate(d.e) ? d.e : "", t: d.t === "half" ? "half" : "off", l: (d.l || "").trim() })) };
    try {
      const { error } = await sb.from("breaks").upsert({ year: y, data }); if (error) throw error;
      st.breaks[y] = data; closeAll(); renderAdmin(); toast(`Dates for ${y} saved.`);
    } catch (e) { fail("save the dates", e); }
  }

  // Family link
  async function makeLink() {
    try {
      let { error } = await sb.from("share_links").update({ active: false }).eq("active", true); if (error) throw error;
      const res = await sb.from("share_links").insert({ label: "Family" }).select().single(); if (res.error) throw res.error;
      st.link = res.data; renderShare(); $("newLinkConfirm").hidden = true;
      toast("New link ready. Copy it and send it to your mom and Brett.");
    } catch (e) { fail("make a link", e); }
  }
  async function turnOff() {
    try {
      const { error } = await sb.from("share_links").update({ active: false }).eq("active", true); if (error) throw error;
      st.link = null; renderShare(); toast("Family link is off. Anyone opening it now sees that it's inactive.");
    } catch (e) { fail("turn off the link", e); }
  }
  async function copyLink() {
    const text = st.link ? famUrl(st.link.token) : ""; if (!text) return;
    try { await navigator.clipboard.writeText(text); toast("Link copied."); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($("famUrl")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Link selected. Copy it from here."); }
  }

  async function bootAdmin() {
    if (!CONFIGURED || !window.supabase) return show("vSetup");
    sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    sb.auth.onAuthStateChange((ev, session) => {
      if (session && (ev === "SIGNED_IN" || ev === "INITIAL_SESSION") && $("vApp").hidden) setTimeout(enter, 0);
      if (ev === "SIGNED_OUT") show("vSignin");
    });
    const { data } = await sb.auth.getSession();
    if (data && data.session) enter(); else show("vSignin");

    $("sendCode").onclick = async () => {
      signinEmail = $("email").value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(signinEmail)) { $("signinMsg").textContent = "Enter your email address."; return; }
      $("sendCode").disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email: signinEmail, options: { emailRedirectTo: location.href.split("#")[0] } });
      $("sendCode").disabled = false;
      if (error) { $("signinMsg").textContent = "Couldn't send the email: " + error.message; return; }
      $("codeStep").hidden = false; $("code").focus();
      $("signinMsg").textContent = "Check your email. Type the code here, or tap the link in the email on this device.";
    };
    $("verifyCode").onclick = async () => {
      const token = $("code").value.replace(/\D/g, "");
      if (!token) return;
      $("verifyCode").disabled = true;
      const { error } = await sb.auth.verifyOtp({ email: signinEmail, token, type: "email" });
      $("verifyCode").disabled = false;
      if (error) $("signinMsg").textContent = "That code didn't work. Check it, or send a new one.";
    };
    $("code").addEventListener("keydown", e => { if (e.key === "Enter") $("verifyCode").click(); });
    $("email").addEventListener("keydown", e => { if (e.key === "Enter") $("sendCode").click(); });
    const out = async () => { await sb.auth.signOut(); show("vSignin"); };
    $("signOut").onclick = out; $("signOut2").onclick = out;
    $("pickMe").onclick = () => setPick("me"); $("pickCo").onclick = () => setPick("co"); $("pickOt").onclick = () => { setPick("other"); $("caregiver").focus(); };
    $("saveDay").onclick = saveDay; $("removeBtn").onclick = removeDay;
    $("settingsBtn").onclick = openSettings; $("saveSet").onclick = saveSettings;
    $("holPrev").onclick = () => { st.holYear--; renderHol(); };
    $("holNext").onclick = () => { st.holYear++; renderHol(); };
    $("holEdit").onclick = openBrk; $("saveBrk").onclick = saveBrk;
    $("addSchool").onclick = () => { st.draft.school.push({ s: "", e: "", t: "off", l: "" }); renderDraft(); };
    $("addSum").onclick = () => { st.draft.sum.push({ start: "", who: st.draft.sum.filter(s => s.who === "me").length < 2 ? "me" : "co" }); renderDraft(); };
    $("copyLink").onclick = copyLink; $("offLink").onclick = turnOff;
    $("newLink").onclick = () => { if (st.link) $("newLinkConfirm").hidden = false; else makeLink(); };
    $("newLinkYes").onclick = makeLink; $("newLinkNo").onclick = () => { $("newLinkConfirm").hidden = true; };
    document.addEventListener("input", e => {
      const t = e.target;
      if (t.dataset.sc !== undefined) st.draft.school[Number(t.dataset.sc)][t.dataset.f] = t.value;
      if (t.dataset.su !== undefined) st.draft.sum[Number(t.dataset.su)][t.dataset.f] = t.value;
    });
  }

  // ---------- Shared click handling ----------
  document.addEventListener("click", e => {
    const d = e.target.closest(".day");
    if (d) { d.dataset.mode === "admin" ? openDay(Number(d.dataset.n)) : openFamDay(Number(d.dataset.n)); return; }
    const nav = e.target.closest("[data-nav]");
    if (nav) { const [mode, step] = nav.dataset.nav.split(":"); navMonth(mode, Number(step)); mode === "admin" ? renderAdmin() : renderFamily(); return; }
    if (e.target.closest("[data-close]") || e.target.classList.contains("scrim")) { closeAll(); return; }
    if (PAGE !== "admin") return;
    const ed = e.target.closest("[data-edit]");
    if (ed) { const n = Number(ed.dataset.edit), x = new Date(n * DAY); st.view.admin = { y: x.getUTCFullYear(), m: x.getUTCMonth() }; renderAdmin(); openDay(n); return; }
    const rs = e.target.closest("[data-rmsc]"); if (rs) { st.draft.school.splice(Number(rs.dataset.rmsc), 1); renderDraft(); return; }
    const ru = e.target.closest("[data-rmsu]"); if (ru) { st.draft.sum.splice(Number(ru.dataset.rmsu), 1); renderDraft(); return; }
    const p = e.target.closest("[data-period]"); if (p) { st.period = p.dataset.period; renderTotals(); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeAll(); });

  if (PAGE === "family") {
    loadFamily();
    window.addEventListener("hashchange", loadFamily);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - lastLoad > 120000) loadFamily(); });
    setInterval(() => { if (document.visibilityState === "visible") loadFamily(); }, 600000);
  } else {
    bootAdmin();
  }
})();
