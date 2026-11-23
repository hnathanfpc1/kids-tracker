/* Kids Tracker test harness: activities (Phase 1, slice 1A). Test tooling only, never shipped with the site.
   Run through run.mjs ("npm test"). Uses tests/fixtures/acts.json on top of tests/fixtures/db.json. Everything in it is made up.

   Main test day: Tue Dec 1, 2026, noon Eastern. Who has the kids around it (db.json rotation, holidays and switches):
     Heather Nov 27 to Dec 3 | Brett Fri Dec 4 (regular Friday handoff, after school) | Heather Sat Dec 5 (switch)
     Brett Dec 6 to 10 | Heather Fri Dec 11 to 17 | Christmas first part Brett Fri Dec 18 to Dec 25, except Grandma Dec 22 and 23 (switches)
     Christmas second part Heather Dec 26 (2 p.m.) to Jan 4 | Brett Jan 5 to 7 | Heather Jan 8 to 14 | Someone else Fri Jan 15 (switch) | Brett Jan 16 to 21

   Teams: Soccer (Ava; Rec Center Field 3; 10 min early for practice, 30 for games; cleats, shin guards, water bottle)
          Basketball (Ava and Max; Eastside Gym; 15 early for practice, 20 for games; basketball shoes, jersey, water bottle)
   Places, drive minutes from Heather's / Brett's / Grandma's: Rec Center 15 / 25 / 20, Eastside Gym 10 / 20 / none,
          Studio B 10 / none / none, West Pool none / none / none. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "acts.json"), "utf8"));
const KID = { ava: "a0000000-0000-4000-8000-000000000001", max: "a0000000-0000-4000-8000-000000000002" };
const TEAM = { soccer: "c0000000-0000-4000-8000-000000000001", bball: "c0000000-0000-4000-8000-000000000002" };
const PLACE = { rec: "b0000000-0000-4000-8000-000000000001", gym: "b0000000-0000-4000-8000-000000000002", unused: "b0000000-0000-4000-8000-000000000005" };
const E = n => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T_ACT = { day: "2026-12-01", instant: "2026-12-01T12:00:00-05:00" };   // Tuesday
const AT = d => `${d}T12:00:00-05:00`;
const PHONE_RE = /\+?\(?1?\)?[\s.()-]*\(?555\)?[\s.()-]*555[\s.()-]*01\d\d/;

// ---------------------------------------------------------------------------
// Helpers that run inside the page (read only)
// ---------------------------------------------------------------------------
function actsLib() {
  const norm = s => (s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
  const $ = id => document.getElementById(id);
  const shown = el => !!(el && el.getClientRects().length);
  const cls = el => [...el.classList].sort().join(" ");
  // Text with a space at every element edge, then no space before punctuation. innerText would run chips into the next word.
  const sp = el => { if (!el) return null; const c = el.cloneNode(true); c.querySelectorAll("*").forEach(x => { x.before(" "); x.after(" "); }); return norm(c.textContent).replace(/\s+([.,:;!?)])/g, "$1"); };
  const kc = el => [...el.classList].filter(c => /^c-/.test(c)).join(" ");
  const ev = el => { const nm = el.querySelector(".ev-name"), a = el.querySelector(".ev-where a"); return { id: el.dataset.ev, cls: cls(el), time: sp(el.querySelector(".ev-time")), title: sp(el.querySelector(".ev-title")),
    kids: [...el.querySelectorAll(".ev-title .kchip")].map(k => `${norm(k.textContent)} ${kc(k)}`), flags: [...el.querySelectorAll(".ev-title .chip")].map(c => norm(c.textContent)),
    where: sp(el.querySelector(".ev-where")), map: a ? { href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel") } : null,
    go: sp(el.querySelector(".ev-go")), gear: sp(el.querySelector(".ev-gear")), note: sp(el.querySelector(".ev-note")), comments: [...el.querySelectorAll(".ev-cmt")].map(sp),
    crossedOut: nm ? getComputedStyle(nm).textDecorationLine.includes("line-through") : null }; };
  const chipOf = c => (c ? `${cls(c)} | ${norm(c.textContent)}` : null);
  const day = el => { const h = el.querySelector(".handoff"); return { date: sp(el.querySelector(".aday-head .dt")), chip: chipOf(el.querySelector(".aday-head .chip")),
    handoff: h ? { cls: cls(h), head: sp(h.querySelector("p")), chip: chipOf(h.querySelector("p .chip")), packTitle: sp(h.querySelector(".pack-title")),
      pack: [...h.querySelectorAll(".pack li")].map(li => ({ text: sp(li), dots: [...li.querySelectorAll(".kdot")].map(kc) })) } : null,
    none: sp(el.querySelector(".none")), events: [...el.querySelectorAll(".ev")].map(ev) }; };
  window.__kta = {
    order: () => [...$("famContent").querySelectorAll("section")].filter(e => shown(e)).map(e => [e.getBoundingClientRect().top, e.id || e.getAttribute("aria-labelledby") || e.className]).sort((x, y) => x[0] - y[0]).map(x => x[1]),
    panel(p) { const box = $(p + "Acts"); return { shown: shown(box), pressed: [...box.querySelectorAll("[data-act]")].filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.dataset.act),
      offShown: shown($(p + "ActOff")), filters: sp(box.querySelector(".filters")), days: [...box.querySelectorAll(".aday")].map(day), editButtons: box.querySelectorAll("button:not([data-act]), input, textarea, select").length }; },
    marks: grid => [...$(grid).querySelectorAll(".day")].map(d => ({ aria: d.getAttribute("aria-label"), out: d.classList.contains("out"), dots: d.querySelector(".dots") ? [...d.querySelectorAll(".dots .kbdg")].map(b => `${norm(b.textContent)} ${kc(b)}`) : null })),
    legend: p => sp($(p + "Legend")),
    today: () => { const t = document.querySelector("#famNow .today-act"); return t ? { text: sp(t), struck: [...t.querySelectorAll("s")].map(sp) } : null; },
    recent: () => ({ shown: shown($("fRecent")), segShown: shown($("fRecentSeg")), pressed: [...document.querySelectorAll("[data-log]")].filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.dataset.log),
      rows: [...document.querySelectorAll("#fLog > li")].map(li => ({ type: li.dataset.type || null, text: sp(li), chips: [...li.querySelectorAll(".chip")].map(chipOf) })), more: shown($("fLogMore")) }),
    dayActs: () => ({ shown: shown($("famDayScrim")), title: sp($("fdTitle")), body: [...$("fdBody").children].map(sp), chip: chipOf($("fdBody").querySelector(".chip")), actsShown: shown($("fdActs")),
      events: [...$("fdActs").querySelectorAll(".ev")].map(ev), focus: [...$("fdActs").querySelectorAll(".ev.focus")].map(e => e.dataset.ev) }),
    newBox: () => ({ shown: shown($("newBox")), items: shown($("newBox")) ? [...document.querySelectorAll("#newList > li")].map(sp) : [], newChips: [...document.querySelectorAll(".ev .chip.new")].map(c => c.closest(".ev").dataset.ev), seen: localStorage.getItem("kt-seen") }),
    // Activities page
    up: () => ({ count: norm($("upCount").textContent), filter: [...$("upFilter").querySelectorAll("button")].map(b => `${norm(b.textContent)}${b.getAttribute("aria-pressed") === "true" ? " [on]" : ""}`),
      rows: [...document.querySelectorAll("#upList .up-row")].map(r => { const ln = r.querySelectorAll(".ln"); return { id: r.dataset.ev, canceled: r.classList.contains("canceled"), when: sp(r.querySelector(".when")), what: sp(ln[0]), time: sp(ln[1]), who: sp(ln[2]), chip: chipOf(ln[2] && ln[2].querySelector(".chip")) }; }),
      more: shown($("upMore")), empty: sp(document.querySelector("#upList .empty")) }),
    sheet: () => ({ shown: shown($("evScrim")), title: norm($("evTitle").textContent), sub: norm($("evSub").textContent),
      kids: [...$("evKids").querySelectorAll("button")].map(b => `${norm(b.textContent)}${b.getAttribute("aria-pressed") === "true" ? " [on]" : ""}`),
      kind: [...$("evKind").querySelectorAll("button")].filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.dataset.kind).join(),
      team: $("evTeam").value, teamText: $("evTeam").selectedOptions[0] ? norm($("evTeam").selectedOptions[0].textContent) : null, name: $("evName").value, day: $("evDay").value, start: $("evStart").value, end: $("evEnd").value,
      repeatShown: shown($("evRepField")), place: $("evPlace").value, placeText: $("evPlace").selectedOptions[0] ? norm($("evPlace").selectedOptions[0].textContent) : null, newPlaceShown: shown($("evNewPlace")),
      arrive: $("evArrive").value, calc: [...$("evCalc").querySelectorAll("p")].map(sp), gear: [...$("evGear").querySelectorAll("span")].map(x => norm(x.firstChild.textContent)), gearHint: norm($("evGearHint").textContent),
      note: $("evNote").value, cancel: shown($("evCancel")) ? norm($("evCancel").textContent) : null, remove: shown($("evRemove")), confirm: shown($("evRmConfirm")), cmtShown: shown($("evCmtField")),
      comments: [...$("evCmts").querySelectorAll(".cmt")].map(c => ({ text: sp(c), del: c.querySelector("[data-delc]") ? norm(c.querySelector("[data-delc]").textContent) : null })),
      tags: [...$("cmtTags").querySelectorAll("label")].map(l => norm(l.textContent)) }),
    txt: () => ({ shown: shown($("txtScrim")), body: $("txtBody").value, href: $("txtGo").getAttribute("href"), note: sp($("txtTo").querySelector("p")),
      to: [...document.querySelectorAll("#txtTo label")].map(l => { const i = l.querySelector("input"); return `${norm(l.textContent)}${i.checked ? " [checked]" : ""}${i.disabled ? " [disabled]" : ""}`; }) }),
    lists: () => ({ teams: [...$("teamList").children].map(sp), places: [...$("placeList").children].map(sp), placeCount: norm($("placeCount").textContent), kids: [...$("kidList").children].map(sp),
      contactInputs: [...$("conBody").querySelectorAll("input")].map(i => `${i.id}=${i.value}`), contactRows: [...$("conBody").querySelectorAll("li")].map(sp), contactHint: sp($("conBody").querySelector(".hint")),
      contactSave: !!$("conSave"), log: [...$("actLog").children].map(sp), back: shown($("backBtn")), signOut: shown($("signOut")) }),
    toast: () => (shown($("toast")) ? norm($("toast").textContent) : null),
    heading: id => sp(document.querySelector(`#${id} h2`)),
    // Escaping: payloads that would run or add elements if any free text went into the page as HTML.
    xss: () => ({ fired: (window.__ktXss || []).slice(), marks: document.querySelectorAll(".xss-mark").length, imgs: document.querySelectorAll('img[src^="x-"]').length, text: document.body.innerText }),
    // Class names and attributes that only a broken-out holder value could create.
    badClass: tok => [...document.querySelectorAll("*")].filter(e => (e.getAttribute("class") || "").includes(tok) || e.hasAttribute("data-pwn")).map(e => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""} class="${e.getAttribute("class")}"${e.hasAttribute("data-pwn") ? " data-pwn" : ""}`).slice(0, 12),
    // Phone numbers anywhere: the page source, every form value and every link.
    phones: re => { const R = new RegExp(re), out = []; const html = document.documentElement.outerHTML; const m = html.match(R); if (m) out.push(`page HTML: "${m[0]}"`);
      document.querySelectorAll("input, textarea").forEach(i => { if (R.test(i.value)) out.push(`#${i.id} value "${i.value}"`); });
      document.querySelectorAll("a[href]").forEach(a => { if (R.test(decodeURIComponent(a.getAttribute("href")))) out.push(`link ${a.id || a.textContent}`); }); return out; },
  };
}
export const ACTS_LIB = `(${actsLib.toString()})();`;

// ---------------------------------------------------------------------------
// Static: the payload builder matches schema.sql key for key, and the family payload names no private column
// ---------------------------------------------------------------------------
export function actsStaticChecks({ check, eq, P, sql, base }) {
  const fn = (sql.match(/create or replace function public\.kt_activities[\s\S]*?\$\$([\s\S]*?)\$\$/) || [])[1] || "";
  const sections = ["kids", "places", "teams", "events", "comments", "log"];
  const sqlKeys = Object.fromEntries(sections.map(sec => {
    const m = fn.match(new RegExp(`'${sec}',\\s*\\(\\s*select coalesce\\(jsonb_agg\\(jsonb_build_object\\(([\\s\\S]*?)\\)\\s*order by`));
    return [sec, m ? [...m[1].matchAll(/'(\w+)',/g)].map(x => x[1]) : null];
  }));
  const db = dbActs(base);
  const built = P.editor(db, Date.parse(T_ACT.instant));
  const drift = sections.filter(sec => !eq(sqlKeys[sec], built[sec][0] ? Object.keys(built[sec][0]) : null)).map(sec => `${sec}: schema.sql names ${JSON.stringify(sqlKeys[sec])}, the test payload has ${JSON.stringify(built[sec][0] ? Object.keys(built[sec][0]) : null)}`);
  check("privacy", "the test payload for activities has exactly the keys kt_activities in schema.sql names, section by section (kids, places, teams, events, comments, log)", !!fn && !drift.length, drift.length ? drift : sections.map(s => `${s}: ${sqlKeys[s].join(", ")}`));
  const FORBIDDEN = ["ical_url", "phone", "lat", "lng", "before", "after", "source_uid", "pnote", "track_from", "email", "created_by", "label"];
  const named = Object.entries(sqlKeys).flatMap(([sec, ks]) => (ks || []).filter(k => FORBIDDEN.includes(k)).map(k => `${sec}.${k}`));
  const shareRule = /\(c\.share_family or not coalesce\(p_family, true\)\)/.test(fn) && /from public\.homes/.test(fn) === false && /from public\.contacts/.test(fn) === false;
  check("privacy", "schema.sql: kt_activities never names ical_url, phone, lat, lng, before, after, source_uid, pnote, track_from or email, reads neither homes nor contacts, and keeps unshared comments for editors only",
    !named.length && shareRule, named.length ? named : shareRule ? "" : "the share_family rule or the homes/contacts exclusion is not where it was");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const cl = x => JSON.parse(JSON.stringify(x));
export function dbActs(base) {
  const d = cl(base);
  d.settings[0].changed_at = FX.changed_at;
  ["kids", "homes", "places", "teams", "events", "event_comments", "contacts", "event_log"].forEach(t => { d[t] = cl(FX[t]); });
  d.events.forEach(e => { if (!e.created_at) e.created_at = "2026-11-25T15:00:00+00:00"; if (!e.created_by) e.created_by = "me"; if (!e.updated_at) e.updated_at = e.created_at; if (!e.updated_by) e.updated_by = e.created_by; if (!e.source) e.source = "hand"; });
  return d;
}
// HTML and script-like text for every free-text field. If any of it were put into a page as HTML, the image would
// fail to load and its onerror would record the field in window.__ktXss, and a .xss-mark element would exist.
const X = tag => `<b class="xss-mark">${tag}</b><img src="x-${tag}" onerror="(window.__ktXss=window.__ktXss||[]).push('${tag}')">"'&`;
function dbXss(base) {
  const d = dbActs(base), ev = n => d.events.find(e => e.id === E(n)), cm = n => d.event_comments.find(c => c.id === `d0000000-0000-4000-8000-00000000000${n}`);
  d.kids[0].name = "Ava" + X("KIDNAME");
  Object.assign(d.places[0], { name: X("PLACENAME"), address: X("ADDRESS"), note: X("PLACENOTE") });
  d.teams[0].name = X("TEAMNAME"); d.teams[0].gear = [X("TEAMGEAR"), "shin guards"]; d.teams[1].note = X("TEAMNOTE");
  ev(2).note = X("EVNOTE"); ev(3).title = X("EVTITLE"); ev(3).gear = [X("EVGEAR")]; ev(8).place_text = X("PLACETEXT");
  cm(1).body = X("COMMENT1"); cm(2).body = X("COMMENT2");
  d.contacts[0].label = X("CONLABEL");
  d.event_log.find(x => x.id.endsWith("0005")).summary = X("LOGSUMMARY");
  const sw = d.swaps.find(w => w.day === "2027-01-15"); sw.caregiver = X("CAREGIVER");
  d.swap_details.find(w => w.day === "2026-12-05").note = X("SWITCHNOTE");
  return d;
}

// ---------------------------------------------------------------------------
// Expected results, worked out by hand from the rules (the arithmetic is in the comments and the QA report)
// ---------------------------------------------------------------------------
// Arrive by = the override, else start minus the team's early minutes (games use early_game). No team and no override: none.
// Leave by = arrive by minus the drive minutes from the house of whoever has the kids that night. Someone else: none.
const GO = {
  [E(2)]: ["2026-12-01", "Arrive 5:20. Leave by 5:05 from Heather's."],    // Soccer practice 5:30 - 10 = 5:20; Rec Center 15 from Heather's = 5:05
  [E(3)]: ["2026-12-02", "Arrive 4:10. Leave by 4:00 from Heather's."],    // Piano, no team, arrive-by override 4:10; Studio B 10 from Heather's = 4:00
  [E(4)]: ["2026-12-02", "Arrive 5:45. Leave by 5:35 from Heather's."],    // Basketball practice 6:00 - 15 = 5:45; Eastside 10 = 5:35
  [E(5)]: ["2026-12-03", null],                                             // Swim club: no team, no override, so no arrive or leave
  [E(6)]: ["2026-12-04", "Arrive 5:30. Leave by 5:05 from Brett's."],      // handoff day, receiving parent Brett. Soccer GAME 6:00 - 30 = 5:30; 25 from Brett's = 5:05
  [E(7)]: ["2026-12-05", "Arrive 9:40. Leave by 9:30 from Heather's."],    // switch to Heather. Basketball game 10:00 - 20 = 9:40; Eastside 10 = 9:30
  [E(8)]: ["2026-12-06", null],                                             // party, typed-in place, no team
  [E(9)]: ["2026-12-07", null],                                             // canceled: no times shown
  [E(10)]: ["2026-12-09", "Arrive 5:20. Leave by 4:55 from Brett's."],     // 5:30 - 10 = 5:20; 25 from Brett's = 4:55
  [E(11)]: ["2026-12-11", "Arrive 5:45. Leave by 5:35 from Heather's."],   // handoff to Heather. 6:00 - 15 = 5:45; 10 = 5:35
  [E(12)]: ["2026-12-12", "Arrive 9:30. Leave by 9:15 from Heather's."],   // game 10:00 - 30 = 9:30; 15 = 9:15 (gear override, times from the team)
  [E(13)]: ["2026-12-14", null],                                            // canceled
  [E(14)]: ["2026-12-16", "Arrive 4:10. Leave by 4:00 from Heather's."],   // override 4:10; 10 = 4:00
  [E(15)]: ["2026-12-17", "Arrive 5:20. Leave by 5:05 from Heather's."],
  [E(16)]: ["2026-12-18", "Arrive 12:40. Leave by 12:20 from Brett's."],   // Christmas starts, Brett. game 1:00 - 20 = 12:40; 20 = 12:20
  [E(17)]: ["2026-12-19", "Arrive 9:15. Leave by 8:50 from Brett's."],     // holiday day. override 9:15 beats the team's 30 (9:30); 25 = 8:50
  [E(18)]: ["2026-12-20", "Arrive 2:45. Leave by 2:25 from Brett's."],     // practice 3:00 - 15 = 2:45; 20 = 2:25
  [E(19)]: ["2026-12-22", "Arrive 5:20. Leave by 5:00 from Grandma's."],   // Grandma night. 5:20 - 20 (drive_grandma) = 5:00
  [E(20)]: ["2026-12-23", "Arrive 5:45."],                                  // Grandma night, Eastside has no drive time from Grandma's: arrive only
  [E(21)]: ["2026-12-26", "Arrive 9:45."],                                  // handoff to Heather at 2 p.m. Override 9:45; West Pool has no drive times
  [E(22)]: ["2027-01-15", "Arrive 5:45."],                                  // someone else has the kids: arrive only, never a leave-by
  [E(24)]: ["2026-12-31", null],
};
// Pack lists at handoffs: gear for every activity that is not canceled from the handoff day to the day before the next handoff.
const PACKS = {
  "2026-12-04": { head: "⇄ Handoff to Brett after school", title: "Pack for Brett's night", pack: [["Ava: cleats, shin guards, water bottle", ["c-orange"]]] },
  "2026-12-05": { head: "⇄ Handoff to Heather", title: "Pack for Heather's night", pack: [["Both: basketball shoes, jerseys, knee pads", ["c-orange", "c-berry"]]] },
  "2026-12-06": { head: "⇄ Handoff to Brett", title: "Pack for Brett's 5 nights", pack: [["Ava: cleats, shin guards, water bottle", ["c-orange"]]] },
  "2026-12-11": { head: "⇄ Handoff to Heather after school", title: "Pack for Heather's week", pack: [["Ava: cleats, shin guards, game uniform, piano book, water bottle", ["c-orange"]], ["Both: basketball shoes, jersey, water bottle", ["c-orange", "c-berry"]]] },
  "2026-12-18": { head: "⇄ Handoff to Brett after school", title: "Pack for Brett's 4 nights", pack: [["Ava: cleats, shin guards, water bottle", ["c-orange"]], ["Both: basketball shoes, jerseys, water bottle", ["c-orange", "c-berry"]]] },
  "2026-12-22": { head: "⇄ Handoff to Grandma", title: "Pack for Grandma's 2 nights", pack: [["Ava: cleats, shin guards, water bottle", ["c-orange"]], ["Both: basketball shoes, jersey, water bottle", ["c-orange", "c-berry"]]] },
  "2026-12-26": { head: "⇄ Handoff to Heather at 2 p.m.", title: "Pack for Heather's week", pack: [["Max: skates, helmet", ["c-berry"]]] },
};
const NAME = { me: "Heather", co: "Brett", grandma: "Grandma" };
const holderClass = k => (["me", "co", "grandma"].includes(k) ? k : "other");

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------
export async function activityChecks(h) {
  const { open, close, q, check, expectAll, setGolden, settle, takeCalls, ready, captureMonth, gotoMonth, clickDay, byDate, makeOracle, familyResponse, P, BASE_DB, toNum, toStr, wd, fmtUTC, span, SHOT_DIR, TEST_CONFIG, UA_IPHONE } = h;
  const ORIGIN = h.origin();
  const DB = dbActs(BASE_DB), O = makeOracle(DB);
  const oName = iso => { const w = O.swap(iso); return w && w.had === "other" ? (w.caregiver || "Someone else") : NAME[O.holder(iso)]; };
  const oChip = iso => `chip ${holderClass(O.holder(iso))} | ${oName(iso)}`;
  const fam = (db, at) => body => ({ json: body && body.p_token === "TESTTOKEN" ? familyResponse(db, { at }) : null });
  const a = (s, fn, ...args) => s.page.evaluate(([f, x]) => window.__kta[f](...x), [fn, args]);
  const until = (s, fn, arg) => s.page.waitForFunction(fn, arg, { timeout: 8000 });
  const ok = (cond, lines) => [!!cond, lines];
  const evDays = new Map(DB.events.map(e => [e.id, e.day]));
  const win = (today, back, ahead) => [toStr(toNum(today) - back), toStr(toNum(today) + ahead)];
  // Kids with a non-canceled activity on a day, in kid order, as "A c-orange" (the calendar marker).
  const marksFor = (iso, db = DB, w = win("2026-12-01", 7, 60)) => db.kids.filter(k => db.events.some(e => e.day === iso && e.day >= w[0] && e.day <= w[1] && e.status !== "canceled" && e.kid_ids.includes(k.id)))
    .sort((x, y) => x.sort - y.sort).map(k => `${k.name[0]} c-${k.color}`);
  const golden = {};
  const FORBIDDEN_PARENT = ["settings", "breaks", "swaps", "swap_details", "share_links", "app_users"];
  const SERVER_SET = { events: ["created_by", "created_at", "updated_by", "updated_at"], event_comments: ["author", "at", "share_family"] };
  const serverSetHits = calls => calls.filter(c => c.payload && SERVER_SET[c.table]).flatMap(c => (Array.isArray(c.payload) ? c.payload : [c.payload]).flatMap(r => SERVER_SET[c.table].filter(k => k in r).map(k => `${c.table}.${c.op} sent ${k}`)));
  const famLink = id => `${ORIGIN}/#k=TESTTOKEN&e=${id}`, pageLink = id => `${ORIGIN}/activities.html#e=${id}`;
  const waitTxt = async s => { await until(s, () => !document.getElementById("txtScrim").hidden); await settle(s); };
  const closeTxt = s => s.page.locator("#txtScrim [data-close]").click();
  // Opens an activity the way a link does (activities.html#e=<id>). The hash is reset first so the same id can be opened twice.
  const openEv = async (s, id) => { await s.page.evaluate(x => { location.hash = "#x"; location.hash = "#e=" + x; }, id); await until(s, x => !document.getElementById("evScrim").hidden && document.getElementById("evTitle").textContent !== "", id); await settle(s); };

  // =========================================================================
  // 1. Family page on Tue Dec 1, 2026 with activities
  // =========================================================================
  {
    const s = await open("family", "family acts Dec 1", { at: T_ACT, respond: fam(DB, T_ACT.instant) });
    const g = golden.family = {};
    g.order = await a(s, "order");
    g.rightNow = await q(s.page, "famNow"); g.today = await a(s, "today");
    g.panelWeek = await a(s, "panel", "f");
    g.legend = await a(s, "legend", "f");
    await gotoMonth(s, "2026-12"); g.marksDec = await a(s, "marks", "fGrid");
    await gotoMonth(s, "2026-11"); g.marksNov = await a(s, "marks", "fGrid");
    g.recentAll = await a(s, "recent");
    await s.page.locator('[data-log="act"]').click(); g.recentAct = await a(s, "recent");
    await s.page.locator('[data-log="kids"]').click(); g.recentKids = await a(s, "recent");
    await s.page.locator('[data-log="all"]').click(); await s.page.locator("#fLogMore").click(); g.recentAllMore = await a(s, "recent");
    await s.page.locator('[data-act="month"]').click(); g.panelMonth = await a(s, "panel", "f");
    g.daySheets = {};
    for (const iso of ["2026-12-04", "2026-12-05", "2026-12-07", "2026-12-19", "2026-12-22", "2026-12-26", "2027-01-15"]) {
      await clickDay(s, iso); g.daySheets[iso] = await a(s, "dayActs"); await s.page.locator("#famDayScrim [data-close]").click();
    }
    g.privacy = await q(s.page, "privacy", ["UNSHARED-", "HOME-ADDR-MARK", "ICAL-SECRET-MARK", "UID-SECRET-MARK", "LOGDETAIL-MARK", "PRIVATE-"]);
    g.phones = await a(s, "phones", PHONE_RE.source);
    g.errors = s.errors.slice();
    await close(s);

    // Order of the page.
    expectAll("acts family", "family page visual order on a phone: Updated box (hidden today), Right now, Activities, Month, Coming up, Recent changes", [["sections shown, top to bottom", g.order, ["famNow", "fActs", "fMonth", "upT", "fRecent"]]]);
    // The a1d0fca crash: a kid, an activity and a handoff in range, and a switch updated in the last 30 days, must render without a console error.
    check("acts family", "with a kid, activities, handoffs in range and switches changed in the last 30 days, the family page renders the Activities panel and Recent changes with no console error",
      g.panelWeek.shown && g.panelWeek.days.length === 6 && g.panelWeek.days.some(d => d.handoff) && g.recentAll.shown && g.recentAll.rows.length > 0 && !g.errors.length,
      [`panel shown ${g.panelWeek.shown} with ${g.panelWeek.days.length} days, recent changes shown ${g.recentAll.shown} with ${g.recentAll.rows.length} rows`, ...g.errors]);
    expectAll("acts family", "Right now card on Tue Dec 1: Heather, plus one Today line for Ava's soccer practice with its leave-by time", [
      ["who", g.rightNow.lines[1], "With Heather"], ["today line", g.today && g.today.text, "Today: Ava Soccer practice 5:30 p.m. Leave by 5:05."]]);
    expectAll("acts family", "Activities panel defaults to This week and shows Tue Dec 1 to Sun Dec 6, every day, with who has the kids", [
      ["pressed", g.panelWeek.pressed, ["week"]], ["days", g.panelWeek.days.map(d => d.date), ["Tue, Dec 1 Today", "Wed, Dec 2", "Thu, Dec 3", "Fri, Dec 4 Handoff day", "Sat, Dec 5 Handoff day", "Sun, Dec 6 Handoff day"]],
      ["kid filter line", g.panelWeek.filters, "Showing Ava Max"], ["read only (no edit controls in the panel)", g.panelWeek.editButtons, 0]]);
    // Who has the kids, every day in Next 30 days and every day sheet, against the independent rules.
    const chipBad = [...g.panelMonth.days.map(d => { const iso = toStr(toNum("2026-12-01") + (Number(/Dec (\d+)/.exec(d.date)[1]) - 1)); return [iso, d.chip, oChip(iso)]; }),
      ...Object.entries(g.daySheets).map(([iso, d]) => [iso + " day sheet", d.chip, oChip(iso)])].filter(([, x, y]) => x !== y);
    check("acts family", "who-has-the-kids chip on every activity day (Next 30 days and the day sheets) matches the custody rules: Dec 4 handoff is Brett's, Dec 5 switch Heather's, Dec 19 holiday Brett's, Dec 22 Grandma, Dec 26 Heather, Jan 15 Someone else",
      !chipBad.length, chipBad.length ? chipBad.map(([d, x, y]) => `${d}: page "${x}", rules "${y}"`) : g.panelMonth.days.map(d => `${d.date}: ${d.chip}`));
    // Arrive and leave times, every event in Next 30 days plus Jan 15 from its day sheet.
    const evs = new Map([...g.panelMonth.days.flatMap(d => d.events), ...Object.values(g.daySheets).flatMap(d => d.events)].map(e => [e.id, e]));
    const goBad = Object.entries(GO).filter(([id, [, want]]) => !evs.has(id) || evs.get(id).go !== want).map(([id, [day, want]]) => `${day} ${id.slice(-2)}: expected ${JSON.stringify(want)}, page shows ${evs.has(id) ? JSON.stringify(evs.get(id).go) : "(not on the page)"}`);
    check("acts family", `arrive-by and leave-by for ${Object.keys(GO).length} activities match the hand arithmetic (team practice and game minutes, overrides, no team, Heather's, Brett's and Grandma's drive, someone else, missing drive times, canceled)`,
      !goBad.length, goBad.length ? goBad : Object.entries(GO).map(([id, [day, w]]) => `${day} ${id.slice(-2)}: ${w}`));
    // Details on single activities.
    const e2 = evs.get(E(2)), e3 = evs.get(E(3)), e7 = evs.get(E(7)), e8 = evs.get(E(8)), e9 = evs.get(E(9)), e12 = evs.get(E(12)), e15 = evs.get(E(15)), e5 = evs.get(E(5));
    expectAll("acts family", "each activity shows its kids, name, time, place with a map link for the address, gear (event override else team), note and shared comments; canceled ones are crossed out with no times or gear", [
      ["Dec 1 title", e2.title, "Ava Soccer practice"], ["Dec 1 time", e2.time, "5:30 p.m. to 6:30"], ["Dec 1 place (team default) and address", e2.where, "Rec Center Field 3 100 Example Park Rd, Faketown"],
      ["Dec 1 map link (Apple device)", e2.map, { href: "https://maps.apple.com/?q=100%20Example%20Park%20Rd%2C%20Faketown", target: "_blank", rel: "noopener noreferrer" }],
      ["Dec 1 team gear", e2.gear, "Bring: cleats, shin guards, water bottle"], ["Dec 2 piano: no team, its own gear", [e3.title, e3.where, e3.map, e3.gear], ["Ava Piano lesson", "Studio B", null, "Bring: piano book"]],
      ["Dec 3 swim: no team, no times", [e5.title, e5.go], ["Max Swim club", null]],
      ["Dec 5 both kids, gear override, shared comment tagging Angie", [e7.kids, e7.gear, e7.comments], [["Ava c-orange", "Max c-berry"], "Bring: basketball shoes, jerseys, knee pads", ["Brett @Angie Want to come watch? Tip-off is at 10."]]],
      ["Dec 5 two-color bar (classes sorted)", e7.cls, "b-berry c-orange ev kb"], ["Dec 6 typed-in place", e8.where, "Party barn on Example Rd"],
      ["Dec 7 canceled", [e9.flags, e9.go, e9.gear, e9.crossedOut], [["Canceled"], null, null, true]], ["Dec 12 gear override", e12.gear, "Bring: cleats, shin guards, game uniform"],
      ["Dec 17 note and comment", [e15.note, e15.comments], ["Note: Bring the red pinnie.", ["Heather @Brett @Angie The pinnie is in the car."]]]]);
    // Pack lists.
    const days = new Map(g.panelMonth.days.map(d => [toStr(toNum("2026-12-01") + (Number(/Dec (\d+)/.exec(d.date)[1]) - 1)), d]));
    const packBad = Object.entries(PACKS).flatMap(([iso, want]) => {
      const d = days.get(iso), ho = d && d.handoff;
      if (!ho) return [`${iso}: no handoff box on the page`];
      const got = { head: ho.head, title: ho.packTitle, pack: ho.pack.map(p => [p.text, p.dots]) };
      return JSON.stringify(got) === JSON.stringify(want) ? [] : [`${iso}: expected ${JSON.stringify(want)}`, `   page shows ${JSON.stringify(got)}`];
    });
    const extraHandoffs = [...days.entries()].filter(([iso, d]) => d.handoff && !PACKS[iso]).map(([iso]) => `${iso} has a handoff box the rules do not expect`);
    check("acts family", "handoff days are flagged and pack lists match the hand count: grouped per kid then Both, a handoff day with nothing to pack (Dec 24) is not listed, canceled activities left out, gear overrides used, jersey and jerseys counted once, one line per kid",
      !packBad.length && !extraHandoffs.length, [...packBad, ...extraHandoffs].length ? [...packBad, ...extraHandoffs] : Object.entries(PACKS).map(([iso, w]) => `${iso}: ${w.title || "(no gear)"}: ${w.pack.map(p => p[0]).join(" | ")}`));
    // Next 30 days: today, every day with an activity and every handoff, through Dec 31 (today + 30). Not Jan 1.
    expectAll("acts family", "Next 30 days from Tue Dec 1 runs through Thu Dec 31 (today plus 30) and lists only days with activities and handoff days that have a pack list (not today when empty, not the Dec 24 handoff with nothing to pack)", [
      ["days", g.panelMonth.days.map(d => d.date.replace(/ (Today|Handoff day)/g, "")), ["Tue, Dec 1", "Wed, Dec 2", "Thu, Dec 3", "Fri, Dec 4", "Sat, Dec 5", "Sun, Dec 6", "Mon, Dec 7", "Wed, Dec 9", "Fri, Dec 11", "Sat, Dec 12", "Mon, Dec 14",
        "Wed, Dec 16", "Thu, Dec 17", "Fri, Dec 18", "Sat, Dec 19", "Sun, Dec 20", "Tue, Dec 22", "Wed, Dec 23", "Sat, Dec 26", "Thu, Dec 31"]]]);
    // Calendar markers.
    const dec = g.marksDec.filter(c => !c.out), nov = g.marksNov.filter(c => !c.out);
    const mBad = [...dec.map((c, i) => [toStr(toNum("2026-12-01") + i), c]), ...nov.map((c, i) => [toStr(toNum("2026-11-01") + i), c])]
      .filter(([iso, c]) => JSON.stringify(c.dots) !== JSON.stringify(marksFor(iso))).map(([iso, c]) => `${iso}: expected ${JSON.stringify(marksFor(iso))}, page shows ${JSON.stringify(c.dots)}`);
    const ariaKids = dec.find((c, i) => i === 1).aria;
    check("acts family", "calendar markers: on every day of Nov and Dec 2026, exactly one initial per kid with an activity that is not canceled (Dec 7 and Dec 14 have only canceled ones, so none); the day's label names them",
      !mBad.length && /Ava and Max have activities$/.test(ariaKids), mBad.length ? mBad : [`Dec 2 label: ${ariaKids}`, ...dec.filter(c => c.dots.length).map((c, i) => `${c.aria.split(",").slice(0, 2).join(",")}: ${c.dots.join(" ")}`)]);
    check("acts family", "the legend lists both kids with their marker when activities are on", /A\s*Ava/.test(g.legend) && /M\s*Max/.test(g.legend), g.legend);
    // Recent changes.
    const actRows = g.recentAct.rows, kidRows = g.recentKids.rows, all = g.recentAllMore.rows;
    expectAll("acts family", "Recent changes: newest first, the 4 activities added in one save show as one line, switches from the last 30 days, the filter works, Show more after 12", [
      ["shown with the filter", [g.recentAll.shown, g.recentAll.segShown, g.recentAll.pressed], [true, true, ["all"]]],
      ["first 12, then Show more", [g.recentAll.rows.length, g.recentAll.more, all.length, g.recentAllMore.more], [12, true, 14, false]],
      ["Activities filter: only activity lines", actRows.map(r => r.type), ["act", "act", "act", "act", "act"]],
      ["the batch line", actRows.filter(r => /added 4 activities/.test(r.text)).map(r => r.text.replace(/^Nov \d+ [\d:]+ [ap]\.m\. /, "")), ["Heather added 4 activities Soccer practice, Soccer game, Dec 9 to Dec 22"]],
      ["Where the kids are filter: only switches", [kidRows.length, kidRows.every(r => r.type === "kids")], [9, true]],
      ["no line older than 30 days and none outside the 60-day window", all.some(r => /Piano lesson on Wed Dec 2|Feb 5/.test(r.text)), false]]);
    check("privacy", "family page with activities: no unshared comment, home address, calendar link, import id, log detail, private note, track_from, totals, percentages or phone numbers",
      !g.privacy.filter(x => !/night count.*PACK FOR|PACK FOR.*night count/i.test(x)).length && !g.phones.length, [...g.privacy, ...g.phones]);
    setGolden("family-acts", g);
  }

  // =========================================================================
  // 2. This week and Next 30 days boundaries, the Off switch and storage
  // =========================================================================
  {
    const b = golden.bounds = {};
    // Rule in acts.js rangeFor: "This week" is today through the coming Sunday; on a Saturday or a Sunday it runs through the Sunday after.
    // "Next 30 days" is today through today + 30.
    for (const [label, iso, want] of [["Tuesday", "2026-12-01", ["2026-12-01", "2026-12-06", ["Tue, Dec 1", "Wed, Dec 2", "Thu, Dec 3", "Fri, Dec 4", "Sat, Dec 5", "Sun, Dec 6"]]], ["Saturday", "2026-12-05", ["2026-12-05", "2026-12-13", ["Sat, Dec 5", "Sun, Dec 6", "Mon, Dec 7", "Wed, Dec 9", "Fri, Dec 11", "Sat, Dec 12"]]], ["Sunday", "2026-12-06", ["2026-12-06", "2026-12-13", ["Sun, Dec 6", "Mon, Dec 7", "Wed, Dec 9", "Fri, Dec 11", "Sat, Dec 12"]]]]) {
      const s = await open("family", `family acts week ${label}`, { at: AT(iso), respond: fam(DB, AT(iso)) });
      const p = await a(s, "panel", "f");
      await s.page.locator('[data-act="month"]').click();
      const m = await a(s, "panel", "f");
      await close(s);
      const dates = p.days.map(d => d.date.replace(/ (Today|Handoff day)/g, ""));
      const wantDays = want[2];
      const mLast = m.days[m.days.length - 1].date.replace(/ (Today|Handoff day)/g, "");
      b[label] = { week: dates, monthFirst: m.days[0].date, monthLast: mLast };
      expectAll("acts boundaries", `This week on a ${label} (${iso}) runs ${want[0]} to ${want[1]}, only days with activities or a pack list are listed; Next 30 days starts today`, [["This week", dates, wantDays], ["Next 30 days starts", m.days[0].date.startsWith(wantDays[0]), true]]);
    }
    // Off: no panel body, no markers, no Today line, no kids in the legend. Remembered across a reload. Day sheet still lists activities.
    const s = await open("family", "family acts off", { at: T_ACT, respond: fam(DB, T_ACT.instant) });
    await s.page.locator('[data-act="off"]').click();
    const off = { panel: await a(s, "panel", "f"), today: await a(s, "today"), legend: await a(s, "legend", "f") };
    await gotoMonth(s, "2026-12"); off.marks = (await a(s, "marks", "fGrid")).filter(c => c.dots !== null).length;
    await s.page.reload(); await ready(s);
    const again = { panel: await a(s, "panel", "f"), stored: await s.page.evaluate(() => localStorage.getItem("kt-acts")) };
    await gotoMonth(s, "2026-12"); again.marks = (await a(s, "marks", "fGrid")).filter(c => c.dots !== null).length;
    await clickDay(s, "2026-12-02"); again.sheet = (await a(s, "dayActs")).events.map(e => e.id.slice(-2)); await s.page.locator("#famDayScrim [data-close]").click();
    await close(s);
    b.off = off; b.offAfterReload = again;
    expectAll("acts boundaries", "Off hides the panel body, every calendar marker, the Today line and the kids in the legend; it is remembered after a reload (kt-acts = off); the day sheet still lists that day's activities", [
      ["pressed", off.panel.pressed, ["off"]], ["off note shown, no days", [off.panel.offShown, off.panel.days.length], [true, 0]], ["markers", off.marks, 0], ["Today line", off.today, null],
      ["legend has no kids", /Ava|Max/.test(off.legend), false], ["after reload", [again.panel.pressed, again.stored, again.marks, again.panel.days.length], [["off"], "off", 0, 0]], ["day sheet Dec 2", again.sheet, ["03", "04"]]]);
    // Storage that throws (private browsing on some phones): the page still works, defaults to This week, and the switch works for the visit.
    const t = await open("family", "family acts storage throws", { at: T_ACT, respond: fam(DB, T_ACT.instant),
      everyLoad: "(() => { const no = () => { throw new Error('storage is off'); }; Storage.prototype.getItem = no; Storage.prototype.setItem = no; })();" });
    const st0 = await a(t, "panel", "f");
    await t.page.locator('[data-act="month"]').click(); const st1 = await a(t, "panel", "f");
    await t.page.locator('[data-act="off"]').click(); const st2 = await a(t, "panel", "f");
    const terr = t.errors.slice(); await close(t);
    expectAll("acts boundaries", "when browser storage throws, the page still loads with This week, the switch still works for the visit, and there are no console errors", [
      ["default", [st0.shown, st0.pressed, st0.days.length], [true, ["week"], 6]], ["Next 30 days", [st1.pressed, st1.days.length], [["month"], 20]], ["Off", [st2.pressed, st2.days.length], [["off"], 0]], ["console errors", terr, []]]);
    // Someone else on Fri Jan 15 and the This week panel on Wed Jan 13: Jan 15 is a handoff day and has no leave-by.
    const j = await open("family", "family acts Jan 13", { at: AT("2027-01-13"), respond: fam(DB, AT("2027-01-13")) });
    const jp = await a(j, "panel", "f"); await close(j);
    const j15 = jp.days.find(d => d.date.startsWith("Fri, Jan 15"));
    b.jan13 = jp;
    expectAll("acts boundaries", "Wed Jan 13: This week runs to Sun Jan 17; Fri Jan 15 is Someone else's handoff day (gold, class other) and the practice shows arrive by only", [
      ["days (only Jan 15 has anything on it; Jan 13 and 14 are empty, today included)", jp.days.map(d => d.date.replace(/ (Today|Handoff day)/g, "")), ["Fri, Jan 15"]],
      ["Jan 15 chip", j15.chip, "chip other | Someone else"], ["Jan 15 handoff", j15.handoff && j15.handoff.head, "⇄ Handoff to Someone else"], ["Jan 15 practice", j15.events.map(e => e.go), ["Arrive 5:45."]],
      ["Jan 16 has nothing on it, so it is not listed", jp.days.some(d => d.date.startsWith("Sat, Jan 16")), false]]);
    // A canceled activity today: struck through in the Today line.
    const c = await open("family", "family acts Dec 7", { at: AT("2026-12-07"), respond: fam(DB, AT("2026-12-07")) });
    b.dec7today = await a(c, "today"); await close(c);
    expectAll("acts boundaries", "on Mon Dec 7 the canceled practice shows struck through in the Today line", [["today", b.dec7today, { text: "Today: Ava Soccer practice 5:30 p.m. Canceled.", struck: ["Soccer practice 5:30 p.m."] }]]);
    setGolden("family-acts-boundaries", b);
  }

  // =========================================================================
  // 3. What's new with activities, and deep links on the family page
  // =========================================================================
  {
    const w = {};
    const s = await open("family", "family acts what's new", { at: T_ACT, respond: fam(DB, T_ACT.instant) });
    w.step1_firstVisit = await a(s, "newBox");
    check("acts what's new", "first visit with activities: no box, no New chips, and the phone remembers the current changed_at", !w.step1_firstVisit.shown && !w.step1_firstVisit.newChips.length && w.step1_firstVisit.seen === FX.changed_at, JSON.stringify(w.step1_firstVisit));
    // The phone last said "Got it" on Nov 28. Since then: a cancel (Brett, Nov 30), a note change (Heather, Nov 30), a removal (Brett, Nov 29),
    // and two comments shared with the family (Nov 29 and Nov 30). The two unshared comments are not in the family payload at all.
    await s.page.evaluate(() => localStorage.setItem("kt-seen", "2026-11-28T00:00:00+00:00"));
    await s.page.reload(); await ready(s);
    await s.page.locator('[data-act="month"]').click();
    w.step2_since = await a(s, "newBox");
    expectAll("acts what's new", "after a later change: the box lists the activity log lines and shared comments since then, newest first, and the two changed activities get a New chip", [
      ["box items", w.step2_since.items, [
        "Sat, Dec 5 Brett commented on Basketball game: \"Want to come watch? Tip-off is at 10.\"",
        "Thu, Dec 17 Heather updated Soccer practice on Thu Dec 17: note",
        "Mon, Dec 7 Brett canceled Soccer practice on Mon Dec 7 at 5:30 p.m.",
        "Thu, Dec 17 Heather commented on Soccer practice: \"The pinnie is in the car.\"",
        "Activity Brett removed Soccer practice on Tue Dec 8 at 5:30 p.m."]],
      ["New chips on", w.step2_since.newChips.map(id => id.slice(-2)).sort(), ["09", "15"]]]);
    await s.page.locator("#gotIt").click();
    w.step3_gotIt = await a(s, "newBox");
    check("acts what's new", "\"Got it\" hides the box, clears every New chip and remembers the latest changed_at", !w.step3_gotIt.shown && !w.step3_gotIt.newChips.length && w.step3_gotIt.seen === FX.changed_at, JSON.stringify(w.step3_gotIt));
    // A new comment that tags Angie, and one that does not (the database keeps that one off the family link).
    const db2 = cl(DB); db2.settings[0].changed_at = "2026-12-01T15:00:00+00:00";
    db2.event_comments.push({ id: "d0000000-0000-4000-8000-000000000010", event_id: E(4), at: "2026-12-01T15:00:00+00:00", author: "co", body: "Running late, Angie can you grab them?", tagged: ["grandma"], share_family: true });
    db2.event_comments.push({ id: "d0000000-0000-4000-8000-000000000011", event_id: E(4), at: "2026-12-01T15:01:00+00:00", author: "co", body: "UNSHARED-THREE only for Heather", tagged: ["me"], share_family: false });
    s.respond = fam(db2, T_ACT.instant);
    await s.page.reload(); await ready(s);
    w.step4_comment = await a(s, "newBox");
    expectAll("acts what's new", "a new comment that tags Angie shows in the box; an untagged one never reaches the family page", [
      ["items", w.step4_comment.items, ["Wed, Dec 2 Brett commented on Basketball practice: \"Running late, Angie can you grab them?\""]], ["unshared", JSON.stringify(w).includes("UNSHARED-THREE"), false]]);
    await close(s);
    setGolden("family-acts-whats-new", w);

    // Deep links: #k=TOKEN&e=<id> opens that activity's day, with the activity highlighted.
    const dl = {};
    const d1 = await open("family", "family acts deep link", { at: T_ACT, respond: fam(DB, T_ACT.instant), hash: `#k=TESTTOKEN&e=${E(16)}` });
    dl.open = await a(d1, "dayActs"); dl.month = (await d1.page.locator("#fMonth").textContent()).trim(); await close(d1);
    const d2 = await open("family", "family acts deep link unknown", { at: T_ACT, respond: fam(DB, T_ACT.instant), hash: `#k=TESTTOKEN&e=${E(23)}` });
    dl.outsideWindow = { sheet: (await a(d2, "dayActs")).shown, toast: await a(d2, "toast"), content: (await q(d2.page, "famMsg")).contentShown }; await close(d2);
    expectAll("acts deep links", "family link with &e=<id> opens that day's sheet on the right month with the activity highlighted; an id the link cannot see shows a plain message", [
      ["sheet", [dl.open.shown, dl.open.title, dl.open.focus], [true, "Friday, December 18", [E(16)]]], ["month", dl.month, "December 2026"],
      ["unknown activity", dl.outsideWindow, { sheet: false, toast: "That activity isn't on the schedule anymore.", content: true }]]);
  }

  // =========================================================================
  // 4. Family page privacy with a deliberately leaky answer, and an older answer without activities
  // =========================================================================
  {
    const leaky = body => {
      if (!body || body.p_token !== "TESTTOKEN") return { json: null };
      const r = familyResponse(DB, { at: T_ACT.instant, leaky: true });
      r.homes = cl(DB.homes); r.contacts = cl(DB.contacts); r.app_users = [{ email: "leak@example.test", role: "admin" }];
      r.teams.forEach(t => { t.ical_url = "https://calendar.example.invalid/ICAL-SECRET-MARK"; });
      r.events.forEach(e => { e.source_uid = "UID-SECRET-MARK"; e.pnote = "PRIVATE-EVENT"; });
      r.places.forEach(p => { p.lat = 10.123456; p.lng = 20.654321; p.phone = "+15555550109"; });
      r.kids.forEach(k => { k.phone = "+15555550108"; });
      r.log.forEach(x => { x.before = { note: "LOGDETAIL-MARK" }; x.after = { note: "LOGDETAIL-MARK" }; });
      return { json: r };
    };
    const s = await open("family", "family acts leaky keys", { at: T_ACT, respond: leaky });
    await s.page.locator('[data-act="month"]').click();
    const hits = [...await q(s.page, "privacy", ["HOME-ADDR-MARK", "ICAL-SECRET-MARK", "UID-SECRET-MARK", "LOGDETAIL-MARK", "PRIVATE-", "leak@example", "10.123456"]), ...await a(s, "phones", PHONE_RE.source)];
    for (const iso of ["2026-12-01", "2026-12-05", "2026-12-17"]) { await clickDay(s, iso); hits.push(...(await q(s.page, "privacy", ["HOME-ADDR-MARK", "ICAL-SECRET-MARK", "UID-SECRET-MARK", "LOGDETAIL-MARK", "PRIVATE-"])).map(x => `${iso} sheet: ${x}`)); await s.page.locator("#famDayScrim [data-close]").click(); }
    await close(s);
    check("privacy", "family page ignores extra keys a response should never carry (home addresses, contacts, phone numbers, calendar links, import ids, map points, log detail, private notes, track_from, totals)",
      !hits.filter(x => !/night count.*PACK FOR|PACK FOR.*night count/i.test(x)).length, hits);
    // A comment row that is NOT shared with the family (share_family false). The database never sends one; the page should not show it if it did.
    const unshared = body => {
      if (!body || body.p_token !== "TESTTOKEN") return { json: null };
      const r = familyResponse(DB, { at: T_ACT.instant });
      r.comments.push({ id: "d0000000-0000-4000-8000-000000000020", event_id: E(2), at: "2026-11-30T10:00:00+00:00", author: "co", body: "UNSHARED-LEAK parent only", tagged: ["me"], share_family: false });
      return { json: r };
    };
    const u = await open("family", "family acts unshared comment row", { at: T_ACT, respond: unshared });
    const uh = (await q(u.page, "privacy", ["UNSHARED-LEAK"])).filter(x => !/night count.*PACK FOR/i.test(x)); await close(u);
    check("privacy", "family page never shows a comment marked share_family = false, even if a response carried one", !uh.length,
      uh.length ? [...uh, "Steps: family link, a get_schedule answer whose comments list has a row with share_family false. Its body shows under the activity (Dec 1 soccer practice).", "acts.js parse() keeps every comment row and the family page does not check share_family"] : "");
    // An older answer (before migration 08): no activity keys at all.
    const old = await open("family", "family acts older answer", { at: T_ACT, respond: body => ({ json: body && body.p_token === "TESTTOKEN" ? P.core(DB) : null }) });
    const o = { content: (await q(old.page, "famMsg")).contentShown, panel: await a(old, "panel", "f"), recent: await a(old, "recent"), today: await a(old, "today") };
    await gotoMonth(old, "2026-12"); o.marks = (await a(old, "marks", "fGrid")).filter(c => c.dots !== null).length; o.errors = old.errors.slice();
    await close(old);
    expectAll("acts family", "an older family answer without any activity keys still loads: no Activities panel, no markers, Recent changes lists switches only with no filter, no console errors", [
      ["page shown", o.content, true], ["Activities panel", o.panel.shown, false], ["markers", o.marks, 0], ["Today line", o.today, null],
      ["Recent changes", [o.recent.shown, o.recent.segShown, o.recent.rows.every(r => r.type === "kids")], [true, false, true]], ["console errors", o.errors, []]]);
  }

  // =========================================================================
  // 5. Holder values outside the four known ones never become class names
  // =========================================================================
  {
    const BAD = 'x-bad" data-pwn="1';
    const dbBad = cl(DB);
    dbBad.swaps.push({ day: "2026-12-03", had: BAD, caregiver: "Odd value", updated_at: "2026-11-30T12:00:00+00:00" });
    dbBad.swap_details.push({ day: "2026-12-03", reason: "other", note: "Odd holder test", pnote: null });
    const out = {};
    const f = await open("family", "family odd holder", { at: T_ACT, respond: fam(dbBad, T_ACT.instant) });
    await gotoMonth(f, "2026-12"); await clickDay(f, "2026-12-03");
    out.family = { bad: await a(f, "badClass", "x-bad"), panelChip: ((await a(f, "panel", "f")).days.find(d => d.date.startsWith("Thu, Dec 3")) || {}).chip,
      recentChip: ((await a(f, "recent")).rows.find(r => /Dec 3/.test(r.text) && r.type === "kids") || { chips: [] }).chips.slice(-1)[0], errors: f.errors.slice() };
    await close(f);
    const ad = await open("admin", "admin odd holder", { at: T_ACT, fake: { db: dbBad } });
    out.admin = { bad: await a(ad, "badClass", "x-bad"), panelChip: ((await a(ad, "panel", "a")).days.find(d => d.date.startsWith("Thu, Dec 3")) || {}).chip };
    await close(ad);
    const ac = await open("activities", "activities odd holder", { at: T_ACT, fake: { db: dbBad } });
    out.activities = { bad: await a(ac, "badClass", "x-bad"), upChip: ((await a(ac, "up")).rows.find(r => r.id === E(5)) || {}).chip };
    await close(ac);
    expectAll("acts holder class", "a holder value outside me, co, grandma and other renders with class \"other\" in the slice's new code (Activities panel day chip, Recent changes, Activities page Upcoming)", [
      ["family panel", out.family.panelChip, "chip other | Odd value"], ["family recent changes", out.family.recentChip, "chip other | Odd value"],
      ["admin panel", out.admin.panelChip, "chip other | Odd value"], ["Activities page upcoming", out.activities.upChip, "chip other | Odd value"]]);
    check("acts holder class", "that odd holder value never appears as a class name, and never breaks out of a class attribute, anywhere on the family, admin or Activities page",
      !out.family.bad.length && !out.admin.bad.length && !out.activities.bad.length,
      [...out.family.bad.map(x => "family: " + x), ...out.admin.bad.map(x => "admin: " + x), ...out.activities.bad.map(x => "activities: " + x)]);
    setGolden("acts-odd-holder", out);
  }

  // =========================================================================
  // 6. Admin page with activities
  // =========================================================================
  {
    const g = golden.admin = {};
    const s = await open("admin", "admin acts Dec 1", { at: T_ACT, fake: { db: DB } });
    g.calls = (await takeCalls(s)).map(c => c.rpc || `${c.table}.${c.op}`);
    g.panel = await a(s, "panel", "a");
    g.button = await s.page.evaluate(() => { const b = document.getElementById("actsBtn"); return b ? { text: b.textContent.trim(), href: b.getAttribute("href"), shown: !!b.getClientRects().length } : null; });
    await gotoMonth(s, "2026-12"); g.marksDec = await a(s, "marks", "aGrid");
    await s.page.locator('[data-period="all"]').click(); g.totalsAll = await q(s.page, "totals"); await s.page.locator('[data-period="ytd"]').click();
    g.log = await q(s.page, "log"); g.share = await q(s.page, "share");
    await s.page.locator('[data-act="month"]').click(); g.panelMonth = await a(s, "panel", "a");
    // Text sheet from a custody change log row: recipients from the contacts table.
    await s.page.locator("#log > li").first().getByRole("button", { name: "Text" }).click();
    g.text = await a(s, "txt"); await s.page.locator("#txtScrim [data-close]").click();
    g.errors = s.errors.filter(e => !/integrity/.test(e));
    await close(s);
    // Same custody, no activities: everything custody-related must be identical.
    const base = await open("admin", "admin no acts Dec 1", { at: T_ACT });
    const b = { log: await q(base.page, "log"), share: await q(base.page, "share") };
    await base.page.locator('[data-period="all"]').click(); b.totalsAll = await q(base.page, "totals");
    await close(base);
    const fam1 = (await (async () => { const f = await open("family", "family acts for admin compare", { at: T_ACT, respond: fam(DB, T_ACT.instant) }); await f.page.locator('[data-act="month"]').click(); const p = await a(f, "panel", "f"); await gotoMonth(f, "2026-12"); const m = await a(f, "marks", "fGrid"); await close(f); return { p, m }; })());
    check("acts admin", "admin page with a kid, activities, handoffs in range and recent switches: the Activities panel renders (read only) with no console error, and the header has an Activities button to activities.html",
      g.panel.shown && g.panel.days.length === 6 && g.panel.editButtons === 0 && !g.errors.length && g.button && g.button.shown && g.button.href === "activities.html" && g.button.text === "Activities",
      [JSON.stringify(g.button), `panel shown ${g.panel.shown}, ${g.panel.days.length} days, ${g.panel.editButtons} edit controls`, ...g.errors]);
    expectAll("acts admin", "admin load reads the custody tables, then get_editor_schedule and contacts", [["calls", g.calls, ["my_role", "settings.select", "breaks.select", "swaps.select", "swap_details.select", "share_links.select", "get_editor_schedule", "contacts.select"]]]);
    const strip = days => days.map(d => ({ date: d.date, chip: d.chip, handoff: d.handoff, events: d.events.map(e => ({ id: e.id, go: e.go, gear: e.gear, title: e.title })) }));
    expectAll("acts admin", "admin Activities panel (Next 30 days) and December markers match the family page day for day (who has the kids, handoffs, pack lists, times, gear)", [
      ["panel", strip(g.panelMonth.days), strip(fam1.p.days)], ["markers", g.marksDec.map(c => c.dots), fam1.m.map(c => c.dots)]]);
    expectAll("acts admin", "custody parts are unchanged by activities: totals since start, change log and family link panel are identical with and without activity data", [
      ["totals", g.totalsAll, b.totalsAll], ["change log", g.log, b.log], ["family link", g.share, b.share]]);
    expectAll("acts text sheet", "admin text sheet: recipients from the contacts table in the order Brett, Heather, Angie (Grandma); Heather (signed in) shown, unchecked and off; Apple link format", [
      ["to", g.text.to, ["Brett [checked]", "Heather (you) [disabled]", "Angie (Grandma) [checked]"]],
      ["href", g.text.href, `sms://open?addresses=+15555550102,5555550101&body=${encodeURIComponent(g.text.body)}`]]);
    setGolden("admin-acts", g);

    // Older or missing editor function: the admin page still works.
    for (const [mode, label] of [["old", "an older get_editor_schedule with no activity keys"], ["missing", "get_editor_schedule not there at all"]]) {
      const o = await open("admin", `admin acts editor ${mode}`, { at: T_ACT, fake: { db: DB, editor: mode } });
      const r = { views: (await q(o.page, "views")).shown, panel: (await a(o, "panel", "a")).shown, errs: o.errors.filter(e => !/integrity/.test(e)) };
      await gotoMonth(o, "2026-12"); r.marks = (await a(o, "marks", "aGrid")).filter(c => c.dots !== null).length;
      await close(o);
      expectAll("acts admin", `admin page with ${label}: tracker shows, no Activities panel, no markers, no console errors`, [["result", r, { views: ["vApp"], panel: false, errs: [], marks: 0 }]]);
    }
    // Text sheet recipients: the config.js fallback, a partial contacts table, a non-Apple phone, no contacts at all.
    const sheet = async (label, o, open2) => { const x = await open(o.kind || "admin", label, o); await x.page.locator("#log > li").first().getByRole("button", { name: "Text" }).click(); const t = await a(x, "txt"); await close(x); return t; };
    const noCon = cl(DB); noCon.contacts = [];
    const nullPhones = cl(DB); nullPhones.contacts.forEach(c => { c.phone = null; });
    const partial = cl(DB); partial.contacts = [{ who: "co", label: "Brett", phone: "+1 555 555 0102" }];
    const t1 = await sheet("admin text: contacts empty", { at: T_ACT, fake: { db: noCon } });
    const t2 = await sheet("admin text: contacts with no numbers", { at: T_ACT, fake: { db: nullPhones } });
    const t3 = await sheet("admin text: only Brett's number", { at: T_ACT, fake: { db: partial } });
    const t4 = await sheet("admin text: Android", { at: T_ACT, fake: { db: DB }, ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36" });
    const t5 = await sheet("admin text: no contacts anywhere", { at: T_ACT, fake: { db: noCon }, config: TEST_CONFIG.replace(/contacts: \[[\s\S]*?\],/, "contacts: [],") });
    const t6 = await sheet("admin text: no contacts anywhere, Android", { at: T_ACT, fake: { db: noCon }, config: TEST_CONFIG.replace(/contacts: \[[\s\S]*?\],/, "contacts: [],"), ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" });
    const enc = t => encodeURIComponent(t.body);
    expectAll("acts text sheet", "text sheet recipients: config.js numbers when the contacts table has none (Mom becomes Angie (Grandma)), no fallback once any number is entered, and the sms: link format is unchanged (Apple and others, with and without numbers)", [
      ["contacts empty: config.js", [t1.to, t1.href], [["Brett [checked]", "Heather (you) [disabled]", "Angie (Grandma) [checked]"], `sms://open?addresses=+15555550102,+15555550101&body=${enc(t1)}`]],
      ["only Brett's number: no fallback", [t3.to, t3.href], [["Brett [checked]", "Heather (you) [disabled]", "Angie (Grandma) (no number yet) [disabled]"], `sms://open?addresses=+15555550102&body=${enc(t3)}`]],
      ["Android", t4.href, `sms:+15555550102,5555550101?body=${enc(t4)}`],
      ["no numbers anywhere, Apple", [t5.to, t5.note, t5.href], [[], "No contacts set up. Messages will open and you can pick who to send to.", `sms:&body=${enc(t5)}`]],
      ["no numbers anywhere, other", t6.href, `sms:?body=${enc(t6)}`]]);
    // CLAUDE.md: "until any number is entered there, the two numbers in config.js are used". Rows with no numbers in them
    // are what "Save contacts" writes when Heather saves before typing numbers. Reproduced end to end on the Activities page too.
    const cs = await open("activities", "activities: save contacts with no numbers", { at: T_ACT, fake: { db: noCon, role: "admin" } });
    await cs.page.locator("#conSave").click(); await settle(cs);
    const saved = await cs.page.evaluate(() => window.__KT_FAKE__.db.contacts);
    const hint = (await a(cs, "lists")).contactHint;
    await openEv(cs, E(2)); await cs.page.locator("#cmtBody").fill("Fallback check"); await cs.page.locator("#tag-co").check(); await cs.page.locator("#cmtPost").click(); await waitTxt(cs);
    const t7 = await a(cs, "txt"); await close(cs);
    expectAll("acts text sheet", "contacts rows that hold no numbers still fall back to config.js (admin text sheet, and the Activities page after Save contacts is pressed with the number boxes empty)", [
      ["admin page, rows with no numbers", t2.to, ["Brett [checked]", "Heather (you) [disabled]", "Angie (Grandma) [checked]"]],
      ["Activities page: what Save contacts wrote", saved.map(c => `${c.who}:${c.phone}`), ["co:null", "me:null", "grandma:null"]],
      ["Activities page: its hint still says the site settings numbers are used", /site settings file/.test(hint), true],
      ["Activities page: text sheet after that", t7.to, ["Brett [checked]", "Heather (you) [disabled]", "Angie (Grandma)"]]]);
  }

  // =========================================================================
  // 7. Activities page, signed in as Heather (admin)
  // =========================================================================
  {
    const r = golden.actsAdmin = {};
    const s = await open("activities", "activities admin", { at: T_ACT, fake: { db: DB, role: "admin" } }), p = s.page;
    r.loadCalls = (await takeCalls(s)).map(c => ({ what: c.rpc || `${c.table}.${c.op}`, columns: c.columns, filters: c.filters, limit: c.limit }));
    r.up = await a(s, "up"); r.lists = await a(s, "lists");
    expectAll("activities page", "as admin: the page reads my_role, get_editor_schedule and contacts, then share_links for the token only (active, newest, one row); nothing else", [
      ["calls", r.loadCalls.map(c => c.what), ["my_role", "get_editor_schedule", "contacts.select", "share_links.select"]],
      ["share_links read", r.loadCalls[3] && [r.loadCalls[3].columns, r.loadCalls[3].filters, r.loadCalls[3].limit], ["token", [{ kind: "eq", col: "active", val: true }], 1]]]);
    // Upcoming: today onward, with who has the kids from the custody rules.
    const rowBad = r.up.rows.filter(x => x.chip !== oChip(evDays.get(x.id))).map(x => `${evDays.get(x.id)}: page "${x.chip}", rules "${oChip(evDays.get(x.id))}"`);
    expectAll("activities page", "Upcoming lists the 24 activities from today on (not Nov 28), with a kid filter, and each row's who-has-the-kids chip matches the custody rules", [
      ["count", r.up.count, "24 coming up"], ["filter", r.up.filter, ["All [on]", "Ava", "Max"]], ["first row", r.up.rows[0].id, E(2)], ["chip mismatches", rowBad, []],
      ["handoff rows say so", r.up.rows.filter(x => /Handoff day/.test(x.who)).map(x => evDays.get(x.id)), ["2026-12-04", "2026-12-05", "2026-12-06", "2026-12-11", "2026-12-18", "2026-12-22", "2026-12-26", "2027-01-15", "2027-02-05"]]]);
    await p.locator('#upFilter [data-kid="' + KID.max + '"]').click(); const upMax = await a(s, "up");
    await p.locator('#upFilter [data-kid="' + KID.ava + '"]').click(); const upAva = await a(s, "up");
    await p.locator('#upFilter [data-kid="all"]').click();
    expectAll("activities page", "kid filter: Max shows his 12, Ava her 20 (shared ones in both)", [["Max", upMax.count, "12 coming up"], ["Ava", upAva.count, "20 coming up"], ["Max rows all include Max", upMax.rows.every(x => DB.events.find(e => e.id === x.id).kid_ids.includes(KID.max)), true]]);

    // Edit and save without changes: the update carries only the editable fields.
    await p.locator(`#upList .up-row[data-ev="${E(2)}"]`).click(); await settle(s);
    r.editSheet = await a(s, "sheet");
    expectAll("activities page", "edit sheet for Tue Dec 1 soccer practice: heading, who has the kids, the team's times, computed arrive and leave times from all three houses, team gear, comments field", [
      ["title and sub", [r.editSheet.title, r.editSheet.sub], ["Soccer practice", "Tuesday, December 1. Heather has the kids that day."]],
      ["kids", r.editSheet.kids, ["Ava [on]", "Max", "Both"]], ["kind, team", [r.editSheet.kind, r.editSheet.team], ["practice", TEAM.soccer]],
      ["calc", r.editSheet.calc, ["Arrive by 5:20 (10 minutes early)", "Leave by 5:05 from Heather's (15 min drive)", "Leave by 4:55 from Brett's (25 min drive)", "Leave by 5:00 from Angie's (20 min drive)"]],
      ["gear", [r.editSheet.gear, r.editSheet.gearHint], [["cleats", "shin guards", "water bottle"], "Same as the Soccer gear list. Changes here are for this activity only."]],
      ["repeat hidden on edit, cancel and remove shown", [r.editSheet.repeatShown, r.editSheet.cancel, r.editSheet.remove, r.editSheet.cmtShown], [false, "Cancel this practice", true, true]]]);
    await takeCalls(s);
    await p.locator("#evSave").click(); await waitTxt(s);
    r.saveSame = { calls: await takeCalls(s), text: await a(s, "txt") }; await closeTxt(s);
    expectAll("activities page", "saving without changes sends one update with only the editable fields (gear left empty so the team list still applies) and offers a text", [
      ["update", r.saveSame.calls.filter(c => c.table === "events").map(c => [c.op, c.payload, c.filters]), [["update", { team_id: TEAM.soccer, kid_ids: [KID.ava], kind: "practice", title: null, day: "2026-12-01", start_time: "17:30", end_time: "18:30", place_id: null, place_text: null, arrive_by: null, gear: null, note: null }, [{ kind: "eq", col: "id", val: E(2) }]]]],
      ["text", r.saveSame.text.body, `Kids Tracker: Heather updated Ava's Soccer practice on Tue, Dec 1 at 5:30 p.m.\n${famLink(E(2))}`]]);

    // Cancel, restore, remove.
    await openEv(s, E(10)); await p.locator("#evCancel").click(); await waitTxt(s);
    r.cancel = { calls: (await takeCalls(s)).filter(c => c.table && c.op !== "select"), text: await a(s, "txt"), row: (await a(s, "up")).rows.find(x => x.id === E(10)) }; await closeTxt(s);
    await openEv(s, E(9)); r.restoreButton = (await a(s, "sheet")).cancel; await p.locator("#evCancel").click(); await waitTxt(s);
    r.restore = { calls: (await takeCalls(s)).filter(c => c.table && c.op !== "select"), text: await a(s, "txt") }; await closeTxt(s);
    await openEv(s, E(24)); await p.locator("#evRemove").click(); r.removeConfirm = (await a(s, "sheet")).confirm; await p.locator("#evRmYes").click(); await waitTxt(s);
    r.remove = { calls: (await takeCalls(s)).filter(c => c.table && c.op !== "select"), text: await a(s, "txt"), stillListed: (await a(s, "up")).rows.some(x => x.id === E(24)) }; await closeTxt(s);
    expectAll("activities page", "cancel, restore and remove: one request each with no server-set fields, the right text, and the family link only on texts that can include Angie", [
      ["cancel request", r.cancel.calls.map(c => [c.table, c.op, c.payload, c.filters]), [["events", "update", { status: "canceled" }, [{ kind: "eq", col: "id", val: E(10) }]]]],
      ["cancel text", r.cancel.text.body, `Kids Tracker: Ava's Soccer practice on Wed, Dec 9 at 5:30 p.m. is canceled.\n${famLink(E(10))}`], ["canceled row", r.cancel.row.canceled, true],
      ["restore button and request", [r.restoreButton, r.restore.calls.map(c => [c.op, c.payload])], ["Restore", [["update", { status: "on" }]]]],
      ["restore text", r.restore.text.body, `Kids Tracker: Ava's Soccer practice on Mon, Dec 7 at 5:30 p.m. is back on.\n${famLink(E(9))}`],
      ["remove asks first", r.removeConfirm, true], ["remove request", r.remove.calls.map(c => [c.table, c.op, c.payload, c.filters]), [["events", "delete", null, [{ kind: "eq", col: "id", val: E(24) }]]]],
      ["remove text has no link (the activity is gone)", r.remove.text.body, "Kids Tracker: Heather removed Max's Movie night on Thu, Dec 31 at 7:00 p.m."], ["removed from the list", r.remove.stillListed, false]]);

    // Comments: tag Brett, then Angie; delete only your own.
    await openEv(s, E(2));
    await p.locator("#cmtBody").fill("Can you take her? <b>bold</b>"); await p.locator("#tag-co").check(); await p.locator("#cmtPost").click(); await waitTxt(s);
    r.cmtBrett = { calls: (await takeCalls(s)).filter(c => c.table && c.op !== "select"), text: await a(s, "txt") }; await closeTxt(s);
    await openEv(s, E(2));
    await p.locator("#cmtBody").fill("Angie, want to watch?"); await p.locator("#tag-grandma").check(); await p.locator("#cmtPost").click(); await waitTxt(s);
    r.cmtAngie = { calls: (await takeCalls(s)).filter(c => c.table && c.op !== "select"), text: await a(s, "txt") };
    await p.locator("#to-grandma").uncheck(); r.cmtAngieUnticked = await a(s, "txt");
    await p.locator("#to-grandma").check(); r.cmtAngieTicked = await a(s, "txt"); await closeTxt(s);
    await openEv(s, E(10)); r.e10comments = (await a(s, "sheet")).comments;
    const del = p.locator("#evCmts [data-delc]"); await del.click(); r.delArmed = (await a(s, "sheet")).comments.map(c => c.del).filter(Boolean);
    await p.locator("#evCmts [data-delc]").click(); await settle(s);
    r.delCalls = (await takeCalls(s)).filter(c => c.table && c.op !== "select"); r.e10after = (await a(s, "sheet")).comments.length;
    await p.locator("#evScrim [data-close]").click();
    const bodyBrett = "Kids Tracker: Heather commented on Ava's Soccer practice on Tue, Dec 1 at 5:30 p.m.:\n\"Can you take her? <b>bold</b>\"";
    const bodyAngie = "Kids Tracker: Heather commented on Ava's Soccer practice on Tue, Dec 1 at 5:30 p.m.:\n\"Angie, want to watch?\"";
    expectAll("activities page", "a tagged comment sends only event_id, body and tags, then opens the text sheet with the tagged people checked; the link is the family link only while Angie is ticked (admin)", [
      ["comment insert", r.cmtBrett.calls.map(c => [c.table, c.op, c.payload]), [["event_comments", "insert", { event_id: E(2), body: "Can you take her? <b>bold</b>", tagged: ["co"] }]]],
      ["tag Brett: recipients", r.cmtBrett.text.to, ["Brett [checked]", "Heather (you) [disabled]", "Angie (Grandma)"]], ["tag Brett: link to this page", r.cmtBrett.text.body, `${bodyBrett}\n${pageLink(E(2))}`],
      ["tag Angie: recipients", r.cmtAngie.text.to, ["Brett", "Heather (you) [disabled]", "Angie (Grandma) [checked]"]], ["tag Angie: family link", r.cmtAngie.text.body, `${bodyAngie}\n${famLink(E(2))}`],
      ["Angie unticked: link switches to this page", r.cmtAngieUnticked.body, `${bodyAngie}\n${pageLink(E(2))}`], ["Angie ticked again", r.cmtAngieTicked.body, `${bodyAngie}\n${famLink(E(2))}`],
      ["Delete only on Heather's own comment", r.e10comments.map(c => c.del), [null, "Delete"]], ["first tap arms it", r.delArmed, ["Tap again to delete"]],
      ["delete request", r.delCalls.map(c => [c.table, c.op, c.filters]), [["event_comments", "delete", [{ kind: "eq", col: "id", val: "d0000000-0000-4000-8000-000000000003" }]]]],
      ["Brett's comment stays", r.e10after, 1]]);

    // Add by hand with Repeat weekly until: one insert for every week.
    await p.locator("#addHand").click(); await settle(s);
    r.newSheet = await a(s, "sheet");
    await p.locator(`#evKids [data-pk="${KID.ava}"]`).click();
    await p.locator("#evTeam").selectOption(TEAM.soccer);
    await p.locator("#evDay").fill("2026-12-02"); await p.locator("#evStart").fill("17:30"); await p.locator("#evRepeat").fill("2027-02-03");
    r.newSheetFilled = await a(s, "sheet");
    await takeCalls(s); await p.locator("#evSave").click(); await waitTxt(s);
    const addCalls = (await takeCalls(s)).filter(c => c.table && c.op !== "select");
    r.repeat = { inserts: addCalls.filter(c => c.op === "insert").map(c => ({ rows: c.payload.length, days: c.payload.map(x => x.day), keys: [...new Set(c.payload.flatMap(Object.keys))].sort(), returning: c.returning })), text: await a(s, "txt"), toast: await a(s, "toast") };
    await closeTxt(s);
    const newId = await s.page.evaluate(() => window.__KT_FAKE__.db.events.filter(e => e.day === "2026-12-02" && e.start_time === "17:30")[0].id);
    expectAll("activities page", "Add one by hand with Repeat weekly until Feb 3: ONE insert with 10 rows (Dec 2 to Feb 3, every 7 days), only editable fields, then a text for the whole series", [
      ["new sheet", [r.newSheet.title, r.newSheet.repeatShown, r.newSheet.cancel, r.newSheet.remove, r.newSheet.cmtShown, r.newSheet.kids], ["New activity", true, null, false, false, ["Ava", "Max", "Both"]]],
      ["picking the team fills the place and keeps Ava", [r.newSheetFilled.kids, r.newSheetFilled.place, r.newSheetFilled.calc[0]], [["Ava [on]", "Max", "Both"], PLACE.rec, "Arrive by 5:20 (10 minutes early)"]],
      ["insert", r.repeat.inserts, [{ rows: 10, days: span("2026-12-02", "2027-02-03").filter((d, i) => i % 7 === 0), keys: ["arrive_by", "day", "end_time", "gear", "kid_ids", "kind", "note", "place_id", "place_text", "start_time", "team_id", "title"], returning: true }]],
      ["toast", r.repeat.toast, "Added 10 activities."],
      ["text", r.repeat.text.body, `Kids Tracker: Heather added Ava's Soccer practice on Wed, Dec 2 at 5:30 p.m., then every week through Wed, Feb 3 (10 in all).\n${famLink(newId)}`]]);
    // The 60 cap: 61 weeks is refused before anything is sent, 60 is one insert of 60.
    await p.locator("#addHand").click(); await p.locator(`#evKids [data-pk="${KID.max}"]`).click(); await p.locator("#evName").fill("Cap test");
    await p.locator("#evDay").fill("2026-12-02"); await p.locator("#evStart").fill("18:00");
    await p.locator("#evRepeat").fill(toStr(toNum("2026-12-02") + 60 * 7)); await takeCalls(s); await p.locator("#evSave").click(); await settle(s);
    r.cap61 = { toast: await a(s, "toast"), calls: (await takeCalls(s)).filter(c => c.table && c.op !== "select"), open: (await a(s, "sheet")).shown };
    await p.locator("#evRepeat").fill(toStr(toNum("2026-12-02") + 59 * 7)); await p.locator("#evSave").click(); await waitTxt(s);
    r.cap60 = (await takeCalls(s)).filter(c => c.table && c.op === "insert").map(c => [c.payload.length, c.payload[0].day, c.payload[59] && c.payload[59].day]); await closeTxt(s);
    expectAll("activities page", "Repeat weekly is capped at 60: 61 weeks shows a message and sends nothing, 60 weeks is one insert of 60 (Dec 2, 2026 to Jan 19, 2028)", [
      ["61", r.cap61, { toast: "That is 61 weeks. Add up to 60 at a time.", calls: [], open: true }], ["60", r.cap60, [[60, "2026-12-02", toStr(toNum("2026-12-02") + 59 * 7)]]]]);
    // A new place from inside an activity.
    await p.locator("#addHand").click(); await p.locator("#evPlace").selectOption("__new"); r.newPlaceRow = (await a(s, "sheet")).newPlaceShown;
    await p.locator("#evNewPlaceName").fill("North Court"); await p.locator("#evNewPlaceAdd").click(); await settle(s);
    r.newPlace = { calls: (await takeCalls(s)).filter(c => c.table && c.op !== "select").map(c => [c.table, c.op, c.payload, c.returning, c.one]), sheet: await a(s, "sheet") };
    await p.locator("#evScrim [data-close]").click();
    expectAll("activities page", "+ Add a new place inside an activity: one insert with just the name, and the new place is picked", [
      ["row shown", r.newPlaceRow, true], ["insert", r.newPlace.calls, [["places", "insert", { name: "North Court" }, true, "single"]]], ["picked", r.newPlace.sheet.placeText, "North Court"]]);

    // Lists: teams, places, kids, contacts (Heather edits), change log (one line per batch).
    r.lists2 = await a(s, "lists");
    expectAll("activities page", "admin sees contacts as editable fields with a Save button; the change log reads \"<name> <summary>\" with one line per batch; Back to schedule is shown", [
      ["contacts", [r.lists2.contactInputs, r.lists2.contactSave], [["cl-co=Brett", "cp-co=+1 555 555 0102", "cl-me=Heather", "cp-me=+15555550103", "cl-grandma=", "cp-grandma=(555) 555-0101"], true]],
      ["back button", r.lists2.back, true],
      ["batch line", r.lists.log.filter(x => /4 activities/.test(x)).map(x => x.replace(/^Nov \d+ [\d:]+ [ap]\.m\. /, "")), ["Heather added 4 activities Soccer practice, Soccer game, Dec 9 to Dec 22"]],
      ["Brett's cancel line", r.lists.log.some(x => /Brett canceled Soccer practice on Mon Dec 7 at 5:30 p\.m\./.test(x)), true],
      ["90-day log includes the Oct 1 line the family never sees", r.lists.log.some(x => /Piano lesson on Wed Dec 2/.test(x)), true]]);

    // Deep link to something that is not there.
    await s.page.evaluate(() => { location.hash = "#e=e9999999-0000-4000-8000-000000000000"; }); await settle(s);
    r.deepUnknown = { toast: await a(s, "toast"), sheet: (await a(s, "sheet")).shown };
    // Every request in the session.
    await takeCalls(s);
    const all = s.allCalls;
    r.serverSet = serverSetHits(all); r.logWrites = all.filter(c => c.table === "event_log").length;
    r.custodyReads = all.filter(c => ["settings", "breaks", "swaps", "swap_details", "app_users"].includes(c.table)).map(c => `${c.table}.${c.op}`);
    r.shareReads = all.filter(c => c.table === "share_links").map(c => [c.op, c.columns || "*"]);
    check("activities page", "admin session: no request ever carries a server-set field (events created/updated by and at; comments author, at, share_family), nothing is sent to event_log, no custody table is read, share_links only once for the token",
      !r.serverSet.length && !r.logWrites && !r.custodyReads.length && JSON.stringify(r.shareReads) === JSON.stringify([["select", "token"]]),
      [`${all.length} requests`, ...r.serverSet, ...r.custodyReads, JSON.stringify(r.shareReads)]);
    expectAll("activities page", "activities.html#e=<unknown id> shows a plain message", [["result", r.deepUnknown, { toast: "That activity isn't on the tracker anymore.", sheet: false }]]);

    // Sign out: the page reloads into the sign-in card, and no phone number is left in the page.
    await Promise.all([p.waitForEvent("load"), p.locator("#signOut").click()]); await ready(s);
    r.afterSignOut = { views: (await q(p, "views")).shown, phones: await a(s, "phones", PHONE_RE.source), top: (await q(p, "views")).topBtns };
    expectAll("activities page", "Sign out reloads the page into the sign-in card and no contact phone number is left anywhere in the page (source, form values, links)", [["result", r.afterSignOut, { views: ["vSignin"], phones: [], top: false }]]);
    r.errors = s.errors.filter(e => !/integrity/.test(e));
    await close(s);
    setGolden("activities-admin", r);
  }
  // Deep link on open, and the not-an-editor card.
  {
    const s = await open("activities", "activities deep link", { at: T_ACT, fake: { db: DB, role: "admin" }, hash: `#e=${E(16)}` });
    const sh = await a(s, "sheet"); await close(s);
    const n = await open("activities", "activities not an editor", { at: T_ACT, fake: { db: DB, role: null } });
    const nv = { views: (await q(n.page, "views")).shown, heading: await a(n, "heading", "vNotAdmin"), calls: (await takeCalls(n)).map(c => c.rpc || `${c.table}.${c.op}`) };
    await close(n);
    expectAll("activities page", "activities.html#e=<id> opens that activity's sheet; a signed-in account that is neither admin nor parent sees \"This account can't make changes\" and nothing else is read", [
      ["deep link", [sh.shown, sh.title, sh.sub], [true, "Basketball game", "Friday, December 18. Brett has the kids that day. Handoff day."]],
      ["not an editor", nv, { views: ["vNotAdmin"], heading: "This account can't make changes", calls: ["my_role"] }]]);
  }

  // =========================================================================
  // 8. Activities page, signed in as Brett (parent)
  // =========================================================================
  {
    const r = golden.actsParent = {};
    const s = await open("activities", "activities parent", { at: T_ACT, fake: { db: DB, role: "parent" } }), p = s.page;
    r.loadCalls = (await takeCalls(s)).map(c => c.rpc || `${c.table}.${c.op}`);
    r.lists = await a(s, "lists");
    await openEv(s, E(10)); r.e10 = (await a(s, "sheet")).comments.map(c => c.del); r.tags = (await a(s, "sheet")).tags; await p.locator("#evScrim [data-close]").click();
    await openEv(s, E(7));
    await p.locator("#cmtBody").fill("Angie, tip-off moved to 10:15."); await p.locator("#tag-grandma").check(); await p.locator("#cmtPost").click(); await waitTxt(s);
    r.cmt = { calls: (await takeCalls(s)).filter(c => c.table && c.op !== "select").map(c => [c.table, c.op, c.payload]), text: await a(s, "txt") }; await closeTxt(s);
    await openEv(s, E(11)); await p.locator("#evCancel").click(); await waitTxt(s);
    r.cancel = await a(s, "txt"); await closeTxt(s);
    await takeCalls(s);
    const all = s.allCalls;
    r.forbidden = all.filter(c => FORBIDDEN_PARENT.includes(c.table)).map(c => `${c.table}.${c.op}`);
    r.serverSet = serverSetHits(all);
    await close(s);
    const body = "Kids Tracker: Brett commented on Ava and Max's Basketball game on Sat, Dec 5 at 10:00 a.m.:\n\"Angie, tip-off moved to 10:15.\"";
    expectAll("activities page", "as parent (Brett): reads only my_role, get_editor_schedule and contacts; contacts are read only; Delete only on his own comments; tag choices are Heather and Angie", [
      ["load", r.loadCalls, ["my_role", "get_editor_schedule", "contacts.select"]], ["Back to schedule is hidden for a parent (the page switch replaces it)", r.lists.back, false],
      ["contacts read only", [r.lists.contactInputs, r.lists.contactSave, r.lists.contactRows], [[], false, ["Brett +15555550102", "Heather +15555550103", "Angie (Grandma) 5555550101"]]],
      ["Delete on Brett's own comment only", r.e10, ["Delete", null]], ["tags", r.tags, ["Heather", "Angie"]]]);
    expectAll("activities page", "parent tags Angie: Angie checked, Brett (signed in) shown but off, and the link is activities.html#e= (a parent never has the family link)", [
      ["insert", r.cmt.calls, [["event_comments", "insert", { event_id: E(7), body: "Angie, tip-off moved to 10:15.", tagged: ["grandma"] }]]],
      ["recipients", r.cmt.text.to, ["Brett (you) [disabled]", "Heather", "Angie (Grandma) [checked]"]], ["body and link", r.cmt.text.body, `${body}\n${pageLink(E(7))}`],
      ["cancel text: Heather and Angie checked, still this page's link", [r.cancel.to, r.cancel.body.split("\n")[1]], [["Brett (you) [disabled]", "Heather [checked]", "Angie (Grandma) [checked]"], pageLink(E(11))]]]);
    check("activities page", "parent session: never requests settings, breaks, swaps, swap_details, share_links or app_users, and never sends a server-set field", !r.forbidden.length && !r.serverSet.length, [`${all.length} requests`, ...r.forbidden, ...r.serverSet]);
    setGolden("activities-parent", r);
  }

  // =========================================================================
  // 9. Error messages
  // =========================================================================
  {
    const r = {};
    const s = await open("activities", "activities errors", { at: T_ACT, fake: { db: DB, role: "admin" }, expectErrors: true }), p = s.page;
    const toastAfter = async () => { await settle(s); await until(s, () => !document.getElementById("toast").hidden); return a(s, "toast"); };
    // A place still used by a team and by activities.
    await p.locator(`#placeList [data-editplace="${PLACE.rec}"]`).click(); await p.locator("#plRemove").click(); await p.locator("#plRmYes").click(); r.place = await toastAfter();
    await p.locator("#placeScrim [data-close]").click();
    await p.locator(`#teamList [data-team="${TEAM.soccer}"]`).click(); await p.locator("#tmRemove").click(); await p.locator("#tmRmYes").click(); r.team = await toastAfter();
    await p.locator("#teamScrim [data-close]").click();
    await p.locator(`#placeList [data-editplace="${PLACE.unused}"]`).click(); await p.locator("#plRemove").click(); await p.locator("#plRmYes").click(); r.unused = await toastAfter();
    // A kid name over the 60-character limit (the page's own limit is taken off, as if an older page had sent it).
    await p.locator(`#kidList [data-kidedit="${KID.ava}"]`).click(); await p.evaluate(() => document.getElementById("kdName").removeAttribute("maxlength"));
    await p.locator("#kdName").fill("A".repeat(61)); await p.locator("#kdSave").click(); r.long = await toastAfter();
    await p.locator("#kidScrim [data-close]").click();
    // A refusal from the database rules.
    await p.evaluate(() => window.__KT_FAKE__.failNext.push({ table: "events", op: "update", error: { code: "42501", message: "permission denied for table events" } }));
    await openEv(s, E(2)); await p.locator("#evSave").click(); r.denied = await toastAfter();
    r.consoleErrors = s.errors.filter(e => !/integrity/.test(e)).length;
    await close(s);
    expectAll("activities page", "plain messages: a used place (23503), a used team (23503), an over-long name (23514) and a refusal (42501); an unused place is removed", [
      ["used place", r.place, "This place is used by an activity or a team, so it can't be removed."], ["used team", r.team, "This team is used by an activity, so it can't be removed. Turn it off instead."],
      ["unused place", r.unused, "Place removed."], ["too long", r.long, "Couldn't save: something is too long, or has a line break where it can't."],
      ["refused", r.denied, "Couldn't save: this account isn't allowed to do that."], ["console errors logged on purpose (one per failed save)", r.consoleErrors, 2]]);
  }

  // =========================================================================
  // 10. Escaping: HTML and script-like text in every free-text field, on all three pages
  // =========================================================================
  {
    const XDB = dbXss(BASE_DB), res = {};
    const f = await open("family", "family escaping", { at: T_ACT, respond: fam(XDB, T_ACT.instant) });
    await f.page.locator('[data-act="month"]').click(); await f.page.locator("#fLogMore").click();
    for (const iso of ["2026-12-01", "2026-12-02", "2026-12-05", "2027-01-15"]) { await clickDay(f, iso); res["family " + iso] = (await a(f, "xss")).text.length; await f.page.locator("#famDayScrim [data-close]").click(); }
    res.family = await a(f, "xss"); await close(f);
    const ad = await open("admin", "admin escaping", { at: T_ACT, fake: { db: XDB } });
    await ad.page.locator('[data-act="month"]').click();
    await ad.page.locator("#log > li").first().getByRole("button", { name: "Text" }).click(); res.adminTxt = await a(ad, "txt"); await ad.page.locator("#txtScrim [data-close]").click();
    res.admin = await a(ad, "xss"); await close(ad);
    const ac = await open("activities", "activities escaping", { at: T_ACT, fake: { db: XDB, role: "admin" } });
    await openEv(ac, E(3)); res.evTitle = (await a(ac, "sheet")).name;
    await openEv(ac, E(10)); await ac.page.locator("#cmtBody").fill(X("TYPEDCOMMENT")); await ac.page.locator("#tag-co").check(); await ac.page.locator("#cmtPost").click(); await waitTxt(ac);
    res.actsTxt = await a(ac, "txt"); await closeTxt(ac);
    res.actsSheets = (await a(ac, "xss")).text;                       // E10's sheet: Brett's unshared comment and the typed one
    await openEv(ac, E(7)); res.actsSheets += (await a(ac, "xss")).text;  // E7's sheet: the comment shared with Angie
    await openEv(ac, E(2)); res.evNote = (await a(ac, "sheet")).note; await ac.page.locator("#evScrim [data-close]").click();
    await ac.page.locator(`#teamList [data-team="${TEAM.soccer}"]`).click(); res.teamName = await ac.page.locator("#tmName").inputValue(); await ac.page.locator("#teamScrim [data-close]").click();
    await ac.page.locator(`#placeList [data-editplace="${PLACE.rec}"]`).click(); res.placeAddr = await ac.page.locator("#plAddr").inputValue(); await ac.page.locator("#placeScrim [data-close]").click();
    res.conLabel = await ac.page.locator("#cl-co").inputValue();
    res.acts = await a(ac, "xss"); await close(ac);
    const lit = (txt, tags) => tags.filter(t => !txt.includes(`<b class="xss-mark">${t}</b>`));
    const missing = {
      family: lit(res.family.text, ["KIDNAME", "PLACENAME", "ADDRESS", "TEAMNAME", "TEAMGEAR", "EVNOTE", "EVTITLE", "EVGEAR", "PLACETEXT", "COMMENT1", "LOGSUMMARY", "CAREGIVER", "SWITCHNOTE"]),
      admin: lit(res.admin.text + res.adminTxt.to.join(" "), ["KIDNAME", "PLACENAME", "TEAMNAME", "EVNOTE", "COMMENT2", "CONLABEL"]),
      activities: lit(res.acts.text + res.actsSheets + res.actsTxt.to.join(" ") + res.actsTxt.body, ["KIDNAME", "PLACENAME", "ADDRESS", "PLACENOTE", "TEAMNAME", "TEAMGEAR", "TEAMNOTE", "EVTITLE", "PLACETEXT", "COMMENT1", "COMMENT2", "LOGSUMMARY", "CONLABEL", "TYPEDCOMMENT"]),
    };
    const values = [["event title field", res.evTitle, X("EVTITLE")], ["event note field", res.evNote, X("EVNOTE")], ["team name field", res.teamName, X("TEAMNAME")], ["place address field", res.placeAddr, X("ADDRESS")], ["contact label field", res.conLabel, X("CONLABEL")]].filter(([, x, y]) => x !== y);
    check("escaping", "HTML and script-like text in kid names, titles, notes, comments, place names, addresses, gear, team names, contact labels, log summaries, typed-in places and caregiver names never runs and shows literally on the family, admin and Activities pages",
      ["family", "admin", "acts"].every(k => !res[k].fired.length && !res[k].marks && !res[k].imgs) && !missing.family.length && !missing.admin.length && !missing.activities.length && !values.length,
      [...["family", "admin", "acts"].map(k => `${k}: ran ${JSON.stringify(res[k].fired)}, injected elements ${res[k].marks}, injected images ${res[k].imgs}`),
        ...Object.entries(missing).filter(([, v]) => v.length).map(([k, v]) => `${k}: not shown literally: ${v.join(", ")}`), ...values.map(([l, x]) => `${l} holds ${JSON.stringify(x)}`)]);
  }

  // =========================================================================
  // 11. Layout at 375px and 1280px, light and dark, every sheet; screenshots
  // =========================================================================
  {
    const info = {};
    const shot = async (s, name, full = true) => { info[name] = await q(s.page, "layout", name.includes("-375-") ? 375 : 1280); await s.page.screenshot({ path: path.join(SHOT_DIR, `acts-${name}.png`), fullPage: full }); };
    for (const mobile of [true, false]) for (const dark of [false, true]) {
      const w = mobile ? 375 : 1280, tag = `${w}-${dark ? "dark" : "light"}`, o = { mobile, dark, fonts: true, at: T_ACT };
      let s = await open("family", `acts layout family ${tag}`, { ...o, respond: fam(DB, T_ACT.instant) });
      await s.page.evaluate(async () => { await document.fonts.ready; });
      await s.page.locator('[data-act="month"]').click(); await shot(s, `family-${tag}`);
      if (mobile) { await clickDay(s, "2026-12-05"); await shot(s, `family-${tag}-sheet-day`, false); }
      await close(s);
      s = await open("admin", `acts layout admin ${tag}`, { ...o, fake: { db: DB } });
      await s.page.evaluate(async () => { await document.fonts.ready; });
      await shot(s, `admin-${tag}`);
      if (mobile) { await s.page.locator("#log > li").first().getByRole("button", { name: "Text" }).click(); await shot(s, `admin-${tag}-sheet-text`, false); }
      await close(s);
      s = await open("activities", `acts layout activities ${tag}`, { ...o, fake: { db: DB, role: "admin" } });
      await s.page.evaluate(async () => { await document.fonts.ready; });
      await shot(s, `activities-${tag}`);
      if (mobile) {
        await s.page.locator("#addHand").click(); await s.page.locator(`#evKids [data-pk="both"]`).click(); await s.page.locator("#evTeam").selectOption(TEAM.bball); await shot(s, `activities-${tag}-sheet-new`, false); await s.page.locator("#evScrim [data-close]").click();
        await openEv(s, E(10)); await shot(s, `activities-${tag}-sheet-edit`, false);
        await s.page.locator("#evCmts").scrollIntoViewIfNeeded(); await shot(s, `activities-${tag}-sheet-edit-comments`, false);
        await s.page.locator("#cmtBody").fill("Layout check comment"); await s.page.locator("#tag-grandma").check(); await s.page.locator("#cmtPost").click(); await waitTxt(s); await shot(s, `activities-${tag}-sheet-text`, false); await closeTxt(s); await s.page.locator("#evScrim [data-close]").click();
        await s.page.locator(`#teamList [data-team="${TEAM.bball}"]`).click(); await shot(s, `activities-${tag}-sheet-team`, false); await s.page.locator("#teamScrim [data-close]").click();
        await s.page.locator(`#placeList [data-editplace="${PLACE.rec}"]`).click(); await shot(s, `activities-${tag}-sheet-place`, false); await s.page.locator("#placeScrim [data-close]").click();
        await s.page.locator(`#kidList [data-kidedit="${KID.ava}"]`).click(); await shot(s, `activities-${tag}-sheet-kid`, false); await s.page.locator("#kidScrim [data-close]").click();
      }
      await close(s);
    }
    {
      const s = await open("activities", "acts layout activities signin 375", { mobile: true, fonts: true, fake: { db: DB, signedIn: false } });
      await shot(s, "activities-375-light-card-signin"); await close(s);
    }
    fs.writeFileSync(path.join(SHOT_DIR, "acts-layout.json"), JSON.stringify(info, null, 1) + "\n");
    const sideways = k => info[k].docScrollWidth > info[k].viewport || info[k].bodyScrollWidth > info[k].viewport || (info[k].sheetOverflow && info[k].sheetOverflow.split(",").some(x => { const [p1, p2] = x.split("/").map(Number); return p1 > p2; }));
    for (const w of [375, 1280]) {
      const bad = Object.keys(info).filter(k => k.includes(`-${w}-`) && sideways(k));
      check("layout", `with activities at ${w}px: no sideways scroll on the family, admin and Activities pages, light and dark${w === 375 ? ", or in any sheet (day, text, new and edit activity, comments, team, place, kid, sign-in)" : ""}`, !bad.length,
        bad.flatMap(k => [`${k}: content ${info[k].docScrollWidth}px in ${info[k].viewport}px, sheet ${info[k].sheetOverflow || "n/a"}`, ...info[k].wide]));
    }
    const small = Object.entries(info).filter(([k]) => k.includes("-375-light")).map(([k, v]) => `${k}: ${v.smallTargets.join("; ") || "none"}`);
    console.log(`INFO   tap targets under 44px with activities (375px light):\n         ${small.join("\n         ")}`);
  }
}
