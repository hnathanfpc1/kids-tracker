#!/usr/bin/env node
/* Kids Tracker test harness. Test tooling only: nothing in tests/ ships with the site.

   HOW TO RUN (from the tests folder)
     npm install            one time. Installs playwright-core only. Uses the Chrome already on this Mac.
     npm test               runs every check, prints PASS / FAIL per check, exits non-zero on any failure.
     npm run baseline       same run, but rewrites tests/golden/*.json from what the pages show right now.
                            Only do this after reviewing why a golden changed.
     npm run shots:before   also saves screenshots to tests/output/before/ (refuses to overwrite; add -- --force).
     npm run shots:after    same, into tests/output/after/.
     npm run check:cdn      the ONE check that uses the real internet (tests/real-cdn.mjs). It loads admin.html with
                            the real supabase-js from jsDelivr to prove the integrity hash on the script tag is right.
                            Run it whenever the supabase-js version or its integrity value changes.
   A plain "npm test" saves its screenshots to tests/output/latest/.

   WHAT IT DOES
     - Serves the repo root from a local static server on a free port.
     - Opens the real index.html and admin.html in headless Chrome with the clock frozen.
     - Never talks to the real Supabase. config.js is replaced with tests/fixtures/config.test.js,
       get_schedule is answered from tests/fixtures/db.json, supabase-js is replaced with
       tests/lib/fake-supabase.js, and any other outside request is blocked and reported.
       (Google Fonts are allowed only while taking screenshots, so pictures look like the real site.)
     - The supabase-js script tag in admin.html carries an integrity hash, so Chrome refuses the stand-in file
       when it arrives from the jsDelivr address (it is not the real library). The fake is therefore also
       installed before any page script runs. Each admin page load is checked to be running on the fake, and the
       one refusal Chrome logs is counted, which proves the hash is being enforced. Whether the hash matches the
       REAL file is checked by "npm run check:cdn", not here.

   OPTIONS
     KT_OFFLINE=1           never fetch web fonts, even for screenshots (pictures then use fallback fonts).
     KT_DIFF_MAX=<n>        list up to n differences per golden file instead of 25 (the full list goes to tests/output/results.json).
     KT_SITE_ROOT=<folder>  test a copy of the site instead of the repo root. Only for proving a check catches
                            a deliberate break in a scratch copy. The baseline cannot be rewritten in this mode.

   AFTER AN INTENDED CHANGE (for example fixing a known bug)
     1. npm test. The fixed bug shows as XPASS and the goldens that mention it show as FAIL with the exact lines.
     2. Read those lines. If they are only what you meant to change, delete the bug's entry from KNOWN_BUGS
        and drop the { bug: "..." } option from its check, then npm run baseline.
     3. npm test again. It should be fully green.
     The baseline is only rewritten when every other check passes, so a broken rule cannot be baked in.

   RESULT LABELS
     PASS   check holds.
     FAIL   check does not hold. The run exits 1.
     XFAIL  a known bug listed in KNOWN_BUGS below still reproduces. Expected today. Does not fail the run.
            Entries with given: false are new findings from QA that nobody has ruled on yet.
     XPASS  a known bug no longer reproduces. The run exits 1 until its entry is removed from KNOWN_BUGS,
            so the check is enforced from then on. Then run "npm run baseline" and review the golden diff. */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { chromium } from "playwright-core";
import { ACTS_LIB, actsStaticChecks, activityChecks } from "./acts.mjs";

// ---------------------------------------------------------------------------
// Known bugs. Each one has a check below that is expected to fail until the bug is fixed.
// ---------------------------------------------------------------------------
const KNOWN_BUGS = {
  // Fixed in Phase 0 and removed from this list on 2026-11-19, so their checks are now enforced:
  //   spring break start read "at 6 p.m." in Heather's years (handoffTime, now in core.js), and a stray block in style.css dropped the base .wrap rule.
  // Fixed on 2026-11-20 after the slice 1A QA run and removed from this list, so their checks are now enforced:
  //   the switched badge hanging over a phone day cell (style.css), "p.m.." in the Right now sentence (app.js), an unshared comment row showing on the family page (app.js),
  //   a raw holder value in class names (app.js), and the config.js numbers not being used once contacts rows exist without numbers (editor.js).
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
// KT_SITE_ROOT points the run at a copy of the site. Only for proving the checks catch a deliberate break in a scratch copy.
const ROOT = process.env.KT_SITE_ROOT ? path.resolve(process.env.KT_SITE_ROOT) : path.resolve(HERE, "..");
const GOLDEN = path.join(HERE, "golden");
const ARGS = process.argv.slice(2);
const UPDATE = ARGS.includes("--update");
const FORCE = ARGS.includes("--force");
const SHOTS = (ARGS.find(a => a.startsWith("--shots=")) || "--shots=latest").split("=")[1].replace(/[^a-z0-9_-]/gi, "") || "latest";
const OFFLINE = process.env.KT_OFFLINE === "1";
const OUT = path.join(HERE, "output");
const SHOT_DIR = path.join(OUT, SHOTS);

// Frozen "today" values, noon Eastern.
const T19 = { day: "2026-11-19", instant: "2026-11-19T12:00:00-05:00" };
const T30 = { day: "2027-03-30", instant: "2027-03-30T12:00:00-04:00" };
const MONTHS = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07"];
// Days whose detail sheet is captured: holiday starts and ends, Friday handoffs, switches, no-school Fridays.
const SHEET_DAYS = ["2026-10-13", "2026-10-16", "2026-10-20", "2026-10-21", "2026-10-31", "2026-11-06", "2026-11-19", "2026-11-20",
  "2026-11-25", "2026-11-30", "2026-12-04", "2026-12-18", "2026-12-22", "2026-12-26", "2027-01-05", "2027-01-15", "2027-02-12",
  "2027-04-02", "2027-04-07", "2027-04-11", "2027-05-07", "2027-05-10", "2027-05-19", "2027-05-28", "2027-06-04", "2027-06-18",
  "2027-06-21", "2027-07-12", "2027-07-19"];
// The one outside script the site loads. Version and address are pinned, and admin.html carries its integrity hash.
// SB_SHA384 was computed by QA on 2026-11-19 from the file jsDelivr serves (openssl dgst -sha384 -binary | openssl base64 -A).
// "npm run check:cdn" recomputes it from the live file. When the version is bumped, update both constants.
const SB_PINNED = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js";
const SB_SHA384 = "sha384-BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R";
// The files that make up the site. Each page loads the shared ones with the same ?v= number.
const SITE_FILES = ["index.html", "admin.html", "activities.html", "app.js", "core.js", "acts.js", "editor.js", "activities.js", "style.css", "config.js"];
// What each page loads with a ?v= number, in this order for the scripts (style.css is the stylesheet).
const PAGE_FILES = {
  "index.html": ["style.css", "config.js", "core.js", "acts.js", "app.js"],
  "admin.html": ["style.css", "config.js", "core.js", "acts.js", "editor.js", "app.js"],
  "activities.html": ["style.css", "config.js", "core.js", "acts.js", "editor.js", "activities.js"],
};
const SHARED_RE = "style\\.css|config\\.js|app\\.js|core\\.js|acts\\.js|editor\\.js|activities\\.js";
// The cache-bust number main served before this slice. Any shared file changed since then needs a higher one.
const MAIN_V = 10;
const UA_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// ---------------------------------------------------------------------------
// Dates as whole-day numbers (written here independently of core.js)
// ---------------------------------------------------------------------------
const DAY = 86400000;
const toNum = s => Math.round(Date.parse(s + "T00:00:00Z") / DAY);
const toStr = n => new Date(n * DAY).toISOString().slice(0, 10);
const wd = n => new Date(n * DAY).getUTCDay();
const fmtUTC = (n, o) => new Date(n * DAY).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
const longLabel = iso => fmtUTC(toNum(iso), { weekday: "long", month: "long", day: "numeric" });
const span = (a, b) => { const out = []; for (let n = toNum(a); n <= toNum(b); n++) out.push(toStr(n)); return out; };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NAME = { me: "Heather", co: "Brett", grandma: "Grandma" };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const clone = x => JSON.parse(JSON.stringify(x));
const BASE_DB = (() => { const d = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "db.json"), "utf8")); delete d._about; return d; })();
const TEST_CONFIG = fs.readFileSync(path.join(HERE, "fixtures", "config.test.js"), "utf8");
const FAKE_SB = fs.readFileSync(path.join(HERE, "lib", "fake-supabase.js"), "utf8");
// The payload builder (lib/payload.js) mirrors kt_schedule_core and kt_activities. Node uses it for the family answer,
// the browser fake uses the same file for get_editor_schedule.
const PAYLOAD_JS = fs.readFileSync(path.join(HERE, "lib", "payload.js"), "utf8");
vm.runInThisContext(PAYLOAD_JS);
const P = globalThis.KTTestPayload;
const PNOTE_MARK = "PRIVATE-";

// Builds the family page answer the same way public.get_schedule does in supabase/schema.sql (lib/payload.js):
// settings (names and anchor only), changed_at, breaks, swaps with reason, shared note and updated_at, then the
// activities part for 7 days back to 60 ahead of "at" (the frozen clock). db.json has no activity rows, so those lists are empty.
// "leaky" adds fields the real function must never send, to prove the page would not show them anyway.
function familyResponse(db, { leaky = false, at = T19.instant } = {}) {
  const s = db.settings[0];
  if (!s) return { settings: null, changed_at: null, breaks: [], swaps: [] };
  const det = new Map(db.swap_details.map(d => [d.day, d]));
  const out = P.family(db, Date.parse(at));
  if (leaky) {
    out.swaps.forEach(row => { const d = det.get(row.day) || {}; row.pnote = d.pnote || `${PNOTE_MARK}LEAK for ${row.day}`; });
    out.settings.track_from = s.track_from; out.totals = { me: 96, co: 74, pct: "54.9%" };
  }
  return out;
}
const dbScheduleOnly = () => { const d = clone(BASE_DB); d.swaps = []; d.swap_details = []; return d; };
const dbEmpty = () => ({ settings: [{ ...BASE_DB.settings[0] }], breaks: [], swaps: [], swap_details: [], share_links: [] });
const T_NEW2 = "2026-11-18T21:30:00+00:00", T_NEW3 = "2026-11-19T14:00:00+00:00";
function dbWhatsNew2() {
  const d = clone(BASE_DB);
  d.settings[0].changed_at = T_NEW2;
  ["2026-12-12", "2026-12-13"].forEach(day => {
    d.swaps.push({ day, had: "co", caregiver: null, updated_at: T_NEW2 });
    d.swap_details.push({ day, reason: "travel", note: "Heather at a conference", pnote: null });
  });
  return d;
}
function dbWhatsNew3() {
  const d = dbWhatsNew2();
  d.settings[0].changed_at = T_NEW3;
  d.swaps = d.swaps.filter(w => w.day !== "2026-11-25"); d.swap_details = d.swap_details.filter(w => w.day !== "2026-11-25");
  return d;
}
// A made-up 2027-28 school year with a spring break in an EVEN year (Brett's), so both parents' years are checked.
// School runs Aug 3, 2027 to May 25, 2028. Last school day before the break is Fri Mar 24, 2028. School resumes Mon Apr 3, 2028.
function dbSpring2028() {
  const d = dbScheduleOnly();
  const row = y => { let r = d.breaks.find(b => b.year === y); if (!r) { r = { year: y, data: {} }; d.breaks.push(r); } return r.data; };
  row(2027).firstDay = "2027-08-03";
  Object.assign(row(2028), { lastDay: "2028-05-25", spL: "2028-03-24", spR: "2028-04-03" });
  return d;
}
// A config.js that has not been filled in yet, to reach the admin page's "Almost there" card.
const CONFIG_NOT_SET_UP = 'window.KT_CONFIG = { url: "https://kt-mock.invalid", key: "PASTE_YOUR_PUBLISHABLE_KEY_HERE", contacts: [] };';

// ---------------------------------------------------------------------------
// Independent oracle: who has the kids each night, written from the rules in CLAUDE.md
// ("How the schedule works"), not from core.js. Order: logged switch, then holiday, then rotation.
// Other holidays beat summer weeks.
// ---------------------------------------------------------------------------
function makeOracle(db) {
  const anchor = toNum(db.settings[0].anchor);
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const hol = new Map(), summer = new Map();
  const put = (map, a, b, who, name) => { for (let n = a; n <= b; n++) if (!map.has(n)) map.set(n, { who, name }); };
  const sundays = (y, m) => { const out = []; for (let n = toNum(`${y}-${String(m).padStart(2, "0")}-01`); new Date(n * DAY).getUTCMonth() === m - 1; n++) if (wd(n) === 0) out.push(n); return out; };
  const rows = new Map(db.breaks.map(b => [b.year, b.data]));
  for (let y = 2024; y <= 2030; y++) {
    const b = rows.get(y) || {}, odd = y % 2 === 1;
    if (isDate(b.spL) && isDate(b.spR)) put(hol, toNum(b.spL), toNum(b.spR) - 2, odd ? "me" : "co", "Spring break");
    if (isDate(b.tgL) && isDate(b.tgR)) put(hol, toNum(b.tgL), toNum(b.tgR) - 1, odd ? "co" : "me", "Thanksgiving");
    if (isDate(b.xmL) && isDate(b.xmR)) {
      put(hol, toNum(b.xmL), toNum(`${y}-12-25`), odd ? "me" : "co", "Christmas, first part");
      put(hol, toNum(`${y}-12-26`), toNum(b.xmR) - 1, odd ? "co" : "me", "Christmas, second part");
    }
    const md = sundays(y, 5)[1], fd = sundays(y, 6)[2];
    put(hol, md - 2, md, "me", "Mother's Day weekend");
    put(hol, fd - 2, fd, "co", "Father's Day weekend");
    (b.summer || []).forEach(s => put(summer, toNum(s.start), toNum(s.start) + 6, s.who, "Summer week"));
  }
  const swaps = new Map(db.swaps.map(w => [toNum(w.day), w]));
  const rotation = n => (((Math.floor((n - anchor) / 7) % 2) + 2) % 2 === 0 ? "me" : "co");
  const holiday = n => hol.get(n) || summer.get(n) || null;
  const scheduled = n => (holiday(n) ? holiday(n).who : rotation(n));
  return {
    rotation: iso => rotation(toNum(iso)),
    holiday: iso => holiday(toNum(iso)),
    scheduled: iso => scheduled(toNum(iso)),
    swap: iso => swaps.get(toNum(iso)) || null,
    holder: iso => { const w = swaps.get(toNum(iso)); return w ? w.had : scheduled(toNum(iso)); },
  };
}

// ---------------------------------------------------------------------------
// Static file server for the repo root
// ---------------------------------------------------------------------------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    const file = path.join(ROOT, rel), ext = path.extname(file);
    // Only the site's own top-level files are served, like GitHub Pages would for these pages.
    if (path.dirname(file) !== ROOT || !MIME[ext] || !fs.existsSync(file)) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[ext], "cache-control": "no-store" });
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

