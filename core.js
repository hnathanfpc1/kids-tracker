/* Kids Tracker: shared schedule logic. Dates, rotation, holidays, school calendar, who has the kids, handoff times.
   No page code in here: nothing reads the page, loads data or saves data.
   Each page keeps its own state and asks for a schedule built on it:
     const sched = window.KTCore.schedule(st);   // st = { settings, swaps, breaks }
   The schedule reads st live. After st.settings, st.swaps or st.breaks change, call sched.rebuild(). */
window.KTCore = (() => {
  "use strict";

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
  const range = (a, b) => b > a ? `${fmt(a, SD)} to ${fmt(b, SD)}` : fmt(a, { weekday: "short", ...SD });

  // One neutral set of reasons, the same wording on both pages.
  const REASONS = { work: "Work", travel: "Travel", coverage: "Coverage requested", other: "Trade or other" };
  const reasonLabel = rec => (rec && REASONS[rec.reason]) || "";
  const GRANDMA = "Grandma";
  const famWhy = rec => rec ? [reasonLabel(rec), rec.note].filter(Boolean).join(". ") : "";

  // ---------- Holidays from the custody agreement ("me" = Mother/Wife, "co" = Father/Husband) ----------
  const HOL = {
    sum: { s: "Summer week", n: "Summer week" }, spring: { s: "Spring break", n: "Spring break" },
    tg: { s: "Thanksgiving", n: "Thanksgiving" }, xm1: { s: "Christmas", n: "Christmas, first part" },
    xm2: { s: "Christmas", n: "Christmas, second part" }, md: { s: "Mother's Day", n: "Mother's Day weekend" },
    fd: { s: "Father's Day", n: "Father's Day weekend" },
  };
  const nthSunday = (y, m, k) => { const f = ymd(y, m, 1); return f + ((7 - wd(f)) % 7) + 7 * (k - 1); };

  // ---------- The schedule for one page's state ----------
  function schedule(st) {
    const S = () => st.settings;
    const nameOf = (who, rec) => who === "me" ? S().myName : who === "co" ? S().coName : who === "grandma" ? GRANDMA : ((rec && rec.with) || "Someone else");

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
    const holOn = n => holMap.get(n);   // the holiday covering day n ({ who, key }), if any
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

    return { nameOf, holidayPeriods, rebuild, holOn, rotation, scheduled, recOf, actual, holderKey, schoolOn, handoffTime, switchGroups, schoolGroups };
  }

  return { DAY, pad, toNum, toStr, ymd, wd, yearOf, fmt, isDate, todayNum, thisMonth, SD, range,
    REASONS, reasonLabel, GRANDMA, famWhy, HOL, nthSunday, schedule };
})();
