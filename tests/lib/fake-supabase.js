/* TEST ONLY. A small stand-in for supabase-js, served by the harness in place of the CDN file.
   It supports exactly the call shapes app.js uses and nothing else, so a new call shape fails loudly.

   Reads its setup from window.__KT_FAKE_CFG__ (set by the harness before any page script runs):
     { db: { settings, breaks, swaps, swap_details, share_links },   // table rows
       signedIn: true|false, role: "admin"|null, failAll: true|false,
       hang: true|false }   // hang: the server never answers, so the page stays on its Loading card

   Exposes window.__KT_FAKE__ = { calls: [...], pending: n, db } so tests can see what the page asked for. */
(function () {
  "use strict";
  if (window.supabase && window.supabase.__ktFake) return;   // already installed by the init script
  var cfg = window.__KT_FAKE_CFG__ || {};
  var db = JSON.parse(JSON.stringify(cfg.db || {}));
  ["settings", "breaks", "swaps", "swap_details", "share_links"].forEach(function (t) { if (!Array.isArray(db[t])) db[t] = []; });
  var PK = { settings: "id", breaks: "year", swaps: "day", swap_details: "day", share_links: "token" };
  var state = { calls: [], pending: 0, db: db, tokenSeq: 0 };
  var clone = function (x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); };
  var FAIL = { message: "mock failure" };

  // Every answer arrives a moment later, like a network call would.
  // "local" answers (reading the saved session) do not depend on the network, so failAll leaves them alone.
  function later(fn, local) {
    state.pending++;
    return new Promise(function (resolve) {
      if (cfg.hang && !local) return;   // never answers
      setTimeout(function () {
        var out;
        try { out = cfg.failAll && !local ? { data: null, error: FAIL } : fn(); }
        catch (e) { out = { data: null, error: { message: String((e && e.message) || e) } }; }
        state.pending--;
        resolve(out);
      }, 8);
    });
  }

  function Query(table) {
    if (!(table in PK)) throw new Error("fake supabase: unknown table " + table);
    this.table = table; this.op = "select"; this.payload = null; this.filters = [];
    this.sort = null; this.max = null; this.one = null; this.returning = false;
  }
  Query.prototype.select = function () { if (this.op !== "select") this.returning = true; return this; };
  Query.prototype.insert = function (rows) { this.op = "insert"; this.payload = clone(rows); return this; };
  Query.prototype.upsert = function (rows) { this.op = "upsert"; this.payload = clone(rows); return this; };
  Query.prototype.update = function (patch) { this.op = "update"; this.payload = clone(patch); return this; };
  Query.prototype.delete = function () { this.op = "delete"; return this; };
  Query.prototype.eq = function (col, val) { this.filters.push({ kind: "eq", col: col, val: val }); return this; };
  Query.prototype.in = function (col, vals) { this.filters.push({ kind: "in", col: col, val: clone(vals) }); return this; };
  Query.prototype.order = function (col, opts) { this.sort = { col: col, asc: !(opts && opts.ascending === false) }; return this; };
  Query.prototype.limit = function (n) { this.max = n; return this; };
  Query.prototype.single = function () { this.one = "single"; return this; };
  Query.prototype.maybeSingle = function () { this.one = "maybe"; return this; };
  Query.prototype._match = function (row) {
    return this.filters.every(function (f) { return f.kind === "eq" ? row[f.col] === f.val : f.val.indexOf(row[f.col]) !== -1; });
  };
  Query.prototype._run = function () {
    var self = this, rows = db[this.table], pk = PK[this.table], touched = [];
    state.calls.push(clone({ table: this.table, op: this.op, payload: this.payload, filters: this.filters, sort: this.sort, limit: this.max, one: this.one, returning: this.returning }));
    if (this.op === "select") {
      touched = rows.filter(function (r) { return self._match(r); });
      if (this.sort) { var s = this.sort; touched = touched.slice().sort(function (a, b) { return (a[s.col] < b[s.col] ? -1 : a[s.col] > b[s.col] ? 1 : 0) * (s.asc ? 1 : -1); }); }
      if (this.max != null) touched = touched.slice(0, this.max);
    } else if (this.op === "insert" || this.op === "upsert") {
      (Array.isArray(this.payload) ? this.payload : [this.payload]).forEach(function (p) {
        var row = clone(p);
        if (self.table === "share_links") {
          if (row.token == null) row.token = "NEWTOKEN" + (++state.tokenSeq);
          if (row.active == null) row.active = true;
          if (row.created_at == null) row.created_at = new Date().toISOString();
        }
        var i = rows.findIndex(function (r) { return r[pk] === row[pk]; });
        if (i === -1) rows.push(row);
        else if (self.op === "upsert") rows[i] = Object.assign({}, rows[i], row);
        else throw new Error("duplicate key in " + self.table);
        touched.push(row);
      });
    } else if (this.op === "update") {
      rows.forEach(function (r) { if (self._match(r)) { Object.assign(r, self.payload); touched.push(r); } });
    } else if (this.op === "delete") {
      var gone = rows.filter(function (r) { return self._match(r); });
      db[this.table] = rows.filter(function (r) { return gone.indexOf(r) === -1; });
      if (this.table === "swaps") {   // swap_details rows go with their swap (on delete cascade)
        var days = gone.map(function (r) { return r.day; });
        db.swap_details = db.swap_details.filter(function (r) { return days.indexOf(r.day) === -1; });
      }
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

  function createClient(url, key, options) {
    state.created = { url: url, hasKey: !!key, options: clone(options) };
    var session = cfg.signedIn ? { user: { email: "admin@example.test" }, access_token: "fake-access-token" } : null;
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
            if (cred && cred.password === "correct-test-password") { session = { user: { email: cred.email }, access_token: "fake-access-token" }; setTimeout(function () { emit("SIGNED_IN"); }, 0); return { data: { session: session }, error: null }; }
            return { data: { session: null }, error: { message: "Invalid login credentials" } };
          });
        },
        signInWithOtp: function (arg) { state.calls.push({ auth: "signInWithOtp", email: arg && arg.email, redirectTo: (arg && arg.options && arg.options.emailRedirectTo) || null }); return later(function () { return { data: {}, error: null }; }); },
        // No verifyOtp on purpose: the code sign-in step was removed from the page, so any call to it must fail loudly.
        signOut: function () { state.calls.push({ auth: "signOut" }); return later(function () { session = null; setTimeout(function () { emit("SIGNED_OUT"); }, 0); return { error: null }; }, true); },
      },
      rpc: function (name, args) {
        state.calls.push({ rpc: name, args: clone(args) || null });
        return later(function () {
          if (name === "my_role") return { data: session ? (cfg.role === undefined ? "admin" : cfg.role) : null, error: null };
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
