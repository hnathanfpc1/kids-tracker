/* Kids Tracker test harness: "one address for Brett", the signed-in home on index.html with no k= in the link. Test tooling only, never shipped.
   Run through run.mjs ("npm test"). Everything is made up: kids Ava and Max, example.test addresses, +1555555 numbers, the TESTTOKEN stand-in.
   The home runs as kind "home" in run.mjs: the page is index.html, supabase-js is the test fake. The lazy-loaded script tag sets its integrity
   attribute from JavaScript, so the harness records the value the page set and does not apply it (STRIP_SRI in run.mjs); the fake could not pass the real hash.
   Token path (kind "family") is the family link and must stay exactly as it was: no supabase-js, no editor.js, no sign-in card. */
import fs from "node:fs";
import path from "node:path";
import { dbActs } from "./acts.mjs";

const E = n => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T_ACT = { day: "2026-12-01", instant: "2026-12-01T12:00:00-05:00" };
const FORBIDDEN = ["settings", "breaks", "swaps", "swap_details", "share_links", "app_users", "contacts"];
const T_NEW2 = "2026-11-18T21:30:00+00:00";
const clone = x => JSON.parse(JSON.stringify(x));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Short list of differences between two captures (path: a | b), so a mismatch says where.
function delta(a, b, p = "", out = []) {
  if (out.length >= 8) return out;
  const isObj = x => x !== null && typeof x === "object";
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) { if (!eq(a, b)) out.push(`${p || "(root)"}: family ${JSON.stringify(a)} | home ${JSON.stringify(b)}`); return out; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) delta(a[k], b[k], p ? `${p}.${k}` : k, out);
  return out;
}

// ---- Fixture for the family link's reach. Today is Tue 2026-12-01 (T_ACT), so the dates shown are Nov 24 (7 back) to Jan 30 (60 ahead). Everything made up. ----
const KA = "a0000000-0000-4000-8000-000000000001", KM = "a0000000-0000-4000-8000-000000000002";
const TIN = "c0000000-0000-4000-8000-0000000000a1", TOUT = "c0000000-0000-4000-8000-0000000000a2";
const PIN = "b0000000-0000-4000-8000-0000000000a1", POUT = "b0000000-0000-4000-8000-0000000000a2", PTEAM = "b0000000-0000-4000-8000-0000000000a3";
export const CUT_E = { early: E(41), back7: E(42), ahead60: E(43), ahead61: E(44), far: E(45) };
export function dbCut(base) {
  const d = dbActs(base);
  const ev = (id, day, kid, o = {}) => ({ id, day, kid_ids: [kid], team_id: null, kind: "other", title: "Cutfix " + day, start_time: "17:00:00", end_time: null, place_id: null, place_text: null, arrive_by: null, gear: null, note: null, status: "on", ...o });
  d.kids = [{ id: KA, name: "Ava", color: "orange", sort: 1, active: true }, { id: KM, name: "Max", color: "berry", sort: 2, active: false }];
  d.places = [{ id: PIN, name: "Inplace Field", address: null, drive_me: 10, drive_co: 10, drive_grandma: null, note: null }, { id: POUT, name: "Outplace Gym", address: null, drive_me: 10, drive_co: 10, drive_grandma: null, note: null },
    { id: PTEAM, name: "Outteam Pool", address: null, drive_me: 10, drive_co: 10, drive_grandma: null, note: null }];
  d.teams = [{ id: TIN, name: "Inteam", kid_ids: [KA], place_id: PIN, early_practice: 0, early_game: 0, gear: [], note: null, ical_url: null, active: true },
    { id: TOUT, name: "Outteam", kid_ids: [KM], place_id: PTEAM, early_practice: 0, early_game: 0, gear: [], note: null, ical_url: null, active: true }];
  d.events = [ev(CUT_E.early, "2026-11-23", KM, { team_id: TOUT, place_id: POUT, title: null, kind: "practice" }), ev(CUT_E.back7, "2026-11-24", KA, { team_id: TIN, place_id: PIN, title: null, kind: "practice" }),
    ev(CUT_E.ahead60, "2027-01-30", KA), ev(CUT_E.ahead61, "2027-01-31", KM), ev(CUT_E.far, "2027-06-15", KM, { team_id: TOUT, title: null, kind: "game" })];
  d.event_comments = [
    { id: "d0000000-0000-4000-8000-0000000000a1", event_id: CUT_E.early, at: "2026-11-30T10:00:00+00:00", author: "co", body: "CUTCOMMENT on a cut day", tagged: ["grandma"], share_family: true },
    { id: "d0000000-0000-4000-8000-0000000000a2", event_id: CUT_E.back7, at: "2026-11-30T11:00:00+00:00", author: "co", body: "INCOMMENT on a shown day", tagged: ["grandma"], share_family: true }];
  const lg = (n, at, o) => ({ id: `f0000000-0000-4000-8000-0000000000${n}`, at, who: "me", action: "added", event_id: null, team_id: null, summary: "LOG" + n, before: null, after: null, batch_id: `90000000-0000-4000-8000-0000000000${n}`, ...o });
  d.event_log = [
    lg(11, "2026-10-20T12:00:00+00:00", { event_id: CUT_E.back7, summary: "LOGOLD shown activity but older than 30 days", after: { day: "2026-11-24", source: "hand" } }),
    lg(12, "2026-11-25T12:00:00+00:00", { event_id: CUT_E.early, summary: "LOGCUTEVENT activity outside the dates", after: { day: "2026-11-23", source: "hand" } }),
    lg(13, "2026-11-26T12:00:00+00:00", { event_id: E(99), action: "removed", summary: "LOGREMOVED activity that no longer exists", before: { day: "2026-12-08", source: "hand" } }),
    lg(14, "2026-11-27T12:00:00+00:00", { team_id: TIN, summary: "LOGTEAMIN team with an activity in the dates", after: { name: "Inteam" } }),
    lg(15, "2026-11-28T12:00:00+00:00", { team_id: TOUT, summary: "LOGTEAMOUT team with nothing in the dates", after: { name: "Outteam" } }),
    lg(16, "2026-11-29T12:00:00+00:00", { event_id: CUT_E.ahead60, summary: "LOGINEVENT activity on the last day shown", after: { day: "2027-01-30", source: "hand" } }),
    lg(17, "2026-11-30T12:00:00+00:00", { summary: "LOGNOTHING no activity and no team" })];
  d.settings[0].changed_at = "2026-11-30T23:30:00+00:00";
  return d;
}

