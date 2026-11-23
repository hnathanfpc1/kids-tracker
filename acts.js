/* Kids Tracker: activities (practices, games, lessons). Reads the activities part of the schedule payload
   and draws it as HTML. Shared by the family page, the admin page and the Activities page.
   Nothing here loads or saves data, and nothing here decides who has the kids: that comes from core.js.
     const acts = KTActs.create(sched, () => st.settings, { fresh: ev => ... });
     acts.load(payload);   // after every load; a payload without the activities keys is fine
   Every value from the database goes through esc() before it goes into HTML. */
window.KTActs = (() => {
  "use strict";
  const { DAY, toNum, toStr, fmt, isDate, wd, SD, GRANDMA, famWhy, range } = window.KTCore;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Kid colors. The database stores the key; the color values are tokens in style.css (.c-orange and so on).
  const COLORS = { orange: "Orange", berry: "Berry", navy: "Navy", charcoal: "Charcoal" };
  const colorKey = c => (COLORS[c] ? c : "charcoal");
  // Who has the kids, as a CSS class: only the four known holders, whatever the data says.
  const holderClass = k => (k === "me" || k === "co" || k === "grandma" ? k : "other");
  const KINDS = { practice: "Practice", game: "Game", lesson: "Lesson", other: "Other" };
  const ANGIE = "Angie";   // how a tag for Heather's mom reads in a comment
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

  // ---------- Times: "17:30:00" from the database <-> minutes after midnight ----------
  const mins = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const wrap = m => ((m % 1440) + 1440) % 1440;
  const clock = m => { m = wrap(m); return `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")}`; };
  const half = m => (wrap(m) < 720 ? "a.m." : "p.m.");
  const timeText = m => `${clock(m)} ${half(m)}`;                       // "5:30 p.m."
  const hhmm = m => { m = wrap(m); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
  const timeSpan = (a, b) => b == null ? timeText(a) : half(a) === half(b) ? `${clock(a)} to ${clock(b)} ${half(b)}` : `${timeText(a)} to ${timeText(b)}`;
  // When something was changed, in the reader's own time: "Dec 1" and "8:14 p.m."
  const stampDay = iso => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const stampTime = iso => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?AM$/i, " a.m.").replace(/\s?PM$/i, " p.m.");
  const dayText = n => fmt(n, { weekday: "short", ...SD });                // "Tue, Dec 1"
  const initial = s => (([...String(s || "").trim()][0]) || "?").toUpperCase();
  const mapUrl = a => (isApple ? "https://maps.apple.com/?q=" : "https://www.google.com/maps/search/?api=1&query=") + encodeURIComponent(String(a).replace(/\s+/g, " ").trim());
  const sentence = s => (s && !/[.!?]$/.test(s) ? s + "." : s);

  // Off / This week / Next 30 days, remembered on this device.
  const PREF = "kt-acts";
  let prefMem = null;
  function pref() {
    if (prefMem) return prefMem;
    let v = null; try { v = localStorage.getItem(PREF); } catch (e) {}
    return (prefMem = v === "off" || v === "week" || v === "month" ? v : "week");
  }
  function setPref(v) { prefMem = v === "off" || v === "month" ? v : "week"; try { localStorage.setItem(PREF, prefMem); } catch (e) {} }
  // "This week" runs from today through Sunday. On a Saturday or Sunday it runs through the next Sunday.
  function rangeFor(today, v) {
    if (v === "month") return [today, today + 30];
    const toSun = (7 - wd(today)) % 7;
    return [today, today + (toSun < 2 ? toSun + 7 : toSun)];
  }

  // ---------- Reading the payload ----------
  function parse(data) {
    const d = data || {}, arr = k => (Array.isArray(d[k]) ? d[k] : []);
    const kids = arr("kids").filter(k => k && k.id && k.name).map(k => ({ id: k.id, name: String(k.name), color: colorKey(k.color), sort: Number(k.sort) || 0, active: k.active !== false }))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    const places = arr("places").filter(p => p && p.id).map(p => ({ ...p, name: String(p.name || "") }));
    const teams = arr("teams").filter(t => t && t.id).map(t => ({ ...t, name: String(t.name || ""), kid_ids: Array.isArray(t.kid_ids) ? t.kid_ids : [], gear: Array.isArray(t.gear) ? t.gear : [],
      early_practice: Number(t.early_practice) || 0, early_game: Number(t.early_game) || 0, active: t.active !== false }));
    const events = arr("events").filter(e => e && e.id && isDate(e.day) && mins(e.start_time) != null).map(e => ({ ...e, n: toNum(e.day), start: mins(e.start_time), end: mins(e.end_time),
      arrive: mins(e.arrive_by), kid_ids: Array.isArray(e.kid_ids) ? e.kid_ids : [], gear: Array.isArray(e.gear) ? e.gear : null, canceled: e.status === "canceled" }))
      .sort((a, b) => a.n - b.n || a.start - b.start || (a.id < b.id ? -1 : 1));
    const comments = arr("comments").filter(c => c && c.id && c.event_id && c.body).map(c => ({ ...c, tagged: Array.isArray(c.tagged) ? c.tagged : [] }))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const log = arr("log").filter(x => x && x.id && x.summary && x.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const w = d.window || {};
    const A = { kids, places, teams, events, comments, log,
      kid: new Map(kids.map(k => [k.id, k])), place: new Map(places.map(p => [p.id, p])), team: new Map(teams.map(t => [t.id, t])), event: new Map(events.map(e => [e.id, e])),
      byDay: new Map(), cmts: new Map(), from: isDate(w.from) ? toNum(w.from) : null, to: isDate(w.to) ? toNum(w.to) : null };
    events.forEach(e => { if (!A.byDay.has(e.n)) A.byDay.set(e.n, []); A.byDay.get(e.n).push(e); });
    comments.forEach(c => { if (!A.cmts.has(c.event_id)) A.cmts.set(c.event_id, []); A.cmts.get(c.event_id).push(c); });
    return A;
  }

  // ---------- The family link's reach, for the signed-in home ----------
  // get_schedule() cuts activities to 7 days back and 60 ahead and the change log to 30 days. get_editor_schedule() returns everything,
  // so the home cuts its copy here to show the same (Heather's decision, 2026-11-22). Display only: that reader can open the Activities page.
  // Returns a new payload; `all` on it holds every activity id that was read, so a deep link can tell "later than this page shows" from "gone".
  function familyCut(data, today) {
    const d = data || {}, arr = k => (Array.isArray(d[k]) ? d[k] : []);
    const from = today - 7, to = today + 60;
    const every = new Set(arr("events").filter(e => e && e.id).map(e => e.id));
    const events = arr("events").filter(e => e && e.id && isDate(e.day) && toNum(e.day) >= from && toNum(e.day) <= to), ids = new Set(events.map(e => e.id));
    const teamIds = new Set(events.map(e => e.team_id).filter(Boolean));
    const teams = arr("teams").filter(t => t && teamIds.has(t.id));
    const placeIds = new Set([...events, ...teams].map(x => x.place_id).filter(Boolean));
    const kidIds = new Set(events.flatMap(e => (Array.isArray(e.kid_ids) ? e.kid_ids : [])));
    const cut = Date.now() - 30 * DAY;
    return { ...d, window: { from: toStr(from), to: toStr(to) }, all: every, events, teams,
      places: arr("places").filter(p => p && placeIds.has(p.id)),
      kids: arr("kids").filter(k => k && (k.active !== false || kidIds.has(k.id))),
      comments: arr("comments").filter(c => c && ids.has(c.event_id)),
      // A line stays when its team still has something in these dates, or its activity is in them. A removed activity has no day left to check, so its line stays.
      log: arr("log").filter(x => x && Date.parse(x.at) >= cut && (teamIds.has(x.team_id) || (!!x.event_id && (ids.has(x.event_id) || !every.has(x.event_id))))) };
  }

  // ---------- Everything that needs the schedule ----------
  // sched: KTCore.schedule(st). S: () => st.settings. opts.fresh(ev): true when an activity changed since this phone last looked.
  function create(sched, S, opts = {}) {
    const { nameOf, actual, recOf, holderKey, handoffTime } = sched;
    const fresh = opts.fresh || (() => false);
    let A = parse(null);

    const kidsOf = ids => A.kids.filter(k => (ids || []).includes(k.id));
    const kchip = k => `<span class="kchip c-${k.color}">${esc(k.name)}</span>`;
    const kdot = k => `<span class="kdot c-${k.color}" aria-hidden="true"></span>`;
    const who = w => (w === "me" ? S().myName : w === "co" ? S().coName : "Someone");     // who made a change
    const tagName = w => (w === "grandma" ? ANGIE : who(w));
    const house = h => (h === "me" ? S().myName + "'s" : h === "co" ? S().coName + "'s" : h === "grandma" ? GRANDMA + "'s" : "");
    const on = n => A.byDay.get(n) || [];
    const team = e => (e && e.team_id && A.team.get(e.team_id)) || null;

    // "Soccer practice", "Soccer: team photos", or the title on its own.
    function label(e) {
      const t = team(e), title = String(e.title || "").trim();
      if (t && title) return `${t.name}: ${title}`;
      if (t) return e.kind && e.kind !== "other" ? `${t.name} ${e.kind}` : t.name;
      return title || KINDS[e.kind] || "Activity";
    }
    // A saved place on the activity, otherwise the team's default place (unless a place was typed in).
    function placeOf(e) {
      if (e.place_id) return A.place.get(e.place_id) || null;
      const t = team(e);
      return !e.place_text && t && t.place_id ? A.place.get(t.place_id) || null : null;
    }
    function drive(p, h) {
      if (!p) return null;
      const v = h === "me" ? p.drive_me : h === "co" ? p.drive_co : h === "grandma" ? p.drive_grandma : null;
      return v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
    }
    // Arrive by: the time set on the activity, otherwise start minus the team's arrive-early minutes. No team and no time: none.
    function arriveBy(e) {
      if (e.arrive != null) return { m: e.arrive, set: true };
      const t = team(e);
      if (!t || e.start == null) return null;
      const early = e.kind === "game" ? t.early_game : t.early_practice;
      return { m: e.start - early, early, set: false };
    }
    // Leave by: arrive by minus the drive from the house of whoever has the kids that day. Someone else's house: none.
    function leaveBy(e, h) { const a = arriveBy(e), d = drive(placeOf(e), h); return a && d != null ? a.m - d : null; }
    const gearOf = e => (e.gear != null ? e.gear : (team(e) || {}).gear || []);

    // Kids with at least one activity that is not canceled on day n, in kid order.
    function kidsOn(n) { const ids = new Set(); on(n).forEach(e => { if (!e.canceled) e.kid_ids.forEach(id => ids.add(id)); }); return A.kids.filter(k => ids.has(k.id)); }
    const markers = n => kidsOn(n).map(k => `<span class="kbdg c-${k.color}" aria-hidden="true">${esc(initial(k.name))}</span>`).join("");
    const legend = () => A.kids.filter(k => k.active).map(k => `<span><span class="kbdg c-${k.color}" aria-hidden="true">${esc(initial(k.name))}</span>${esc(k.name)}</span>`).join("");

    // One activity.
    function evHtml(e, o = {}) {
      const ks = kidsOf(e.kid_ids), h = actual(e.n), a = arriveBy(e), lv = leaveBy(e, h), p = placeOf(e), g = gearOf(e);
      const cls = ["ev", ks[0] ? "c-" + ks[0].color : "", ks[1] ? "kb b-" + ks[1].color : "", e.canceled ? "canceled" : "", o.focus === e.id ? "focus" : ""].filter(Boolean).join(" ");
      const where = p ? `<p class="ev-where">${esc(p.name)}${p.address ? `<br><a href="${esc(mapUrl(p.address))}" target="_blank" rel="noopener noreferrer">${esc(p.address)}</a>` : ""}</p>`
        : e.place_text ? `<p class="ev-where">${esc(e.place_text)}</p>` : "";
      const go = !e.canceled && a ? `<p class="ev-go num">Arrive ${clock(a.m)}.${lv != null ? ` <strong>Leave by ${clock(lv)}</strong> from ${esc(house(h))}.` : ""}</p>` : "";
      const gear = !e.canceled && g.length ? `<p class="ev-gear">Bring: ${esc(g.join(", "))}</p>` : "";
      const note = e.note ? `<p class="ev-note"><strong>Note:</strong> ${esc(e.note)}</p>` : "";
      const cm = (A.cmts.get(e.id) || []).map(c => `<p class="ev-cmt"><span class="chip ${c.author === "co" ? "co" : "me"}">${esc(who(c.author))}</span>${c.tagged.map(t => `<strong>@${esc(tagName(t))}</strong> `).join("")}${esc(c.body)}</p>`).join("");
      const flags = `${fresh(e) ? `<span class="chip new">New</span>` : ""}${e.canceled ? `<span class="chip plain">Canceled</span>` : ""}`;
      return `<div class="${cls}" data-ev="${esc(e.id)}"><div class="ev-time num">${clock(e.start)}<small>${half(e.start)}</small>${e.end != null ? `<small>to ${clock(e.end)}</small>` : ""}</div>
        <div class="ev-body"><p class="ev-title">${flags}${ks.map(kchip).join("")}<span class="ev-name">${esc(label(e))}</span></p>${where}${go}${gear}${note}${cm}</div></div>`;
    }
    const dayEvents = (n, o) => on(n).map(e => evHtml(e, o)).join("");

    // Gear to pack at a handoff: every activity that is not canceled from day a through day b, one line per kid (or "Both").
    function pack(a, b) {
      const groups = new Map(), two = A.kids.filter(k => k.active).length === 2;
      for (let n = a; n <= b; n++) on(n).forEach(e => {
        const g = gearOf(e), ks = kidsOf(e.kid_ids);
        if (e.canceled || !g.length || !ks.length) return;
        const key = ks.map(k => k.id).join(",");
        if (!groups.has(key)) groups.set(key, { kids: ks, name: ks.length === 1 ? ks[0].name : ks.length === 2 && two ? "Both" : ks.map(k => k.name).join(" and "), items: [], seen: new Set() });
        const gr = groups.get(key);
        // "jersey" and "jerseys" count as one item; the first spelling is kept.
        g.forEach(it => { const t = String(it || "").trim(), k = t.toLowerCase().replace(/s$/, ""); if (t && !gr.seen.has(k)) { gr.seen.add(k); gr.items.push(t); } });
      });
      const order = k => A.kids.indexOf(k);
      return [...groups.values()].sort((x, y) => x.kids.length - y.kids.length || order(x.kids[0]) - order(y.kids[0]));
    }
    const isHandoff = n => holderKey(n - 1) !== holderKey(n);
    function handoffBox(n) {
      const a = actual(n), nm = nameOf(a, recOf(n)), ht = handoffTime(n);
      let end = n; while (end < n + 60 && holderKey(end + 1) === holderKey(n)) end++;
      const len = end - n + 1, groups = pack(n, end);
      return `<div class="handoff ${holderClass(a)}"><p><strong>&#8644; Handoff to</strong> <span class="chip ${holderClass(a)}">${esc(nm)}</span>${ht ? esc(ht) : ""}</p>${groups.length
        ? `<p class="pack-title">Pack for ${esc(nm)}'s ${len >= 7 ? "week" : len === 1 ? "night" : len + " nights"}</p><ul class="pack">${groups.map(g => `<li>${g.kids.map(kdot).join("")}<strong>${esc(g.name)}:</strong> ${esc(g.items.join(", "))}</li>`).join("")}</ul>` : ""}</div>`;
    }
    function dayBlock(n, today, o) {
      const a = actual(n), evs = on(n), ho = isHandoff(n);
      return `<div class="aday"><div class="aday-head"><span class="dt">${dayText(n)}${n === today ? "<small>Today</small>" : ""}${ho ? "<small>Handoff day</small>" : ""}</span><span class="chip ${holderClass(a)}">${esc(nameOf(a, recOf(n)))}</span></div>
        ${ho ? handoffBox(n) : ""}${evs.length ? evs.map(e => evHtml(e, o)).join("") : `<p class="none">No activities.</p>`}</div>`;
    }
    // The Activities panel body for "week" or "month". Next 30 days skips days with nothing on them.
    function panel(today, v, o = {}) {
      const [a, b] = rangeFor(today, v), out = [];
      for (let n = a; n <= b; n++) {
        if (v === "month" && n !== today && !on(n).length && !isHandoff(n)) continue;
        out.push(dayBlock(n, today, o));
      }
      const ks = A.kids.filter(k => k.active);
      return `${ks.length ? `<div class="filters"><span>Showing</span>${ks.map(kchip).join("")}</div>` : ""}<div class="agenda">${out.join("")}</div>`;
    }
    // One line for the "Right now" card.
    function todayLine(n) {
      const evs = on(n); if (!evs.length) return "";
      const h = actual(n);
      return `<div class="today-act"><strong>Today:</strong> ${evs.map(e => {
        const lv = leaveBy(e, h), what = `${esc(label(e))} ${timeText(e.start)}`;   // ends in "a.m." or "p.m.", so no extra period
        return `<span class="ta">${kidsOf(e.kid_ids).map(kchip).join("")}${e.canceled ? `<s>${what}</s> Canceled.` : `${what}${lv != null ? ` Leave by ${clock(lv)}.` : ""}`}</span>`;
      }).join(" ")}</div>`;
    }

    // ---------- Change log ----------
    // Lines written by one save or one import share a batch id. They show as one line.
    function logGroups() {
      const g = new Map();
      A.log.forEach(x => { const k = (x.batch_id || x.id) + "|" + x.action; if (!g.has(k)) g.set(k, []); g.get(k).push(x); });
      return [...g.values()];
    }
    const VERB = { added: "added", changed: "changed", canceled: "canceled", removed: "removed" };
    function logKids(lines) {
      const ids = new Set();
      lines.forEach(x => { const e = x.event_id && A.event.get(x.event_id), t = x.team_id && A.team.get(x.team_id); ((e && e.kid_ids) || (t && t.kid_ids) || []).forEach(id => ids.add(id)); });
      return A.kids.filter(k => ids.has(k.id));
    }
    // { at, who, head, sub, kids } for one batch.
    function logLine(lines) {
      const x = lines[0], count = Math.max(Number(x.batch_count) || 1, lines.length), kids = logKids(lines);
      if (count === 1) return { at: x.at, who: x.who, head: x.summary, sub: "", kids, lines };
      const evs = lines.map(l => l.event_id && A.event.get(l.event_id)).filter(Boolean).sort((a, b) => a.n - b.n);
      const names = [...new Set(evs.map(label))];
      const sub = evs.length ? `${names.slice(0, 2).join(", ")}${names.length > 2 ? " and more" : ""}, ${evs[0].n === evs[evs.length - 1].n ? dayText(evs[0].n) : `${fmt(evs[0].n, SD)} to ${fmt(evs[evs.length - 1].n, SD)}`}`
        : `For example: ${x.summary}`;
      return { at: x.at, who: x.who, head: x.action === "restored" ? `put ${count} activities back on` : `${VERB[x.action] || x.action} ${count} activities`, sub, kids, lines };
    }
    const lines = () => logGroups().map(logLine);
    const whoChip = w => `<span class="chip ${w === "me" || w === "co" ? w : "plain"}">${esc(who(w))}</span>`;

    // Recent changes for the family page: activity log lines plus switches logged in the last 30 days, newest first.
    // swaps: the page's st.swaps (switches carry updatedAt). Private notes are never part of these records on the family page.
    function recent(swaps) {
      const items = lines().map(l => ({ at: Date.parse(l.at), type: "act",
        html: `<li class="rc" data-type="act"><div class="when num">${esc(stampDay(l.at))}<small>${esc(stampTime(l.at))}</small></div>
          <div class="what"><p>${l.sub ? "" : l.kids.map(kdot).join("")}${whoChip(l.who)}${esc(l.head)}</p>${l.sub ? `<p class="sub2">${l.kids.map(kdot).join("")}${esc(l.sub)}</p>` : ""}</div></li>` }));
      const cut = Date.now() - 30 * DAY, groups = [];
      [...(swaps ? swaps.values() : [])].filter(r => r && r.updatedAt && Date.parse(r.updatedAt) >= cut && isDate(r.date)).sort((a, b) => (a.date < b.date ? -1 : 1)).forEach(r => {
        const n = toNum(r.date), k = [r.had, r.with, r.reason, r.note, r.updatedAt].join("|"), g = groups[groups.length - 1];
        if (g && g.k === k && g.end === n - 1) g.end = n; else groups.push({ k, start: n, end: n, rec: r });
      });
      groups.forEach(g => {
        const r = g.rec, why = famWhy(r);
        items.push({ at: Date.parse(r.updatedAt), type: "kids",
          html: `<li class="rc" data-type="kids"><div class="when num">${esc(stampDay(r.updatedAt))}<small>${esc(stampTime(r.updatedAt))}</small></div>
            <div class="what"><p>${whoChip("me")}switched ${g.end > g.start ? "nights" : "a night"}</p><p class="sub2">&#8644; ${range(g.start, g.end)}: <span class="chip ${holderClass(r.had)}">${esc(nameOf(r.had, r))}</span>has the kids.${why ? " " + esc(sentence(why)) : ""}</p></div></li>` });
      });
      return items.sort((a, b) => b.at - a.at);
    }
    // "Updated since you last looked": activity log lines and shared comments newer than the time this phone said "Got it".
    function freshItems(seen) {
      const t0 = Date.parse(seen); if (!seen || !Number.isFinite(t0)) return [];
      const out = [];
      lines().filter(l => Date.parse(l.at) > t0).forEach(l => {
        const x = l.lines[0], evs = l.lines.map(y => y.event_id && A.event.get(y.event_id)).filter(Boolean).sort((a, b) => a.n - b.n);
        const dt = evs.length ? range(evs[0].n, evs[evs.length - 1].n) : x.team_id ? "Team" : "Activity";
        out.push({ at: Date.parse(l.at), html: `<li><span class="dt">${dt}</span><span>${l.kids.map(kdot).join("")}${whoChip(l.who)}${esc(l.head)}</span></li>` });
      });
      A.comments.filter(c => Date.parse(c.at) > t0).forEach(c => {
        const e = A.event.get(c.event_id); if (!e) return;
        const body = c.body.length > 140 ? c.body.slice(0, 137).trim() + "..." : c.body;
        out.push({ at: Date.parse(c.at), html: `<li><span class="dt">${dayText(e.n)}</span><span>${whoChip(c.author)}commented on ${esc(label(e))}: "${esc(body)}"</span></li>` });
      });
      return out.sort((a, b) => b.at - a.at).map(i => i.html);
    }

    return {
      load(data) { A = parse(data); },
      get data() { return A; },
      has: () => A.kids.length > 0,
      on, kidsOf, kidsOn, markers, legend, label, placeOf, drive, arriveBy, leaveBy, gearOf, house, who, tagName, kchip, kdot,
      evHtml, dayEvents, handoffBox, panel, todayLine, lines, recent, freshItems, isHandoff, whoChip,
    };
  }

  return { create, parse, familyCut, esc, COLORS, colorKey, holderClass, KINDS, ANGIE, mins, clock, half, timeText, timeSpan, hhmm, stampDay, stampTime, dayText, initial, pref, setPref, rangeFor };
})();