// ---------------------------------------------------------------------------
// Check registry
// ---------------------------------------------------------------------------
const results = [];
function check(group, name, ok, detail = "", opts = {}) {
  const bug = opts.bug || null;
  if (bug && !KNOWN_BUGS[bug]) throw new Error("unknown bug id " + bug);
  const status = bug ? (ok ? "XPASS" : "XFAIL") : ok ? "PASS" : "FAIL";
  const lines = Array.isArray(detail) ? detail : String(detail || "").split("\n").filter(Boolean);
  results.push({ group, name, status, detail: lines, bug });
  const tag = { PASS: "PASS ", FAIL: "FAIL ", XFAIL: "XFAIL", XPASS: "XPASS" }[status];
  console.log(`${tag}  [${group}] ${name}${status === "XFAIL" ? (KNOWN_BUGS[bug].given ? "  (known bug, expected to fail today)" : "  (NEW finding from QA, logged as a known bug so the run stays readable)") : ""}`);
  if (status !== "PASS" || opts.always) lines.slice(0, 30).forEach(l => console.log(`         ${l}`));
  if (status === "XPASS") console.log(`         This known bug no longer reproduces. Remove "${bug}" from KNOWN_BUGS in tests/run.mjs, then run "npm run baseline".`);
  return ok;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function expectAll(group, name, pairs, opts) {   // pairs: [label, actual, expected]
  const bad = pairs.filter(([, a, e]) => !eq(a, e));
  return check(group, name, !bad.length, bad.length ? bad.map(([l, a, e]) => `${l}: expected ${JSON.stringify(e)}, page shows ${JSON.stringify(a)}`) : pairs.map(([l, a]) => `${l}: ${JSON.stringify(a)}`), opts);
}

// ---------------------------------------------------------------------------
// Helpers that run inside the page (read-only: they only look at the DOM)
// ---------------------------------------------------------------------------
function pageLib() {
  const norm = s => (s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
  const $ = id => document.getElementById(id);
  const vis = el => (el ? norm(el.innerText) : null);
  const cls = el => [...el.classList].sort().join(" ");
  const chips = el => [...el.querySelectorAll(".chip")].map(c => `${cls(c)} | ${norm(c.textContent)}`);
  const rows = sel => [...document.querySelectorAll(sel)].map(li => { const o = { text: vis(li) }, c = chips(li); if (c.length) o.chips = c; return o; });
  const shown = el => !!(el && el.getClientRects().length);
  const val = id => ($(id) ? $(id).value : null);
  window.__ktq = {
    cal(mode) {
      const g = $(mode === "admin" ? "aGrid" : "fGrid");
      return {
        heading: norm($(mode === "admin" ? "aMonth" : "fMonth").textContent),
        dow: [...g.querySelectorAll(".dow")].map(e => norm(e.textContent)).join(" "),
        cells: [...g.querySelectorAll(".day")].map(el => { const o = { cls: cls(el), aria: el.getAttribute("aria-label"), text: vis(el) }; if (el.querySelector(".nw")) o.newDot = true; return o; }),
      };
    },
    legend: mode => vis($(mode === "admin" ? "aLegend" : "fLegend")),
    famMsg: () => ({ msgShown: shown($("famMsg")), msg: norm($("famMsgText").textContent), contentShown: shown($("famContent")) }),
    famNow: () => ({ cls: cls($("famNow")), lines: [...$("famNow").children].map(vis) }),
    famNotes: () => rows("#fNotes > li"),
    famUp: () => rows("#fUp > li"),
    famNew: () => ({ shown: shown($("newBox")), items: shown($("newBox")) ? rows("#newList > li") : [], dots: document.querySelectorAll(".day .nw").length, newChips: document.querySelectorAll(".chip.new").length, seen: localStorage.getItem("kt-seen") }),
    famDay: () => ({ shown: shown($("famDayScrim")), title: vis($("fdTitle")), lines: [...$("fdBody").children].map(vis), chips: chips($("fdBody")) }),
    updated: () => vis($("updated")),
    totals: () => ({
      period: [...document.querySelectorAll('[data-period][aria-pressed="true"]')].map(b => norm(b.textContent)).join(","),
      me: { label: norm($("meLbl").textContent), nights: norm($("meN").textContent), pct: norm($("mePct").textContent) },
      co: { label: norm($("coLbl").textContent), nights: norm($("coN").textContent), pct: norm($("coPct").textContent) },
      bar: ["meBar", "gmBar", "otBar", "coBar"].map(id => `${id} ${$(id).style.width}`).join(", "),
      facts: [...document.querySelectorAll("#facts > li")].map(vis),
    }),
    log: () => ({ count: vis($("logCount")), rows: rows("#log > li") }),
    hol: () => ({ year: vis($("holYear")), rows: rows("#holList > li"), hint: vis($("sumHint")) }),
    share: () => ({ status: vis($("shareStatus")), url: vis($("famUrl")), copyDisabled: $("copyLink").disabled, offShown: shown($("offLink")), previewShown: shown($("previewFam")),
      previewHref: $("previewFam").getAttribute("href"), newLabel: vis($("newLink")), confirmShown: shown($("newLinkConfirm")) }),
    views: () => ({ shown: ["vLoading", "vSetup", "vSignin", "vNotAdmin", "vApp"].filter(id => shown($(id))), topBtns: shown($("topBtns")), toast: shown($("toast")) ? vis($("toast")) : null,
      sheets: [...document.querySelectorAll(".scrim")].filter(shown).map(e => e.id), signinMsg: $("signinMsg") ? vis($("signinMsg")) : null }),
    adminDay: () => ({
      shown: shown($("dayScrim")), title: vis($("dayTitle")), sched: vis($("daySched")),
      picks: [...document.querySelectorAll(".pick button")].map(b => `${norm(b.textContent)}${b.getAttribute("aria-pressed") === "true" ? " [picked]" : ""}`),
      careShown: shown($("careField")), sameNoteShown: shown($("sameNote")), detailFieldsShown: ["reasonField", "thruField", "noteField", "pnoteField"].filter(id => shown($(id))),
      reasons: [...document.querySelectorAll("#reasons label")].map(l => `${vis(l)}${l.querySelector("input").checked ? " [checked]" : ""}`),
      thru: val("thru"), thruMin: $("thru").min, note: val("note"), pnote: val("pnote"), caregiver: val("caregiver"),
      removeShown: shown($("removeBtn")), saveDisabled: $("saveDay").disabled,
    }),
    textSheet: () => ({ shown: shown($("txtScrim")), body: val("txtBody"), to: [...document.querySelectorAll("#txtTo label")].map(l => `${vis(l)}${l.querySelector("input").checked ? " [checked]" : ""}`), href: $("txtGo").getAttribute("href") }),
    settingsSheet: () => ({ shown: shown($("setScrim")), my: val("sMy"), co: val("sCo"), anchor: val("sAnchor"), from: val("sFrom") }),
    datesSheet: () => ({
      shown: shown($("brkScrim")), title: vis($("brkTitle")),
      fields: Object.fromEntries(["first", "last", "spL", "spR", "tgL", "tgR", "xmL", "xmR"].map(k => [k, val("b_" + k)])),
      school: [...document.querySelectorAll("#schoolRows .row-in")].map(r => [...r.querySelectorAll("input, select")].map(i => i.value).join(" | ")),
      summer: [...document.querySelectorAll("#sumRows .row-in")].map(r => [...r.querySelectorAll("input, select")].map(i => i.value + (i.tagName === "SELECT" ? ` (${i.selectedOptions[0].textContent})` : "")).join(" | ")),
      schoolEmptyNote: vis(document.querySelector("#schoolRows > p")), summerEmptyNote: vis(document.querySelector("#sumRows > p")), addSummerShown: shown($("addSum")),
    }),
    // Things the family page must never show.
    privacy(marks) {
      const html = document.documentElement.outerHTML, text = document.body.innerText, hits = [];
      marks.forEach(m => { if (html.includes(m)) hits.push(`page HTML contains "${m}"`); });
      [[/track_?from/i, "track_from"], [/pnote/i, "pnote"]].forEach(([re, l]) => { if (re.test(html)) hits.push(`page HTML mentions ${l}`); });
      [[/%/, "a percent sign"], [/\b\d+\s+nights?\b/i, "a night count"], [/\bcovered\b/i, "\"covered\""], [/overnights/i, "\"Overnights\""], [/\bNet\s*[+-]?\d/, "a net figure"]]
        .forEach(([re, l]) => { const m = text.match(re); if (m) hits.push(`visible text contains ${l}: "${text.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, " ")}"`); });
      return hits;
    },
    layout(width) {
      const de = document.documentElement, vw = width || de.clientWidth;
      const tag = el => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.classList.length ? "." + [...el.classList].join(".") : "");
      const wide = [];
      document.querySelectorAll("body *").forEach(el => { const r = el.getBoundingClientRect(); if (r.width && r.height && (r.right > vw + 1 || r.left < -1) && wide.length < 8) wide.push(`${tag(el)} spans ${Math.round(r.left)} to ${Math.round(r.right)}`); });
      const small = new Map();
      document.querySelectorAll("button, a[href], input, select, textarea, label").forEach(el => {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height || el.closest(".day")) return;
        if (r.height < 44 || r.width < 44) { const k = tag(el).replace(/#[\w-]+/, ""); if (!small.has(k)) small.set(k, `${k} ${Math.round(r.width)}x${Math.round(r.height)}`); }
      });
      const day = document.querySelector(".day:not(.out)"), dr = day ? day.getBoundingClientRect() : null;
      // Badges (switched, half day, new dot, star) that stick out past the edge of their day cell.
      const badges = [];
      document.querySelectorAll(".day").forEach(d => { const c = d.getBoundingClientRect(); d.querySelectorAll(".sw, .half, .nw, .star").forEach(b => { const r = b.getBoundingClientRect(); const over = Math.round((r.right - c.right) * 10) / 10; if (r.width && over > 0.5) badges.push(`${d.getAttribute("aria-label")}: ${b.className} badge is ${Math.round(r.width)}px wide and ${over}px of it is past the cell edge`); }); });
      const wrap = document.querySelector(".wrap"), cs = wrap ? getComputedStyle(wrap) : null, wr = wrap ? wrap.getBoundingClientRect() : null;
      return { viewport: vw, innerWidth: window.innerWidth, docScrollWidth: de.scrollWidth, bodyScrollWidth: document.body.scrollWidth, wide,
        badges, sheetOverflow: [...document.querySelectorAll(".sheet")].filter(shown).map(s => `${s.scrollWidth}/${s.clientWidth}`).join(","),
        dayCell: dr ? `${Math.round(dr.width)}x${Math.round(dr.height)}` : null, smallTargets: [...small.values()],
        wrap: cs ? { maxWidth: cs.maxWidth, marginLeft: cs.marginLeft, display: cs.display, rowGap: cs.rowGap, width: Math.round(wr.width),
          marginRight: cs.marginRight, flexDirection: cs.flexDirection, left: Math.round(wr.left * 10) / 10, right: Math.round(wr.right * 10) / 10 } : null,
        fonts: { figtree: [...document.fonts].some(f => /Figtree/.test(f.family) && f.status === "loaded"), bricolage: [...document.fonts].some(f => /Bricolage/.test(f.family) && f.status === "loaded") } };
    },
    // One of the admin page's small cards (sign-in, loading, setup, not-admin): where it sits and how wide it is.
    card(id) {
      const el = $(id), r = el.getBoundingClientRect(), de = document.documentElement, r1 = x => Math.round(x * 10) / 10;
      return { shown: ["vLoading", "vSetup", "vSignin", "vNotAdmin", "vApp"].filter(v => shown($(v))), width: r1(r.width), left: r1(r.left), right: r1(r.right), top: r1(r.top), height: r1(r.height),
        viewport: de.clientWidth, docScrollWidth: de.scrollWidth, headerBottom: r1(document.querySelector("header.top").getBoundingClientRect().bottom), text: vis(el) };
    },
    signin: () => ({ removed: ["codeStep", "code", "verifyCode"].filter(id => $(id)), controls: [...document.querySelectorAll("#vSignin input, #vSignin button")].map(e => `${e.tagName.toLowerCase()}#${e.id}`),
      labels: [...document.querySelectorAll("#vSignin label, #vSignin button")].map(e => norm(e.textContent)), msg: vis($("signinMsg")), focus: document.activeElement ? document.activeElement.id : "",
      disabled: ["pwSignIn", "sendCode"].filter(id => $(id).disabled), shown: ["vLoading", "vSetup", "vSignin", "vNotAdmin", "vApp"].filter(v => shown($(v))) }),
  };
}
const PAGE_LIB = `(${pageLib.toString()})();`;
const q = (page, fn, ...args) => page.evaluate(([f, a]) => window.__ktq[f](...a), [fn, args]);

// ---------------------------------------------------------------------------
// Browser sessions
// ---------------------------------------------------------------------------
let browser, ORIGIN;
const sessions = [];
const SRI = Object.fromEntries(["admin", "activities"].map(k => [k, /<script[^>]+supabase[^>]+integrity=/i.test(fs.readFileSync(path.join(ROOT, k + ".html"), "utf8"))]));
// The one console error an admin page load is allowed: Chrome refusing the stand-in file because it does not match the integrity hash.
const sriRefusal = e => e.includes(`Failed to find a valid digest in the 'integrity' attribute for resource '${SB_PINNED}'`);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };

/* kind: "family" | "admin". Options: at (T19/T30 or an instant string), mobile, dark, fonts, hash,
   respond(body) for get_schedule, fake { db, signedIn, role, failAll, hang } for the admin fake,
   config (text served as config.js instead of the test config), wait (admin only: the id of the card to wait for
   when the page is meant to stay on it, for example "vLoading"),
   expectErrors (console errors are expected in this scenario, for example a failed request). */
const PAGE_OF = { family: "index.html", admin: "admin.html", activities: "activities.html" };
async function open(kind, label, o = {}) {
  const instant = (o.at && o.at.instant) || o.at || T19.instant;
  const ctx = await browser.newContext({
    viewport: o.mobile ? { width: o.width || 375, height: 812 } : { width: 1280, height: 900 },
    deviceScaleFactor: o.mobile ? 2 : 1, isMobile: !!o.mobile, hasTouch: !!o.mobile,
    colorScheme: o.dark ? "dark" : "light", timezoneId: "America/New_York", locale: "en-US",
    userAgent: o.ua || (o.mobile ? UA_IPHONE : UA_MAC), serviceWorkers: "block",
  });
  await ctx.clock.setFixedTime(new Date(instant));
  const s = { kind, label, ctx, errors: [], unexpected: [], cdn: [], famCalls: [], allCalls: [], expectErrors: !!o.expectErrors,
    respond: o.respond || (body => ({ json: body && body.p_token === "TESTTOKEN" ? familyResponse(BASE_DB, { at: instant }) : null })) };
  await ctx.addInitScript({ content: PAGE_LIB + ACTS_LIB });
  // Extra setup that runs before the page scripts on the FIRST load only (a later reload keeps what the page saved).
  if (o.init) await ctx.addInitScript({ content: `if (!sessionStorage.getItem("kt-test-init")) { sessionStorage.setItem("kt-test-init", "1"); ${o.init} }` });
  if (o.everyLoad) await ctx.addInitScript({ content: o.everyLoad });
  if (kind !== "family") {
    const cfg = { db: BASE_DB, signedIn: true, role: "admin", failAll: false, ...(o.fake || {}) };
    // With an integrity attribute on the script tag the browser would refuse the stand-in file,
    // so in that case the fake is also installed before the page scripts run.
    await ctx.addInitScript({ content: `window.__KT_FAKE_CFG__ = ${JSON.stringify(cfg)};${PAYLOAD_JS}${SRI[kind] ? FAKE_SB : ""}` });
  }
  await ctx.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === ORIGIN) {
      if (url.pathname === "/config.js") return route.fulfill({ status: 200, contentType: "application/javascript", body: o.config || TEST_CONFIG });
      return route.continue();
    }
    if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
      if (o.fonts && !OFFLINE) return route.continue();
      return route.fulfill({ status: 200, contentType: "text/css", body: "/* web fonts are stubbed by the test harness */" });
    }
    if (url.hostname === "cdn.jsdelivr.net" && /supabase/.test(url.pathname)) {
      s.cdn.push(req.url());
      return route.fulfill({ status: 200, contentType: "application/javascript", headers: CORS, body: FAKE_SB });
    }
    if (url.pathname.endsWith("/rest/v1/rpc/get_schedule")) {
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      let body = null; try { body = JSON.parse(req.postData() || "null"); } catch (e) {}
      s.famCalls.push({ host: url.host, method: req.method(), body, apikey: (await req.allHeaders()).apikey || null });
      const r = s.respond(body);
      if (r === "abort") return route.abort("failed");
      return route.fulfill({ status: r.status || 200, contentType: "application/json", headers: CORS, body: JSON.stringify(r.json === undefined ? null : r.json) });
    }
    s.unexpected.push(`${req.method()} ${req.url()}`);
    return route.abort("blockedbyclient");
  });
  const page = await ctx.newPage();
  s.page = page; s.loads = 0;
  page.on("load", () => { s.loads++; });   // reloads are counted: each load asks for supabase-js once
  page.on("console", m => { if (m.type() === "error") s.errors.push(`${m.text()} (${m.location().url || "no url"})`); });
  page.on("pageerror", e => s.errors.push(`Uncaught: ${e.message}`));
  sessions.push(s);
  await page.goto(`${ORIGIN}/${PAGE_OF[kind]}${o.hash === undefined ? (kind === "family" ? "#k=TESTTOKEN" : "") : o.hash}`);
  if (o.wait) await page.waitForFunction(id => window.__KT_FAKE__ && !document.getElementById(id).hidden && window.__KT_FAKE__.calls.length > 0, o.wait, { timeout: 10000 });
  else await ready(s);
  // Proof that an admin page is running on the test fake: not the real library, and not a blocked library either.
  if (kind !== "family") s.fake = await page.evaluate(() => ({ isFake: !!(window.supabase && window.supabase.__ktFake), hasState: !!window.__KT_FAKE__, client: (window.__KT_FAKE__ && window.__KT_FAKE__.created) || null }));
  return s;
}
async function ready(s) {
  const page = s.page;
  if (s.kind === "family") {
    await page.waitForFunction(() => !document.getElementById("famContent").hidden || !/^Loading/.test(document.getElementById("famMsgText").textContent), null, { timeout: 10000 });
  } else {
    const settled = () => page.waitForFunction(() => window.__KT_FAKE__ && window.__KT_FAKE__.pending === 0 && ["vSetup", "vSignin", "vNotAdmin", "vApp"].some(id => !document.getElementById(id).hidden), null, { timeout: 10000 });
    await settled(); await page.waitForTimeout(60); await settled();
  }
}
const settle = async s => { await s.page.waitForFunction(() => window.__KT_FAKE__.pending === 0); await s.page.waitForTimeout(30); await s.page.waitForFunction(() => window.__KT_FAKE__.pending === 0); };
// Every call taken is also kept on s.allCalls, so a whole session can be checked for requests it must never make.
const takeCalls = async s => { const c = await s.page.evaluate(() => { const c = window.__KT_FAKE__.calls.slice(); window.__KT_FAKE__.calls.length = 0; return c; }); s.allCalls.push(...c); return c; };
const close = async s => { await s.ctx.close(); };