export async function homeChecks(h) {
  const { open, close, check, expectAll, settle, takeCalls, ready, captureMonth, captureFamily, truthChecks, dbScheduleOnly, familyResponse, q, BASE_DB, ROOT, T19, SB_PINNED, SB_SHA384, PNOTE_MARK, byDate, holderOf } = h;
  const DBA = dbActs(BASE_DB);
  const SHOTS = path.join(ROOT, "private", "preview-home");
  fs.mkdirSync(SHOTS, { recursive: true });
  const G = "home";
  const a = (s, fn, ...args) => s.page.evaluate(([f, x]) => window.__kta[f](...x), [fn, args]);
  const until = (s, fn, arg) => s.page.waitForFunction(fn, arg, { timeout: 8000 });
  const rail = calls => [...new Set(calls.map(c => c.rpc ? "rpc:" + c.rpc : c.table ? `${c.table}.${c.op}` : c.auth ? "auth:" + c.auth : "?"))].sort();
  const errs = s => s.errors.filter(e => !/integrity/.test(e));
  const homeOpts = (o = {}) => ({ at: T_ACT, ...o, fake: { db: clone(DBA), role: "parent", ...(o.fake || {}) } });
  const baseOpts = (o = {}) => ({ at: T19, ...o, fake: { db: clone(BASE_DB), role: "parent", ...(o.fake || {}) } });
  // What is on screen on the home: which card, the message, which buttons show.
  const state = s => s.page.evaluate(() => {
    const vis = el => !!el && !el.hidden && el.getClientRects().length > 0, $ = id => document.getElementById(id), norm = t => (t || "").replace(/\s+/g, " ").trim();
    return { signin: vis($("vSignin")), content: vis($("famContent")), msgShown: vis($("famMsg")), msg: vis($("famMsg")) ? norm($("famMsgText").textContent) : "",
      msgBtns: vis($("famMsg")) ? [...$("famMsgBtns").querySelectorAll("button")].filter(vis).map(b => norm(b.textContent)) : [],
      homeBtns: vis($("homeBtns")) ? [...$("homeBtns").children].filter(vis).flatMap(b => b.tagName === "NAV" ? [...b.children].map(a => `${norm(a.textContent)}${a.getAttribute("aria-current") === "page" ? " (current)" : " -> " + a.getAttribute("href")}`) : [`${norm(b.textContent)}${b.getAttribute("href") ? " -> " + b.getAttribute("href") : ""}`]) : [],
      gridCells: $("fGrid") ? $("fGrid").querySelectorAll(".day").length : 0, headClass: $("famHead").className, url: location.pathname + location.hash };
  });
  const pwIn = async (s, pw = "correct-test-password") => { await s.page.locator("#email").fill("brett@example.test"); await s.page.locator("#password").fill(pw); await s.page.locator("#pwSignIn").click(); };
  const waitContent = s => until(s, () => !document.getElementById("famContent").hidden);
  const shot = (s, name, clip) => s.page.screenshot({ path: path.join(SHOTS, name), clip }).catch(() => {});
  const r = {};

  // ---- 1. The family link path is unchanged: no supabase-js, no editor.js, no sign-in card ----
  {
    const s = await open("family", "home: token path", { at: T19 }), p = s.page;
    const d = await p.evaluate(() => ({ sb: !!window.supabase, editor: !!window.KTEditor, scripts: [...document.scripts].map(x => x.src.replace(location.origin, "")).filter(x => /supabase|editor/.test(x)),
      inert: document.getElementById("sbSrc") ? document.getElementById("sbSrc").type : null, vis: id => 0 }));
    const st = await state(s);
    check(G, "family link (k=TOKEN): zero requests to the supabase-js CDN or editor.js, no supabase or KTEditor object, no executable supabase script tag", !s.cdn.length && !s.reqs.some(x => /editor\.js/.test(x)) && !d.sb && !d.editor && !d.scripts.length,
      [`cdn: ${s.cdn.join(", ") || "none"}`, `same-origin requests: ${s.reqs.join(", ")}`, JSON.stringify({ ...d, vis: undefined })]);
    expectAll(G, "family link: shows the schedule, no sign-in card, no Activities or Sign out buttons, header is not in home mode, one get_schedule call with the token", [
      ["content", st.content, true], ["signin card", st.signin, false], ["buttons", st.homeBtns, []], ["head class", st.headClass, "fam-head"], ["family calls", s.famCalls.map(c => c.body && c.body.p_token), ["TESTTOKEN"]], ["errors", errs(s), []]]);
    // Same capture the family goldens cover, kept for the comparison with the home below.
    r.famBase = (await captureFamily(s)).out;
    await close(s);
  }
  {
    const s = await open("family", "home: bad token", { hash: "#k=OLDTOKEN", at: T19 });
    const st = await state(s);
    expectAll(G, "family link with a turned-off token: today's message, no sign-in card, no Sign out or Try again, still no CDN or editor.js request", [
      ["msg", st.msg, "This link isn't active anymore. Ask Heather for the new one."], ["signin", st.signin, false], ["buttons", st.msgBtns, []], ["content", st.content, false],
      ["cdn", s.cdn, []], ["editor.js", s.reqs.filter(x => /editor\.js/.test(x)), []]]);
    await close(s);
  }

  // ---- 2. No token, signed out ----
  {
    const s = await open("home", "home: signed out", homeOpts({ fake: { signedIn: false } })), p = s.page;
    const st = await state(s), calls = await takeCalls(s);
    const card = await p.evaluate(() => document.getElementById("vSignin").innerText.replace(/\s+/g, " "));
    expectAll(G, "no k=, signed out: sign-in card shown, schedule hidden and not drawn, the 'Have a family link?' line is there, no schedule data requested", [
      ["signin", st.signin, true], ["content", st.content, false], ["msg shown", st.msgShown, false], ["calendar cells drawn", st.gridCells, 0], ["head class", st.headClass, "fam-head home"],
      ["family-link line", /Have a family link\? Open that link instead\. It needs no sign-in\./.test(card), true], ["calls", rail(calls), []], ["get_schedule calls", s.famCalls.length, 0], ["errors", errs(s), []]]);
    // wrong password, then the right one
    await pwIn(s, "wrong"); await settle(s); await p.waitForTimeout(40);
    const wrong = await p.evaluate(() => document.getElementById("signinMsg").textContent);
    await pwIn(s); await waitContent(s); await settle(s);
    const after = await state(s), c2 = await takeCalls(s);
    expectAll(G, "signed out then wrong password then the right one: plain message, then the family view, reading only my_role and get_editor_schedule after sign-in", [
      ["wrong", wrong, "That email and password didn't match. Check them and try again."], ["content", after.content, true], ["signin", after.signin, false],
      ["calls", rail(c2), ["auth:signInWithPassword", "rpc:get_editor_schedule", "rpc:my_role"]]]);
    await close(s);
  }

  // ---- 3. Parent signed in: the view, the buttons, exactly which calls, nothing private ----
  {
    const s = await open("home", "home: parent signed in", baseOpts()), p = s.page;
    const st = await state(s);
    expectAll(G, "parent signed in: lands on the family view with the Schedule | Activities switch (Schedule current, Activities -> activities.html) and Sign out in the header, no sign-in card, no message", [
      ["content", st.content, true], ["signin", st.signin, false], ["msg", st.msgShown, false], ["buttons", st.homeBtns, ["Schedule (current)", "Activities -> activities.html", "Sign out"]], ["head class", st.headClass, "fam-head home"], ["errors", errs(s), []]]);
    // Month by month and every holiday day sheet, same capture as the family link
    const cap = await captureFamily(s, { privacyMarks: [PNOTE_MARK, ...BASE_DB.share_links.map(l => l.token), "#k=", "k=TESTTOKEN"] });
    r.homeBase = cap.out;
    const calls = await takeCalls(s), allRail = rail(s.allCalls);
    check(G, "parent session: the complete list of calls is my_role and get_editor_schedule, no table read at all (none of settings, breaks, swaps, swap_details, share_links, app_users, contacts), no get_schedule", eq(allRail, ["rpc:get_editor_schedule", "rpc:my_role"]) && !s.allCalls.some(c => c.table) && !s.famCalls.length, [...allRail, `family calls ${s.famCalls.length}`]);
    check(G, "parent home page: no private note, track_from, totals, percentages, night counts or family link token anywhere in the page or day sheets", !cap.privacy.length, cap.privacy);
    const delt = delta(r.famBase, r.homeBase);
    check(G, "same fixture and clock: the home's Right now card, coming up, legend, every calendar month Oct 2026 to Jul 2027, this month lists and 29 day sheets match the family link exactly", !delt.length, delt);
    await close(s);
  }
  // Leaky editor payload: pnote, track_from and totals added, and unshared comments in the data
  {
    const s = await open("home", "home: leaky editor payload", homeOpts({ fake: { leaky: true, db: (() => { const d = clone(DBA); d.swap_details.forEach(w => { if (w.pnote == null) w.pnote = PNOTE_MARK + "x"; }); return d; })() } })), p = s.page;
    const marks = ["UNSHARED-ONE", "UNSHARED-TWO", "PRIVATE-", "LEAK", "track_from", "pnote", "54.9", "2026-10-07"], hits = [];
    const scan = async where => { const t = await p.evaluate(() => document.body.innerText + document.documentElement.outerHTML); marks.filter(m => t.includes(m)).forEach(m => hits.push(`${where}: "${m}"`)); };
    await scan("first view");
    await p.locator('[data-act="month"]').click(); await scan("Next 30 days");
    for (const iso of ["2026-12-05", "2026-12-22"]) { await h.clickDay(s, iso); await scan(`day sheet ${iso}`); await p.locator("#famDayScrim [data-close]").click(); }
    await p.evaluate(([id]) => { location.hash = "#x"; location.hash = "#e=" + id; }, [E(10)]); await p.waitForTimeout(100); await scan("activity E10 day (has unshared comments)");
    check(G, "home ignores pnote, track_from, totals and unshared comments (UNSHARED-ONE and TWO) even if the editor payload were to carry them, in the first view, Next 30 days and day sheets", !hits.length, hits);
    await close(s);
  }
  // Truths on the home (no switches), plus the Right now card
  {
    const db = dbScheduleOnly();
    const s = await open("home", "home: schedule only", { at: T19, fake: { db, role: "parent" } });
    const now = await q(s.page, "famNow");
    const months = {}; for (const ym of ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07"]) months[ym] = await captureMonth(s, ym);
    const leap = { "2028-02": await captureMonth(s, "2028-02"), "2028-03": await captureMonth(s, "2028-03") };
    truthChecks("home", months, db, { leap });
    const cells = byDate(months), who = d => holderOf(cells.get(d));
    expectAll("truths home", "signed-in home: 2026-10-02 Heather's, 2026-11-09 Brett's, Thanksgiving Nov 20 to 29 Heather's, Christmas Dec 18 to 25 Brett's, Dec 26 Heather's", [
      ["Oct 2", who("2026-10-02"), "me"], ["Nov 9", who("2026-11-09"), "co"], ["Nov 20", who("2026-11-20"), "me"], ["Nov 29", who("2026-11-29"), "me"],
      ["Dec 18", who("2026-12-18"), "co"], ["Dec 25", who("2026-12-25"), "co"], ["Dec 26", who("2026-12-26"), "me"]]);
    expectAll("truths home", "Right now on the home, Thu Nov 19, 2026 with no switches: Heather through Thu Dec 3, Brett picks up Fri Dec 4 after school", [
      ["card color", now.cls, "me now"], ["who", now.lines[1], "With Heather"], ["through and next", now.lines[2], "Through Thursday, Dec 3. Brett picks up Friday, Dec 4 after school."]]);
    await close(s);
  }
  // Activities: same fixture and clock on both, Right now and Dec 2026 and the panel
  {
    const fam = await open("family", "home: family acts", { at: T_ACT, respond: () => ({ json: familyResponse(DBA, { at: T_ACT.instant }) }) });
    const hom = await open("home", "home: home acts", homeOpts());
    const pick = async s => ({ now: await q(s.page, "famNow"), panel: await a(s, "panel", "f"), dec: await captureMonth(s, "2026-12"), marks: await a(s, "marks", "fGrid"), today: await a(s, "today"), legend: await a(s, "legend", "f"), recent: (await a(s, "recent")).rows });
    const fa = await pick(fam), ho = await pick(hom), famRecent = fa.recent, homeRecent = ho.recent; delete fa.recent; delete ho.recent;
    const d = delta(fa, ho);
    // Since 2026-11-22 the home is cut to the family link's reach (activities 7 days back to 60 ahead, 30 days of changes), so the whole Recent changes list should match too.
    const rd = delta(famRecent, homeRecent);
    for (const x of [fam, hom]) await x.page.locator('[data-log="kids"]').click();
    const kidsF = (await a(fam, "recent")).rows, kidsH = (await a(hom, "recent")).rows, missing = delta(kidsF, kidsH);
    check(G, "with activities (made-up Ava and Max): the home's Right now, Activities panel, Dec 2026 calendar with kid markers, Today line and legend match the family link", !d.length, d);
    check(G, "Recent changes, filtered to Where the kids are: the home lists exactly the same custody lines as the family link", !missing.length, missing);
    check(G, "Recent changes, All: the home lists the same lines as the family link now that it is cut to the same 30 days and dates (the family fixture has no removed activity outside its dates)", !rd.length && homeRecent.length > 0, [`home ${homeRecent.length} lines, family ${famRecent.length}`, ...rd]);
    await close(fam); await close(hom);
  }


  // ---- 3b. The home is cut to the family link's reach (activities 7 days back to 60 ahead, 30 days of changes) ----
  {
    const CD = dbCut(BASE_DB), iso = ["2026-11-23", "2026-11-24", "2027-01-30", "2027-01-31"];
    const SEEN = "localStorage.setItem('kt-seen','2026-11-01T00:00:00+00:00');";
    const fam = await open("family", "cut: family", { at: T_ACT, respond: () => ({ json: familyResponse(CD, { at: T_ACT.instant }) }), init: SEEN });
    const hom = await open("home", "cut: home", { at: T_ACT, init: SEEN, fake: { db: clone(CD), role: "parent" } });
    const days = async s => { const out = {}; for (const d of iso) { await h.clickDay(s, d); await s.page.waitForTimeout(40); const x = await a(s, "dayActs"); out[d] = x.events.map(e => e.id.slice(-2)); await s.page.locator("#famDayScrim [data-close]").click(); } return out; };
    const markOf = async (s, ym, day) => { await h.gotoMonth(s, ym); return (await a(s, "marks", "fGrid")).filter(c => !c.out && c.aria && c.aria.startsWith(day)).map(c => c.dots); };
    const pick = async s => ({ days: await days(s), nov: await markOf(s, "2026-11", "Monday, November 23"), nov24: await markOf(s, "2026-11", "Tuesday, November 24"), jan30: await markOf(s, "2027-01", "Saturday, January 30"), jan31: await markOf(s, "2027-01", "Sunday, January 31"),
      jun: await markOf(s, "2027-06", "Tuesday, June 15"), legend: await a(s, "legend", "f") });
    const f = await pick(fam), o = await pick(hom);
    expectAll("home cut", "home with activities at today-8, today-7, today+60, today+61 and far out: only the two inside ones show in the day detail, the calendar has kid markers on those two days only, no marker on a cut day", [
      ["day detail, Nov 23 / Nov 24 / Jan 30 / Jan 31", o.days, { "2026-11-23": [], "2026-11-24": ["42"], "2027-01-30": ["43"], "2027-01-31": [] }],
      ["marker Nov 23 (cut)", o.nov, [[]]], ["marker Nov 24", o.nov24.length === 1 && o.nov24[0] && o.nov24[0].length, 1], ["marker Jan 30", o.jan30.length === 1 && o.jan30[0] && o.jan30[0].length, 1],
      ["marker Jan 31 (cut)", o.jan31, [[]]], ["marker Jun 15 2027 (far)", o.jun, [[]]]]);
    check("home cut", "the home's day detail, calendar markers and legend for those days match the family link for the same fixture (the inactive kid with nothing in the dates is not in the legend on either)", !delta(f, o).length && !/Max/.test(o.legend), delta(f, o).concat(o.legend));
    // What the page holds: the cut itself, run in the page on the full editor payload
    const cut = await hom.page.evaluate(([db, now]) => { const full = window.KTTestPayload.editor(db, now), c = window.KTActs.familyCut(full, window.KTCore.toNum("2026-12-01")), id = x => x.map(y => y.id.slice(-2)).sort();
      return { win: c.window, events: id(c.events), teams: id(c.teams), places: id(c.places), kids: c.kids.map(k => k.name), comments: id(c.comments), log: c.log.map(x => x.summary.split(" ")[0]).sort(), all: [...c.all].map(x => x.slice(-2)).sort(), fullLog: full.log.length, fullEvents: full.events.length, keys: Object.keys(c).sort() }; },
      [CD, Date.parse(T_ACT.instant)]);
    expectAll("home cut", "familyCut on the full editor payload: window is 2026-11-24 to 2027-01-30, events are the two inside ones, only the team and the places those use stay (Outteam, Outplace and Outteam's pool are gone), the inactive kid is gone, all five ids are remembered, nothing else is dropped from the other keys", [
      ["window", cut.win, { from: "2026-11-24", to: "2027-01-30" }], ["full payload had", [cut.fullEvents, cut.fullLog], [5, 7]], ["events", cut.events, ["42", "43"]], ["teams", cut.teams, ["a1"]], ["places", cut.places, ["a1"]],
      ["kids", cut.kids, ["Ava"]], ["comments", cut.comments, ["a2"]], ["all ids", cut.all, ["41", "42", "43", "44", "45"]], ["keys", cut.keys.filter(k => ["settings", "breaks", "swaps", "changed_at"].includes(k)), ["breaks", "changed_at", "settings", "swaps"]]]);
    expectAll("home cut", "change log on the home: older than 30 days dropped, a line for an activity outside the dates dropped, a removed activity's line kept, a line whose team has an activity in the dates kept, a team with nothing in the dates dropped, a line for an activity on the last day shown kept, a line with no activity and no team dropped",
      [["lines kept", cut.log, ["LOGINEVENT", "LOGREMOVED", "LOGTEAMIN"]]]);
    const rec = async s => (await a(s, "recent")).rows.map(r => r.text);
    const recH = await rec(hom), recF = await rec(fam), has = (rows, t) => rows.some(x => x.includes(t));
    expectAll("home cut", "Recent changes on the home: LOGREMOVED, LOGTEAMIN and LOGINEVENT show; LOGOLD, LOGCUTEVENT, LOGTEAMOUT and LOGNOTHING do not; the list matches the family link's",
      [["shown", ["LOGREMOVED", "LOGTEAMIN", "LOGINEVENT"].map(t => has(recH, t)), [true, true, true]], ["hidden", ["LOGOLD", "LOGCUTEVENT", "LOGTEAMOUT", "LOGNOTHING"].map(t => has(recH, t)), [false, false, false, false]], ["same as family", delta(recF, recH), []]]);
    // Updated since you last looked: a comment on a cut activity and log lines for cut things stay out
    const nb = async s => { await s.page.locator('[data-act="month"]').click(); return a(s, "newBox"); };
    const nbH = await nb(hom), txt = nbH.items.join(" | ");
    expectAll("home cut", "\"Updated since you last looked\" on the home (kt-seen set to Nov 1): the shown activity's comment and the kept log lines are in, the cut activity's comment and cut log lines are not, and the box matches the family link's", [
      ["box shown", nbH.shown, true], ["in", ["INCOMMENT", "LOGREMOVED", "LOGTEAMIN", "LOGINEVENT"].map(t => txt.includes(t)), [true, true, true, true]],
      ["out", ["CUTCOMMENT", "LOGOLD", "LOGCUTEVENT", "LOGTEAMOUT", "LOGNOTHING"].map(t => txt.includes(t)), [false, false, false, false, false]], ["same as family", delta((await nb(fam)).items, nbH.items), []]]);
    // Nothing from a cut team, place or kid anywhere on the page, in the markup or on any day sheet opened above
    const page = await hom.page.evaluate(() => document.documentElement.outerHTML + document.body.innerText);
    check("home cut", "no name from a cut team, place, activity or the inactive kid appears anywhere in the home's page (Outteam, Outplace, Outteam's pool, Cutfix 2026-11-23, Cutfix 2027-01-31, Max)", !["Outteam", "Outplace", "Outteam Pool", "Cutfix 2026-11-23", "Cutfix 2027-01-31", "CUTCOMMENT"].some(t => page.includes(t)) && !/\bMax\b/.test(await hom.page.evaluate(() => document.getElementById("famContent").innerText)), "found one");
    await takeCalls(hom);
    const calls = rail(hom.allCalls), noArgs = hom.allCalls.filter(c => c.rpc === "get_editor_schedule").every(c => !c.args || !Object.keys(c.args).length), edAll = hom.allCalls.filter(c => c.rpc === "get_editor_schedule").length;
    check("home cut", "the home still calls only my_role and get_editor_schedule, with no arguments (the cut happens on the phone, no date is sent to the database), no table, no get_schedule", eq(calls, ["rpc:get_editor_schedule", "rpc:my_role"]) && noArgs && edAll >= 1 && !hom.famCalls.length && !errs(hom).length, [...calls, `args ${JSON.stringify(hom.allCalls.filter(c => c.rpc === "get_editor_schedule").map(c => c.args))}`, ...errs(hom)]);
    await close(fam); await close(hom);
    // Deep links: an id the cut removed gets the new message, an unknown id keeps the old one, an id inside the dates opens
    const dl = {};
    for (const [k, id] of [["cut", CUT_E.early], ["far", CUT_E.far], ["unknown", E(77)], ["inside", CUT_E.ahead60]]) {
      const s = await open("home", "cut deep link " + k, { at: T_ACT, hash: "#e=" + id, fake: { db: clone(CD), role: "parent" } }); await s.page.waitForTimeout(120);
      dl[k] = { toast: await a(s, "toast"), sheet: (await a(s, "dayActs")).shown, content: (await state(s)).content }; await close(s);
    }
    const OUT = "That activity is outside the dates shown here. Open Activities to see it.", GONE = "That activity isn't on the schedule anymore.";
    expectAll("home cut", "home deep link #e=<id>: an activity cut by the dates (just before the window, and far out) says it is outside the dates and to open Activities; an id never read keeps the old message; one inside the dates opens its day; the schedule still shows each time", [
      ["cut (today-8)", dl.cut, { toast: OUT, sheet: false, content: true }], ["far out", dl.far, { toast: OUT, sheet: false, content: true }], ["unknown", dl.unknown, { toast: GONE, sheet: false, content: true }], ["inside (today+60)", [dl.inside.toast, dl.inside.sheet], [null, true]]]);
  }

  // ---- 4. Roles and failures ----
  {
    const s = await open("home", "home: admin redirect", baseOpts({ fake: { role: "admin" }, noReady: true, everyLoad: `addEventListener("pagehide",function(){try{if(window.__KT_FAKE__)sessionStorage.setItem("kt-prev-calls",JSON.stringify(window.__KT_FAKE__.calls))}catch(e){}});` }));
    await s.page.waitForURL(/admin\.html$/, { timeout: 8000 });
    await s.page.waitForFunction(() => window.__KT_FAKE__ && window.__KT_FAKE__.pending === 0 && !document.getElementById("vApp").hidden, null, { timeout: 8000 });
    s.fake = await s.page.evaluate(() => ({ isFake: !!(window.supabase && window.supabase.__ktFake), hasState: !!window.__KT_FAKE__, client: (window.__KT_FAKE__ && window.__KT_FAKE__.created) || null }));
    s.sriWant = 1;   // admin.html's own tag carries the integrity hash, so the stand-in is refused once there
    const prev = await s.page.evaluate(() => JSON.parse(sessionStorage.getItem("kt-prev-calls") || "[]"));
    expectAll(G, "admin signed in at the home: sent to admin.html, the admin view loads, and the home itself asked only my_role (no schedule read)", [
      ["url", new URL(s.page.url()).pathname.replace(/^\//, ""), "admin.html"], ["calls on the home page", rail(prev), ["rpc:my_role"]]]);
    await close(s);
  }
  {
    const s = await open("home", "home: no role", baseOpts({ fake: { role: null } })), p = s.page;
    const st = await state(s), calls = rail(await takeCalls(s));
    expectAll(G, "no role: the can't-make-changes message with Sign out only, no schedule, no Try again, only my_role asked", [
      ["msg", /^This account can't make changes\./.test(st.msg), true], ["buttons", st.msgBtns, ["Sign out"]], ["content", st.content, false], ["header buttons", st.homeBtns, []], ["cells", st.gridCells, 0], ["calls", calls, ["rpc:my_role"]], ["errors", errs(s), []]]);
    await close(s);
  }
  {
    const s = await open("home", "home: failed schedule", baseOpts({ fake: { failNext: [{ rpc: "get_editor_schedule", error: { code: "500", message: "mock failure" } }] } })), p = s.page;
    const st = await state(s);
    expectAll(G, "get_editor_schedule fails: message with Try again and Sign out, no schedule, no blank page", [
      ["msg", st.msg, "Couldn't load the schedule. Check your connection and try again."], ["buttons", st.msgBtns, ["Try again", "Sign out"]], ["content", st.content, false], ["header buttons", st.homeBtns, []]]);
    await takeCalls(s); await p.locator("#famRetry").click(); await waitContent(s); await settle(s);
    const st2 = await state(s), c = rail(await takeCalls(s));
    expectAll(G, "Try again works when the next call succeeds: schedule and header buttons show, retry message gone, calls are my_role then get_editor_schedule only", [
      ["content", st2.content, true], ["msg", st2.msgShown, false], ["buttons", st2.homeBtns, ["Schedule (current)", "Activities -> activities.html", "Sign out"]], ["calls", c, ["rpc:get_editor_schedule", "rpc:my_role"]], ["errors", errs(s), []]]);
    await close(s);
  }
  {
    // my_role itself fails (a network or auth error), and Try again fixes it
    const s = await open("home", "home: failed role check", baseOpts({ expectErrors: true, fake: { failNext: [{ rpc: "my_role", error: { code: "401", message: "JWT expired" } }] } })), p = s.page;
    const st = await state(s);
    await p.locator("#famRetry").click(); await waitContent(s);
    const st2 = await state(s);
    expectAll(G, "my_role fails with an auth error (session expired): retry message with Try again and Sign out, never blank, and Try again then loads the schedule", [
      ["msg", st.msg, "Couldn't load the schedule. Check your connection and try again."], ["buttons", st.msgBtns, ["Try again", "Sign out"]], ["after retry", st2.content, true]]);
    await close(s);
  }
  {
    // A session that expires mid-visit: the next refresh gets an auth error
    const s = await open("home", "home: expires mid visit", baseOpts()), p = s.page;
    await p.evaluate(() => { window.__KT_FAKE__.failNext.push({ rpc: "get_editor_schedule", error: { code: "PGRST301", message: "JWT expired" } }); });
    await s.ctx.clock.setFixedTime(new Date("2026-11-19T12:30:00-05:00"));
    await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await settle(s); await p.waitForTimeout(80);
    const st = await state(s);
    check(G, "session expires mid-visit (refresh gets an auth error): the page is not blank (the last schedule stays, or a message shows)", st.content || st.msgShown || st.signin, JSON.stringify({ content: st.content, msg: st.msg, signin: st.signin }));
    const upd = await p.evaluate(() => document.getElementById("updated").textContent);
    check(G, "session expires mid-visit: the last schedule stays and the page says it could not refresh, with the last updated time", st.content && /^Couldn't refresh\. Last updated \d/.test(upd), JSON.stringify({ content: st.content, upd }));
    await close(s);
  }

  // ---- 5. Sign out ----
  {
    const s = await open("home", "home: sign out", baseOpts()), p = s.page;
    await Promise.all([p.waitForEvent("load"), p.locator("#signOut").click()]);
    await ready(s);
    const st = await state(s), stored = await p.evaluate(() => localStorage.getItem("kt-fake-auth"));
    expectAll(G, "Sign out from the home: back to the sign-in card, schedule and header buttons gone, no calendar drawn, signed-out flag stored", [
      ["signin", st.signin, true], ["content", st.content, false], ["header buttons", st.homeBtns, []], ["cells", st.gridCells, 0], ["stored", stored, "out"]]);
    await close(s);
    const s2 = await open("home", "home: sign out from message", baseOpts({ fake: { role: null } }));
    await Promise.all([s2.page.waitForEvent("load"), s2.page.locator("#signOut2").click()]); await ready(s2);
    const st2 = await state(s2);
    check(G, "Sign out on the no-role message also returns to the sign-in card", st2.signin && !st2.content && !st2.msgShown, JSON.stringify(st2));
    await close(s2);
  }

  // ---- 6. Deep links ----
  const sheetOf = s => a(s, "dayActs");
  {
    const s = await open("home", "home: #e= signed out", homeOpts({ hash: `#e=${E(7)}`, fake: { signedIn: false } }));
    const st0 = await state(s);
    await pwIn(s); await waitContent(s); await settle(s); await s.page.waitForTimeout(100);
    const d = await sheetOf(s);
    expectAll(G, "#e=<id> with no k=, signed out: sign-in card first, then after sign-in that activity's day opens with the activity highlighted", [
      ["card first", st0.signin, true], ["sheet", d.shown, true], ["focus", d.focus, [E(7)]], ["day", /December 5/.test(d.title), true]]);
    await close(s);
    const s1 = await open("home", "home: #e= signed in", homeOpts({ hash: `#e=${E(7)}` }));
    await s1.page.waitForTimeout(100);
    const d1 = await sheetOf(s1);
    check(G, "#e=<id> with no k=, already signed in: opens that activity's day straight away", d1.shown && eq(d1.focus, [E(7)]), JSON.stringify({ shown: d1.shown, focus: d1.focus }));
    await close(s1);
  }
  for (const [label, offset, want] of [["fresh (1 minute old)", 60000, true], ["stale (2 hours old)", 2 * 3600000, false]]) {
    const s = await open("home", `home: kt-open ${label}`, homeOpts({ fake: { signedIn: false } }));
    await s.page.evaluate(([id, off]) => localStorage.setItem("kt-open", id + "|" + (Date.now() - off)), [E(7), offset]);
    await pwIn(s); await waitContent(s); await settle(s); await s.page.waitForTimeout(100);
    const d = await sheetOf(s), left = await s.page.evaluate(() => localStorage.getItem("kt-open"));
    expectAll(G, `kt-open ${label}, no #e= in the link: ${want ? "opens that activity's day" : "does not open anything"}, and the remembered value is removed`, [["opens", d.shown, want], ["removed", left, null]]);
    await close(s);
  }
  {
    const s = await open("home", "home: kt-open junk and hash wins", homeOpts({ hash: `#e=${E(11)}`, fake: { signedIn: false } }));
    await s.page.evaluate(id => localStorage.setItem("kt-open", id + "|" + Date.now()), E(7));
    await pwIn(s); await waitContent(s); await settle(s); await s.page.waitForTimeout(100);
    const d = await sheetOf(s), left = await s.page.evaluate(() => localStorage.getItem("kt-open"));
    expectAll(G, "both #e= in the link and a fresh kt-open: the link wins, and kt-open is still removed", [["focus", d.focus, [E(11)]], ["removed", left, null]]);
    await close(s);
    const j = await open("home", "home: kt-open garbage", homeOpts({ fake: { signedIn: false } }));
    await j.page.evaluate(() => localStorage.setItem("kt-open", "<script>|NaN"));
    await pwIn(j); await waitContent(j); await settle(j);
    const left2 = await j.page.evaluate(() => localStorage.getItem("kt-open")), st = await state(j);
    check(G, "a garbage kt-open value does not crash or open anything, and is removed", st.content && left2 === null && !errs(j).length && !(await sheetOf(j)).shown, JSON.stringify({ left2, errs: errs(j) }));
    await close(j);
  }
  {
    const s = await open("home", "home: #e= unknown id", homeOpts({ hash: "#e=e0000000-0000-4000-8000-999999999999" })), p = s.page;
    await p.waitForTimeout(150);
    const toast = await a(s, "toast"), d = await sheetOf(s), st = await state(s);
    expectAll(G, "#e=<id> for an activity not in the payload: no crash, the schedule shows, a plain 'isn't on the schedule anymore' toast, no sheet, no console error", [
      ["content", st.content, true], ["toast", toast, "That activity isn't on the schedule anymore."], ["sheet", d.shown, false], ["errors", errs(s), []]]);
    await close(s);
    const s2 = await open("home", "home: #e= too short", homeOpts({ hash: "#e=abc" }));
    const st2 = await state(s2);
    check(G, "#e= with a malformed id is ignored: the schedule shows, no sheet, no error", st2.content && !(await sheetOf(s2)).shown && !errs(s2).length, JSON.stringify(st2));
    await close(s2);
  }
  {
    // A link token appearing in the address starts over in family mode
    const s = await open("home", "home: hash gains a token", baseOpts()), p = s.page;
    await Promise.all([p.waitForEvent("load"), p.evaluate(() => { location.hash = "#k=TESTTOKEN"; })]);
    await p.waitForFunction(() => !document.getElementById("famContent").hidden, null, { timeout: 8000 });
    const st = await state(s);
    check(G, "changing the address from the home to #k=TOKEN restarts in family-link mode: family view, one get_schedule call, no header buttons", st.content && eq(st.homeBtns, []) && s.famCalls.length === 1, JSON.stringify({ st, fam: s.famCalls.length }));
    s.cdnWant = 1;
    await close(s);
  }

  // ---- 7. What's new and the Activities panel preference on the home, against the family link ----
  {
    const bump = `(function(){var d=window.__KT_FAKE__.db;d.settings[0].changed_at="${T_NEW2}";["2026-12-12","2026-12-13"].forEach(function(day){d.swaps.push({day:day,had:"co",caregiver:null,updated_at:"${T_NEW2}"});d.swap_details.push({day:day,reason:"travel",note:"Heather at a conference",pnote:null});});})();`;
    const famDb = clone(BASE_DB); famDb.settings[0].changed_at = T_NEW2;
    ["2026-12-12", "2026-12-13"].forEach(day => { famDb.swaps.push({ day, had: "co", caregiver: null, updated_at: T_NEW2 }); famDb.swap_details.push({ day, reason: "travel", note: "Heather at a conference", pnote: null }); });
    const fam = await open("family", "home: whats new family", { at: T19 });
    const hom = await open("home", "home: whats new home", baseOpts());
    const snap = async s => ({ ...(await q(s.page, "famNew")), up: (await q(s.page, "famUp")).filter(x => (x.chips || []).some(c => c.startsWith("chip new"))) });
    const f1 = await snap(fam), h1 = await snap(hom);
    fam.respond = () => ({ json: familyResponse(famDb) });
    await hom.ctx.addInitScript({ content: bump });
    await fam.page.reload(); await ready(fam); await hom.page.reload(); await ready(hom);
    const f2 = await snap(fam), h2 = await snap(hom);
    await fam.page.locator("#gotIt").click(); await hom.page.locator("#gotIt").click();
    const f3 = await snap(fam), h3 = await snap(hom);
    expectAll(G, "what's new on the home: first visit shows nothing new and remembers changed_at; a later change shows the box, the New dots and chips; Got it clears them and stores the new value", [
      ["first visit", [h1.shown, h1.dots, h1.newChips, h1.seen], [false, 0, 0, BASE_DB.settings[0].changed_at]],
      ["later change", [h2.shown, h2.up.length > 0, h2.items.length > 0], [true, true, true]], ["after Got it", [h3.shown, h3.dots, h3.newChips, h3.seen], [false, 0, 0, T_NEW2]]]);
    const d1 = delta([f1, f2, f3], [h1, h2, h3]);
    check(G, "what's new box, dots, chips and the list of changes are identical on the home and the family link at all three steps", !d1.length, d1);
    await close(fam); await close(hom);
    // kt-acts
    const fa = await open("family", "home: kt-acts family", { at: T_ACT, respond: () => ({ json: familyResponse(DBA, { at: T_ACT.instant }) }) });
    const ho = await open("home", "home: kt-acts home", homeOpts());
    const d0 = [(await a(fa, "panel", "f")).pressed, (await a(ho, "panel", "f")).pressed];
    await fa.page.locator('[data-act="off"]').click(); await ho.page.locator('[data-act="off"]').click();
    await fa.page.reload(); await ready(fa); await ho.page.reload(); await ready(ho);
    const offF = await a(fa, "panel", "f"), offH = await a(ho, "panel", "f");
    const keyF = await fa.page.evaluate(() => localStorage.getItem("kt-acts")), keyH = await ho.page.evaluate(() => localStorage.getItem("kt-acts"));
    expectAll(G, "Activities panel preference on the home matches the family link: default This week, Off is remembered in kt-acts after a reload and hides the panel body", [
      ["default", d0, [["week"], ["week"]]], ["stored", [keyF, keyH], ["off", "off"]], ["off pressed", offH.pressed, offF.pressed], ["off body", [offH.shown, offH.days.length], [offF.shown, offF.days.length]], ["off line", offH.offShown, offF.offShown]]);
    await close(fa); await close(ho);
  }

  // ---- 8. activities.html Back button ----
  for (const [role, want] of [["parent", "switch"], ["admin", "admin.html"]]) {
    const s = await open("activities", `home: activities back as ${role}`, { at: T_ACT, fake: { db: clone(DBA), role } });
    const b = await s.page.evaluate(() => { const e = document.getElementById("backBtn"), n = document.getElementById("pageSwitch"), vis = x => !x.hidden && x.getClientRects().length > 0;
      return { shown: vis(e), href: e.getAttribute("href"), sw: vis(n) ? [...n.children].map(a => `${a.textContent.trim()} ${a.getAttribute("aria-current") === "page" ? "(current)" : "-> " + a.getAttribute("href")}`) : null, signOutQuiet: document.getElementById("signOut").classList.contains("quiet") }; });
    if (role === "parent") expectAll(G, "activities.html as parent: Back to schedule is hidden; the Schedule | Activities switch shows Activities current and Schedule linking to ./; Sign out is quiet", [["back shown", b.shown, false], ["switch", b.sw, ["Schedule -> ./", "Activities (current)"]], ["sign out quiet", b.signOutQuiet, true]]);
    else expectAll(G, "activities.html as admin (unchanged): Back to schedule is shown and goes to admin.html, no page switch, Sign out not quiet", [["shown", b.shown, true], ["href", b.href, want], ["switch", b.sw, null], ["sign out quiet", b.signOutQuiet, false]]);
    await close(s);
  }

  // ---- 9. The lazy-loaded script tag carries the same URL, integrity and crossorigin as the other two pages ----
  {
    const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
    const attr = (t, n) => (t.match(new RegExp(`\\s${n}="([^"]*)"`)) || [])[1];
    const tag = f => (read(f).match(/<script[^>]+supabase[^>]*integrity=[^>]*>/) || [""])[0];
    const idxV = (read("index.html").match(/app\.js\?v=(\w+)/) || [])[1];
    const s = await open("home", "home: lazy script tag", homeOpts({ fake: { signedIn: false } }));
    const live = await s.page.evaluate(() => ({ sri: window.__ktSri.map(x => [x.el.src, x.integrity, x.el.crossOrigin])   /* the address is read from the tag now: the page sets integrity before src */, tags: [...document.querySelectorAll("script[src*=supabase]")].map(x => ({ src: x.getAttribute("src"), cross: x.getAttribute("crossorigin") })),
      editor: [...document.scripts].map(x => x.getAttribute("src")).filter(x => /editor\.js/.test(x || "")) }));
    const want = { src: attr(tag("admin.html"), "src"), integrity: attr(tag("admin.html"), "integrity"), cross: attr(tag("admin.html"), "crossorigin") };
    const act = { src: attr(tag("activities.html"), "src"), integrity: attr(tag("activities.html"), "integrity"), cross: attr(tag("activities.html"), "crossorigin") };
    expectAll(G, "the script tag the home adds at run time carries the same src, integrity and crossorigin as admin.html and activities.html (so a version bump cannot drift), loaded once, with editor.js at the same ?v= as app.js", [
      ["admin = activities", want, act], ["pinned", want, { src: SB_PINNED, integrity: SB_SHA384, cross: "anonymous" }],
      ["integrity the page set", live.sri, [[want.src, want.integrity, want.cross]]], ["tag in DOM", live.tags, [{ src: want.src, cross: want.cross }]],
      ["editor.js", live.editor, [`editor.js?v=${idxV}`]]]);
    await close(s);
  }

  // ---- 10. 375px, light and dark, signed out and signed in; tap targets and contrast ----
  const contrast = s => s.page.evaluate(() => {
    const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
    const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c.length === 3 || c[3] > 0.95)) return c; } return [255, 255, 255]; };
    const out = [];
    document.querySelectorAll("#vSignin h2, #vSignin .msg, #vSignin .hint, #vSignin label, #pwSignIn, #sendCode, #homeBtns a, #homeBtns button, #famMsgText, #famRetry, #famMsgBtns .btn, #famHead h1, #famNow").forEach(el => {
      if (!el.getClientRects().length) return;
      const fg = rgb(getComputedStyle(el).color), bg = bgOf(el), l1 = lum(fg), l2 = lum(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      out.push({ el: el.id || el.className || el.tagName, ratio: Math.round(ratio * 10) / 10 });
    });
    return out;
  });
  const targets = s => s.page.evaluate(() => [...document.querySelectorAll("#vSignin button, #homeBtns .btn, #famMsgBtns .btn")].filter(e => e.getClientRects().length).map(e => { const b = e.getBoundingClientRect(); return `${(e.id || e.textContent).slice(0, 14)} ${Math.round(b.width)}x${Math.round(b.height)}`; }));
  for (const dark of [false, true]) for (const mode of ["signed out", "signed in", "no role message", "retry message"]) {
    const o = { mobile: true, dark, fake: mode === "signed out" ? { signedIn: false } : mode === "no role message" ? { role: null } : mode === "retry message" ? { failNext: [{ rpc: "get_editor_schedule", error: { code: "500", message: "mock failure" } }] } : {} };
    const s = await open("home", `home: 375 ${dark ? "dark" : "light"} ${mode}`, homeOpts(o)), p = s.page;
    const w = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    const bottom = await p.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); return document.documentElement.scrollWidth; });
    const cut = await p.evaluate(() => [...document.querySelectorAll("#famHead *, #vSignin *, #famMsg *")].filter(e => e.getClientRects().length).filter(e => { const b = e.getBoundingClientRect(); return b.right > window.innerWidth + 0.5 || b.left < -0.5; }).map(e => e.id || e.className || e.tagName));
    const tg = await targets(s), small = tg.filter(t => Number(t.split(" ").pop().split("x")[1]) < 36), con = await contrast(s), low = con.filter(c => c.ratio < 4.5);
    await shot(s, `home-375-${dark ? "dark" : "light"}-${mode.replace(/ /g, "-")}.png`, { x: 0, y: 0, width: 375, height: 520 });
    console.log(`INFO   home 375 ${dark ? "dark" : "light"} ${mode}: targets ${tg.join("; ")}; lowest contrast ${con.length ? Math.min(...con.map(c => c.ratio)) : "n/a"}`);
    if (mode === "signed out") {
      const pw = await p.evaluate(() => { const e = document.getElementById("email").getBoundingClientRect(), w = document.getElementById("password").getBoundingClientRect(), c = getComputedStyle(document.getElementById("password")), ce = getComputedStyle(document.getElementById("email"));
        return { emailH: Math.round(e.height), pwH: Math.round(w.height), radius: [ce.borderTopLeftRadius, c.borderTopLeftRadius] }; });
      if (!dark) check(G, "sign-in card: the Password box matches the Email box (same height and rounded corners) and is a usable tap target", pw.pwH === pw.emailH && pw.radius[0] === pw.radius[1], JSON.stringify(pw));
    }
    expectAll(G, `home at 375px ${dark ? "dark" : "light"}, ${mode}: no sideways scroll (top and bottom), nothing past the screen edge, buttons 36px or taller (the site-wide button height is 38), text contrast at least 4.5:1, no console error`, [
      ["scrollWidth", w.doc <= w.win, true], ["bottom", bottom <= w.win, true], ["cut off", cut, []], ["small targets", small, []], ["low contrast", low, []], ["errors", errs(s), []]]);
    await close(s);
  }
  for (const dark of [false, true]) {   // desktop width too
    const s = await open("home", `home: desktop ${dark ? "dark" : "light"}`, homeOpts({ dark })), p = s.page;
    const w = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth })), con = await contrast(s);
    expectAll(G, `home at desktop width ${dark ? "dark" : "light"}, signed in: no sideways scroll, text contrast at least 4.5:1`, [["scroll", w.doc <= w.win, true], ["low contrast", con.filter(c => c.ratio < 4.5), []]]);
    await close(s);
  }
}
