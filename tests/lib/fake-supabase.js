/* TEST ONLY. A small stand-in for supabase-js, served by the harness in place of the CDN file.
   It supports exactly the call shapes app.js and activities.js use and nothing else, so a new call shape fails loudly.
   It needs tests/lib/payload.js loaded first (window.KTTestPayload) to answer get_editor_schedule.

   Reads its setup from window.__KT_FAKE_CFG__ (set by the harness before any page script runs):
     { db: { settings, breaks, swaps, swap_details, share_links,                       // custody tables
             kids, homes, places, teams, events, event_comments, contacts, event_log },  // activities tables
       signedIn: true|false, role: "admin"|"parent"|null, failAll: true|false,
       hang: true|false,          // the server never answers, so the page stays on its Loading card
       editor: "full"|"old"|"missing" }   // get_editor_schedule: today's shape, an older one with no activity keys, or not there at all

   What the fake does the way the database does (supabase/schema.sql), so the pages see realistic answers:
     - my_role / my_who / get_editor_schedule. get_editor_schedule returns null for anyone who is not admin or parent.
     - A parent's sign-in reads nothing from settings, breaks, swaps, swap_details, share_links or app_users (row level
       security: the rows are filtered out, no error). Contacts can only be written by admin (42501 for a parent).
     - Server-set fields are stamped here: events created_by/created_at/updated_by/updated_at, status 'on' and source 'hand'
       on insert; comments author/at/share_family. One change log line per event or team write, one batch per request.
       The harness reads the request payloads exactly as the page sent them, before any stamping.
     - Foreign keys: removing a place or team that something still uses fails with 23503. Kids cannot be removed (42501).
     - Check rules that matter for messages: kids name up to 60 characters, places and teams 120 (23514).
     - Removing an event removes its comments.

   Exposes window.__KT_FAKE__ = { calls: [...], pending: n, db, failNext: [] } so tests can see what the page asked for.
   failNext: push { table or rpc, op, error: { code, message } } to make the next matching request fail once. */