async function gotoMonth(s, ym) {
  const mode = s.kind, [y, m] = ym.split("-").map(Number);
  const head = await s.page.locator(mode === "admin" ? "#aMonth" : "#fMonth").textContent();
  const [mn, yy] = head.trim().split(" "), diff = (y - Number(yy)) * 12 + (m - 1 - MONTH_NAMES.indexOf(mn));
  const btn = s.page.locator(`[data-nav="${mode}:${diff < 0 ? -1 : 1}"]`);
  for (let i = 0; i < Math.abs(diff); i++) await btn.click();
  const now = (await s.page.locator(mode === "admin" ? "#aMonth" : "#fMonth").textContent()).trim();
  if (now !== `${MONTH_NAMES[m - 1]} ${y}`) throw new Error(`month navigation landed on "${now}", wanted ${ym}`);
}
const gridStart = ym => { const first = toNum(ym + "-01"); return first - wd(first); };
async function captureMonth(s, ym) {
  await gotoMonth(s, ym);
  const c = await q(s.page, "cal", s.kind), g0 = gridStart(ym);
  c.cells.forEach((cell, i) => { cell.date = toStr(g0 + i); });
  return c;
}
async function clickDay(s, iso) {
  const ym = iso.slice(0, 7);
  await gotoMonth(s, ym);
  const cell = s.page.locator(`#${s.kind === "admin" ? "aGrid" : "fGrid"} .day`).nth(toNum(iso) - gridStart(ym));
  const aria = await cell.getAttribute("aria-label");
  if (!aria.startsWith(longLabel(iso))) throw new Error(`cell for ${iso} is labeled "${aria}"`);
  await cell.click();
}
async function famDaySheet(s, iso) {
  await clickDay(s, iso);
  const d = await q(s.page, "famDay");
  if (!d.shown || d.title !== longLabel(iso)) throw new Error(`family day sheet for ${iso} shows "${d.title}"`);
  await s.page.locator("#famDayScrim [data-close]").click();
  delete d.shown; return d;
}
async function adminDaySheet(s, iso, { keepOpen = false } = {}) {
  await clickDay(s, iso);
  const d = await q(s.page, "adminDay");
  if (!d.shown) throw new Error(`admin day sheet did not open for ${iso}`);
  if (!keepOpen) await s.page.locator("#dayScrim [data-close]").click();
  delete d.shown; return d;
}
// Change log rows read like "Oct 13" over "2026 Tue".
const logRow = (s, iso) => s.page.locator("#log > li").filter({ hasText: new RegExp(`${fmtUTC(toNum(iso), { month: "short", day: "numeric" })}\\s*${iso.slice(0, 4)} ${fmtUTC(toNum(iso), { weekday: "short" })}`) });

// A flat date -> cell lookup over captured months, using the cell that belongs to its own month.
function byDate(months) {
  const map = new Map();
  Object.entries(months).forEach(([ym, m]) => m.cells.forEach(c => { if (c.date.startsWith(ym)) map.set(c.date, c); }));
  return map;
}
const holderOf = cell => ["me", "co", "grandma", "other"].filter(k => cell.cls.split(" ").includes(k)).join("+");

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------
async function captureFamily(s, { months = MONTHS, sheets = SHEET_DAYS, privacyMarks = [PNOTE_MARK] } = {}) {
  const out = { updatedLine: await q(s.page, "updated"), whatsNew: await q(s.page, "famNew"), rightNow: await q(s.page, "famNow"),
    comingUp: await q(s.page, "famUp"), legend: await q(s.page, "legend", "family"), months: {}, daySheets: {} };
  const privacy = [];
  const scan = async where => (await q(s.page, "privacy", privacyMarks)).forEach(h => privacy.push(`${where}: ${h}`));
  await scan("first view");
  for (const ym of months) { out.months[ym] = { ...(await captureMonth(s, ym)), thisMonthList: await q(s.page, "famNotes") }; await scan(ym); }
  for (const iso of sheets) {
    await clickDay(s, iso);
    const d = await q(s.page, "famDay");
    if (!d.shown || d.title !== longLabel(iso)) throw new Error(`family day sheet for ${iso} shows "${d.title}"`);
    await scan(`day sheet ${iso}`);
    await s.page.locator("#famDayScrim [data-close]").click();
    delete d.shown; out.daySheets[iso] = d;
  }
  await s.page.locator('[data-nav="family:0"]').click();
  out.todayButtonReturnsTo = (await s.page.locator("#fMonth").textContent()).trim();
  return { out, privacy };
}
async function captureAdmin(s, { months = MONTHS, sheets = SHEET_DAYS } = {}) {
  const p = s.page;
  const out = { views: await q(p, "views"), familyLink: await q(p, "share"), legend: await q(p, "legend", "admin"), totals: {}, months: {}, daySheets: {}, holidays: {}, textSheets: {} };
  out.totals.thisYear_default = await q(p, "totals");
  await p.locator('[data-period="all"]').click(); out.totals.sinceStart = await q(p, "totals");
  await p.locator('[data-period="month"]').click();
  for (const ym of months) out.months[ym] = { ...(await captureMonth(s, ym)), totalsMonthShown: await q(p, "totals") };
  await p.locator('[data-period="ytd"]').click(); out.totals.thisYear_afterNav = await q(p, "totals");
  out.changeLog = await q(p, "log");
  for (const iso of sheets) out.daySheets[iso] = await adminDaySheet(s, iso);
  const startYear = Number(await p.locator("#holYear").textContent());
  for (const y of [2026, 2027, 2028]) {
    const cur = Number(await p.locator("#holYear").textContent());
    for (let i = 0; i < Math.abs(y - cur); i++) await p.locator(y > cur ? "#holNext" : "#holPrev").click();
    out.holidays[y] = await q(p, "hol");
  }
  out.holidaysDefaultYear = startYear;
  for (const w of BASE_DB.swaps.map(x => x.day).filter((d, i, a) => [0, 2, 3, 5, 7, 9, a.length - 1].includes(i))) {
    await logRow(s, w).getByRole("button", { name: "Text" }).click();
    const t = await q(p, "textSheet"); delete t.shown; out.textSheets[w] = t;
    await p.locator("#txtScrim [data-close]").click();
  }
  await p.locator('[data-nav="admin:0"]').click();
  out.todayButtonReturnsTo = (await p.locator("#aMonth").textContent()).trim();
  return out;
}

// ---------------------------------------------------------------------------
// Goldens
// ---------------------------------------------------------------------------
const goldens = {};
// The port changes every run, so the local address is swapped for a fixed stand-in (plain and URL-encoded forms).
const setGolden = (name, data) => { goldens[name] = JSON.parse(JSON.stringify(data).split(ORIGIN).join("http://TEST-ORIGIN").split(encodeURIComponent(ORIGIN)).join(encodeURIComponent("http://TEST-ORIGIN"))); };
// KT_DIFF_MAX=<n> lifts the cap of 25 listed differences per golden file, for reading every changed line before accepting a new baseline.
// The full list is also saved to tests/output/results.json.
const DIFF_MAX = Number(process.env.KT_DIFF_MAX) || 25;
function diff(a, b, p = "", out = []) {
  if (out.length >= DIFF_MAX) return out;
  const isObj = x => x !== null && typeof x === "object";
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) { if (!eq(a, b)) out.push(`${p || "(root)"}: golden ${JSON.stringify(a)} | now ${JSON.stringify(b)}`); return out; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], p ? `${p}.${k}` : k, out);
  return out;
}
function finishGoldens() {
  fs.mkdirSync(GOLDEN, { recursive: true });
  if (UPDATE) {
    const blockers = results.filter(r => r.status === "FAIL" || r.status === "XPASS");
    if (process.env.KT_SITE_ROOT || blockers.length) {
      check("golden", "baseline rewritten", false, process.env.KT_SITE_ROOT ? "KT_SITE_ROOT is set. The baseline only ever comes from the real repo." :
        [`Not rewritten: ${blockers.length} check(s) above did not pass. Fix those first (or remove a fixed bug from KNOWN_BUGS), then run the baseline again.`]);
      return;
    }
  }
  for (const [name, data] of Object.entries(goldens)) {
    const file = path.join(GOLDEN, name + ".json"), text = JSON.stringify(data, null, 1) + "\n";
    if (UPDATE) { fs.writeFileSync(file, text); check("golden", `${name}.json written (baseline updated)`, true); continue; }
    if (!fs.existsSync(file)) { check("golden", `${name}.json matches the baseline`, false, 'No golden file yet. Run "npm run baseline" to create it.'); continue; }
    const d = diff(JSON.parse(fs.readFileSync(file, "utf8")), data);
    check("golden", `${name}.json matches the baseline`, !d.length, d.length ? [`${d.length >= DIFF_MAX ? DIFF_MAX + " or more" : d.length} difference(s). First ones:`, ...d] : "");
  }
  if (!UPDATE) {
    const extra = fs.readdirSync(GOLDEN).filter(f => f.endsWith(".json") && !(f.replace(/\.json$/, "") in goldens));
    check("golden", "no leftover golden files", !extra.length, extra.join(", "));
  }
}

