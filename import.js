/* Kids Tracker: reading pasted lists and calendar files for the Activities page (activities.html).
   Pure logic only: no page access, no Supabase calls, no clock. Every function that needs "today" takes it as a whole-day
   number (the same day numbers core.js uses: whole days since 1970-01-01, via Date.UTC so no time zone drift).
   Exposed as window.KTImport (and module.exports when loaded by node, so QA can test it directly).

   A parsed row ("item") looks like:
     { day: "YYYY-MM-DD" | null, start: minutes | null, end: minutes | null, what, kind, kids: [kid ids], team: undefined,
       place_id, place_text, uid, canceled, src, flags: [{ f, t, soft }], ... }
   "flags" are the reader's guesses or doubts, shown on the review row. A soft flag is a note, not a guess.
   team stays undefined until Apply to all or the row editor sets it (undefined means "not set yet", "" means "no team"). */
(function (root) {
  "use strict";
  const MAX_ROWS = 300, MAX_BYTES = 1048576, DAY = 86400000;
  const MAX_LINE = 2000;     // one pasted line is never longer than this; the rest is dropped before any pattern runs
  const MAX_WORK = 5000;     // dates looked at in one calendar file, counting repeats and ones already past
  const KINDS = { practice: "Practice", game: "Game", lesson: "Lesson", other: "Other" };
  const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  const WD_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MON_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---------- Whole-day numbers ----------
  const num = (y, m, d) => {
    if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const n = Math.round(Date.UTC(y, m - 1, d) / DAY), c = new Date(n * DAY);
    return c.getUTCMonth() === m - 1 && c.getUTCDate() === d ? n : null;   // rejects Feb 30 and the like
  };
  const ymd = n => { const c = new Date(n * DAY); return { y: c.getUTCFullYear(), m: c.getUTCMonth() + 1, d: c.getUTCDate() }; };
  const str = n => new Date(n * DAY).toISOString().slice(0, 10);
  const dow = n => new Date(n * DAY).getUTCDay();                 // Sunday is 0
  const dateText = n => { const c = ymd(n); return `${MON_NAMES[c.m - 1]} ${c.d}`; };
  const esc2 = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // ---------- Text cleaning ----------
  const one = s => String(s == null ? "" : s).replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  const norm = s => one(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  // ---------- Times ----------
  const fmtTime = m => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} ${m % 1440 < 720 ? "a.m." : "p.m."}`;
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const TP = "(\\d{1,2})(?::(\\d{2}))?(?:\\s*([ap])\\.?\\s*m\\.?)?(?![A-Za-z0-9])";
  const TIME_RE = new RegExp("^" + TP + "(?:\\s*(?:-|\\u2013|\\u2014|to|until|till)\\s*" + TP + ")?", "i");
  // Reads a time or a time range at the start of s. Returns { start, end, len, flags } or null.
  function timeAt(s) {
    const m = TIME_RE.exec(s); if (!m) return null;
    const a = { h: +m[1], mi: m[2] == null ? null : +m[2], ap: m[3] ? m[3].toLowerCase() : null, lead: /^0\d/.test(m[1]) };
    const b = m[4] == null ? null : { h: +m[4], mi: m[5] == null ? null : +m[5], ap: m[6] ? m[6].toLowerCase() : null, lead: /^0\d/.test(m[4]) };
    const timey = p => p && (p.mi != null || p.ap);
    const plainRange = b && !timey(a) && !timey(b) && a.h >= 1 && a.h <= 12 && b.h >= 1 && b.h <= 12;   // "6-7" is read as 6:00 to 7:00, am or pm guessed
    if (!(timey(a) || timey(b) || plainRange)) return null;
    const bad = p => p && (p.mi != null && p.mi > 59 || (p.ap ? p.h < 1 || p.h > 12 : p.h > 24));
    if (bad(a) || bad(b)) return null;
    const flags = [];
    const h24 = p => !p.ap && (p.h >= 13 || p.h === 0 || (p.lead && p.mi != null));
    const base = p => p.h % 12 * 60 + (p.mi || 0);
    let start, end = null;
    const sure = p => p.ap ? base(p) + (p.ap === "p" ? 720 : 0) : h24(p) ? p.h * 60 + (p.mi || 0) : null;
    start = sure(a);
    let guessedStart = false;
    if (start == null) {
      if (b && b.ap && sure(b) != null) {                // "5:30-6:30 pm": the start shares the end's am or pm unless that puts it after the end
        const e0 = sure(b); let s0 = base(a) + (b.ap === "p" ? 720 : 0);
        if (s0 > e0) s0 = base(a) + (b.ap === "p" ? 0 : 720);
        start = s0;
      } else { start = base(a) + (a.h >= 8 && a.h <= 11 ? 0 : 720); guessedStart = true; }   // 8 to 11 is morning, 12 and 1 to 7 is afternoon
    }
    if (b) {
      end = sure(b);
      if (end == null) {
        const same = base(b) + (start >= 720 ? 720 : 0), other = base(b) + (start >= 720 ? 0 : 720);
        end = same > start ? same : other > start ? other : null;
        if (!b.ap && !a.ap && end != null) guessedStart = true;
      }
      if (end != null && end <= start) { end = null; flags.push({ f: "time", t: "The end time is before the start. I left it out." }); }
    }
    if (guessedStart) flags.push({ f: "time", t: `No am or pm. I guessed ${fmtTime(start)}${end != null ? " to " + fmtTime(end) : ""}` });   // fmtTime ends in "a.m." or "p.m.", so no extra period
    return { start, end, len: m[0].length, flags };
  }
  const timeWhole = s => { const t = timeAt(s.trim()); return t && t.len === s.trim().length ? t : null; };

  // ---------- Dates ----------
  const WDPRE = /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s*/i;
  const DATE_RES = [
    /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?![\d:])/,
    /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d:\/])/,
    /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?![\d:])/,
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?(?![\d:])/,
  ];
  // Reads a date at the start of s. Returns { n, len, flags } or null. today is a day number.
  function dateAt(s, today) {
    let skip = 0, wdWord = null;
    const w = WDPRE.exec(s);
    if (w) { wdWord = w[1].toLowerCase(); skip = w[0].length; }
    const rest = s.slice(skip);
    let y = null, mo = null, d = null, len = 0, hadYear = true;
    for (let i = 0; i < DATE_RES.length; i++) {
      const m = DATE_RES[i].exec(rest); if (!m) continue;
      if (i === 0) { y = +m[1]; mo = +m[2]; d = +m[3]; }
      else if (i === 1) { mo = +m[1]; d = +m[2]; if (m[3]) { y = +m[3]; if (m[3].length === 2) y += 2000; } }
      else if (i === 2) { mo = MONTHS[m[1].toLowerCase()]; d = +m[2]; if (m[3]) y = +m[3]; }
      else { mo = MONTHS[m[2].toLowerCase()]; d = +m[1]; if (m[3]) y = +m[3]; }
      if (!mo) continue;
      len = skip + m[0].length; break;
    }
    if (!len) return null;
    const flags = [], ty = ymd(today).y;
    if (y == null) {
      hadYear = false;
      const wdIdx = wdWord ? ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(wdWord) : -1;
      const cand = [ty, ty + 1].map(yy => num(yy, mo, d)).filter(n => n != null);
      let pick = cand.find(n => n >= today - 60 && (wdIdx < 0 || dow(n) === wdIdx));   // the next one coming, give or take two months back
      if (pick == null) pick = cand.find(n => n >= today - 60) != null ? cand.find(n => n >= today - 60) : cand[0];
      if (pick == null) return null;
      y = ymd(pick).y;
      flags.push({ f: "date", t: `No year given. I used ${y}.` });
    }
    const n = num(y, mo, d); if (n == null) return null;
    if (wdWord) {
      const wdIdx = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(wdWord);
      if (dow(n) !== wdIdx) flags.push({ f: "date", t: `${dateText(n)} is a ${WD_NAMES[dow(n)]}, not a ${WD_NAMES[wdIdx]}. Check the date.` });
    }
    return { n, len, flags, hadYear };
  }
  const dateWhole = (s, today) => { const t = s.trim(), r = dateAt(t, today); return r && r.len === t.length ? r : null; };

  // ---------- Kids, places, kinds ----------
  const BOTH = /^(both|both kids|all|all kids|everyone|each|the kids)$/i;
  function parseKids(text, kids) {
    const ids = [], unknown = [];
    one(text).split(/\s*(?:,|&|\+|\/|;|\band\b)\s*/i).filter(Boolean).forEach(part => {
      if (BOTH.test(part)) { kids.filter(k => k.active !== false).forEach(k => { if (!ids.includes(k.id)) ids.push(k.id); }); return; }
      const k = kids.find(x => norm(x.name) === norm(part));
      if (k) { if (!ids.includes(k.id)) ids.push(k.id); } else unknown.push(part);
    });
    return { ids, unknown };
  }
  const kidCell = (text, kids) => { const t = one(text); if (!t) return false; const r = parseKids(t, kids); return r.ids.length > 0 && !r.unknown.length; };
  function placeMatch(text, places, loose) {
    const t = norm(text); if (!t) return null;
    let p = places.find(x => norm(x.name) === t);
    if (!p && loose) p = places.filter(x => norm(x.name).length >= 3 && (" " + t + " ").includes(" " + norm(x.name) + " ")).sort((a, b) => b.name.length - a.name.length)[0];
    return p || null;
  }
  function kindOf(text) {
    const t = String(text || "").toLowerCase();
    if (/\b(game|games|match|matches|tournament|scrimmage|vs\.?|versus|playoffs?)\b/.test(t)) return "game";
    if (/\b(lesson|lessons|tutoring|tutor)\b/.test(t)) return "lesson";
    if (/\b(practice|practise|training|rehearsal|clinic|workout)\b/.test(t)) return "practice";
    return "other";
  }
  // The title to store. With a team, a title that only repeats the team name or the kind is stored as nothing, so the team's name shows.
  function titleFor(what, kind, teamName) {
    let t = one(what);
    if (teamName) t = t.replace(new RegExp("^" + esc2(one(teamName)) + "\\b[\\s:,\\-]*", "i"), "").trim();
    if (teamName && (!t || /^(practices?|games?|lessons?|training|match(es)?)$/i.test(t))) return null;
    return t ? t.slice(0, 120) : null;
  }

  // ---------- Building one item ----------
  function makeItem(o, ctx) {
    const kids = ctx.kids || [], places = ctx.places || [];
    const flags = (o.flags || []).slice();
    const what = one(o.what).slice(0, 120);
    const it = { day: o.n != null ? str(o.n) : null, start: o.start == null ? null : o.start, end: o.end == null ? null : o.end, what, kind: kindOf(what),
      kids: [], team: undefined, place_id: null, place_text: null, uid: o.uid || null, canceled: !!o.canceled, src: o.src, flags, raw: o.raw ? one(o.raw).slice(0, 200) : "" };
    if (it.day == null) flags.push({ f: "date", t: o.rawDate ? `I couldn't read the date "${one(o.rawDate).slice(0, 40)}".` : "No date found." });
    if (it.start == null && !o.allDay) flags.push({ f: "time", t: o.rawTime ? `I couldn't read the time "${one(o.rawTime).slice(0, 40)}".` : "No start time found." });
    if (it.start == null && o.allDay) flags.push({ f: "time", t: "All day event. Set a start time." });
    if (it.start != null && it.end == null) flags.push({ f: "time", t: "No end time.", soft: true });
    if (o.kidText) { const r = parseKids(o.kidText, kids); it.kids = r.ids; r.unknown.forEach(u => flags.push({ f: "kid", t: `I don't know the kid "${one(u).slice(0, 40)}".` })); }
    const pt = one(o.placeText).slice(0, 200);
    if (pt) {
      const p = placeMatch(pt, places, o.loosePlace);
      if (p) it.place_id = p.id; else { it.place_text = pt; flags.push({ f: "place", t: "I don't know this place. It will be saved as typed text." }); }
    }
    if (o.unsure && one(o.unsure)) flags.push({ f: "unsure", t: one(o.unsure).slice(0, 300) });
    if (it.day != null && it.day < str(ctx.today)) flags.push({ f: "date", t: "This date is in the past." });
    return it;
  }

  // ---------- Paste a list ----------
  const HEAD = { date: "date", day: "date", when: "date", time: "time", start: "time", starts: "time", "start time": "time", what: "what", activity: "what", event: "what", title: "what",
    description: "what", name: "what", kid: "kid", kids: "kid", child: "kid", children: "kid", who: "kid", place: "place", where: "place", location: "place", field: "place", venue: "place",
    unsure: "unsure", flag: "unsure", flags: "unsure", guess: "unsure", guesses: "unsure", check: "unsure", notes: "unsure", note: "unsure" };
  function splitCsv(line) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"' && !cur.trim()) { q = true; cur = ""; }
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur); return out;
  }
  function splitLines(text) {
    const lines = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").map(l => l.slice(0, MAX_LINE).trimEnd()).filter(l => /[^\s,;|\t]/.test(l));
    const tab = lines.some(l => l.includes("\t")), pipe = !tab && lines.some(l => l.includes("|"));
    return lines.map(l => (tab ? l.split("\t").map(c => c.replace(/^"(.*)"$/, "$1")) : pipe ? l.split("|") : splitCsv(l)).map(c => c.trim()));
  }
  // "Dec 1" then "2026" in separate comma cells came from "Dec 1, 2026": put them back together.
  function mergeYears(cells, today) {
    const out = [];
    cells.forEach(c => {
      const prev = out[out.length - 1];
      if (/^\d{4}$/.test(c) && prev != null) { const d = dateAt(prev, today); if (d && !d.hadYear && d.len === prev.length) { out[out.length - 1] = prev + ", " + c; return; } }
      out.push(c);
    });
    return out;
  }
  // One typed line with no separators: date, then time, then the rest. Kid and place names are picked out of the rest.
  function typedLine(line, ctx) {
    let s = one(line), flags = [], n = null, start = null, end = null, rawDate = "", rawTime = "";
    const d = dateAt(s, ctx.today);
    if (d) { n = d.n; flags = flags.concat(d.flags); s = s.slice(d.len).replace(/^[\s,;:\-\u2013\u2014|@]+/, ""); } else rawDate = s.slice(0, 20);
    const t = timeAt(s);
    if (t) { start = t.start; end = t.end; flags = flags.concat(t.flags); s = s.slice(t.len).replace(/^[\s,;:\-\u2013\u2014|@]+/, ""); }
    let kidText = "", placeText = "";
    const kids = ctx.kids || [], places = ctx.places || [];
    const names = kids.map(k => k.name).filter(Boolean).concat(["both kids", "both"]).sort((a, b) => b.length - a.length);
    const found = [];
    names.forEach(nm => { const re = new RegExp("(^|[\\s,(])" + esc2(nm) + "(?=$|[\\s,.)'])", "i"); if (re.test(s)) { found.push(nm); s = s.replace(re, "$1"); } });
    if (found.length) kidText = found.join(", ");
    places.slice().sort((a, b) => b.name.length - a.name.length).some(p => {
      const re = new RegExp("(^|[\\s,(@])" + esc2(p.name) + "(?=$|[\\s,.)])", "i");
      if (re.test(s)) { placeText = p.name; s = s.replace(re, "$1"); return true; } return false;
    });
    const what = s.replace(/\s+(at|in|@)\s*$/i, "").replace(/\s*[@,;|]\s*$/, "").replace(/\(\s*\)/g, "").replace(/^[\s,;:\-]+|[\s,;:\-@]+$/g, "");
    return { n, start, end, what, kidText, placeText, flags, rawDate, rawTime, raw: line };
  }
  // Works out which column is which. Returns { date, time, what, kid, place, unsure } as column indexes (or undefined).
  function mapColumns(rows, headerRoles, ctx) {
    const width = Math.max(...rows.map(r => r.length)), roles = {}, used = new Set();
    (headerRoles || []).forEach((r, i) => { if (r && roles[r] === undefined) { roles[r] = i; used.add(i); } });
    const score = (i, fn) => rows.reduce((n, r) => n + (r[i] && fn(r[i]) ? 1 : 0), 0);
    const filled = i => rows.reduce((n, r) => n + (r[i] ? 1 : 0), 0);
    const pick = (role, fn, min) => {
      if (roles[role] !== undefined) return;
      let best = -1, bs = 0;
      for (let i = 0; i < width; i++) { if (used.has(i)) continue; const s = score(i, fn); if (s > bs && s >= Math.max(min, filled(i) / 2)) { best = i; bs = s; } }
      if (best >= 0) { roles[role] = best; used.add(best); }
    };
    pick("date", c => !!dateAt(c.trim(), ctx.today), 1);
    pick("time", c => !!timeWhole(c), 1);
    pick("kid", c => kidCell(c, ctx.kids || []), 1);
    pick("place", c => !!placeMatch(c, ctx.places || [], false), 1);
    const rest = []; for (let i = 0; i < width; i++) if (!used.has(i) && filled(i)) rest.push(i);
    ["what", "place", "unsure"].forEach(role => { if (roles[role] === undefined && rest.length) { roles[role] = rest.shift(); } });
    return roles;
  }
  // ctx = { today, kids: [{id,name,active}], places: [{id,name}] }
  function parseList(text, ctx) {
    const res = { items: [], ignored: 0, header: false, tooMany: false, total: 0, error: null };
    if (String(text || "").length > MAX_BYTES) { res.error = "That is too much text. Paste up to 1 MB at a time."; return res; }
    let rows = splitLines(text);
    if (!rows.length) { res.error = "Nothing to read yet. Paste your list first."; return res; }
    const multi = rows.some(r => r.length > 1);
    let roles = null;
    if (multi) {
      rows = rows.map(r => mergeYears(r, ctx.today));
      const first = rows[0].map(c => HEAD[norm(c)] || null);
      const known = first.filter(Boolean).length;
      if (known >= 2 && !rows[0].some(c => dateAt(c.trim(), ctx.today))) { res.header = true; roles = first; rows = rows.slice(1); }
      else if (known >= 1 && rows.length > 1 && !rows[0].some(c => dateAt(c.trim(), ctx.today) || timeWhole(c))) { res.header = true; roles = first; rows = rows.slice(1); }
    }
    res.total = rows.length;
    if (rows.length > MAX_ROWS) { res.tooMany = true; return res; }
    if (!multi) {
      rows.forEach(r => {
        const t = typedLine(r[0], ctx);
        if (t.n == null && t.start == null) { res.ignored++; return; }
        res.items.push(makeItem({ ...t, src: "paste", loosePlace: false }, ctx));
      });
      return res;
    }
    const map = mapColumns(rows, roles, ctx);
    const cell = (r, role) => (map[role] !== undefined && r[map[role]] != null ? r[map[role]].trim() : "");
    rows.forEach(r => {
      let dText = cell(r, "date"), tText = cell(r, "time"), flags = [], n = null, start = null, end = null;
      const d = dText ? dateAt(dText, ctx.today) : null;
      if (d) { n = d.n; flags = flags.concat(d.flags); if (d.len < dText.length && !tText) tText = dText.slice(d.len).replace(/^[\s,;:\-]+/, ""); }
      const t = tText ? timeAt(tText.trim()) : null;
      if (t) { start = t.start; end = t.end; flags = flags.concat(t.flags); }
      if (!d && !t) { res.ignored++; return; }
      res.items.push(makeItem({ n, start, end, what: cell(r, "what"), kidText: cell(r, "kid"), placeText: cell(r, "place"), unsure: cell(r, "unsure"), flags,
        rawDate: d ? "" : dText, rawTime: t ? "" : tText, src: "paste", raw: r.join(" | ") }, ctx));
    });
    return res;
  }

  // ---------- Calendar files (.ics) ----------
  const fmtCache = {};
  function tzParts(ms, tz) {
    const key = tz || "";
    const f = fmtCache[key] || (fmtCache[key] = new Intl.DateTimeFormat("en-US", Object.assign({ hour12: false, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }, tz ? { timeZone: tz } : {})));
    const p = {}; f.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
    return { n: num(+p.year, +p.month, +p.day), m: (+p.hour % 24) * 60 + +p.minute };
  }
  const wallMs = (n, m) => n * DAY + m * 60000;
  function wallToInstant(n, m, tz) {   // the moment a wall clock time happened in time zone tz, or null when tz is not a zone name
    try {
      const g = wallMs(n, m), p = tzParts(g, tz), i1 = g - (wallMs(p.n, p.m) - g), p2 = tzParts(i1, tz);
      return g - (wallMs(p2.n, p2.m) - i1) - 0;
    } catch (e) { return null; }
  }
  function unfold(t) { return String(t).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, ""); }
  function unesc(v) { return v.replace(/\\([nN,;\\])/g, (m, c) => (/[nN]/.test(c) ? "\n" : c)); }
  function parseProp(line) {
    let q = false, ci = -1;
    for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ":" && !q) { ci = i; break; } }
    if (ci < 0) return null;
    const head = line.slice(0, ci), value = line.slice(ci + 1), parts = []; let cur = ""; q = false;
    for (const c of head) { if (c === '"') { q = !q; cur += c; } else if (c === ";" && !q) { parts.push(cur); cur = ""; } else cur += c; }
    parts.push(cur);
    const params = {}; parts.slice(1).forEach(p => { const e = p.indexOf("="); if (e > 0) params[p.slice(0, e).toUpperCase()] = p.slice(e + 1).replace(/^"|"$/g, ""); });
    return { name: parts[0].toUpperCase(), params, value };
  }
  function icsWhen(p) {
    if (!p) return null;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(p.value.trim()); if (!m) return null;
    const n = num(+m[1], +m[2], +m[3]); if (n == null) return null;
    if (m[4] == null || (p.params.VALUE || "").toUpperCase() === "DATE") return { kind: "date", n, m: null };
    const mm = +m[4] * 60 + +m[5];
    if (m[7]) return { kind: "utc", n, m: mm };
    if (p.params.TZID) return { kind: "tz", n, m: mm, tz: p.params.TZID };
    return { kind: "floating", n, m: mm };
  }
  const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  function readRule(v) {
    const r = {}; v.split(";").forEach(x => { const e = x.indexOf("="); if (e > 0) r[x.slice(0, e).toUpperCase()] = x.slice(e + 1); });
    if (r.FREQ !== "WEEKLY") return null;
    if (Object.keys(r).some(k => !["FREQ", "INTERVAL", "BYDAY", "UNTIL", "COUNT", "WKST"].includes(k))) return null;
    if (!r.UNTIL && !r.COUNT) return null;
    const interval = r.INTERVAL ? +r.INTERVAL : 1; if (!(interval >= 1 && interval <= 52)) return null;
    let days = null;
    if (r.BYDAY) { days = r.BYDAY.split(",").map(x => BYDAY[x.trim().toUpperCase()]); if (days.some(x => x === undefined)) return null; }
    const count = r.COUNT ? +r.COUNT : null; if (r.COUNT && !(count >= 1)) return null;
    return { interval, days, count, until: r.UNTIL || null };
  }
  function parseDuration(v) {
    const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec((v || "").trim()); if (!m) return null;
    return (((+m[1] || 0) * 7 + (+m[2] || 0)) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0)) * 60000;
  }
  // ctx = { today, tz (device zone name, or leave out for this device's own), kids, places }
  function parseIcs(text, ctx) {
    const res = { items: [], skippedPast: 0, skippedUnreadable: 0, converted: false, tooMany: false, total: 0, error: null };
    if (String(text || "").length > MAX_BYTES) { res.error = "That file is bigger than 1 MB. Export a shorter date range and try again."; return res; }
    const body = unfold(String(text || "").replace(/^\uFEFF/, ""));
    if (!/BEGIN:VCALENDAR/i.test(body)) { res.error = "That doesn't look like a calendar file."; return res; }
    const events = []; let cur = null, depth = 0;
    body.split("\n").forEach(line => {
      const u = line.trim().toUpperCase();
      if (u === "BEGIN:VEVENT") { cur = { p: {}, ex: [] }; depth = 0; return; }
      if (!cur) return;
      if (u === "END:VEVENT") { events.push(cur); cur = null; return; }
      if (u.startsWith("BEGIN:")) { depth++; return; }
      if (u.startsWith("END:")) { depth--; return; }
      if (depth > 0) return;
      const pr = parseProp(line); if (!pr) return;
      if (pr.name === "EXDATE") cur.ex.push(pr); else if (!(pr.name in cur.p)) cur.p[pr.name] = pr;
    });
    const overrides = new Set();
    events.forEach(e => { if (e.p["RECURRENCE-ID"] && e.p.UID) { const w = icsWhen(e.p["RECURRENCE-ID"]); if (w) overrides.add(e.p.UID.value.trim() + "|" + w.n); } });
    const out = [];
    const toLocal = (kind, tz, ms) => {                       // an instant (or a wall time for floating and all-day) to this device's day and minutes
      if (kind === "date" || kind === "floating") return { n: Math.floor(ms / DAY), m: Math.round((ms - Math.floor(ms / DAY) * DAY) / 60000) };
      return tzParts(ms, ctx.tz);
    };
    let work = 0;
    for (const e of events) {
      if (out.length > MAX_ROWS || work > MAX_WORK) break;      // over the limit: stop before doing any more work
      const P = e.p, ds = icsWhen(P.DTSTART); if (!ds) continue;
      const uid0 = P.UID ? P.UID.value.trim() : "";
      let tzOk = true, instOf = w => wallMs(w.n, w.m || 0);
      if (ds.kind === "utc") instOf = w => wallMs(w.n, w.m);
      if (ds.kind === "tz") instOf = w => { const i = wallToInstant(w.n, w.m, ds.tz); if (i == null) { tzOk = false; return wallMs(w.n, w.m); } return i; };
      let durMs = null;
      const de = icsWhen(P.DTEND);
      if (de && ds.kind !== "date") {
        let endInst;
        if (de.kind === "tz") { const i = wallToInstant(de.n, de.m, de.tz); endInst = i == null ? wallMs(de.n, de.m || 0) : i; } else endInst = wallMs(de.n, de.m || 0);
        durMs = endInst - instOf(ds);
      } else if (P.DURATION && ds.kind !== "date") durMs = parseDuration(P.DURATION.value);
      if (durMs != null && durMs <= 0) durMs = null;
      // Which start days
      let days = [ds.n], unreadable = false, recurring = false;
      if (P.RRULE) {
        const rule = readRule(P.RRULE.value);
        if (!rule) unreadable = true;
        else {
          recurring = true;
          let untilN = Infinity;
          if (rule.until) { const uw = icsWhen({ value: rule.until, params: {} }); if (uw) untilN = uw.kind === "utc" && ds.kind === "tz" && tzOk ? tzParts(wallMs(uw.n, uw.m), ds.tz).n : uw.n; }
          const want = [...new Set(rule.days || [dow(ds.n)])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
          const ws = ds.n - ((dow(ds.n) + 6) % 7), gen = [];
          for (let k = 0; gen.length < 260 && k < 600; k++) {
            let stop = false;
            for (const wdv of want) {
              const n = ws + k * rule.interval * 7 + ((wdv + 6) % 7);
              if (n < ds.n) continue;
              if (n > untilN || (rule.count && gen.length >= rule.count) || gen.length >= 260) { stop = true; break; }
              gen.push(n);
            }
            if (stop) break;
          }
          const ex = new Set(); e.ex.forEach(x => x.value.split(",").forEach(v => { const w = icsWhen({ value: v, params: {} }); if (w) ex.add(w.n); }));
          days = gen.filter(n => !ex.has(n) && !overrides.has(uid0 + "|" + n));
        }
      }
      const rid = P["RECURRENCE-ID"] ? icsWhen(P["RECURRENCE-ID"]) : null;
      const summary = P.SUMMARY ? unesc(P.SUMMARY.value) : "", loc = P.LOCATION ? unesc(P.LOCATION.value).split("\n")[0] : "", desc = P.DESCRIPTION ? unesc(P.DESCRIPTION.value) : "";
      const cancelled = P.STATUS && /^CANCELL?ED$/i.test(P.STATUS.value.trim());
      let firstSeen = false;
      for (const dn of days) {
        if (++work > MAX_WORK || out.length > MAX_ROWS) break;
        const wall = { n: dn, m: ds.m }, isDate = ds.kind === "date";
        let s, en = null;
        if (isDate) s = { n: dn, m: null };
        else {
          const inst = instOf(wall), kind = ds.kind === "tz" && !tzOk ? "floating" : ds.kind;   // unknown zone: the time as written
          s = toLocal(kind, ds.tz, inst);
          if (durMs != null) en = toLocal(kind, ds.tz, inst + durMs);
          if (ds.kind !== "floating") res.converted = res.converted || (ds.kind === "utc" || ds.kind === "tz");
        }
        const lastN = en ? en.n : s.n;
        if (lastN < ctx.today) { if (!firstSeen && unreadable) res.skippedUnreadable++; res.skippedPast++; firstSeen = true; continue; }
        firstSeen = true;
        const flags = [];
        if (unreadable) flags.push({ f: "other", t: "Repeats in a way I can't read. Only the first date was added." });
        if (ds.kind === "tz" && !tzOk) flags.push({ f: "time", t: `I don't know the time zone "${one(ds.tz).slice(0, 40)}". I used the time as written.` });
        let endM = null;
        if (en && en.n === s.n && en.m > s.m) endM = en.m; else if (en && en.n !== s.n) flags.push({ f: "time", t: "It ends after midnight. I left the end time out." });
        let uid = uid0 ? (recurring || rid ? `${uid0}#${str(rid ? rid.n : dn)}` : uid0) : null;
        if (uid && uid.length > 480) uid = null;
        const it = makeItem({ n: s.n, start: s.m, end: endM, what: summary, placeText: loc, flags, uid, canceled: !!cancelled, allDay: isDate, loosePlace: true, src: "file", raw: summary }, ctx);
        it.desc = desc.slice(0, 500);
        out.push(it);
        if (unreadable) break;
      }
    }
    // The same calendar id twice in one file would clash in the database: keep the first.
    const seen = new Set();
    out.forEach(it => { if (it.uid) { if (seen.has(it.uid)) it.uid = null; else seen.add(it.uid); } });
    res.total = out.length;
    if (out.length > MAX_ROWS || work > MAX_WORK) { res.tooMany = true; return res; }
    res.items = out.sort((a, b) => (a.day || "").localeCompare(b.day || "") || (a.start || 0) - (b.start || 0));
    return res;
  }

  // ---------- What a row means once Apply to all is counted ----------
  // all = { kids: [ids], team: "" or team id, place_id: "" or place id, place: "" | "__new", newName: "" }; lk = { teams: Map id->team, kids: [...] }
  function effective(r, all, lk) {
    all = all || {};
    const teamId = r.team !== undefined ? r.team : all.team || "", team = teamId ? lk.teams.get(teamId) || null : null;
    let kids = r.kids.length ? r.kids : (all.kids && all.kids.length ? all.kids : team ? team.kid_ids.filter(id => lk.kids.some(k => k.id === id)) : []);
    const e = { day: r.day, n: r.day ? Math.round(Date.parse(r.day + "T00:00:00Z") / DAY) : null, start: r.start, end: r.end, kids: kids.slice(), team_id: team ? team.id : null, kind: r.kind,
      title: null, place_id: null, place_text: null, new_place: null };
    e.title = team ? titleFor(r.what, r.kind, team.name) : (one(r.what) || null);
    if (r.place_id) e.place_id = r.place_id;
    else if (r.place_text) e.place_text = r.place_text;
    else if (all.place_id) e.place_id = all.place_id;
    else if (all.place === "__new" && one(all.newName)) e.new_place = one(all.newName).slice(0, 120);
    e.problems = [];
    if (!e.kids.length) e.problems.push("Pick who it's for.");
    if (!e.team_id && !e.title) e.problems.push("Needs a name or a team.");
    if (!r.day) e.problems.push("Needs a date.");
    if (r.start == null) e.problems.push("Needs a start time.");
    return e;
  }

  // ---------- Already on the tracker, or moved ----------
  const sameKids = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  function sameWhat(r, e, ex) {
    const cands = [norm(r.what), norm(e.title || ""), e.team_id ? norm((ex.label || "")) : ""].filter(Boolean);
    const exs = [norm(ex.label || ""), norm(ex.title || "")].filter(Boolean);
    if (!cands.length) return !!ex.kind && ex.kind === r.kind;
    return cands.some(c => exs.some(x => x === c || (c.length >= 3 && x.length >= 3 && (x.includes(c) || c.includes(x))) || (c === ex.kind)));
  }
  // existing: [{ id, day, start, end, kid_ids, title, kind, team_id, place_id, place_text, status, source_uid, label }]
  // Sets r.status ("new", "dup", "twice", "moved", "cancel", "gone"), r.target, r.changes (text lines), r.patch (columns to update) and r.checked on a change of status.
  function classify(rows, existing, all, lk, today) {
    const claimed = new Set(), nowStr = str(today), found = new Map();
    rows.forEach(r => { r.eff = effective(r, all, lk); });
    // 1. Exact matches first: the same calendar id, or the same kids, date, start time and name. Doing these first means a second
    //    session on the same day (a doubleheader) is not mistaken for the first one having moved.
    rows.forEach(r => {
      if (!r.day) return;
      const e = r.eff; let ex = null, by = null;
      if (r.uid) { ex = existing.find(x => x.source_uid && x.source_uid === r.uid && !claimed.has(x.id)) || null; if (ex) by = "uid"; }
      if (!ex && e.kids.length && r.start != null) { ex = existing.find(x => !claimed.has(x.id) && x.day === r.day && x.start === r.start && sameKids(x.kid_ids, e.kids) && sameWhat(r, e, x)) || null; if (ex) by = "match"; }
      if (ex) { claimed.add(ex.id); found.set(r, { ex, by }); }
    });
    // 2. Then the same kids, date and name at another time: it probably moved. The review row shows old and new, and can be switched to "add as new".
    rows.forEach(r => {
      if (!r.day || found.has(r) || r.asNew || !r.eff.kids.length) return;
      const e = r.eff, ex = existing.find(x => !claimed.has(x.id) && x.day === r.day && sameKids(x.kid_ids, e.kids) && sameWhat(r, e, x));
      if (ex) { claimed.add(ex.id); found.set(r, { ex, by: "match" }); }
    });
    rows.forEach(r => {
      const e = r.eff, f = found.get(r), ex = f ? f.ex : null;
      r.status = "new"; r.target = null; r.changes = []; r.patch = null; r.by = f ? f.by : null; r.canSplit = false;
      if (ex) {
        r.target = ex.id;
        if (r.canceled) { if (ex.status === "canceled") r.status = "dup"; else { r.status = "cancel"; r.changes.push("Canceled in the file"); r.patch = { status: "canceled" }; } }
        else {
          const patch = {}, ch = [];
          if (r.day !== ex.day) { patch.day = r.day; ch.push(`Date moved ${dateText(Math.round(Date.parse(ex.day + "T00:00:00Z") / DAY))} to ${dateText(e.n)}`); }
          const startDiff = r.start != null && r.start !== ex.start;
          if (startDiff) { patch.start_time = hhmm(r.start); ch.push(`Time moved ${fmtTime(ex.start)} to ${fmtTime(r.start)}`); if (r.end != null) patch.end_time = hhmm(r.end); }
          let placeDiff = false;
          if (r.place_id) placeDiff = r.place_id !== ex.place_id;
          else if (r.place_text) placeDiff = !!ex.place_id || norm(r.place_text) !== norm(ex.place_text || "");
          if (placeDiff) {
            patch.place_id = r.place_id || null; patch.place_text = r.place_id ? null : r.place_text;
            const pn = r.place_id && lk.places && lk.places.get(r.place_id);
            ch.push(`Place changed to ${pn ? pn.name : r.place_text || "a saved place"}`);
          }
          if (ch.length) { r.status = "moved"; r.changes = ch; r.patch = patch; r.canSplit = f.by === "match" && startDiff; } else r.status = "dup";
        }
        e.problems = [];      // nothing is added for this row: the activity already on the tracker keeps its own kids and name
      } else if (r.canceled) r.status = "gone";
    });
    // 4. The same row listed twice in one paste or file (same kids, date, start time and name): a later copy that would be added as new
    //    is "twice" and starts unticked. It can still be ticked and added. Rows matched to the tracker above keep their status.
    const seen = new Set();
    rows.forEach(r => {
      if (r.day && (r.status === "new" || r.status === "dup" || r.status === "moved")) {
        const e = r.eff, key = [r.day, r.start, e.kids.slice().sort().join(","), e.team_id || "", norm(e.title || ""), e.kind].join("|");
        if (!seen.has(key)) seen.add(key); else if (r.status === "new") r.status = "twice";
      }
      if (r.prevStatus !== r.status) { r.checked = (r.status === "new" || r.status === "moved" || r.status === "cancel") && !(r.day && r.day < nowStr); r.prevStatus = r.status; }
    });
    return rows;
  }

  // ---------- Wording ----------
  const plural = (n, one1, many) => `${n} ${n === 1 ? one1 : many}`;
  function headline(rows) {
    const live = rows.filter(r => r.status !== "gone"), c = { practice: 0, game: 0, lesson: 0, other: 0 };
    live.forEach(r => { c[r.kind] = (c[r.kind] || 0) + 1; });
    if (!live.length) return rows.length ? "Nothing to add or change" : "I couldn't find any activities";
    const parts = [];
    if (c.practice) parts.push(plural(c.practice, "practice", "practices"));
    if (c.game) parts.push(plural(c.game, "game", "games"));
    if (c.lesson) parts.push(plural(c.lesson, "lesson", "lessons"));
    if (c.other) parts.push(parts.length ? plural(c.other, "other activity", "other activities") : plural(c.other, "activity", "activities"));
    return "I found " + (parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0]);
  }
  const needsLook = r => r.status === "moved" || r.status === "cancel" || (r.status !== "dup" && r.status !== "twice" && (r.flags.some(f => !f.soft) || (r.eff && r.eff.problems.length > 0)));
  // srcText: "the list you pasted", "the file Team.ics" and so on.
  function summary(rows, srcText) {
    const live = rows.filter(r => r.status !== "gone"), dup = live.filter(r => r.status === "dup").length, look = live.filter(needsLook).length;
    const twice = live.filter(r => r.status === "twice").length, bits = [`From ${srcText}.`];
    if (rows.length && !live.length) return bits[0];      // only canceled events that were never on the tracker: the note under this says so
    if (dup) bits.push(`${dup} ${dup === 1 ? "is" : "are"} already on the tracker.`);
    if (twice) bits.push(`${twice} ${twice === 1 ? "is" : "are"} listed twice.`);
    if (look) bits.push(`${look} ${look === 1 ? "needs" : "need"} a quick look.`);
    if (!dup && !twice && !look) bits.push("Everything looks clear.");
    return bits.join(" ");
  }
  // The one text for a whole import. o = { me, adds: [{ n, kind, kidNames: [] }], moved: count, canceled: count, dayText: fn(day number) }
  function textLine(o) {
    const list = (a, w) => a.length > 1 ? a.slice(0, -1).join(", ") + " " + w + " " + a[a.length - 1] : a[0] || "";
    const bits = [];
    if (o.adds.length) {
      const ns = o.adds.map(a => a.n), lo = Math.min(...ns), hi = Math.max(...ns), c = {};
      o.adds.forEach(a => { c[a.kind] = (c[a.kind] || 0) + 1; });
      const what = [["practice", "practice", "practices"], ["game", "game", "games"], ["lesson", "lesson", "lessons"]].filter(k => c[k[0]]).map(k => plural(c[k[0]], k[1], k[2]));
      if (c.other) what.push(what.length ? plural(c.other, "other activity", "other activities") : plural(c.other, "activity", "activities"));
      const names = [...new Set([].concat(...o.adds.map(a => a.kidNames)))];
      bits.push(`${o.me} added ${plural(o.adds.length, "activity", "activities")} (${list(what, "and")})${names.length ? " for " + list(names, "and") : ""}, ${lo === hi ? "on " + o.dayText(lo) : o.dayText(lo) + " to " + o.dayText(hi)}.`);
    }
    if (o.moved) bits.push(`${o.adds.length ? "Also updated" : o.me + " updated"} ${plural(o.moved, "activity that moved", "activities that moved")}.`);
    if (o.canceled) bits.push(`${o.adds.length || o.moved ? "Also canceled" : o.me + " canceled"} ${plural(o.canceled, "activity", "activities")}.`);
    return "Kids Tracker: " + bits.join(" ");
  }
  // The request copied for the AI chat. Names come from the page's loaded data at run time. Nothing here is a real name.
  function helperRequest(o) {
    const T = "\t", names = a => a.filter(Boolean).join(", ");
    const lines = [
      "I am attaching a photo, screenshot, PDF or message with a schedule of my kids' activities. Please read it and answer with ONLY the rows below, with no other text and no code block.",
      "",
      "Use tab separated rows, one activity per row, in exactly these columns:",
      ["Date", "Time", "What", "Kid", "Place", "Unsure"].join(T),
      "",
      "Rules:",
      "- The first row is the header above. Then one row per activity.",
      `- Date: write it as YYYY-MM-DD. Today is ${o.todayText}. If the schedule shows no year, use the next date that fits and say so in Unsure.`,
      "- Time: the start and end like 5:30-6:30 pm, or only the start like 5:30 pm if there is no end. Always include am or pm.",
      "- What: practice, game or lesson, plus a short name if there is one (for example: game vs Eagles).",
      `- Kid: ${o.kids && o.kids.length ? "one of " + names(o.kids) + ", or Both" : "the kid's first name, or Both"}. Leave it empty if the schedule does not say.`,
      `- Place: ${o.places && o.places.length ? "use one of these exactly if it matches: " + names(o.places) + ". Otherwise write the place as shown" : "write the place as shown"}. Leave it empty if there is none.`,
    ];
    if (o.teams && o.teams.length) lines.push(`- Team names I already use, if they help you tell activities apart: ${names(o.teams)}.`);
    lines.push("- Unsure: leave it empty unless you guessed. If you guessed anything (a year, an am or pm, a place, which kid), say what you guessed and why in a few words.",
      "- Never invent an activity. If a line is not an activity, leave it out.");
    return lines.join("\n");
  }

  const api = { MAX_ROWS, MAX_BYTES, KINDS, parseList, parseIcs, effective, classify, headline, summary, textLine, helperRequest, needsLook, titleFor, kindOf, fmtTime, hhmm, timeAt, dateAt, num, str, ymd, dow };
  root.KTImport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