(function () {
  "use strict";
  if (window.supabase && window.supabase.__ktFake) return;   // already installed by the init script
  var cfg = window.__KT_FAKE_CFG__ || {};
  var db = JSON.parse(JSON.stringify(cfg.db || {}));
  var TABLES = ["settings", "breaks", "swaps", "swap_details", "share_links", "app_users",
    "kids", "homes", "places", "teams", "events", "event_comments", "contacts", "event_log"];
  TABLES.forEach(function (t) { if (!Array.isArray(db[t])) db[t] = []; });
  var PK = { settings: "id", breaks: "year", swaps: "day", swap_details: "day", share_links: "token", app_users: "email",
    kids: "id", homes: "who", places: "id", teams: "id", events: "id", event_comments: "id", contacts: "who", event_log: "id" };
  var CUSTODY = ["settings", "breaks", "swaps", "swap_details", "share_links", "app_users"];
  var state = { calls: [], pending: 0, db: db, tokenSeq: 0, idSeq: 0, failNext: (cfg.failNext || []).slice() };
  var clone = function (x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); };
  var FAIL = { message: "mock failure" };
  var role = function () { return cfg.role === undefined ? "admin" : cfg.role; };
  var who = function () { return role() === "admin" ? "me" : role() === "parent" ? "co" : null; };
  var isEditor = function () { return role() === "admin" || role() === "parent"; };
  var nowIso = function () { return new Date().toISOString().replace("Z", "+00:00"); };
  var newId = function (p) { state.idSeq++; return p + "1111111-1111-4111-9111-" + String(state.idSeq).padStart(12, "0"); };   // never the same shape as a fixture id
  var err = function (code, message) { var e = new Error(message); e.pg = { code: code, message: message }; return e; };
  var bump = function () { if (db.settings[0]) db.settings[0].changed_at = nowIso(); };

  // Every answer arrives a moment later, like a network call would.
  // "local" answers (reading the saved session) do not depend on the network, so failAll leaves them alone.
  function later(fn, local) {
    state.pending++;
    return new Promise(function (resolve) {
      if (cfg.hang && !local) return;   // never answers
      setTimeout(function () {
        var out;
        try { out = cfg.failAll && !local ? { data: null, error: FAIL } : fn(); }
        catch (e) { out = { data: null, error: e && e.pg ? e.pg : { message: String((e && e.message) || e) } }; }
        state.pending--;
        resolve(out);
      }, 8);
    });
  }
  function injected(kind, name, op) {
    var i = state.failNext.findIndex(function (f) { return (f[kind] === name) && (!f.op || f.op === op); });
    if (i === -1) return null;
    var f = state.failNext.splice(i, 1)[0];
    return f.error || FAIL;
  }

  // ---- What the database adds on its own (triggers) ----
  var DY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var dayText = function (d) { var t = new Date(d + "T00:00:00Z"); return DY[t.getUTCDay()] + " " + MO[t.getUTCMonth()] + " " + t.getUTCDate(); };
  var timeText = function (t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ""); if (!m) return ""; var h = Number(m[1]); return ((h % 12) || 12) + ":" + m[2] + " " + (h < 12 ? "a.m." : "p.m."); };
  function label(e) {
    var t = e.team_id && db.teams.filter(function (x) { return x.id === e.team_id; })[0], title = String(e.title || "").trim();
    if (t && ["practice", "game", "lesson"].indexOf(e.kind) !== -1) return t.name + " " + e.kind;
    if (t && title) return t.name + ": " + title;
    if (t) return t.name;
    return title || "an activity";
  }
  function log(action, row, before, after, batch, isTeam) {
    var s;
    if (isTeam) s = action === "added" ? 'added the team "' + row.name + '"' : action === "removed" ? 'removed the team "' + row.name + '"' : 'changed the team "' + row.name + '": details';
    else if (action === "added") s = "added " + label(row) + " on " + dayText(row.day) + " at " + timeText(row.start_time);
    else if (action === "removed") s = "removed " + label(row) + " on " + dayText(row.day) + " at " + timeText(row.start_time);
    else if (action === "canceled") s = "canceled " + label(row) + " on " + dayText(row.day) + " at " + timeText(row.start_time);
    else if (action === "restored") s = "put " + label(row) + " back on for " + dayText(row.day) + " at " + timeText(row.start_time);
    else s = "updated " + label(row) + " on " + dayText(row.day) + ": details";
    db.event_log.push({ id: newId("1"), at: nowIso(), who: who(), action: action, event_id: isTeam ? null : row.id, team_id: isTeam ? row.id : null, summary: s,
      before: before ? clone(before) : null, after: after ? clone(after) : null, batch_id: batch });
  }
  function checkRow(table, row) {
    var lim = { kids: 60, places: 120, teams: 120 }[table];
    if (lim && row.name != null && (String(row.name).trim() === "" || String(row.name).length > lim)) throw err("23514", 'new row for relation "' + table + '" violates check constraint "' + table + '_name_check"');
    if (table === "events" && row.title != null && String(row.title).length > 120) throw err("23514", 'new row for relation "events" violates check constraint "events_title_check"');
  }
  function stampInsert(table, row, batch) {
    if (table === "events") {
      if (row.id == null) row.id = newId("e");
      if (row.kind == null) row.kind = "other";
      if (row.status == null) row.status = "on";
      if (row.source == null) row.source = "hand";
      row.created_at = row.updated_at = nowIso(); row.created_by = row.updated_by = who();
      log("added", row, null, row, batch);
    } else if (table === "event_comments") {
      if (row.id == null) row.id = newId("c");
      row.tagged = (row.tagged || []).filter(function (t, i, a) { return a.indexOf(t) === i; }).sort();
      row.author = who(); row.at = nowIso(); row.share_family = row.tagged.indexOf("grandma") !== -1;
    } else if (table === "teams") {
      if (row.id == null) row.id = newId("t");
      if (row.gear == null) row.gear = []; if (row.active == null) row.active = true;
      log("added", row, null, row, batch, true);
    } else if (["places", "kids"].indexOf(table) !== -1 && row.id == null) row.id = newId(table === "places" ? "p" : "k");
    else if (table === "share_links") {
      if (row.token == null) row.token = "NEWTOKEN" + (++state.tokenSeq);
      if (row.active == null) row.active = true;
      if (row.created_at == null) row.created_at = new Date().toISOString();
    }
  }

  function Query(table) {
    if (!(table in PK)) throw new Error("fake supabase: unknown table " + table);
    this.table = table; this.op = "select"; this.payload = null; this.filters = []; this.columns = null;
    this.sort = null; this.max = null; this.one = null; this.returning = false;
  }
  Query.prototype.select = function (cols) { if (this.op !== "select") this.returning = true; else this.columns = cols === undefined ? null : cols; return this; };
  Query.prototype.insert = function (rows) { this.op = "insert"; this.payload = clone(rows); return this; };
  Query.prototype.upsert = function (rows) { this.op = "upsert"; this.payload = clone(rows); return this; };
  Query.prototype.update = function (patch) { this.op = "update"; this.payload = clone(patch); return this; };
  Query.prototype.delete = function () { this.op = "delete"; return this; };
  Query.prototype.eq = function (col, val) { this.filters.push({ kind: "eq", col: col, val: val }); return this; };
  Query.prototype.in = function (col, vals) { this.filters.push({ kind: "in", col: col, val: clone(vals) }); return this; };
  Query.prototype.not = function (col, op, val) { this.filters.push({ kind: "not", col: col, op: op, val: val }); return this; };
  Query.prototype.order = function (col, opts) { this.sort = { col: col, asc: !(opts && opts.ascending === false) }; return this; };
  Query.prototype.limit = function (n) { this.max = n; return this; };
  Query.prototype.single = function () { this.one = "single"; return this; };
  Query.prototype.maybeSingle = function () { this.one = "maybe"; return this; };
  Query.prototype._match = function (row) {
    return this.filters.every(function (f) {
      if (f.kind === "eq") return row[f.col] === f.val;
      if (f.kind === "not") { if (f.op !== "is") throw new Error("fake supabase: .not() only supports 'is'"); return !(f.val === null ? row[f.col] == null : row[f.col] === f.val); }
      return f.val.indexOf(row[f.col]) !== -1; });
  };
  Query.prototype._run = function () {
    var self = this, t = this.table, pk = PK[t], touched = [], batch = this.op === "select" ? null : newId("b");   // one batch per write request
    var call = { table: t, op: this.op, payload: this.payload, filters: this.filters, sort: this.sort, limit: this.max, one: this.one, returning: this.returning };
    if (this.columns !== null && this.columns !== "*") call.columns = this.columns;   // only recorded when the page names columns, so older call records keep their shape
    state.calls.push(clone(call));
    var bad = injected("table", t, this.op); if (bad) return { data: null, error: bad };
    var hidden = role() === "parent" && CUSTODY.indexOf(t) !== -1;   // row level security filters every row out for a parent
    if (t === "event_log" && this.op !== "select") throw err("42501", "permission denied for table event_log");
    if (t === "kids" && this.op === "delete") throw err("42501", "permission denied for table kids");
    if (t === "event_comments" && this.op === "update") throw err("42501", "permission denied for table event_comments");
    if (t === "contacts" && this.op !== "select" && role() !== "admin") throw err("42501", 'new row violates row-level security policy for table "contacts"');
    if (hidden && this.op !== "select") throw err("42501", 'new row violates row-level security policy for table "' + t + '"');
    var rows = hidden ? [] : db[t];
    if (this.op === "select") {
      touched = rows.filter(function (r) { return self._match(r); });
      if (this.sort) { var s = this.sort; touched = touched.slice().sort(function (a, b) { return (a[s.col] < b[s.col] ? -1 : a[s.col] > b[s.col] ? 1 : 0) * (s.asc ? 1 : -1); }); }
      if (this.max != null) touched = touched.slice(0, this.max);
      if (this.columns && this.columns !== "*") { var cols = this.columns.split(",").map(function (c) { return c.trim(); }); touched = touched.map(function (r) { var o = {}; cols.forEach(function (c) { o[c] = r[c]; }); return o; }); }
    } else if (this.op === "insert" || this.op === "upsert") {
      (Array.isArray(this.payload) ? this.payload : [this.payload]).forEach(function (p) {
        var row = clone(p);
        checkRow(t, row);
        if (t === "events" && row.source_uid != null && rows.some(function (r) { return r.source_uid === row.source_uid; })) throw err("23505", 'duplicate key value violates unique constraint "events_source_uid_key"');
        var i = row[pk] == null ? -1 : rows.findIndex(function (r) { return r[pk] === row[pk]; });
        if (i === -1) { stampInsert(t, row, batch); rows.push(row); touched.push(row); }
        else if (self.op === "upsert") { rows[i] = Object.assign({}, rows[i], row); touched.push(rows[i]); }
        else throw err("23505", "duplicate key value violates unique constraint \"" + t + "_pkey\"");
      });
      if (["events", "teams", "kids", "places"].indexOf(t) !== -1 || (t === "event_comments" && touched.some(function (r) { return r.share_family; }))) bump();
    } else if (this.op === "update") {
      rows.forEach(function (r) {
        if (!self._match(r)) return;
        var before = clone(r), next = Object.assign({}, r, self.payload);
        checkRow(t, next);
        Object.assign(r, self.payload);
        if (t === "events") {
          var changed = JSON.stringify(before) !== JSON.stringify(r);
          if (changed) { r.updated_at = nowIso(); r.updated_by = who(); r.created_at = before.created_at; r.created_by = before.created_by;
            log(before.status === "on" && r.status === "canceled" ? "canceled" : before.status === "canceled" && r.status === "on" ? "restored" : "changed", r, before, r, batch); bump(); }
        }
        if (t === "teams") { log("changed", r, before, r, batch, true); bump(); }
        if (t === "kids" || t === "places") bump();
        touched.push(r);
      });
    } else if (this.op === "delete") {
      var gone = rows.filter(function (r) { return self._match(r); });
      if (t === "places" && gone.some(function (p) { return db.events.some(function (e) { return e.place_id === p.id; }) || db.teams.some(function (x) { return x.place_id === p.id; }); }))
        throw err("23503", 'update or delete on table "places" violates foreign key constraint "events_place_id_fkey" on table "events"');
      if (t === "teams" && gone.some(function (x) { return db.events.some(function (e) { return e.team_id === x.id; }); }))
        throw err("23503", 'update or delete on table "teams" violates foreign key constraint "events_team_id_fkey" on table "events"');
      if (t === "event_comments") gone = gone.filter(function (c) { return c.author === who(); });   // only your own (row level security)
      db[t] = rows.filter(function (r) { return gone.indexOf(r) === -1; });
      if (t === "swaps") {   // swap_details rows go with their swap (on delete cascade)
        var days = gone.map(function (r) { return r.day; });
        db.swap_details = db.swap_details.filter(function (r) { return days.indexOf(r.day) === -1; });
      }
      if (t === "events") gone.forEach(function (e) {
        log("removed", e, Object.assign(clone(e), { comments: db.event_comments.filter(function (c) { return c.event_id === e.id; }) }), null, batch);
        db.event_comments = db.event_comments.filter(function (c) { return c.event_id !== e.id; });
        bump();
      });
      if (t === "teams") gone.forEach(function (x) { log("removed", x, x, null, batch, true); bump(); });
      if (t === "places" && gone.length) bump();
      touched = gone;
    }
    var wantsRows = this.op === "select" || this.returning;
    if (this.one) {
      if (touched.length > 1 || (this.one === "single" && touched.length !== 1)) return { data: null, error: { message: "expected one row, got " + touched.length } };
      return { data: touched.length ? clone(touched[0]) : null, error: null };
    }
    return { data: wantsRows ? clone(touched) : null, error: null };
  };
  Query.prototype.then = function (onOk, onErr) { var self = this; return later(function () { return self._run(); }).then(onOk, onErr); };

  // The real library keeps the session in localStorage, so signing in or out survives a reload. So does the fake:
  // "kt-fake-auth" is "in" or "out" once the page has signed in or out; until then cfg.signedIn decides.
  var AUTH = "kt-fake-auth";
  var remember = function (v) { try { localStorage.setItem(AUTH, v); } catch (e) {} };
  function createClient(url, key, options) {
    state.created = { url: url, hasKey: !!key, options: clone(options) };
    var stored = null; try { stored = localStorage.getItem(AUTH); } catch (e) {}
    var session = (stored ? stored === "in" : cfg.signedIn) ? { user: { email: "admin@example.test" }, access_token: "fake-access-token" } : null;
    var listeners = [];
    var emit = function (ev) { listeners.forEach(function (cb) { cb(ev, session); }); };
    return {
      auth: {
        onAuthStateChange: function (cb) {
          listeners.push(cb);
          setTimeout(function () { cb("INITIAL_SESSION", session); }, 0);
          return { data: { subscription: { unsubscribe: function () {} } } };
        },
        getSession: function () { return later(function () { return { data: { session: session }, error: null }; }, true); },
        signInWithPassword: function (cred) {
          state.calls.push({ auth: "signInWithPassword", email: cred && cred.email });
          return later(function () {
            if (cred && cred.password === "correct-test-password") { session = { user: { email: cred.email }, access_token: "fake-access-token" }; remember("in"); setTimeout(function () { emit("SIGNED_IN"); }, 0); return { data: { session: session }, error: null }; }
            return { data: { session: null }, error: { message: "Invalid login credentials" } };
          });
        },
        signInWithOtp: function (arg) { state.calls.push({ auth: "signInWithOtp", email: arg && arg.email, redirectTo: (arg && arg.options && arg.options.emailRedirectTo) || null }); return later(function () { return { data: {}, error: null }; }); },
        // No verifyOtp on purpose: the code sign-in step was removed from the page, so any call to it must fail loudly.
        signOut: function () { state.calls.push({ auth: "signOut" }); return later(function () { session = null; remember("out"); setTimeout(function () { emit("SIGNED_OUT"); }, 0); return { error: null }; }, true); },
      },
      rpc: function (name, args) {
        state.calls.push({ rpc: name, args: clone(args) || null });
        return later(function () {
          var bad = injected("rpc", name); if (bad) return { data: null, error: bad };
          if (name === "my_role") return { data: session ? role() : null, error: null };
          if (name === "my_who") return { data: session ? who() : null, error: null };
          if (name === "get_editor_schedule" && cfg.editor !== "missing") {
            if (!session || !isEditor()) return { data: null, error: null };
            var P = window.KTTestPayload, full = P.editor(db, Date.now());
            if (cfg.editor === "old") return { data: P.core(db), error: null };
            // cfg.leaky: a payload that wrongly carries fields the real function never sends, to prove the page would not show them.
            if (cfg.leaky) { (full.swaps || []).forEach(function (r) { r.pnote = "PRIVATE-LEAK for " + r.day; }); full.settings.track_from = "2026-10-07"; full.totals = { me: 96, co: 74, pct: "54.9%" }; }
            return { data: full, error: null };
          }
          if (name === "get_editor_schedule") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.get_editor_schedule without parameters in the schema cache" } };
          return { data: null, error: { message: "fake supabase: unknown rpc " + name } };
        });
      },
      from: function (table) { return new Query(table); },
    };
  }

  var api = { createClient: createClient, __ktFake: true };
  // Locked in place so nothing loaded later can swap the real library in.
  Object.defineProperty(window, "supabase", { configurable: false, enumerable: true, get: function () { return api; }, set: function () {} });
  window.__KT_FAKE__ = state;
})();