// ---------------------------------------------------------------------------
// Checks: static files
// ---------------------------------------------------------------------------
function staticChecks() {
  const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
  const htmlFiles = fs.readdirSync(ROOT).filter(f => f.endsWith(".html"));
  const pages = Object.keys(PAGE_FILES);
  const vs = htmlFiles.flatMap(f => [...read(f).matchAll(new RegExp(`(?:${SHARED_RE})\\?v=(\\w+)`, "g"))].map(m => `${f}: ${m[0]}`));
  const nums = new Set(vs.map(v => v.split("?v=")[1]));
  // Each page must load each of its shared files exactly once with a ?v= number, all pages with the same number,
  // and must not load another page's script (app.js stays off the Activities page, activities.js off the other two).
  const perPage = pages.flatMap(f => {
    const txt = htmlFiles.includes(f) ? read(f) : "";
    const count = n => [...txt.matchAll(new RegExp(`(?:href|src)="${n.replace(".", "\\.")}\\?v=\\w+"`, "g"))].length;
    const all = ["style.css", "config.js", "core.js", "acts.js", "editor.js", "app.js", "activities.js"];
    return [...PAGE_FILES[f].map(n => (count(n) === 1 ? null : `${f}: ${n} is loaded ${count(n)} time(s) with a ?v= number, expected exactly 1`)),
      ...all.filter(n => !PAGE_FILES[f].includes(n) && new RegExp(`(?:href|src)="${n.replace(".", "\\.")}`).test(txt)).map(n => `${f}: loads ${n}, which belongs to another page`)];
  }).filter(Boolean);
  const v = [...nums][0];
  check("static", `cache-bust number is the same on every shared file in all three HTML files, and higher than main's v=${MAIN_V}`, !perPage.length && nums.size === 1 && Number(v) > MAIN_V, [`value(s): ${[...nums].join(", ")}`, ...perPage, ...vs]);
  // Script order matters: each script reads what the ones before it set (KT_CONFIG, KTCore, KTActs, KTEditor).
  const scripts = pages.map(f => { const tags = [...read(f).matchAll(/<script\b[^>]*>/g)].map(m => m[0]); return { f, tags, local: tags.map(t => (t.match(/\ssrc="([^"]+)"/) || [])[1] || "(inline)").filter(x => !/^https?:/.test(x)).map(x => x.replace(/\?.*$/, "")) }; });
  const late = scripts.flatMap(x => x.tags.filter(t => /\s(async|defer)\b|type="module"/.test(t)).map(t => `${x.f}: ${t} would not run in page order`));
  check("static", "script order on every page: config.js, core.js, acts.js, then editor.js on the two signed-in pages, then the page script (app.js or activities.js), as plain scripts that run in order",
    scripts.every(x => eq(x.local, PAGE_FILES[x.f].filter(n => n.endsWith(".js")))) && !late.length, [...scripts.map(x => `${x.f}: ${x.local.join(", then ")}`), ...late]);
  // core.js is the shared schedule logic only.
  const coreSrc = read("core.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const pageCode = [[/\bdocument\b/, "document"], [/\blocalStorage\b|\bsessionStorage\b/, "browser storage"], [/\bfetch\s*\(|XMLHttpRequest/, "a network call"], [/supabase/i, "supabase"], [/\blocation\b/, "location"],
    [/window\.(?!KTCore\b)/, "window.<something other than KTCore>"]].filter(([re]) => re.test(coreSrc)).map(([, l]) => `core.js uses ${l}`);
  check("static", "core.js is schedule logic only: it sets window.KTCore and uses no page, storage, network or Supabase code", /window\.KTCore\s*=/.test(coreSrc) && !pageCode.length, pageCode);
  // acts.js draws activities and saves nothing; editor.js only signs in and opens Messages.
  const strip = f => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const actsSrc = strip("acts.js"), edSrc = strip("editor.js");
  const actsBad = [[/\bfetch\s*\(|XMLHttpRequest/, "a network call"], [/supabase|\bsb\.(?:from|rpc)\(/i, "the database"], [/sessionStorage/, "sessionStorage"], [/\.innerHTML\s*=/, "writes to the page itself (it should only return HTML)"]].filter(([re]) => re.test(actsSrc)).map(([, l]) => `acts.js uses ${l}`);
  const edBad = [[/\bfetch\s*\(|XMLHttpRequest/, "a network call"], [/\bsb\.(?:from|rpc)\(/, "a table or function call"]].filter(([re]) => re.test(edSrc)).map(([, l]) => `editor.js uses ${l}`);
  check("static", "acts.js sets window.KTActs and only reads and draws (no network, no database calls); editor.js sets window.KTEditor and makes no table or function calls",
    /window\.KTActs\s*=/.test(actsSrc) && /window\.KTEditor\s*=/.test(edSrc) && !actsBad.length && !edBad.length, [...actsBad, ...edBad]);
  // The unused code sign-in step was removed in Phase 0. It must not come back half-wired.
  const leftovers = ["admin.html", "index.html", "activities.html", "app.js", "core.js", "editor.js", "activities.js"].flatMap(f => [[/codeStep/, "codeStep"], [/verifyCode/, "verifyCode"], [/verifyOtp/, "verifyOtp"], [/id="code"/, 'id="code"'], [/\$\("code"\)/, '$("code")'], [/for="code"/, 'for="code"']]
    .filter(([re]) => re.test(read(f))).map(([, l]) => `${f} still mentions ${l}`));
  check("static", "the unused code sign-in step is gone from the site files (codeStep, code, verifyCode, verifyOtp)", !leftovers.length, leftovers);
  // The one outside script: exact pinned address, integrity hash, crossorigin, on each signed-in page. No other outside scripts.
  const attr = (t, n) => (t.match(new RegExp(`\\s${n}="([^"]*)"`)) || [])[1];
  const outside = scripts.flatMap(x => x.tags.filter(t => /^https?:/.test(attr(t, "src") || "")).map(t => ({ f: x.f, t })));
  const tagProblems = ["admin.html", "activities.html"].flatMap(f => {
    const sb = outside.filter(x => x.f === f && /supabase/i.test(x.t)), t0 = sb[0] ? sb[0].t : "";
    return [sb.length !== 1 && `${f} has ${sb.length} supabase-js script tags, expected 1`,
      attr(t0, "src") !== SB_PINNED && `${f}: src is "${attr(t0, "src")}", expected the pinned address ${SB_PINNED}`,
      !/^sha384-[A-Za-z0-9+/]{64}$/.test(attr(t0, "integrity") || "") && `${f}: integrity is "${attr(t0, "integrity")}", expected sha384- followed by 64 characters`,
      attr(t0, "integrity") !== SB_SHA384 && `${f}: integrity is not the hash QA computed from the real 2.117.3 file (${SB_SHA384}). If the version changed on purpose, run "npm run check:cdn" and update SB_PINNED and SB_SHA384`,
      attr(t0, "crossorigin") !== "anonymous" && `${f}: crossorigin is "${attr(t0, "crossorigin")}", expected "anonymous" (without it the browser cannot check the hash)`].filter(Boolean);
  });
  const others = outside.filter(x => !/supabase/i.test(x.t) || x.f === "index.html");
  if (others.length) tagProblems.push(`other outside scripts: ${others.map(x => `${x.f}: ${x.t}`).join(" ")}`);
  if (/supabase/i.test(read("index.html"))) tagProblems.push("index.html mentions supabase: the family page must not load supabase-js");
  check("static", "admin.html and activities.html each load supabase-js once from the exact pinned 2.117.3 address with its integrity hash and crossorigin=\"anonymous\"; the family page does not load it", !tagProblems.length, tagProblems.length ? tagProblems : "both tags match");
  configYmlChecks(read);
  const missing = htmlFiles.flatMap(f => [...read(f).matchAll(new RegExp(`(?:href|src)="((?:${SHARED_RE})[^"]*)"`, "g"))].filter(m => !/\?v=\w+/.test(m[1])).map(m => `${f}: ${m[1]}`));
  check("static", "every shared CSS and JS file is loaded with a ?v= number", !missing.length, missing);

  // Real config.js: shape only. Values are never printed.
  const sandbox = {}; let cfgErr = "";
  try { new Function("window", read("config.js"))(sandbox); } catch (e) { cfgErr = e.message; }
  const cfg = sandbox.KT_CONFIG || {}, key = String(cfg.key || "");
  let role = ""; try { role = JSON.parse(Buffer.from(key.split(".")[1] || "", "base64url").toString() || "{}").role || ""; } catch (e) {}
  const cfgProblems = [cfgErr && "config.js does not run: " + cfgErr, !/^https:\/\//.test(cfg.url || "") && "url is not https", !key && "key is empty",
    (/^sb_secret_/.test(key) || role === "service_role") && "key looks like a SECRET key", /service_role/.test(read("config.js").replace(/\/\/.*$/gm, "")) && "config.js mentions service_role outside a comment"].filter(Boolean);
  check("static", "real config.js loads, has an https URL and a public (not secret) key", !cfgProblems.length, cfgProblems);

  // get_schedule in schema.sql must not send private fields.
  const sql = read("supabase/schema.sql"), m = sql.match(/create or replace function public\.get_schedule[\s\S]*?\$\$([\s\S]*?)\$\$/);
  const body = m ? m[1] : "";
  const bad = ["pnote", "track_from"].filter(w => body.includes(w));
  check("privacy", "schema.sql: get_schedule never selects pnote or track_from", !!m && !bad.length, m ? bad.map(w => `function body mentions ${w}`) : "get_schedule not found in supabase/schema.sql");
  const mock = JSON.stringify(familyResponse(BASE_DB));
  const mockKeys = ["settings", "changed_at", "breaks", "swaps", "window", "kids", "places", "teams", "events", "comments", "log"], swapKeys = ["day", "had", "caregiver", "reason", "note", "updated_at"];
  const r = familyResponse(BASE_DB);
  check("privacy", "test answer for get_schedule has the same fields as schema.sql and no private ones",
    eq(Object.keys(r), mockKeys) && eq(Object.keys(r.settings), ["my_name", "co_name", "anchor"]) && r.swaps.every(w => eq(Object.keys(w), swapKeys)) && !/pnote|track_from|PRIVATE-/.test(mock),
    "the mocked response drifted from the documented get_schedule shape");

  // Writing rule: no em or en dashes in anything Heather or the family reads.
  const dashFiles = [...SITE_FILES, "_config.yml", ...fs.readdirSync(HERE).filter(f => /\.(mjs|json)$/.test(f) && f !== "package-lock.json").map(f => "tests/" + f),
    "tests/fixtures/db.json", "tests/fixtures/acts.json", "tests/fixtures/config.test.js", "tests/lib/fake-supabase.js", "tests/lib/payload.js"].filter(f => fs.existsSync(path.join(ROOT, f)));
  const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
  const dashHits = dashFiles.flatMap(f => read(f).split("\n").map((l, i) => (DASHES.test(l) ? `${f}:${i + 1}` : null)).filter(Boolean));
  const dashMissing = [...SITE_FILES, "_config.yml"].filter(f => !dashFiles.includes(f));
  actsStaticChecks({ check, eq, P, sql, base: BASE_DB });
  check("static", `no em dashes or en dashes in site files or test files (${dashFiles.length} files, including core.js, acts.js, editor.js, activities.js and _config.yml)`, !dashHits.length && !dashMissing.length, [...dashHits, ...dashMissing.map(f => `${f} is missing, so it could not be checked`)]);
}

// _config.yml tells GitHub Pages what to leave off the public site. It must do that and nothing else,
// and it must never leave off a file the site needs.
function configYmlChecks(read) {
  const file = path.join(ROOT, "_config.yml");
  if (!fs.existsSync(file)) { check("static", "_config.yml exists", false, "No _config.yml at the top of the repo."); return; }
  // A strict reader: comment lines, one "exclude:" key, and plain "  - name" items. Anything else is reported.
  const excluded = [], odd = [], keys = []; let comments = 0, inList = false;
  read("_config.yml").split("\n").forEach((l, i) => {
    if (!l.trim()) return;
    if (/^#/.test(l)) { comments++; return; }
    const k = l.match(/^([A-Za-z_][\w-]*):\s*$/);
    if (k) { keys.push(k[1]); inList = k[1] === "exclude"; return; }
    const m = inList && l.match(/^  - ([A-Za-z0-9._-]+)\s*$/);
    if (m) { excluded.push(m[1]); return; }
    odd.push(`line ${i + 1} is not a comment, "exclude:" or a plain list item: ${l}`);
  });
  check("static", "_config.yml contains only a comment and an exclude list", eq(keys, ["exclude"]) && excluded.length > 0 && !odd.length && comments >= 1,
    odd.length || !eq(keys, ["exclude"]) ? [`keys found: ${keys.join(", ") || "none"}`, ...odd] : `${comments} comment line(s), exclude list: ${excluded.join(", ")}`);
  // The same file through a real YAML parser (Ruby, which is what GitHub Pages itself uses).
  const rb = spawnSync("ruby", ["-ryaml", "-rjson", "-e", "puts JSON.generate(YAML.safe_load(File.read(ARGV[0])))", file], { encoding: "utf8" });
  if (rb.error) console.log("INFO   ruby is not installed here, so _config.yml was read by the strict reader only and not by a full YAML parser");
  else { let parsed = null; try { parsed = JSON.parse(rb.stdout); } catch (e) {}
    check("static", "_config.yml parses as YAML and holds exactly the exclude list", rb.status === 0 && eq(parsed, { exclude: excluded }), rb.status === 0 ? `parsed: ${rb.stdout.trim()}` : rb.stderr.trim().split("\n").slice(0, 3)); }
  const needed = excluded.filter(e => SITE_FILES.some(f => f === e || f.startsWith(e + "/")) || e === ".");
  check("static", `_config.yml does not exclude any file the site needs (${SITE_FILES.join(", ")})`, !needed.length && SITE_FILES.every(f => fs.existsSync(path.join(ROOT, f))),
    [...needed.map(e => `"${e}" is excluded but the site needs it`), ...SITE_FILES.filter(f => !fs.existsSync(path.join(ROOT, f))).map(f => `${f} is missing from the repo root`)]);
  // Everything else at the top of the repo should be left off the site. (GitHub Pages already skips names that start with a dot or an underscore.)
  const published = fs.readdirSync(ROOT).filter(n => !/^[._]/.test(n) && !SITE_FILES.includes(n) && !excluded.includes(n));
  check("static", "everything at the top of the repo is either a site file or left off the public site by _config.yml", !published.length, published.map(n => `"${n}" would be published. Add it to the exclude list, or to SITE_FILES in tests/run.mjs if it is part of the site`));
}

// ---------------------------------------------------------------------------
// Checks: known truths (independent of the goldens)
// ---------------------------------------------------------------------------
function truthChecks(label, months, db, { leap } = {}) {
  const cells = byDate(months), G = `truths ${label}`;
  const who = iso => { const c = cells.get(iso); return c ? holderOf(c) : "(no cell)"; };
  const aria = iso => (cells.get(iso) || {}).aria || "";
  const all = (days, want, mark) => days.filter(d => who(d) !== want || (mark && !aria(d).includes(mark))).map(d => `${d}: expected ${NAME[want]}${mark ? ` with "${mark}"` : ""}, page shows "${aria(d)}" [${who(d)}]`);
  const none = (days, mark) => days.filter(d => aria(d).includes(mark)).map(d => `${d}: should not be marked "${mark}", page shows "${aria(d)}"`);
  const hasSwaps = db.swaps.length > 0;

  if (!hasSwaps) {
    check(G, "2026-10-02 is Heather's and 2026-11-09 is Brett's", who("2026-10-02") === "me" && who("2026-11-09") === "co", `2026-10-02 [${who("2026-10-02")}], 2026-11-09 [${who("2026-11-09")}]`);
    check(G, "Thanksgiving 2026 is Heather's, nights of Nov 20 to Nov 29, and stops there",
      ...(x => [!x.length, x])([...all(span("2026-11-20", "2026-11-29"), "me", "Thanksgiving"), ...none(["2026-11-19", "2026-11-30"], "Thanksgiving")]));
    check(G, "Christmas 2026 first part is Brett's, Dec 18 to Dec 25", ...(x => [!x.length, x])([...all(span("2026-12-18", "2026-12-25"), "co", "Christmas, first part"), ...none(["2026-12-17"], "Christmas")]));
    check(G, "Christmas 2026 second part is Heather's, Dec 26 through Jan 4, and Jan 5 is back on the rotation (Brett)",
      ...(x => [!x.length, x])([...all(span("2026-12-26", "2027-01-04"), "me", "Christmas, second part"), ...all(["2027-01-05"], "co"), ...none(["2027-01-05"], "Christmas")]));
    check(G, "Mother's Day weekend 2027 is Heather's: Fri May 7, Sat May 8, Sun May 9",
      ...(x => [!x.length, x])([...all(span("2027-05-07", "2027-05-09"), "me", "Mother's Day weekend"), ...none(["2027-05-06", "2027-05-10"], "Mother's Day")]));
    check(G, "Father's Day weekend 2027 is Brett's: Fri Jun 18, Sat Jun 19, Sun Jun 20",
      ...(x => [!x.length, x])([...all(span("2027-06-18", "2027-06-20"), "co", "Father's Day weekend"), ...none(["2027-06-17", "2027-06-21"], "Father's Day")]));
    check(G, "Spring break 2027 (odd year) is Heather's, Apr 2 to Apr 10, and Apr 11 returns to the rotation (Brett)",
      ...(x => [!x.length, x])([...all(span("2027-04-02", "2027-04-10"), "me", "Spring break"), ...all(["2027-04-11"], "co"), ...none(["2027-04-01", "2027-04-11"], "Spring break")]));
    // Holiday beats rotation: these nights fall in the OTHER parent's rotation week.
    const o = makeOracle(db);
    const hb = [["2026-11-23", "me"], ["2026-12-25", "co"], ["2027-01-02", "me"], ["2027-05-08", "me"]];
    check(G, "a holiday beats the rotation (Nov 23, Dec 25, Jan 2 and May 8 fall in the other parent's rotation week)",
      hb.every(([d, w]) => o.rotation(d) !== w && who(d) === w), hb.map(([d, w]) => `${d}: rotation says ${NAME[o.rotation(d)]}, holiday says ${NAME[w]}, page shows [${who(d)}]`));
    check(G, "other holidays beat summer weeks (Heather's summer week Jun 18 to 24 gives way to Father's Day Jun 18 to 20, then holds Jun 21 to 24)",
      ...(x => [!x.length, x])([...all(span("2027-06-18", "2027-06-20"), "co", "Father's Day weekend"), ...none(span("2027-06-18", "2027-06-20"), "Summer week"), ...all(span("2027-06-21", "2027-06-24"), "me", "Summer week")]));
    check(G, "a summer week beats the rotation (Brett's week Jul 12 to 18 covers Heather's rotation days Jul 12 to 15)",
      ...(x => [!x.length, x])([...all(span("2027-07-12", "2027-07-18"), "co", "Summer week"), ...(span("2027-07-12", "2027-07-15").every(d => o.rotation(d) === "me") ? [] : ["fixture no longer puts Jul 12 to 15 in Heather's rotation week"])]));
    check(G, "year boundary: Dec 31, 2026 and Jan 1, 2027 are both Heather's (Christmas second part), Jan 8 starts Heather's week, Jan 15 Brett's",
      who("2026-12-31") === "me" && who("2027-01-01") === "me" && who("2027-01-07") === "co" && who("2027-01-08") === "me" && who("2027-01-15") === "co",
      ["2026-12-31", "2027-01-01", "2027-01-07", "2027-01-08", "2027-01-15"].map(d => `${d} [${who(d)}]`).join(", "));
    check(G, "on a handoff day the whole day belongs to the receiving parent (Fri Nov 6 is Brett's, Fri Oct 16 is Heather's)",
      who("2026-11-05") === "me" && who("2026-11-06") === "co" && who("2026-10-15") === "co" && who("2026-10-16") === "me", ["2026-10-15", "2026-10-16", "2026-11-05", "2026-11-06"].map(d => `${d} [${who(d)}]`).join(", "));
    if (leap) {
      // 2026-10-02 to 2028-02-29 is 365 + 150 = 515 days. 515 / 7 = 73 full weeks, an odd number, so it is Brett's week.
      const lc = byDate(leap);
      const lw = iso => (lc.get(iso) ? holderOf(lc.get(iso)) : "(no cell)");
      check(G, "leap year: Tue Feb 29, 2028 exists and is Brett's (week 73 from the anchor), Fri Mar 3, 2028 starts Heather's week 74",
        (lc.get("2028-02-29") || {}).aria === "Tuesday, February 29, Brett" && lw("2028-03-01") === "co" && lw("2028-03-02") === "co" && lw("2028-03-03") === "me",
        ["2028-02-28", "2028-02-29", "2028-03-01", "2028-03-02", "2028-03-03"].map(d => `${d} "${(lc.get(d) || {}).aria}" [${lw(d)}]`));
    }
  } else {
    const sw = [["2026-11-25", "co", "Thanksgiving"], ["2026-12-22", "grandma", "Christmas, first part"], ["2026-12-23", "grandma", "Christmas, first part"], ["2027-04-07", "grandma", "Spring break"]];
    check(G, "a logged switch beats a holiday (Nov 25 to Brett inside Thanksgiving, Dec 22 and 23 and Apr 7 to Grandma inside Christmas and spring break)",
      sw.every(([d, w, h]) => who(d) === w && aria(d).includes("switched") && aria(d).includes(h) && cells.get(d).cls.split(" ").includes("swap")),
      sw.map(([d, w, h]) => `${d}: expected ${w}, switched, still marked ${h}. Page shows "${aria(d)}" [${cells.get(d) ? cells.get(d).cls : ""}]`));
    const sr = [["2026-10-13", "me"], ["2026-10-20", "grandma"], ["2026-10-31", "other"], ["2026-11-17", "co"]];
    check(G, "a logged switch beats the rotation (Oct 13, Oct 20, Oct 31, Nov 17)", sr.every(([d, w]) => who(d) === w && aria(d).includes("switched")), sr.map(([d, w]) => `${d}: expected ${w}, page shows "${aria(d)}"`));
  }
  // Every night Oct 2026 to Jul 2027 against the independent oracle.
  const o = makeOracle(db), bad = [];
  let n = 0;
  for (const [iso, c] of cells) {
    n++;
    const want = o.holder(iso), h = o.holiday(iso), sw = o.swap(iso);
    const wantName = sw && sw.had === "other" ? (sw.caregiver || "Someone else") : NAME[want];
    const wantStart = [longLabel(iso), wantName, sw ? "switched" : "", h ? h.name : ""].filter(Boolean).join(", ");
    if (holderOf(c) !== want) bad.push(`${iso}: rules say ${want}, page shows [${c.cls}]`);
    else if (c.cls.split(" ").includes("swap") !== !!sw) bad.push(`${iso}: switched marker is wrong, page shows [${c.cls}]`);
    else if (!(c.aria === wantStart || c.aria.startsWith(wantStart + ", "))) bad.push(`${iso}: label should start "${wantStart}", page shows "${c.aria}"`);
  }
  check(G, `all ${n} nights from Oct 2026 to Jul 2027 match an independent calculation from the written rules`, n >= 300 && !bad.length, bad);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (SHOTS !== "latest" && fs.existsSync(SHOT_DIR) && fs.readdirSync(SHOT_DIR).some(f => f.endsWith(".png")) && !FORCE) {
    console.error(`tests/output/${SHOTS}/ already has screenshots. They are the "${SHOTS}" pictures, so this run will not overwrite them.\nTo replace them on purpose: npm run shots:${SHOTS} -- --force`);
    process.exit(2);
  }
  const { server, origin } = await startServer();
  ORIGIN = origin;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  console.log(`Kids Tracker checks. Site served from ${ROOT} at ${ORIGIN}. Chrome ${browser.version()}. ${UPDATE ? "BASELINE UPDATE: golden files will be rewritten." : "Comparing against golden files."}\n`);

  try {
    staticChecks();

    // ---- Schedule only (no logged switches): the pure rules, on both pages ----
    {
      const s = await open("family", "family, schedule only", { respond: () => ({ json: familyResponse(dbScheduleOnly()) }) });
      const now = await q(s.page, "famNow");
      const months = {}; for (const ym of MONTHS) months[ym] = await captureMonth(s, ym);
      const leap = { "2028-02": await captureMonth(s, "2028-02"), "2028-03": await captureMonth(s, "2028-03") };
      truthChecks("family", months, dbScheduleOnly(), { leap });
      expectAll("truths family", "Right now on Thu Nov 19, 2026 with no switches: Heather through Thu Dec 3, Brett picks up Fri Dec 4 after school", [
        ["card color", now.cls, "me now"], ["who", now.lines[1], "With Heather"], ["through and next", now.lines[2], "Through Thursday, Dec 3. Brett picks up Friday, Dec 4 after school."], ["school", now.lines[now.lines.length - 1], "School today"]]);
      await close(s);
      const a = await open("admin", "admin, schedule only", { fake: { db: dbScheduleOnly() } });
      const am = {}; for (const ym of MONTHS) am[ym] = await captureMonth(a, ym);
      const aleap = { "2028-02": await captureMonth(a, "2028-02"), "2028-03": await captureMonth(a, "2028-03") };
      truthChecks("admin", am, dbScheduleOnly(), { leap: aleap });
      // Scheduled totals with no switches. Counting starts Wed Oct 7, 2026 (track_from in the fixture, 5 days after the anchor), so Oct 7 to Nov 19 is 44 nights.
      // Heather: Oct 7-8 (2), Oct 16-22 (7), Oct 30 to Nov 5 (7), Nov 13-19 (7) = 23. Brett: Oct 9-15, Oct 23-29, Nov 6-12 = 21.
      await a.page.locator('[data-period="all"]').click();
      const t = await q(a.page, "totals");
      expectAll("totals", "no switches, since start on Nov 19, 2026: Heather 23, Brett 21 of 44, nobody covered", [
        ["Heather", t.me.nights, "23"], ["Brett", t.co.nights, "21"], ["Heather %", t.me.pct, "52.3%"], ["Brett %", t.co.pct, "47.7%"],
        ["facts", t.facts, ["Oct 7 to Nov 19, 2026, 44 nights", "Heather covered 0 for Brett", "Brett covered 0 for Heather", "Net 0"]]]);
      await close(a);
    }

    // ---- Family page, full fixture, both frozen dates ----
    const fam = {};
    for (const T of [T19, T30]) {
      const s = await open("family", `family ${T.day}`, { at: T });
      const { out, privacy } = await captureFamily(s);
      fam[T.day] = out;
      setGolden(`family-${T.day}`, out);
      truthChecks(`family ${T.day}`, out.months, BASE_DB);
      check("privacy", `family page ${T.day}: no private note, track_from, totals or percentages anywhere in the page (10 months, ${SHEET_DAYS.length} day sheets)`, !privacy.length, privacy);
      const call = s.famCalls[0] || {};
      check("privacy", `family page ${T.day}: the only data request is one POST to get_schedule carrying just the token`,
        s.famCalls.length === 1 && call.method === "POST" && eq(call.body, { p_token: "TESTTOKEN" }) && call.host === "kt-mock.invalid" && call.apikey === "test-publishable-key-not-real",
        JSON.stringify(s.famCalls));
      await close(s);
    }
    {
      // Handoff times, read from the day sheets.
      // The handoff rules live in handoffTime in core.js.
      const d19 = fam[T19.day].daySheets, last = iso => d19[iso].lines.filter(l => l.startsWith("Handoff:")).join(" / ") || "(no handoff line)";
      expectAll("truths handoff", "regular Friday handoff on a school day reads \"after school\"", [["Fri 2026-11-06", last("2026-11-06"), "Handoff: Heather to Brett, after school"], ["Fri 2026-12-04", last("2026-12-04"), "Handoff: Heather to Brett, after school"]]);
      expectAll("truths handoff", "Friday handoff with no school reads \"at 5 p.m.\" (teacher workday, winter weekend, summer break)", [
        ["Fri 2026-10-16", last("2026-10-16"), "Handoff: Brett to Heather, at 5 p.m."], ["Fri 2027-02-12", last("2027-02-12"), "Handoff: Heather to Brett, at 5 p.m."], ["Fri 2027-06-04", last("2027-06-04"), "Handoff: Heather to Brett, at 5 p.m."]]);
      expectAll("truths handoff", "holiday handoffs use the agreement times (Christmas starts at dismissal, second part at 2 p.m. Dec 26, spring break ends at 6 p.m.)", [
        ["Fri 2026-12-18 half day", last("2026-12-18"), "Handoff: Heather to Brett, after school"], ["Sat 2026-12-26", last("2026-12-26"), "Handoff: Brett to Heather, at 2 p.m."],
        ["Tue 2027-01-05 school resumes", last("2027-01-05"), "Handoff: Heather to Brett, after school"], ["Sun 2027-04-11", last("2027-04-11"), "Handoff: Heather to Brett, at 6 p.m."]]);
      expectAll("truths handoff", "one-off switches show no set time", [["Tue 2026-10-13", last("2026-10-13"), "Handoff: Brett to Heather"], ["Wed 2026-10-21", last("2026-10-21"), "Handoff: Grandma to Heather"], ["Wed 2026-11-25", last("2026-11-25"), "Handoff: Heather to Brett"]]);
      // Spring break START: after school on the last school day, in both parents' years (Heather confirmed). Fixed in Phase 0, was a known bug.
      const f30 = fam[T30.day], d30 = f30.daySheets, hand = (sheets, iso) => sheets[iso].lines.filter(l => l.startsWith("Handoff:")).join(" / ") || "(no handoff line)";
      const upOn = day => (f30.comingUp.find(r => r.text.startsWith(day + " ")) || {}).text || `(no ${day} entry)`;
      expectAll("truths handoff", "spring break 2027 (Heather's year) starts \"after school\" on Fri Apr 2: day sheet on both test dates, Right now card and Coming up", [
        ["day sheet 2027-04-02, today Nov 19", hand(d19, "2027-04-02"), "Handoff: Brett to Heather, after school"],
        ["day sheet 2027-04-02, today Mar 30", hand(d30, "2027-04-02"), "Handoff: Brett to Heather, after school"],
        ["Right now on 2027-03-30", f30.rightNow.lines[2], "Through Thursday, Apr 1. Heather picks up Friday, Apr 2 after school."],
        ["Coming up on 2027-03-30", upOn("Apr 2"), "Apr 2 Friday Heatherpicks up after school, through Tue, Apr 6 ★ Spring break begins, Heather's year"]]);
      // Spring break END: 6 p.m. the evening before school resumes. Must not have moved when the start was fixed.
      expectAll("truths handoff", "spring break 2027 still ENDS \"at 6 p.m.\": the handoff out of spring break on Sun Apr 11 (day sheet on both test dates, and Coming up)", [
        ["day sheet 2027-04-11, today Nov 19", hand(d19, "2027-04-11"), "Handoff: Heather to Brett, at 6 p.m."],
        ["day sheet 2027-04-11, today Mar 30", hand(d30, "2027-04-11"), "Handoff: Heather to Brett, at 6 p.m."],
        ["Coming up on 2027-03-30", upOn("Apr 11"), "Apr 11 Sunday Brettpicks up at 6 p.m., through Thu, Apr 15"]]);
    }
    {
      // The last night of spring break 2027, Sat Apr 10: the Right now card names the 6 p.m. pickup the next day.
      // (Only the start of the sentence is compared. The doubled period at its end is the separate tracked finding.)
      const s = await open("family", "family, last night of spring break", { at: "2027-04-10T12:00:00-04:00" });
      const now = await q(s.page, "famNow");
      expectAll("truths handoff", "Right now on Sat Apr 10, 2027 (last night of spring break): Heather tonight, Brett picks up tomorrow at 6 p.m.", [
        ["who", now.lines[1], "With Heather"], ["sentence starts", now.lines[2].replace(/\.+$/, ""), "Tonight only. Brett picks up tomorrow at 6 p.m"]]);
      await close(s);
    }
    {
      // Brett's year: a made-up spring break in 2028 (even year). Last school day Fri Mar 24, school resumes Mon Apr 3.
      // Rotation: Mar 17 to 23 is Heather's week, Mar 31 to Apr 6 is Heather's week. Spring break gives Brett Mar 24 to Apr 1.
      const s = await open("family", "family, spring break in Brett's year", { respond: () => ({ json: familyResponse(dbSpring2028()) }) });
      const start = await famDaySheet(s, "2028-03-24"), mid = await famDaySheet(s, "2028-03-31"), end = await famDaySheet(s, "2028-04-02");
      const cells = byDate({ "2028-03": await captureMonth(s, "2028-03"), "2028-04": await captureMonth(s, "2028-04") });
      const nights = span("2028-03-24", "2028-04-01").filter(d => holderOf(cells.get(d)) !== "co" || !cells.get(d).aria.includes("Spring break"));
      const hand = d => d.lines.filter(l => l.startsWith("Handoff:")).join(" / ") || "(no handoff line)";
      expectAll("truths handoff", "spring break in Brett's year (2028, made-up dates): Brett has Mar 24 to Apr 1, it starts \"after school\" and ends \"at 6 p.m.\" on Sun Apr 2", [
        ["nights Mar 24 to Apr 1 that are not Brett's spring break", nights, []],
        ["start, Fri 2028-03-24", hand(start), "Handoff: Heather to Brett, after school"],
        ["middle Friday 2028-03-31 (Heather's rotation week, holiday holds)", hand(mid), "(no handoff line)"],
        ["end, Sun 2028-04-02", hand(end), "Handoff: Brett to Heather, at 6 p.m."],
        ["Sun 2028-04-02 is back on the rotation", [holderOf(cells.get("2028-04-02")), cells.get("2028-04-02").aria.includes("Spring break")], ["me", false]]]);
      await close(s);
    }

    // ---- Family page: time zone edges ----
    for (const [label, instant, want] of [["11:30 p.m. Eastern on Nov 19", "2026-11-19T23:30:00-05:00", "Thursday, November 19"], ["12:30 a.m. Eastern on Nov 20", "2026-11-20T00:30:00-05:00", "Friday, November 20"]]) {
      const s = await open("family", `family ${label}`, { at: instant });
      const today = await s.page.locator("#fGrid .day.today").getAttribute("aria-label");
      check("truths family", `"today" follows the local calendar day at ${label}`, today.startsWith(want), `today cell: "${today}"`);
      await close(s);
    }

    // ---- Family page: Right now sentence when the next pickup has a clock time ----
    {
      // Thu Oct 15, 2026 with no switches: Brett's last night. Fri Oct 16 is a teacher workday, so Heather picks up at 5 p.m.
      const s = await open("family", "family, pickup with a clock time", { at: "2026-10-15T12:00:00-04:00", respond: () => ({ json: familyResponse(dbScheduleOnly()) }) });
      const now = await q(s.page, "famNow");
      expectAll("copy", "Right now sentence ends with one period when the pickup time is \"5 p.m.\" (Thu Oct 15, 2026, no switches)", [["who", now.lines[1], "With Brett"], ["sentence", now.lines[2], "Tonight only. Heather picks up tomorrow at 5 p.m."]]);
      await close(s);
    }

    // ---- Family page: a response that wrongly includes private fields must still not show them ----
    {
      const s = await open("family", "family, leaky response", { at: T30, respond: () => ({ json: familyResponse(BASE_DB, { leaky: true }) }) });
      const { privacy } = await captureFamily(s, { sheets: ["2026-10-13", "2026-12-22", "2027-03-09", "2027-04-07"] });
      check("privacy", "family page ignores pnote, track_from and totals even if a response were to include them", !privacy.length, privacy);
      await close(s);
    }

    // ---- Family page: "Updated since you last looked" ----
    {
      const flow = {};
      const s = await open("family", "family, what's new");
      const snap = async () => ({ ...(await q(s.page, "famNew")), comingUpNewRows: (await q(s.page, "famUp")).filter(r => (r.chips || []).some(c => c.startsWith("chip new"))) });
      flow.step1_firstVisit = await snap();
      check("what's new", "first visit: no box, no New markers, and this phone remembers the current changed_at", !flow.step1_firstVisit.shown && flow.step1_firstVisit.dots === 0 && flow.step1_firstVisit.newChips === 0 && flow.step1_firstVisit.seen === BASE_DB.settings[0].changed_at, JSON.stringify(flow.step1_firstVisit));
      s.respond = () => ({ json: familyResponse(dbWhatsNew2()) });
      await s.page.reload(); await ready(s);
      flow.step2_laterChange = await snap();
      flow.step2_december = await captureMonth(s, "2026-12");
      const dots = flow.step2_december.cells.filter(c => c.newDot && c.date.startsWith("2026-12")).map(c => c.date);
      check("what's new", "after a later change: box lists the new switch (Dec 12 to Dec 13, Brett, Travel), New dots on exactly those two days, New chip in Coming up",
        flow.step2_laterChange.shown && eq(flow.step2_laterChange.items, [{ text: "Dec 12 to Dec 13 BrettTravel. Heather at a conference", chips: ["chip co | Brett"] }]) && eq(dots, ["2026-12-12", "2026-12-13"])
          && flow.step2_laterChange.comingUpNewRows.length === 1 && flow.step2_laterChange.comingUpNewRows[0].text.startsWith("Dec 12 ") && flow.step2_laterChange.seen === BASE_DB.settings[0].changed_at,
        [JSON.stringify(flow.step2_laterChange), `dots on: ${dots.join(", ") || "none"}`]);
      await s.page.locator("#gotIt").click();
      flow.step3_afterGotIt = await snap();
      flow.step3_december = (await captureMonth(s, "2026-12")).cells.filter(c => c.newDot).length;
      check("what's new", "\"Got it\" hides the box, clears every New marker and remembers the new changed_at", !flow.step3_afterGotIt.shown && flow.step3_afterGotIt.dots === 0 && flow.step3_afterGotIt.newChips === 0 && flow.step3_afterGotIt.seen === T_NEW2, JSON.stringify(flow.step3_afterGotIt));
      await s.page.reload(); await ready(s);
      flow.step4_reloadSameData = await snap();
      check("what's new", "reloading with nothing new keeps the box hidden", !flow.step4_reloadSameData.shown && flow.step4_reloadSameData.dots === 0, JSON.stringify(flow.step4_reloadSameData));
      s.respond = () => ({ json: familyResponse(dbWhatsNew3()) });
      await s.page.reload(); await ready(s);
      flow.step5_switchRemoved = await snap();
      check("what's new", "a removed switch (nothing newer to list) shows the box with the \"went back to the regular schedule\" line",
        flow.step5_switchRemoved.shown && eq(flow.step5_switchRemoved.items.map(i => i.text), ["Some days went back to the regular schedule, or school dates were updated."]) && flow.step5_switchRemoved.dots === 0, JSON.stringify(flow.step5_switchRemoved));
      await s.page.locator("#gotIt").click();
      flow.step6_afterGotIt = await snap();
      check("what's new", "\"Got it\" clears that box too", !flow.step6_afterGotIt.shown && flow.step6_afterGotIt.seen === T_NEW3, JSON.stringify(flow.step6_afterGotIt));
      setGolden("family-whats-new", flow);
      await close(s);
    }

    // ---- Family page: empty and error states ----
    {
      const st = {};
      const msg = async (label, o) => { const s = await open("family", `family state: ${label}`, o); const m = await q(s.page, "famMsg"); await close(s); return m; };
      st.noToken = await msg("no token", { hash: "" });
      st.inactiveLink = await msg("inactive link", { hash: "#k=OLDTOKEN" });
      st.serverError = await msg("server error", { respond: () => ({ status: 500, json: { message: "mock failure" } }), expectErrors: true });
      st.networkDown = await msg("network down", { respond: () => "abort", expectErrors: true });
      st.scheduleNotSetUp = await msg("no settings row", { respond: () => ({ json: { settings: null, changed_at: null, breaks: [], swaps: [] } }) });
      expectAll("states", "family page messages: no token, inactive link, failed request, schedule not set up", [
        ["no token", st.noToken, { msgShown: true, msg: "Open this page from the link Heather sent you.", contentShown: false }],
        ["inactive link", st.inactiveLink, { msgShown: true, msg: "This link isn't active anymore. Ask Heather for the new one.", contentShown: false }],
        ["server error", st.serverError, { msgShown: true, msg: "Couldn't load the schedule. Check your connection and refresh the page.", contentShown: false }],
        ["network down", st.networkDown, { msgShown: true, msg: "Couldn't load the schedule. Check your connection and refresh the page.", contentShown: false }],
        ["schedule not set up", st.scheduleNotSetUp, { msgShown: true, msg: "The schedule isn't set up yet.", contentShown: false }]]);
      {
        const s = await open("family", "family state: no data", { respond: () => ({ json: familyResponse(dbEmpty()) }) });
        st.noData = { rightNow: await q(s.page, "famNow"), november: { ...(await captureMonth(s, "2026-11")), thisMonthList: await q(s.page, "famNotes") }, comingUp: await q(s.page, "famUp"), whatsNew: await q(s.page, "famNew") };
        check("states", "family page with no switches and no school calendar still shows the rotation and a plain empty month list",
          st.noData.rightNow.lines[1] === "With Heather" && eq(st.noData.november.thisMonthList, [{ text: "No switches, holidays or days off school this month." }]) && st.noData.november.cells.length === 35, JSON.stringify(st.noData.rightNow));
        await close(s);
      }
      {
        // The 2027-28 school calendar is not entered: fall 2027 has no Thanksgiving or Christmas dates.
        const s = await open("family", "family state: missing school year", { at: T30 });
        st.missingSchoolYear = {};
        for (const ym of ["2027-09", "2027-11", "2027-12"]) st.missingSchoolYear[ym] = { ...(await captureMonth(s, ym)), thisMonthList: await q(s.page, "famNotes") };
        const nov = byDate({ "2027-11": st.missingSchoolYear["2027-11"] });
        check("states", "a school year that is not entered yet falls back to the plain rotation with no holiday or school marks (Nov 2027)",
          [...nov.values()].every(c => !/Thanksgiving|No school|Half/.test(c.aria)) && eq(st.missingSchoolYear["2027-11"].thisMonthList, [{ text: "No switches, holidays or days off school this month." }]), "");
        await close(s);
      }
      setGolden("family-states", st);
    }

    // ---- Admin page, full fixture, both frozen dates ----
    const adm = {};
    for (const T of [T19, T30]) {
      const s = await open("admin", `admin ${T.day}`, { at: T });
      adm[T.day] = await captureAdmin(s);
      setGolden(`admin-${T.day}`, adm[T.day]);
      truthChecks(`admin ${T.day}`, adm[T.day].months, BASE_DB);
      check("static", `admin page ${T.day}: supabase-js is requested once, from the exact pinned jsDelivr address`, s.cdn.length === 1 && s.cdn[0] === SB_PINNED, s.cdn.join(", ") || "no request seen");
      await close(s);
    }
    {
      /* TOTALS, counted by hand from the rules and tests/fixtures/db.json. The arithmetic is in the final QA report.
         Rotation weeks from the anchor Fri 2026-10-02: even weeks Heather, odd weeks Brett.
         Counting starts Wed 2026-10-07 (track_from in the fixture, made up, 5 days after the anchor), so Oct 2 to 6 are never counted.
         Scheduled nights by month (H = Heather, B = Brett):
           Oct 7-31:  H 11 (Oct 7-8, 16-22, 30-31)            B 14 (Oct 9-15, 23-29)
           Nov 1-30:  H 23 (Nov 1-5, 13-19, Thanksgiving 20-29, Nov 30)   B 7 (Nov 6-12)
           Dec 1-31:  H 16 (Dec 1-3, 11-17, Christmas part two 26-31)     B 15 (Dec 4-10, Christmas part one 18-25)
           Jan 1-31:  H 18 (Jan 1-4, 8-14, 22-28)             B 13 (Jan 5-7, 15-21, 29-31)
           Feb 1-28:  H 14 (Feb 5-11, 19-25)                  B 14 (Feb 1-4, 12-18, 26-28)
           Mar 1-30:  H 14 (Mar 5-11, 19-25)                  B 16 (Mar 1-4, 12-18, 26-30)
         Switches through Mar 30, 2027: Oct 13-14 Heather for Brett, Oct 20 Grandma for Heather, Oct 31 Babysitter for Heather,
           Nov 17 Brett for Heather, Nov 25 Brett for Heather, Dec 5 Heather for Brett, Dec 22-23 Grandma for Brett,
           Jan 15 Someone else for Brett, Feb 27-28 Heather for Brett, Mar 9 Brett for Heather.
         Nov 19, 2026, since start: 25 + 19 = 44 nights. Scheduled H 11 + 12 = 23, B 14 + 7 = 21. After the five switched nights: H 22, B 20, Grandma 1, Babysitter 1.
         Mar 30, 2027, since start: 25 + 30 + 31 + 31 + 28 + 30 = 175 nights. Scheduled H 96, B 79. After all switches: H 96, B 74, Grandma 3, someone else 2. */
      const a19 = adm[T19.day], a30 = adm[T30.day];
      const tot = (t, me, co, mePct, coPct, facts) => [["Heather nights", t.me.nights, String(me)], ["Brett nights", t.co.nights, String(co)], ["Heather %", t.me.pct, mePct], ["Brett %", t.co.pct, coPct], ["facts line", t.facts, facts]];
      expectAll("totals", "today Nov 19, 2026, Since start (Oct 7 to Nov 19, 44 nights): Heather 22, Brett 20, Grandma 1, Babysitter 1", tot(a19.totals.sinceStart, 22, 20, "50%", "45.5%",
        ["Oct 7 to Nov 19, 2026, 44 nights", "Grandma kept them 1 (2.3%)", "Babysitter kept them 1 (2.3%)", "Heather covered 2 for Brett", "Brett covered 1 for Heather", "Net +1 to Heather"]));
      expectAll("totals", "today Nov 19, 2026, This year: same 44 nights, because counting starts Oct 7, 2026 (later than Jan 1)", tot(a19.totals.thisYear_default, 22, 20, "50%", "45.5%",
        ["Oct 7 to Nov 19, 2026, 44 nights", "Grandma kept them 1 (2.3%)", "Babysitter kept them 1 (2.3%)", "Heather covered 2 for Brett", "Brett covered 1 for Heather", "Net +1 to Heather"]));
      expectAll("totals", "today Nov 19, 2026, Month shown = November (Nov 1 to 19, 19 nights): Heather 11, Brett 8", tot(a19.months["2026-11"].totalsMonthShown, 11, 8, "57.9%", "42.1%",
        ["Nov 1 to Nov 19, 2026, 19 nights", "Heather covered 0 for Brett", "Brett covered 1 for Heather", "Net -1 to Brett"]));
      expectAll("totals", "today Nov 19, 2026, Month shown = October (starts at the totals start date: Oct 7 to 31, 25 nights): Heather 11, Brett 12, Grandma 1, Babysitter 1", tot(a19.months["2026-10"].totalsMonthShown, 11, 12, "44%", "48%",
        ["Oct 7 to Oct 31, 2026, 25 nights", "Grandma kept them 1 (4%)", "Babysitter kept them 1 (4%)", "Heather covered 2 for Brett", "Brett covered 0 for Heather", "Net +2 to Heather"]));
      expectAll("totals", "today Nov 19, 2026, Month shown = December (future month): nothing counted", [["Heather", a19.months["2026-12"].totalsMonthShown.me, { label: "Heather", nights: "0", pct: "No nights yet" }],
        ["facts", a19.months["2026-12"].totalsMonthShown.facts[0], "Nothing counted in this period yet"]]);
      expectAll("totals", "today Mar 30, 2027, Since start (Oct 7 to Mar 30, 175 nights): Heather 96, Brett 74, Grandma 3, someone else 2", tot(a30.totals.sinceStart, 96, 74, "54.9%", "42.3%",
        ["Oct 7 to Mar 30, 2027, 175 nights", "Grandma kept them 3 (1.7%)", "Babysitter kept them 1, Someone else kept them 1 (1.1%)", "Heather covered 5 for Brett", "Brett covered 3 for Heather", "Net +2 to Heather"]));
      expectAll("totals", "today Mar 30, 2027, This year (Jan 1 to Mar 30, 89 nights): Heather 47, Brett 41, someone else 1", tot(a30.totals.thisYear_default, 47, 41, "52.8%", "46.1%",
        ["Jan 1 to Mar 30, 2027, 89 nights", "Someone else kept them 1 (1.1%)", "Heather covered 2 for Brett", "Brett covered 1 for Heather", "Net +1 to Heather"]));
      expectAll("totals", "today Mar 30, 2027, Month shown = March (Mar 1 to 30, 30 nights): Heather 13, Brett 17", tot(a30.months["2027-03"].totalsMonthShown, 13, 17, "43.3%", "56.7%",
        ["Mar 1 to Mar 30, 2027, 30 nights", "Heather covered 0 for Brett", "Brett covered 1 for Heather", "Net -1 to Brett"]));
      expectAll("totals", "today Mar 30, 2027, Month shown = December 2026 (31 nights): Heather 17, Brett 12, Grandma 2", tot(a30.months["2026-12"].totalsMonthShown, 17, 12, "54.8%", "38.7%",
        ["Dec 1 to Dec 31, 2026, 31 nights", "Grandma kept them 2 (6.5%)", "Heather covered 1 for Brett", "Brett covered 0 for Heather", "Net +1 to Heather"]));
      check("totals", "This year totals do not change when a different month is shown", eq(a19.totals.thisYear_default, a19.totals.thisYear_afterNav) && eq(a30.totals.thisYear_default, a30.totals.thisYear_afterNav), "");
      const priv = a19.changeLog.rows.filter(r => r.text.includes("Private: PRIVATE-")).length;
      check("privacy", "admin change log does show private notes, labeled Private (proves the family-page check would catch a leak)", priv === 5 && a19.changeLog.count === "15 days", `${priv} private rows, count "${a19.changeLog.count}"`);
      const texts = Object.values(a19.textSheets).map(t => t.body).join("\n");
      check("privacy", "prefilled text messages never include a private note", !texts.includes(PNOTE_MARK) && texts.includes("Kids Tracker update:"), texts);
    }

    // ---- Admin page: sign-in and empty states ----
    {
      const st = {};
      const view = async (label, o) => { const s = await open("admin", `admin state: ${label}`, o); const v = await q(s.page, "views"); return { s, v }; };
      let r = await view("signed out", { fake: { signedIn: false } }); st.signedOut = r.v;
      await r.s.page.locator("#pwSignIn").click(); st.signedOut_emptySubmit = (await q(r.s.page, "views")).signinMsg;
      await r.s.page.locator("#email").fill("admin@example.test"); await r.s.page.locator("#password").fill("wrong-test-password"); await r.s.page.locator("#pwSignIn").click(); await settle(r.s);
      st.signedOut_wrongPassword = (await q(r.s.page, "views")).signinMsg;
      await r.s.page.locator("#password").fill("correct-test-password"); await r.s.page.locator("#pwSignIn").click();
      await r.s.page.waitForFunction(() => !document.getElementById("vApp").hidden); await settle(r.s);
      st.signedIn_afterPassword = await q(r.s.page, "views");
      // Sign out reloads the page (editor.js), so nothing from the session stays in memory. The fake remembers the sign-out like the real library.
      await Promise.all([r.s.page.waitForEvent("load"), r.s.page.locator("#signOut").click()]); await ready(r.s);
      st.afterSignOut = await q(r.s.page, "views");
      await close(r.s);
      r = await view("not an admin", { fake: { role: null } }); st.notAdmin = r.v; await close(r.s);
      r = await view("load fails", { fake: { failAll: true }, expectErrors: true }); st.loadFails = r.v; await close(r.s);
      r = await view("brand new, no rows", { fake: { db: { settings: [], breaks: [], swaps: [], swap_details: [], share_links: [] } } });
      st.brandNew = { views: r.v, settings: await q(r.s.page, "settingsSheet"), familyLink: await q(r.s.page, "share"), changeLog: await q(r.s.page, "log"), holidays: await q(r.s.page, "hol") };
      await close(r.s);
      expectAll("states", "admin page views: signed out, wrong password, signed in, signed out again, not an admin, failed load, brand new", [
        ["signed out", [st.signedOut.shown, st.signedOut.topBtns], [["vSignin"], false]],
        ["empty submit", st.signedOut_emptySubmit, "Enter your email and password."],
        ["wrong password", st.signedOut_wrongPassword, "That email and password didn't match. Check them and try again."],
        ["after sign in", [st.signedIn_afterPassword.shown, st.signedIn_afterPassword.topBtns], [["vApp"], true]],
        ["after sign out", st.afterSignOut.shown, ["vSignin"]],
        ["not an admin", st.notAdmin.shown, ["vNotAdmin"]],
        ["failed load", [st.loadFails.shown, st.loadFails.toast], [["vSignin"], "Couldn't load your tracker: mock failure."]],
        ["brand new: settings sheet opens with this week's Friday", [st.brandNew.views.sheets, st.brandNew.settings.anchor, st.brandNew.settings.from], [["setScrim"], "2026-11-13", "2026-11-19"]],
        ["brand new: no link", [st.brandNew.familyLink.status, st.brandNew.familyLink.url, st.brandNew.familyLink.newLabel], ["Off", "No active link. Make one to share.", "Make a link"]]]);
      setGolden("admin-states", st);
    }

    // ---- Admin page: the sign-in card after the unused code step was removed ----
    {
      const s = await open("admin", "admin sign-in: password and email link", { fake: { signedIn: false } }), p = s.page;
      const MSG_LINK = "Check your email and tap the Sign in link on this same device. It brings you right back here, signed in.";
      const first = await q(p, "signin");
      expectAll("sign-in", "the code step is gone: no #codeStep, #code or #verifyCode, and the card holds just email, password, Sign in and \"Email me a link instead\"", [
        ["removed elements still on the page", first.removed, []], ["inputs and buttons in the card", first.controls, ["input#email", "input#password", "button#pwSignIn", "button#sendCode"]],
        ["labels", first.labels, ["Email", "Password", "Sign in", "Email me a link instead"]], ["message line starts empty", first.msg, ""]]);
      await takeCalls(s);
      // Email link with no email typed: a prompt, and nothing is sent.
      await p.locator("#sendCode").click();
      const linkEmpty = { msg: (await q(p, "signin")).msg, calls: await takeCalls(s) };
      // Email link with an email typed (capitals and spaces are tidied): one signInWithOtp call that sends Heather back to this page.
      await p.locator("#email").fill("  Admin@Example.Test "); await p.locator("#sendCode").click(); await settle(s);
      const link = { ...(await q(p, "signin")), calls: await takeCalls(s) };
      expectAll("sign-in", "\"Email me a link instead\" asks for an email first, then calls signInWithOtp once with the tidied email and a link back to this page", [
        ["no email typed: message", linkEmpty.msg, "Enter your email address."], ["no email typed: nothing sent", linkEmpty.calls, []],
        ["email typed: what was sent", link.calls, [{ auth: "signInWithOtp", email: "admin@example.test", redirectTo: `${ORIGIN}/admin.html` }]],
        ["email typed: message", link.msg, MSG_LINK], ["still on the sign-in card, buttons usable again", [link.shown, link.disabled], [["vSignin"], []]]]);
      // Password: Enter in the email box moves to the password box, a wrong password shows the message, the right one signs in.
      await p.locator("#email").press("Enter");
      const focusAfterEnter = (await q(p, "signin")).focus;
      await p.locator("#password").fill("wrong-test-password"); await p.locator("#pwSignIn").click(); await settle(s);
      const wrong = { ...(await q(p, "signin")), calls: await takeCalls(s) };
      await p.locator("#password").fill("correct-test-password"); await p.locator("#password").press("Enter");
      await p.waitForFunction(() => !document.getElementById("vApp").hidden); await settle(s);
      const right = { shown: (await q(p, "views")).shown, calls: await takeCalls(s) };
      expectAll("sign-in", "password sign-in calls signInWithPassword with the tidied email: wrong password stays on the card with a message, the right one (Enter key) opens the tracker", [
        ["Enter in the email box moves to", focusAfterEnter, "password"],
        ["wrong password: what was sent", wrong.calls, [{ auth: "signInWithPassword", email: "admin@example.test" }]],
        ["wrong password: message and view", [wrong.msg, wrong.shown], ["That email and password didn't match. Check them and try again.", ["vSignin"]]],
        ["right password: first call", right.calls[0], { auth: "signInWithPassword", email: "admin@example.test" }],
        ["right password: then the role check, the five table reads, and (after the page shows) activities and text contacts", right.calls.slice(1).map(c => c.rpc || `${c.table}.${c.op}`), ["my_role", "settings.select", "breaks.select", "swaps.select", "swap_details.select", "share_links.select", "get_editor_schedule", "contacts.select"]],
        ["right password: view", right.shown, ["vApp"]]]);
      const stray = s.errors.filter(e => !sriRefusal(e));
      check("sign-in", "no console errors anywhere in the sign-in flow (empty link, link sent, wrong password, signed in)", !stray.length, stray);
      await close(s);
    }

    // ---- Admin page: writes (what gets sent when Heather saves) ----
    {
      const w = {}, s = await open("admin", "admin writes"), p = s.page;
      await takeCalls(s);
      const after = async () => { await settle(s); const o = { calls: await takeCalls(s), toast: (await q(p, "views")).toast, text: await q(p, "textSheet") }; if (o.text.shown) await p.locator("#txtScrim [data-close]").click(); return o; };
      // a. Two-day change to Grandma inside Thanksgiving.
      w.a_sheetBefore = await adminDaySheet(s, "2026-11-21", { keepOpen: true });
      await p.locator("#pickGm").click(); await p.locator("#r-work").check(); await p.locator("#thru").fill("2026-11-22");
      await p.locator("#note").fill("Test shared note"); await p.locator("#pnote").fill("PRIVATE-TEST private note");
      await p.locator("#saveDay").click();
      w.a_saveTwoDaysGrandma = await after();
      w.a_cellsAfter = (await captureMonth(s, "2026-11")).cells.filter(c => ["2026-11-21", "2026-11-22"].includes(c.date));
      w.a_logCount = (await q(p, "log")).count;
      check("writes", "saving a two-day change sends 2 swaps rows then 2 swap_details rows, and the text message has the shared note only",
        eq(w.a_saveTwoDaysGrandma.calls.map(c => `${c.table}.${c.op}:${c.payload.length}`), ["swaps.upsert:2", "swap_details.upsert:2"]) && w.a_saveTwoDaysGrandma.calls[1].payload[0].pnote === "PRIVATE-TEST private note"
          && w.a_saveTwoDaysGrandma.text.body === `Kids Tracker update: Grandma has the kids Sat, Nov 21 to Sun, Nov 22. Work. Test shared note.\n${ORIGIN}/#k=TESTTOKEN` && w.a_cellsAfter.every(c => c.cls === "day grandma swap") && w.a_logCount === "17 days",
        [JSON.stringify(w.a_saveTwoDaysGrandma.calls), w.a_saveTwoDaysGrandma.text.body, JSON.stringify(w.a_cellsAfter), w.a_logCount]);
      // b. Picking the scheduled parent on an unchanged day logs nothing.
      await adminDaySheet(s, "2026-11-23", { keepOpen: true }); await p.locator("#pickMe").click();
      w.b_scheduledParentPicked = await q(p, "adminDay"); await p.locator("#dayScrim [data-close]").click();
      w.b_calls = await takeCalls(s);
      check("writes", "picking the scheduled parent on an unchanged day logs nothing (Save is off, note says it matches the schedule)", w.b_scheduledParentPicked.saveDisabled && w.b_scheduledParentPicked.sameNoteShown && !w.b_scheduledParentPicked.detailFieldsShown.length && !w.b_calls.length, JSON.stringify(w.b_scheduledParentPicked));
      // c. Remove a change from the change log.
      await logRow(s, "2026-11-17").getByRole("button", { name: "Edit" }).click();
      w.c_sheet = await q(p, "adminDay");
      await p.locator("#removeBtn").click();
      w.c_removeNov17 = await after();
      await p.locator('[data-period="all"]').click(); w.c_totalsSinceStartAfter = await q(p, "totals"); await p.locator('[data-period="ytd"]').click();
      check("writes", "removing the Nov 17 switch deletes that one day and Since start becomes Heather 23, Brett 19",
        eq(w.c_removeNov17.calls, [{ table: "swaps", op: "delete", payload: null, filters: [{ kind: "eq", col: "day", val: "2026-11-17" }], sort: null, limit: null, one: null, returning: false }])
          && w.c_removeNov17.text.body.startsWith("Kids Tracker update: Tue, Nov 17 is back to the regular schedule (Heather).") && w.c_totalsSinceStartAfter.me.nights === "23" && w.c_totalsSinceStartAfter.co.nights === "19",
        [JSON.stringify(w.c_removeNov17.calls), w.c_removeNov17.text.body, JSON.stringify(w.c_totalsSinceStartAfter)]);
      // d. Setting a logged range back to the scheduled parent deletes it.
      await logRow(s, "2026-10-13").getByRole("button", { name: "Edit" }).click();
      await p.locator("#pickCo").click(); await p.locator("#thru").fill("2026-10-14"); await p.locator("#saveDay").click();
      w.d_backToScheduled = await after();
      check("writes", "setting Oct 13 to 14 back to Brett (the scheduled parent) deletes both days and logs nothing new",
        w.d_backToScheduled.calls.length === 1 && w.d_backToScheduled.calls[0].op === "delete" && eq(w.d_backToScheduled.calls[0].filters, [{ kind: "in", col: "day", val: ["2026-10-13", "2026-10-14"] }]) && w.d_backToScheduled.toast === "Back to the regular schedule.",
        JSON.stringify(w.d_backToScheduled));
      // e. Someone else, with a name.
      await adminDaySheet(s, "2026-11-28", { keepOpen: true }); await p.locator("#pickOt").click(); await p.locator("#caregiver").fill("Sitter"); await p.locator("#saveDay").click();
      w.e_someoneElse = await after();
      check("writes", "\"Someone else\" saves the typed name as the caregiver", w.e_someoneElse.calls.length === 2 && eq(w.e_someoneElse.calls[0].payload.map(r => [r.day, r.had, r.caregiver]), [["2026-11-28", "other", "Sitter"]]) && w.e_someoneElse.text.body.startsWith("Kids Tracker update: Sitter has the kids Sat, Nov 28. Coverage requested."), JSON.stringify(w.e_someoneElse));
      // f. Family link.
      await p.locator("#newLink").click(); w.f_confirm = await q(p, "share");
      await p.locator("#newLinkYes").click(); w.f_newLink = { ...(await after()), panel: await q(p, "share") };
      await p.locator("#offLink").click(); w.f_turnOff = { ...(await after()), panel: await q(p, "share") };
      check("writes", "making a new family link turns the old one off first, and Turn off leaves no active link",
        w.f_confirm.confirmShown && eq(w.f_newLink.calls.map(c => `${c.table}.${c.op}`), ["share_links.update", "share_links.insert"]) && w.f_newLink.panel.url === `${ORIGIN}/#k=NEWTOKEN1` && w.f_turnOff.panel.status === "Off" && !w.f_turnOff.panel.offShown,
        [JSON.stringify(w.f_newLink.calls), JSON.stringify(w.f_newLink.panel), JSON.stringify(w.f_turnOff.panel)]);
      // g. Dates editor: open and save without changing anything, for 2026 and 2027.
      for (const y of [2026, 2027]) {
        const cur = Number(await p.locator("#holYear").textContent());
        for (let i = 0; i < Math.abs(y - cur); i++) await p.locator(y > cur ? "#holNext" : "#holPrev").click();
        await p.locator("#holEdit").click();
        w[`g_datesEditor${y}`] = await q(p, "datesSheet");
        await p.locator("#saveBrk").click();
        w[`g_saveDates${y}`] = await after();
      }
      const src = y => BASE_DB.breaks.find(b => b.year === y).data;
      check("writes", "opening the dates editor and saving without edits sends back the same school dates (2026 and 2027)",
        [2026, 2027].every(y => { const c = w[`g_saveDates${y}`].calls; return c.length === 1 && c[0].table === "breaks" && c[0].op === "upsert" && c[0].payload.year === y && eq(c[0].payload.data, src(y)); }),
        [2026, 2027].map(y => JSON.stringify(w[`g_saveDates${y}`].calls)));
      // h. Rotation settings.
      await p.locator("#settingsBtn").click(); w.h_settingsSheet = await q(p, "settingsSheet"); await p.locator("#saveSet").click(); w.h_saveSettings = await after();
      check("writes", "rotation settings open with the stored values and save them back unchanged",
        eq(w.h_settingsSheet, { shown: true, my: "Heather", co: "Brett", anchor: "2026-10-02", from: "2026-10-07" }) && eq(w.h_saveSettings.calls.map(c => c.payload), [{ id: 1, my_name: "Heather", co_name: "Brett", anchor: "2026-10-02", track_from: "2026-10-07" }]), JSON.stringify(w.h_saveSettings.calls));
      setGolden("admin-writes", w);
      await close(s);
    }

    // ---- Phone width snapshot of what is visible in the calendar (names collapse to initials, "Off") ----
    {
      const ph = {};
      let s = await open("family", "family phone", { mobile: true });
      ph.family = { rightNow: await q(s.page, "famNow"), november: await captureMonth(s, "2026-11"), december: await captureMonth(s, "2026-12") };
      await close(s);
      s = await open("admin", "admin phone", { mobile: true });
      ph.admin = { november: await captureMonth(s, "2026-11") };
      await close(s);
      const c = byDate({ "2026-11": ph.family.november });
      expectAll("layout", "at 375px the calendar shows initials and \"Off\" instead of full names and \"No school\"", [["Mon Nov 23", c.get("2026-11-23").text, "23 ★ H OFF"], ["Wed Nov 25", c.get("2026-11-25").text, "25 ★ ⇄ B OFF"], ["Mon Nov 9", c.get("2026-11-09").text, "9 B"]]);
      setGolden("phone-375", ph);
    }

    // ---- Layout, screenshots, console ----
    {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const info = {};
      for (const kind of ["family", "admin"]) for (const mobile of [true, false]) for (const dark of [false, true]) {
        const name = `${kind}-${mobile ? 375 : 1280}-${dark ? "dark" : "light"}`;
        const s = await open(kind, `screenshot ${name}`, { mobile, dark, fonts: true });
        await s.page.evaluate(async () => { await document.fonts.ready; });
        await s.page.screenshot({ path: path.join(SHOT_DIR, name + ".png"), fullPage: true });
        info[name] = await q(s.page, "layout", mobile ? 375 : 1280);
        if (mobile && !dark) {
          // Sheets at phone width.
          const shot = async tag => { info[`${kind}-375-${tag}`] = await q(s.page, "layout", 375); await s.page.screenshot({ path: path.join(SHOT_DIR, `${kind}-375-sheet-${tag}.png`) }); };
          if (kind === "family") { await clickDay(s, "2026-11-25"); await shot("day"); await s.page.locator("#famDayScrim [data-close]").click(); }
          else {
            await clickDay(s, "2026-11-17"); await shot("day"); await s.page.locator("#dayScrim [data-close]").click();
            await logRow(s, "2026-11-17").getByRole("button", { name: "Text" }).click(); await shot("text"); await s.page.locator("#txtScrim [data-close]").click();
            await s.page.locator("#holEdit").click(); await shot("dates"); await s.page.locator("#brkScrim [data-close]").click();
            await s.page.locator("#settingsBtn").click(); await shot("settings"); await s.page.locator("#setScrim [data-close]").click();
          }
        }
        await close(s);
      }
      fs.writeFileSync(path.join(SHOT_DIR, "layout.json"), JSON.stringify(info, null, 1) + "\n");
      const scrolls = k => info[k].docScrollWidth > info[k].viewport || info[k].bodyScrollWidth > info[k].viewport;
      const sideways = (kind, w) => Object.keys(info).filter(k => k.startsWith(`${kind}-${w}-`)).filter(k => scrolls(k) || (info[k].sheetOverflow && info[k].sheetOverflow.split(",").some(x => { const [a, b] = x.split("/").map(Number); return a > b; })));
      for (const kind of ["family", "admin"]) {
        const bad = sideways(kind, 375);
        check("layout", `${kind} page at 375px: no sideways scroll (page in light and dark${kind === "admin" ? ", day, text, dates and settings sheets" : ", day sheet"})`, !bad.length,
          bad.flatMap(k => [`${k}: content is ${info[k].docScrollWidth}px wide in a ${info[k].viewport}px screen, sheet ${info[k].sheetOverflow || "n/a"}`, ...info[k].wide]));
        const badW = sideways(kind, 1280);
        check("layout", `${kind} page at 1280px: no sideways scroll`, !badW.length, badW.flatMap(k => [`${k}: content is ${info[k].docScrollWidth}px wide`, ...info[k].wide]));
      }
      check("layout", "at 375px every calendar badge (switched, half day, star) sits inside its day cell, family and admin, November 2026",
        !info["family-375-light"].badges.length && !info["admin-375-light"].badges.length, [...info["family-375-light"].badges.map(b => "family: " + b), ...info["admin-375-light"].badges.map(b => "admin: " + b)]);
      for (const width of [390, 430]) {   // common iPhone widths, for information
        const s = await open("family", `family ${width}px`, { mobile: true, width, fonts: true });
        await s.page.evaluate(async () => { await document.fonts.ready; });
        const l = await q(s.page, "layout", width);
        console.log(`INFO   family page at ${width}px: day cell ${l.dayCell}, badges past the cell edge: ${l.badges.length ? l.badges.join(" | ") : "none"}, sideways scroll: ${l.docScrollWidth > width ? "YES" : "no"}`);
        await close(s);
      }
      // The base .wrap rule (style.css): a centered column, 18px between sections. Admin is capped at 1040px, family at 560px.
      // A stray block used to make browsers drop this rule. Fixed in Phase 0, was a known bug.
      const wrapPairs = (w, max, vw) => [["max-width", w.maxWidth, `${max}px`], ["rendered width", w.width, Math.min(max, vw - 32)], ["left edge", w.left, (vw - Math.min(max, vw - 32)) / 2], ["right edge", w.right, (vw + Math.min(max, vw - 32)) / 2],
        ["left and right margins match", w.marginLeft, w.marginRight], ["display", w.display, "flex"], ["direction", w.flexDirection, "column"], ["row gap", w.rowGap, "18px"]];
      for (const mode of ["light", "dark"]) {
        expectAll("layout", `admin page at 1280px (${mode}): .wrap is 1040px wide, centered, a flex column with an 18px row gap`, wrapPairs(info[`admin-1280-${mode}`].wrap, 1040, 1280));
        expectAll("layout", `family page at 1280px (${mode}): .wrap is 560px wide, centered, a flex column with an 18px row gap`, wrapPairs(info[`family-1280-${mode}`].wrap, 560, 1280));
      }
      expectAll("layout", "at 375px .wrap fills the screen with 16px each side on both pages (343px wide), same flex column and gap", [...wrapPairs(info["admin-375-light"].wrap, 1040, 375).map(([l, a, e]) => ["admin " + l, a, e]), ...wrapPairs(info["family-375-light"].wrap, 560, 375).map(([l, a, e]) => ["family " + l, a, e])]);

      // The four small admin cards (.narrow): 343px wide at a 375px window and 420px at 1280px, centered, one at a time.
      // With .wrap a flex column again they would shrink to their content without "width: 100%" on .narrow.
      const CARDS = [
        ["signin", "vSignin", "Sign in", { fake: { signedIn: false } }],
        ["loading", "vLoading", "Loading", { fake: { hang: true }, wait: "vLoading" }],              // signed in, and the server never answers
        ["setup", "vSetup", "Almost there", { config: CONFIG_NOT_SET_UP }],                          // config.js not filled in
        ["not-admin", "vNotAdmin", "This account can't make changes", { fake: { role: null } }],     // signed in with an email that cannot edit
      ];
      const cards = {};
      for (const mobile of [true, false]) for (const [name, id, , o] of CARDS) {
        const w = mobile ? 375 : 1280;
        const s = await open("admin", `admin card ${name} at ${w}px`, { ...o, mobile, fonts: true });
        await s.page.evaluate(async () => { await document.fonts.ready; });
        cards[`${name}-${w}`] = await q(s.page, "card", id);
        await s.page.screenshot({ path: path.join(SHOT_DIR, `admin-${w}-card-${name}.png`) });
        await close(s);
      }
      {
        const s = await open("admin", "admin card signin at 375px, dark", { fake: { signedIn: false }, mobile: true, dark: true, fonts: true });
        await s.page.evaluate(async () => { await document.fonts.ready; });
        cards["signin-375-dark"] = await q(s.page, "card", "vSignin");
        await s.page.screenshot({ path: path.join(SHOT_DIR, "admin-375-card-signin-dark.png") });
        await close(s);
      }
      fs.writeFileSync(path.join(SHOT_DIR, "layout.json"), JSON.stringify({ ...info, cards }, null, 1) + "\n");
      for (const [w, want] of [[375, 343], [1280, 420]]) {
        expectAll("layout", `admin small cards at ${w}px: sign-in, loading, setup and not-admin are each ${want}px wide, centered, shown alone, with no sideways scroll`, CARDS.flatMap(([name, id, title]) => { const c = cards[`${name}-${w}`]; return [
          [`${name}: width`, c.width, want], [`${name}: left edge`, c.left, (w - want) / 2], [`${name}: right edge`, c.right, (w + want) / 2], [`${name}: only card showing`, c.shown, [id]],
          [`${name}: page width`, c.docScrollWidth, w], [`${name}: card starts with`, c.text.startsWith(title), true]]; }));
      }
      expectAll("layout", "sign-in card at 375px in dark mode is the same size and place as in light mode", [["width", cards["signin-375-dark"].width, 343], ["left edge", cards["signin-375-dark"].left, 16], ["top", cards["signin-375-dark"].top, cards["signin-375"].top]]);
      console.log(`INFO   small admin cards: the card starts ${Math.round(cards["signin-375"].top - cards["signin-375"].headerBottom)}px below the page header at 375px and ${Math.round(cards["signin-1280"].top - cards["signin-1280"].headerBottom)}px at 1280px (40px card margin plus the 18px .wrap gap)`);
      const fontsOk = Object.values(info).every(i => i.fonts.figtree && i.fonts.bricolage);
      console.log(`INFO   screenshots saved to tests/output/${SHOTS}/ (${fs.readdirSync(SHOT_DIR).filter(f => f.endsWith(".png")).length} images). Web fonts ${fontsOk ? "loaded" : "NOT loaded (offline or blocked), fallback fonts used"}.`);
      console.log(`INFO   phone day cell size: family ${info["family-375-light"].dayCell}, admin ${info["admin-375-light"].dayCell}. Tap targets under 44px (family): ${info["family-375-light"].smallTargets.join("; ") || "none"}`);
      console.log(`INFO   tap targets under 44px (admin): ${info["admin-375-light"].smallTargets.join("; ") || "none"}`);
    }

    // ---- Activities (slice 1A): family, admin and the Activities page. In tests/acts.mjs ----
    await activityChecks({ open, close, q, check, expectAll, setGolden, settle, takeCalls, ready, captureMonth, clickDay, gotoMonth, byDate, holderOf, makeOracle,
      familyResponse, P, BASE_DB, clone, origin: () => ORIGIN, toNum, toStr, wd, fmtUTC, span, SHOT_DIR, PNOTE_MARK, TEST_CONFIG, UA_MAC, UA_IPHONE, T19, sessions });

    // ---- Console errors and stray network requests, across every page opened above ----
    for (const kind of ["family", "admin", "activities"]) {
      const mine = sessions.filter(s => s.kind === kind);
      const fontNoise = e => /fonts\.(googleapis|gstatic)\.com/.test(e);
      // Only the one expected refusal of the stand-in file is set aside, and only on the admin page. It is counted in its own check below.
      const sriNoise = e => SRI[kind] && sriRefusal(e);
      const errs = mine.filter(s => !s.expectErrors).flatMap(s => s.errors.filter(e => !fontNoise(e) && !sriNoise(e)).map(e => `${s.label}: ${e}`));
      check("console", `${kind} page: no console errors (${mine.filter(s => !s.expectErrors).length} page loads)`, !errs.length, errs);
      const expected = mine.filter(s => s.expectErrors).map(s => `${s.label}: ${s.errors.length} error(s)`);
      if (expected.length) console.log(`         (failed-request scenarios log errors on purpose: ${expected.join("; ")})`);
      const stray = mine.flatMap(s => s.unexpected.map(u => `${s.label}: ${u}`));
      check("console", `${kind} page: no network requests other than the site's own files, fonts${kind !== "family" ? ", supabase-js" : ""} and the mocked data call`, !stray.length, stray);
    }

    // ---- The admin tests really ran on the test fake ----
    {
      const admins = sessions.filter(s => s.kind !== "family");
      const bad = admins.flatMap(s => { const refusals = s.errors.filter(sriRefusal).length, out = [];
        if (!s.fake || !s.fake.isFake || !s.fake.hasState) out.push("window.supabase was not the test fake");
        if (s.fake && s.label.indexOf("card setup") === -1 && (!s.fake.client || s.fake.client.url !== "https://kt-mock.invalid" || !s.fake.client.hasKey)) out.push(`the page did not create its client on the fake with the test address (${JSON.stringify(s.fake.client)})`);
        if (s.cdn.length !== (s.loads || 1) || s.cdn.some(u => u !== SB_PINNED)) out.push(`asked jsDelivr for: ${s.cdn.join(", ") || "nothing"} (${s.loads || 1} page load(s))`);
        const want = (SRI[s.kind] ? 1 : 0) * (s.loads || 1);   // one refusal per page load (sign out reloads the page)
        if (refusals !== want) out.push(`Chrome refused the stand-in file ${refusals} time(s), expected ${want}`);
        return out.map(x => `${s.label}: ${x}`); });
      check("harness", `all ${admins.length} admin and Activities page sessions ran on the test fake (never the real library, never a blocked one), each load asked for the pinned file once, and Chrome refused the stand-in once per load because of the integrity hash`, admins.length >= 25 && !bad.length, bad);
    }

    finishGoldens();
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  // ---- Summary ----
  const by = st => results.filter(r => r.status === st);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), update: UPDATE, results }, null, 1) + "\n");
  console.log("\n" + "=".repeat(78));
  const given = by("XFAIL").filter(r => KNOWN_BUGS[r.bug].given).length;
  console.log(`${by("PASS").length} passed, ${by("FAIL").length} failed, ${given} known bugs still failing (expected), ${by("XFAIL").length - given} new QA findings still failing, ${by("XPASS").length} known bugs now passing`);
  const showX = (title, list) => { if (!list.length) return; console.log("\n" + title); list.forEach(r => { console.log(`  XFAIL  [${r.group}] ${r.name}`); console.log(`         ${KNOWN_BUGS[r.bug].note}`); r.detail.forEach(l => console.log(`         ${l}`)); }); };
  showX("KNOWN BUGS, expected to fail today (not counted as failures):", by("XFAIL").filter(r => KNOWN_BUGS[r.bug].given));
  showX("NEW FINDINGS from QA, tracked as known bugs until someone decides (not counted as failures):", by("XFAIL").filter(r => !KNOWN_BUGS[r.bug].given));
  if (by("XPASS").length) { console.log("\nKNOWN BUGS THAT NOW PASS (remove them from KNOWN_BUGS in tests/run.mjs, then npm run baseline):"); by("XPASS").forEach(r => console.log(`  XPASS  [${r.group}] ${r.name}`)); }
  if (by("FAIL").length) { console.log("\nREAL FAILURES:"); by("FAIL").forEach(r => console.log(`  FAIL   [${r.group}] ${r.name}`)); }
  const bad = by("FAIL").length + by("XPASS").length;
  console.log(`\n${bad ? "RESULT: NOT GREEN" : "RESULT: GREEN" + (by("XFAIL").length ? " except the known bugs listed above" : "")}`);
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error("\nThe harness itself crashed (this is a test tooling problem, not a site result):\n", e); process.exit(3); });
