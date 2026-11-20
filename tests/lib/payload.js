/* TEST ONLY. Builds the schedule payloads the way supabase/schema.sql does, from fixture tables.
   Used in two places so they can never drift apart:
     - run.mjs (Node) builds the family page answer for get_schedule (p_family = true, a 7 back / 60 ahead window).
     - fake-supabase.js (in the browser) answers get_editor_schedule (p_family = false, no window) after every write.

   Mirrors, column by column:
     kt_schedule_core()                -> core(db)
     kt_activities(p_from, p_to, fam)  -> activities(db, from, to, family, nowMs)
   Every key is named one by one, like the SQL. Anything not listed in the SQL is never copied across,
   so a fixture row can carry extra fields (ical_url, lat, before, after, source_uid) to prove they are dropped. */
(function (root) {
  "use strict";
  var DAY = 86400000;
  var arr = function (x) { return Array.isArray(x) ? x : []; };
  var has = function (o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); };
  var val = function (o, k) { return has(o, k) && o[k] !== undefined ? o[k] : null; };
  var inWin = function (d, from, to) { return typeof d === "string" && (from == null || d >= from) && (to == null || d <= to); };
  var cmp = function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };

  // kt_schedule_core(): settings (names and anchor only), changed_at, breaks, swaps with the shared detail.
  function core(db) {
    var s = arr(db.settings)[0] || null;
    var det = {}; arr(db.swap_details).forEach(function (d) { det[d.day] = d; });
    return {
      settings: s ? { my_name: s.my_name, co_name: s.co_name, anchor: s.anchor } : null,
      changed_at: s ? s.changed_at : null,
      breaks: arr(db.breaks).map(function (b) { return { year: b.year, data: b.data }; }),
      swaps: arr(db.swaps).slice().sort(function (a, b) { return cmp(a.day, b.day); }).map(function (w) {
        var d = det[w.day] || {};
        return { day: w.day, had: w.had, caregiver: val(w, "caregiver"), reason: val(d, "reason"), note: val(d, "note"), updated_at: w.updated_at };
      }),
    };
  }

  // kt_activities(p_from, p_to, p_family). nowMs stands in for now() (the log goes back 30 days for the family, 90 for editors).
  function activities(db, from, to, family, nowMs) {
    var fam = family !== false;
    var ev = arr(db.events).filter(function (e) { return inWin(e.day, from, to); });
    var evTeam = {}, evPlace = {}, evKid = {}, evId = {};
    ev.forEach(function (e) { evId[e.id] = 1; if (e.team_id) evTeam[e.team_id] = 1; if (e.place_id) evPlace[e.place_id] = 1; arr(e.kid_ids).forEach(function (k) { evKid[k] = 1; }); });
    var tm = arr(db.teams).filter(function (t) { return !fam || evTeam[t.id]; });
    var tmId = {}, tmPlace = {}; tm.forEach(function (t) { tmId[t.id] = 1; if (t.place_id) tmPlace[t.place_id] = 1; });
    var pl = arr(db.places).filter(function (p) { return !fam || evPlace[p.id] || tmPlace[p.id]; });
    var kd = arr(db.kids).filter(function (k) { return !fam || k.active !== false || evKid[k.id]; });
    var cm = arr(db.event_comments).filter(function (c) { return evId[c.event_id] && (c.share_family === true || !fam); });
    var cut = nowMs - (fam ? 30 : 90) * DAY;
    var lg = arr(db.event_log).filter(function (x) { return Date.parse(x.at) >= cut; });
    var counts = {}; lg.forEach(function (x) { var k = x.batch_id + "|" + x.action; counts[k] = (counts[k] || 0) + 1; });
    var dayOf = function (j) { return j && typeof j.day === "string" ? j.day : null; };
    var srcOf = function (x) { return (x.after && x.after.source) || (x.before && x.before.source) || null; };
    var lgOut = lg.filter(function (x) {
      if (!fam) return true;
      if (x.team_id && tmId[x.team_id]) return true;
      var a = dayOf(x.after), b = dayOf(x.before);
      return (a && from != null && to != null && a >= from && a <= to) || (b && from != null && to != null && b >= from && b <= to);
    }).sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at) || cmp(a.summary, b.summary) || cmp(a.id, b.id); });
    return {
      window: { from: from == null ? null : from, to: to == null ? null : to },
      kids: kd.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0) || cmp(a.name, b.name); })
        .map(function (k) { return { id: k.id, name: k.name, color: k.color, sort: k.sort, active: k.active !== false }; }),
      places: pl.slice().sort(function (a, b) { return cmp(a.name, b.name); })
        .map(function (p) { return { id: p.id, name: p.name, address: val(p, "address"), drive_me: val(p, "drive_me"), drive_co: val(p, "drive_co"), drive_grandma: val(p, "drive_grandma"), note: val(p, "note") }; }),
      teams: tm.slice().sort(function (a, b) { return cmp(a.name, b.name); })
        .map(function (t) { return { id: t.id, name: t.name, kid_ids: arr(t.kid_ids), place_id: val(t, "place_id"), early_practice: t.early_practice || 0, early_game: t.early_game || 0, gear: arr(t.gear), note: val(t, "note"), active: t.active !== false }; }),
      events: ev.slice().sort(function (a, b) { return cmp(a.day, b.day) || cmp(a.start_time, b.start_time) || cmp(a.id, b.id); })
        .map(function (e) { return { id: e.id, team_id: val(e, "team_id"), kid_ids: arr(e.kid_ids), kind: e.kind || "other", title: val(e, "title"), day: e.day, start_time: e.start_time, end_time: val(e, "end_time"),
          place_id: val(e, "place_id"), place_text: val(e, "place_text"), arrive_by: val(e, "arrive_by"), gear: has(e, "gear") ? e.gear : null, note: val(e, "note"), status: e.status || "on",
          created_at: val(e, "created_at"), updated_at: val(e, "updated_at"), updated_by: val(e, "updated_by") }; }),
      comments: cm.slice().sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at) || cmp(a.id, b.id); })
        .map(function (c) { return { id: c.id, event_id: c.event_id, at: c.at, author: c.author, body: c.body, tagged: arr(c.tagged), share_family: c.share_family === true }; }),
      log: lgOut.map(function (x) { return { id: x.id, at: x.at, who: val(x, "who"), action: x.action, event_id: val(x, "event_id"), team_id: val(x, "team_id"), summary: x.summary,
        source: srcOf(x), batch_id: x.batch_id, batch_count: counts[x.batch_id + "|" + x.action] }; }),
    };
  }

  // Calendar day in US Eastern time for an instant, as "YYYY-MM-DD" (get_schedule names the zone explicitly).
  function easternDay(ms) {
    var p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
    var g = function (t) { return p.filter(function (x) { return x.type === t; })[0].value; };
    return g("year") + "-" + g("month") + "-" + g("day");
  }
  var shift = function (iso, n) { return new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10); };

  // get_schedule(p_token) for an active token: the core plus activities from 7 days back to 60 ahead.
  function family(db, nowMs) {
    var t = easternDay(nowMs), out = core(db), a = activities(db, shift(t, -7), shift(t, 60), true, nowMs);
    Object.keys(a).forEach(function (k) { out[k] = a[k]; });
    return out;
  }
  // get_editor_schedule() with no limits: the core plus every activity.
  function editor(db, nowMs) {
    var out = core(db), a = activities(db, null, null, false, nowMs);
    Object.keys(a).forEach(function (k) { out[k] = a[k]; });
    return out;
  }

  root.KTTestPayload = { core: core, activities: activities, family: family, editor: editor, easternDay: easternDay };
})(typeof window !== "undefined" ? window : globalThis);
