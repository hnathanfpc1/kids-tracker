/* Kids Tracker test harness: activities slice 1B, "Paste and import". Test tooling only, never shipped with the site.
   Run through run.mjs ("npm test"). Everything here is made up: kids Ava and Max, places from tests/fixtures/acts.json, +1555555 numbers.

   Part 1 (importUnitChecks) calls window.KTImport's pure functions in node with "today" passed in and the device zone passed as America/Chicago.
   Part 2 (importPageChecks) runs the real Activities page on the fake Supabase: paste, calendar file, photo helper, review screen, saving.

   Hand arithmetic used below (today is Tue 2026-12-01 unless a check says otherwise):
     5:30 pm = 17*60+30 = 1050 minutes, 6:30 pm = 1110, 6 pm = 1080, 7 pm = 1140, 10 am = 600, 9 am = 540, 12 am = 0, 12:30 am = 30, 12 pm = 720, 1 pm = 780,
     11:30 am = 690, 12:30 pm = 750, 8 pm = 1200, 9:30 pm = 1290, 5 pm = 1020.
     America/Chicago is UTC-6 in winter (CST) and UTC-5 in summer (CDT). Daylight time ends Sun 2026-11-01 and starts Sun 2027-03-14.
     So 2026-10-31 22:30Z = 17:30 CDT, 2026-11-01 23:30Z = 17:30 CST, 2027-03-13 23:30Z = 17:30 CST, 2027-03-14 23:30Z = 18:30 CDT. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "acts.json"), "utf8"));
const DAYMS = 86400000;
const toNum = s => Math.round(Date.parse(s + "T00:00:00Z") / DAYMS);
const toStr = n => new Date(n * DAYMS).toISOString().slice(0, 10);
const cl = x => JSON.parse(JSON.stringify(x));
const KID = { ava: "a0000000-0000-4000-8000-000000000001", max: "a0000000-0000-4000-8000-000000000002" };
const TEAM = { soccer: "c0000000-0000-4000-8000-000000000001" };
const PLACE = { rec: "b0000000-0000-4000-8000-000000000001", gym: "b0000000-0000-4000-8000-000000000002", studio: "b0000000-0000-4000-8000-000000000003" };
const E = n => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T_ACT = { day: "2026-12-01", instant: "2026-12-01T12:00:00-05:00" };
const FORBIDDEN_PARENT = ["settings", "breaks", "swaps", "swap_details", "share_links", "app_users"];

// ---------------------------------------------------------------------------
// Part 1: KTImport in node
// ---------------------------------------------------------------------------
export function importUnitChecks({ check, expectAll, ROOT }) {
  const require = createRequire(import.meta.url);
  const KT = require(path.join(ROOT, "import.js"));
  const KIDS = [{ id: "k-ava", name: "Ava", active: true }, { id: "k-max", name: "Max", active: true }];
  const PLACES = [{ id: "p-rec", name: "Rec Center Field 3" }, { id: "p-gym", name: "Eastside Gym" }, { id: "p-studio", name: "Studio B" }];
  const nameOf = id => (KIDS.find(k => k.id === id) || { name: id }).name;
  const ctx = (today = "2026-12-01", extra = {}) => ({ today: toNum(today), tz: "America/Chicago", kids: KIDS, places: PLACES, ...extra });
  const flagsOf = it => it.flags.map(f => `${f.f}${f.soft ? "~" : ""}: ${f.t}`);
  const S = it => ({ day: it.day, start: it.start, end: it.end, kids: it.kids.map(nameOf), place: it.place_id || it.place_text || null, flags: flagsOf(it) });
  const list = (text, today, extra) => KT.parseList(text, ctx(today, extra));
  const ONE = (line, today) => { const r = list(line, today); return r.items[0] ? S(r.items[0]) : { none: true, ignored: r.ignored, error: r.error }; };
  const NO_END = "time~: No end time.";

  // ---- Paste: layouts ----
  {
    const tabHead = ["Date\tTime\tWhat\tKid\tPlace\tUnsure", "2026-12-03\t5:30-6:30 pm\tSoccer practice\tAva\teastside GYM\t", "2026-12-05\t10 am\tGame vs Eagles\tBoth\tNorth Court\tGuessed the opponent"].join("\n");
    const r1 = list(tabHead);
    expectAll("import reader", "paste, tab separated with a header row: columns found by name, case-insensitive place match, blank unsure ignored, unknown place kept as typed text with a flag, the unsure text shown as a flag", [
      ["header", r1.header, true], ["rows", r1.items.length, 2],
      ["row 1", S(r1.items[0]), { day: "2026-12-03", start: 1050, end: 1110, kids: ["Ava"], place: "p-gym", flags: [] }],
      ["row 1 kind and what", [r1.items[0].kind, r1.items[0].what], ["practice", "Soccer practice"]],
      ["row 2", S(r1.items[1]), { day: "2026-12-05", start: 600, end: null, kids: ["Ava", "Max"], place: "North Court", flags: [NO_END, "place: I don't know this place. It will be saved as typed text.", "unsure: Guessed the opponent"] }],
      ["row 2 kind", r1.items[1].kind, "game"]]);
    const r2 = list("Dec 5\t10am\tGame\tBoth\tStudio B\nDec 8\t6:00 pm\tPiano lesson\tMax\tStudio B");
    expectAll("import reader", "paste, tab separated with NO header row: the date, time, kid and place columns are worked out from what is in them", [
      ["header", r2.header, false],
      ["row 1", S(r2.items[0]), { day: "2026-12-05", start: 600, end: null, kids: ["Ava", "Max"], place: "p-studio", flags: ["date: No year given. I used 2026.", NO_END] }],
      ["row 1 what", r2.items[0].what, "Game"], ["row 2", S(r2.items[1]), { day: "2026-12-08", start: 1080, end: null, kids: ["Max"], place: "p-studio", flags: ["date: No year given. I used 2026.", NO_END] }],
      ["row 2 kind", r2.items[1].kind, "lesson"]]);
    const r3 = list("Date, Time, What, Kid, Place\nTue Dec 1, 5:30-6:30 pm, Practice, Ava, Eastside Gym\nSat Dec 5, 10am, Game, Both");
    expectAll("import reader", "paste, comma separated (the placeholder text on the sheet): weekday names agree with the date, a short last row is fine", [
      ["rows", r3.items.length, 2], ["row 1", S(r3.items[0]), { day: "2026-12-01", start: 1050, end: 1110, kids: ["Ava"], place: "p-gym", flags: ["date: No year given. I used 2026."] }],
      ["row 2", S(r3.items[1]), { day: "2026-12-05", start: 600, end: null, kids: ["Ava", "Max"], place: null, flags: ["date: No year given. I used 2026.", NO_END] }]]);
    const r4 = list("Tue Dec 1 5:30-6:30 pm Soccer practice Ava at Rec Center Field 3\nSat Dec 5 10am Game Both\nremember water bottles");
    expectAll("import reader", "paste, typed lines with no separators: date, then time, then the rest; the kid and the saved place are picked out of the rest; a line with no date or time is left out and counted", [
      ["rows", r4.items.length, 2], ["ignored", r4.ignored, 1],
      ["row 1", [S(r4.items[0]), r4.items[0].what], [{ day: "2026-12-01", start: 1050, end: 1110, kids: ["Ava"], place: "p-rec", flags: ["date: No year given. I used 2026."] }, "Soccer practice"]],
      ["row 2", [S(r4.items[1]), r4.items[1].what], [{ day: "2026-12-05", start: 600, end: null, kids: ["Ava", "Max"], place: null, flags: ["date: No year given. I used 2026.", NO_END] }, "Game"]]]);
    const r5 = list("Dec 1, 2026, 5pm, Game, Ava");
    expectAll("import reader", "\"Dec 1, 2026\" split into two comma cells is put back together as one date with a year (no \"no year\" flag)", [["row", S(r5.items[0]), { day: "2026-12-01", start: 1020, end: null, kids: ["Ava"], place: null, flags: [NO_END] }]]);
    const ro = list("Sat Dec 5, 10am, Game, Ava\nlots of text with no date");
    expectAll("import reader", "a pasted block with only one readable row still reads it and reports the other as left out", [["rows", ro.items.length, 1], ["ignored", ro.ignored, 1]]);
  }

  // ---- Paste: dates with no year ----
  {
    const D = (txt, today) => ONE(txt + ", 5 pm, Game, Ava", today);
    const dflags = txt => D(txt).flags.filter(f => /^date/.test(f));
    const yr = (txt, today) => { const o = D(txt, today); return [o.day, o.flags.filter(f => /^date/.test(f))]; };
    expectAll("import reader", "dates with no year: the year is the next one on or after today, and the flag says which year was used (today Dec 1 2026: Dec 5 is 2026, Jan 5 is 2027; today Dec 28 2026: Dec 28 is today, Jan 5 is 2027)", [
      ["Dec 5 pasted Dec 1 2026", yr("Dec 5", "2026-12-01"), ["2026-12-05", ["date: No year given. I used 2026."]]],
      ["Jan 5 pasted Dec 1 2026 (January date in December)", yr("Jan 5", "2026-12-01"), ["2027-01-05", ["date: No year given. I used 2027."]]],
      ["Jan 5 pasted Dec 28 2026", yr("Jan 5", "2026-12-28"), ["2027-01-05", ["date: No year given. I used 2027."]]],
      ["Dec 28 pasted Dec 28 2026 (today counts)", yr("Dec 28", "2026-12-28"), ["2026-12-28", ["date: No year given. I used 2026."]]],
      ["Fri Jan 1 pasted Dec 1 2026 (weekday agrees with 2027)", yr("Fri Jan 1", "2026-12-01"), ["2027-01-01", ["date: No year given. I used 2027."]]],
      ["Mar 3 pasted Dec 28 2026", yr("Mar 3", "2026-12-28"), ["2027-03-03", ["date: No year given. I used 2027."]]]]);
    // Decided 2026-11-20: a schedule pasted mid season lists dates that have just gone by. Those stay in this year (up to 60 days back) so they are
    // not added a year out by mistake; the review screen leaves a past date unchecked. Anything older than 60 days means next year's.
    expectAll("import reader", "a no-year date from the last 60 days stays in this year (Dec 1 and Dec 27 pasted on Dec 28 2026, Nov 15 pasted on Dec 1 2026); one more than 60 days back means next year's (Sep 1 pasted on Dec 1 2026)", [
      ["Dec 1 pasted Dec 28 2026", yr("Dec 1", "2026-12-28")[0], "2026-12-01"], ["Dec 27 pasted Dec 28 2026", yr("Dec 27", "2026-12-28")[0], "2026-12-27"],
      ["Nov 15 pasted Dec 1 2026", yr("Nov 15", "2026-12-01")[0], "2026-11-15"], ["Sep 1 pasted Dec 1 2026 (91 days back)", yr("Sep 1", "2026-12-01")[0], "2027-09-01"]]);
    expectAll("import reader", "leap day: Feb 29 with no year pasted Dec 1 2027 is Feb 29 2028; 2028-02-29 and 2/29/2028 are read; 2027-02-29 and Feb 29 with no leap year ahead are refused with a plain flag", [
      ["Feb 29 pasted Dec 1 2027", yr("Feb 29", "2027-12-01"), ["2028-02-29", ["date: No year given. I used 2028."]]],
      ["2028-02-29", D("2028-02-29", "2026-12-01").day, "2028-02-29"], ["2/29/2028", D("2/29/2028", "2026-12-01").day, "2028-02-29"],
      ["2027-02-29", [D("2027-02-29", "2026-12-01").day, D("2027-02-29", "2026-12-01").flags[0]], [null, "date: No date found."]],
      ["Feb 29 pasted Dec 1 2026", [D("Feb 29", "2026-12-01").day, D("Feb 29", "2026-12-01").flags[0]], [null, "date: No date found."]]]);
    expectAll("import reader", "other date spellings: 12/3/2026, 12/3/26, 3 Dec, December 3rd 2026, Thu Dec 3 2026; and a wrong weekday is flagged (Fri Dec 4 is a Friday, Fri Dec 5 2026 is a Saturday)", [
      ["12/3/2026", D("12/3/2026").day, "2026-12-03"], ["12/3/26", D("12/3/26").day, "2026-12-03"], ["3 Dec 2026", D("3 Dec 2026").day, "2026-12-03"],
      ["December 3rd 2026", D("December 3rd 2026").day, "2026-12-03"], ["Thu Dec 3 2026", [D("Thu Dec 3 2026").day, dflags("Thu Dec 3 2026")], ["2026-12-03", []]],
      ["Fri Dec 4 2026", dflags("Fri Dec 4 2026"), []],
      ["Fri Dec 5 2026", dflags("Fri Dec 5 2026"), ["date: Dec 5 is a Saturday, not a Friday. Check the date."]]]);
    expectAll("import reader", "a date before today with a year is kept and flagged in the past (Nov 20 2026 pasted Dec 1 2026)", [["flags", dflags("2026-11-20"), ["date: This date is in the past."]]]);
  }

  // ---- Paste: times ----
  {
    const T = txt => { const o = ONE(`2026-12-03, ${txt}, Game, Ava`); return o.none ? o : [o.start, o.end, o.flags]; };
    expectAll("import reader", "time ranges in several spellings all read as 5:30 to 6:30 pm (1050 to 1110): '5:30-6:30 pm', '5:30 pm - 6:30 pm', '5:30pm to 6:30pm', '5:30 p.m. - 6:30 p.m.', '17:30-18:30', '5:30-6:30pm', '5:30 pm until 6:30 pm'", [
      ["5:30-6:30 pm", T("5:30-6:30 pm"), [1050, 1110, []]], ["5:30 pm - 6:30 pm", T("5:30 pm - 6:30 pm"), [1050, 1110, []]], ["5:30pm to 6:30pm", T("5:30pm to 6:30pm"), [1050, 1110, []]],
      ["5:30 p.m. - 6:30 p.m.", T("5:30 p.m. - 6:30 p.m."), [1050, 1110, []]], ["17:30-18:30", T("17:30-18:30"), [1050, 1110, []]], ["5:30-6:30pm", T("5:30-6:30pm"), [1050, 1110, []]],
      ["5:30 pm until 6:30 pm", T("5:30 pm until 6:30 pm"), [1050, 1110, []]]]);
    expectAll("import reader", "start time only: '5:30 pm' is 1050 with a soft 'No end time' note, not a problem", [["5:30 pm", T("5:30 pm"), [1050, null, [NO_END]]], ["6 pm", T("6 pm"), [1080, null, [NO_END]]], ["10am", T("10am"), [600, null, [NO_END]]]]);
    expectAll("import reader", "no am or pm is flagged with the guess: '5:30' is 5:30 p.m., '9:00' is 9:00 a.m., '6-7' is 6:00 to 7:00 p.m.", [
      ["5:30", T("5:30"), [1050, null, ["time: No am or pm. I guessed 5:30 p.m.", NO_END]]], ["9:00", T("9:00"), [540, null, ["time: No am or pm. I guessed 9:00 a.m.", NO_END]]],
      ["6-7", T("6-7"), [1080, 1140, ["time: No am or pm. I guessed 6:00 p.m. to 7:00 p.m."]]]]);
    expectAll("import reader", "12 a.m. is minute 0 (not missing), 12:30 a.m. is 30, 12 p.m. and 12:00 p.m. are noon (720), 12 pm - 1 pm is 720 to 780, and a range that crosses noon ('11:30 am - 12:30 pm', '11:30-12:30 pm') is 690 to 750", [
      ["12 am", T("12 am"), [0, null, [NO_END]]], ["12:30 am", T("12:30 am"), [30, null, [NO_END]]], ["12 pm", T("12 pm"), [720, null, [NO_END]]], ["12:00 p.m.", T("12:00 p.m."), [720, null, [NO_END]]],
      ["12 pm - 1 pm", T("12 pm - 1 pm"), [720, 780, []]], ["11:30 am - 12:30 pm", T("11:30 am - 12:30 pm"), [690, 750, []]], ["11:30-12:30 pm", T("11:30-12:30 pm"), [690, 750, []]]]);
    expectAll("import reader", "an end before the start is left out with a flag ('6:30 pm - 5:30 pm' keeps 1110 and drops the end)", [["6:30 pm - 5:30 pm", T("6:30 pm - 5:30 pm"), [1110, null, ["time: The end time is before the start. I left it out.", NO_END]]]]);
    const nt = list("Date\tTime\tWhat\n2026-12-03\tsoon\tGame");
    expectAll("import reader", "a time that cannot be read is kept as a row with a flag naming what was typed (nothing is dropped silently)", [["rows", nt.items.length, 1], ["start", nt.items[0] && nt.items[0].start, null], ["flag", nt.items[0] && flagsOf(nt.items[0]).filter(f => /^time:/.test(f)), ["time: I couldn't read the time \"soon\"."]]]);
  }

  // ---- Paste: kids, places ----
  {
    const K = txt => { const r = list(`Date\tTime\tKid\n2026-12-03\t5 pm\t${txt}`); return r.items[0] ? [r.items[0].kids.map(nameOf), flagsOf(r.items[0]).filter(f => /^kid/.test(f))] : r; };
    expectAll("import reader", "kid matching: 'Both' and 'all kids' are every active kid, 'Ava, Max' and 'Ava and Max' and 'max & ava' are both, 'ava' ignores case, an unknown kid is flagged and not guessed, a known kid next to an unknown one keeps the known one", [
      ["Both", K("Both"), [["Ava", "Max"], []]], ["all kids", K("all kids"), [["Ava", "Max"], []]], ["Ava, Max", K("Ava, Max"), [["Ava", "Max"], []]], ["Ava and Max", K("Ava and Max"), [["Ava", "Max"], []]],
      ["max & ava", K("max & ava"), [["Max", "Ava"], []]], ["ava", K("ava"), [["Ava"], []]], ["Sam", K("Sam"), [[], ["kid: I don't know the kid \"Sam\"."]]],
      ["Ava, Sam", K("Ava, Sam"), [["Ava"], ["kid: I don't know the kid \"Sam\"."]]]]);
    const withInactive = KT.parseList("Date\tTime\tKid\n2026-12-03\t5 pm\tBoth", { ...ctx(), kids: [...KIDS, { id: "k-zed", name: "Zed", active: false }] });
    expectAll("import reader", "'Both' never includes a kid who is turned off", [["kids", withInactive.items[0].kids, ["k-ava", "k-max"]]]);
    const P = txt => { const r = list(`Date\tTime\tWhat\tPlace\n2026-12-03\t5 pm\tGame\t${txt}`); return S(r.items[0]); };
    expectAll("import reader", "place matching ignores case, spacing and punctuation ('EASTSIDE  gym', 'Eastside Gym!'); an unknown place is kept as typed text with a flag; a saved place plus extra words is NOT guessed in a paste", [
      ["EASTSIDE  gym", [P("EASTSIDE  gym").place, P("EASTSIDE  gym").flags], ["p-gym", [NO_END]]], ["Eastside Gym!", P("Eastside Gym!").place, "p-gym"],
      ["North Court", [P("North Court").place, P("North Court").flags], ["North Court", [NO_END, "place: I don't know this place. It will be saved as typed text."]]],
      ["Eastside Gym field 2", P("Eastside Gym field 2").place, "Eastside Gym field 2"]]);
  }

  // ---- Paste: limits ----
  {
    const row = i => `2026-12-${String((i % 28) + 1).padStart(2, "0")}\t5 pm\tGame\tAva`;
    const mk = n => ["Date\tTime\tWhat\tKid", ...Array.from({ length: n }, (_, i) => row(i))].join("\n");
    const ok = list(mk(300)), many = list(mk(301)), big = list("x".repeat(KT.MAX_BYTES + 1)), none = list("   \n  ");
    expectAll("import reader", "limits: 300 rows are read, 301 are refused with the count, over 1 MB is refused with a plain message, empty text asks for a list", [
      ["300 rows", [ok.items.length, ok.tooMany], [300, false]], ["301 rows", [many.items.length, many.tooMany, many.total], [0, true, 301]],
      ["over 1 MB", big.error, "That is too much text. Paste up to 1 MB at a time."], ["empty", none.error, "Nothing to read yet. Paste your list first."]]);
  }

  // ---- Calendar file ----
  const ics = (...events) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Example//EN", ...events, "END:VCALENDAR", ""].join("\r\n");
  const ev = (...lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
  const IC = (text, today, extra) => KT.parseIcs(text, ctx(today, extra));
  const IS = it => ({ day: it.day, start: it.start, end: it.end });
  {
    const r = IC(ics(
      ev("UID:u1@example.test", "DTSTART:20261203T173000", "DTEND:20261203T183000", "SUMMARY:Soccer pract", " ice\\, and more", "LOCATION:Eastside Gym\\, Court 2", "DESCRIPTION:line1\\nline2"),
      ev("UID:u2@example.test", "DTSTART:20261204T173000", "SUMMARY:Game vs Eagles\\; Hawks\\nsecond line", "SUMMARY:ignored second summary")));
    expectAll("import reader", "calendar file: folded lines are joined ('Soccer pract' + 'ice, and more'), \\, \\; \\n are unescaped, a saved place named inside the location matches, the description keeps its line break, a second SUMMARY is ignored", [
      ["rows", r.items.length, 2], ["row 1", [IS(r.items[0]), r.items[0].what, r.items[0].place_id, r.items[0].desc], [{ day: "2026-12-03", start: 1050, end: 1110 }, "Soccer practice, and more", "p-gym", "line1\nline2"]],
      ["row 2 title (newline made a space, ; and , restored)", r.items[1].what, "Game vs Eagles; Hawks second line"], ["row 2 kind", r.items[1].kind, "game"],
      ["uids", r.items.map(i => i.uid), ["u1@example.test", "u2@example.test"]], ["not converted", r.converted, false]]);
    const bad = KT.parseIcs("hello", ctx());
    expectAll("import reader", "a file that is not a calendar is refused with a plain message; over 1 MB is refused with a plain message", [
      ["not a calendar", bad.error, "That doesn't look like a calendar file."], ["over 1 MB", KT.parseIcs("BEGIN:VCALENDAR" + "x".repeat(KT.MAX_BYTES), ctx()).error, "That file is bigger than 1 MB. Export a shorter date range and try again."]]);
  }
  {
    // A UTC event shown on each side of a daylight saving change, in Chicago.
    const u = (z, e) => ics(ev("UID:z@example.test", `DTSTART:${z}`, `DTEND:${e}`, "SUMMARY:Practice"));
    const fall1 = IC(u("20261031T223000Z", "20261031T233000Z"), "2026-10-01"), fall2 = IC(u("20261101T233000Z", "20261102T003000Z"), "2026-10-01");
    const spr1 = IC(u("20270313T233000Z", "20270314T003000Z"), "2027-03-01"), spr2 = IC(u("20270314T233000Z", "20270315T003000Z"), "2027-03-01");
    const late = IC(u("20261202T020000Z", "20261202T033000Z"), "2026-12-01");
    expectAll("import reader", "UTC events are converted to the device zone (America/Chicago) on both sides of a daylight saving change: Oct 31 22:30Z is 5:30 pm CDT, Nov 1 23:30Z is 5:30 pm CST, Mar 13 23:30Z is 5:30 pm CST, Mar 14 23:30Z is 6:30 pm CDT; and a late UTC time lands on the day before (Dec 2 02:00Z is Dec 1 8:00 pm)", [
      ["Oct 31 22:30Z", IS(fall1.items[0]), { day: "2026-10-31", start: 1050, end: 1110 }], ["Nov 1 23:30Z", IS(fall2.items[0]), { day: "2026-11-01", start: 1050, end: 1110 }],
      ["Mar 13 23:30Z", IS(spr1.items[0]), { day: "2027-03-13", start: 1050, end: 1110 }], ["Mar 14 23:30Z (ends Mar 15 00:30Z = 7:30 pm CDT)", IS(spr2.items[0]), { day: "2027-03-14", start: 1110, end: 1170 }],
      ["Dec 2 02:00Z to 03:30Z", IS(late.items[0]), { day: "2026-12-01", start: 1200, end: 1290 }], ["converted flag", [fall1.converted, late.converted], [true, true]]]);
    const tz = IC(ics(ev("UID:t1@example.test", "DTSTART;TZID=America/New_York:20261203T180000", "DTEND;TZID=America/New_York:20261203T190000", "SUMMARY:Practice"),
      ev("UID:t2@example.test", "DTSTART;TZID=America/Chicago:20261204T180000", "DTEND;TZID=America/Chicago:20261204T190000", "SUMMARY:Practice")));
    expectAll("import reader", "a TZID event is converted too: 6 pm New York is 5 pm Chicago (1020 to 1080), and 6 pm Chicago stays 6 pm (1080 to 1140)", [
      ["New York 6 pm", IS(tz.items[0]), { day: "2026-12-03", start: 1020, end: 1080 }], ["Chicago 6 pm", IS(tz.items[1]), { day: "2026-12-04", start: 1080, end: 1140 }]]);
    const un = IC(ics(ev("UID:t3@example.test", "DTSTART;TZID=Eastern Standard Time:20261203T180000", "DTEND;TZID=Eastern Standard Time:20261203T190000", "SUMMARY:Practice")));
    expectAll("import reader", "a TZID the reader does not know (a Windows name like 'Eastern Standard Time') uses the time as written, as the flag says: 6 pm stays 6 pm (1080 to 1140)", [
      ["time", IS(un.items[0]), { day: "2026-12-03", start: 1080, end: 1140 }], ["flag", flagsOf(un.items[0]).filter(f => /^time:/.test(f)), ["time: I don't know the time zone \"Eastern Standard Time\". I used the time as written."]]]);
    const fl = IC(ics(ev("UID:f1@example.test", "DTSTART:20261203T173000", "DURATION:PT1H30M", "SUMMARY:Practice"), ev("UID:f2@example.test", "DTSTART:20261204T230000", "DTEND:20261205T010000", "SUMMARY:Late")));
    expectAll("import reader", "a floating time is used as written (5:30 pm is 1050), DURATION PT1H30M gives an end of 7:00 pm (1140), and an end after midnight is left out with a flag", [
      ["floating plus duration", IS(fl.items[0]), { day: "2026-12-03", start: 1050, end: 1140 }], ["after midnight", [IS(fl.items[1]), flagsOf(fl.items[1]).filter(f => /midnight/.test(f))], [{ day: "2026-12-04", start: 1380, end: null }, ["time: It ends after midnight. I left the end time out."]]]]);
    const ad = IC(ics(ev("UID:a1@example.test", "DTSTART;VALUE=DATE:20261205", "DTEND;VALUE=DATE:20261206", "SUMMARY:Tournament day"), ev("UID:a2@example.test", "DTSTART:20261206T100000", "SUMMARY:Game", "STATUS:CANCELLED"), ev("UID:a3@example.test", "DTSTART:20261207T100000", "SUMMARY:Game", "STATUS:CANCELED")));
    expectAll("import reader", "an all-day event has no start and says to set one; STATUS:CANCELLED and the CANCELED spelling both mark the row canceled", [
      ["all day", [IS(ad.items[0]), flagsOf(ad.items[0])], [{ day: "2026-12-05", start: null, end: null }, ["time: All day event. Set a start time."]]],
      ["cancelled", ad.items.map(i => i.canceled), [false, true, true]]]);
  }
  {
    const wk = (start, rule, extra = []) => IC(ics(ev("UID:w@example.test", `DTSTART:${start}T173000`, "DTEND:" + start + "T183000", "SUMMARY:Soccer practice", `RRULE:${rule}`, ...extra)));
    const days = r => r.items.map(i => i.day);
    expectAll("import reader", "weekly repeats: UNTIL (Thursdays Dec 3 to Dec 24 is 4), COUNT=3, BYDAY on two days (Tue and Thu from Tue Dec 1, 5 in all), BYDAY when the first day is not in the list (Mon and Wed from Wed Dec 2, 3 in all), INTERVAL=2, a UTC UNTIL on a TZID series", [
      ["UNTIL", days(wk("20261203", "FREQ=WEEKLY;UNTIL=20261224T235959")), ["2026-12-03", "2026-12-10", "2026-12-17", "2026-12-24"]],
      ["COUNT=3", days(wk("20261203", "FREQ=WEEKLY;COUNT=3")), ["2026-12-03", "2026-12-10", "2026-12-17"]],
      ["BYDAY=TU,TH COUNT=5", days(wk("20261201", "FREQ=WEEKLY;BYDAY=TU,TH;COUNT=5")), ["2026-12-01", "2026-12-03", "2026-12-08", "2026-12-10", "2026-12-15"]],
      ["BYDAY=MO,WE from a Wednesday", days(wk("20261202", "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3")), ["2026-12-02", "2026-12-07", "2026-12-09"]],
      ["INTERVAL=2 COUNT=3", days(wk("20261203", "FREQ=WEEKLY;INTERVAL=2;COUNT=3")), ["2026-12-03", "2026-12-17", "2026-12-31"]],
      ["UTC UNTIL with a TZID start", days(IC(ics(ev("UID:w@example.test", "DTSTART;TZID=America/Chicago:20261203T173000", "SUMMARY:Practice", "RRULE:FREQ=WEEKLY;UNTIL=20261225T000000Z")))), ["2026-12-03", "2026-12-10", "2026-12-17", "2026-12-24"]]]);
    const ex = wk("20261203", "FREQ=WEEKLY;COUNT=4", ["EXDATE:20261210T173000"]);
    expectAll("import reader", "EXDATE removes that one date (4 Thursdays minus Dec 10 leaves Dec 3, 17, 24); each repeat gets its own id (uid#date) so each can be matched later", [
      ["days", days(ex), ["2026-12-03", "2026-12-17", "2026-12-24"]], ["uids", ex.items.map(i => i.uid), ["w@example.test#2026-12-03", "w@example.test#2026-12-17", "w@example.test#2026-12-24"]]]);
    const un1 = wk("20261203", "FREQ=MONTHLY;COUNT=3"), un2 = wk("20261203", "FREQ=DAILY;COUNT=5"), un3 = wk("20261203", "FREQ=WEEKLY"), un4 = wk("20261203", "FREQ=WEEKLY;BYSETPOS=1;COUNT=3");
    const msg = "other: Repeats in a way I can't read. Only the first date was added.";
    expectAll("import reader", "a repeat the reader cannot handle (monthly, daily, weekly with no end, BYSETPOS) gives the first date only with a flag", [
      ["monthly", [days(un1), flagsOf(un1.items[0])], [["2026-12-03"], [msg]]], ["daily", [days(un2), flagsOf(un2.items[0])[0]], [["2026-12-03"], msg]],
      ["weekly with no end", [days(un3), flagsOf(un3.items[0])[0]], [["2026-12-03"], msg]], ["BYSETPOS", [days(un4), flagsOf(un4.items[0])[0]], [["2026-12-03"], msg]]]);
    const past = IC(ics(ev("UID:p1@example.test", "DTSTART:20261120T173000", "SUMMARY:Old"), ev("UID:p2@example.test", "DTSTART:20261112T173000", "SUMMARY:Series", "RRULE:FREQ=WEEKLY;COUNT=4"),
      ev("UID:p3@example.test", "DTSTART:20261001T173000", "SUMMARY:Monthly", "RRULE:FREQ=MONTHLY;COUNT=3")));
    expectAll("import reader", "events that ended before today are skipped and counted: a Nov 20 event, a weekly series Nov 12, 19, 26 (3 past, Dec 3 kept), and an unreadable monthly repeat that began Oct 1 (counted as unreadable)", [
      ["kept", past.items.map(i => i.day), ["2026-12-03"]], ["skippedPast (1 + 3 + 1)", past.skippedPast, 5], ["skippedUnreadable", past.skippedUnreadable, 1]]);
    const edge = IC(ics(ev("UID:e1@example.test", "DTSTART:20261130T233000", "DTEND:20261201T003000", "SUMMARY:Spans"), ev("UID:e2@example.test", "DTSTART:20261201T080000", "SUMMARY:Today")));
    expectAll("import reader", "an event on today is kept; one that ends after midnight today is kept even though it started yesterday", [["days", edge.items.map(i => i.day), ["2026-11-30", "2026-12-01"]], ["skippedPast", edge.skippedPast, 0]]);
    const dupUid = IC(ics(ev("UID:same@example.test", "DTSTART:20261203T173000", "SUMMARY:A"), ev("UID:same@example.test", "DTSTART:20261204T173000", "SUMMARY:B")));
    expectAll("import reader", "the same calendar id twice in one file keeps it on the first only, so the database never sees a clash", [["uids", dupUid.items.map(i => i.uid), ["same@example.test", null]]]);
    const many = IC(ics(...Array.from({ length: 301 }, (_, i) => ev(`UID:m${i}@example.test`, "DTSTART:20261203T173000", "SUMMARY:A"))));
    const fine = IC(ics(...Array.from({ length: 300 }, (_, i) => ev(`UID:m${i}@example.test`, "DTSTART:20261203T173000", "SUMMARY:A"))));
    expectAll("import reader", "300 events in a file are read, 301 are refused with the count", [["300", [fine.items.length, fine.tooMany], [300, false]], ["301", [many.items.length, many.tooMany, many.total], [0, true, 301]]]);
  }

  // ---- Duplicates, moves, wording ----
  {
    const ava = "k-ava";
    const exist = (o = {}) => ({ id: "x1", day: "2026-12-03", start: 1050, end: 1110, kid_ids: [ava], title: "Soccer practice", kind: "practice", team_id: null, place_id: null, place_text: null, status: "on", source_uid: null, label: "Soccer practice", ...o });
    const run = (text, existing, today = "2026-12-01", parse = list) => { const r = parse(text, today); KT.classify(r.items, existing, { kids: [] }, { teams: new Map(), kids: KIDS, places: new Map(PLACES.map(p => [p.id, p])) }, toNum(today)); return r.items; };
    const st = it => [it.status, !!it.checked];
    const row = (t = "5:30-6:30 pm", what = "Soccer practice", kid = "Ava", day = "2026-12-03") => `Date\tTime\tWhat\tKid\n${day}\t${t}\t${what}\t${kid}`;
    expectAll("import dupes", "a pasted row with the same kids, date, start time and what as an existing activity is 'Already on the tracker' (status dup) and unchecked; a different kid, a different day or a different name is new and checked", [
      ["same", st(run(row(), [exist()])[0]), ["dup", false]], ["different kid", st(run(row("5:30-6:30 pm", "Soccer practice", "Max"), [exist()])[0]), ["new", true]],
      ["different day", st(run(row("5:30-6:30 pm", "Soccer practice", "Ava", "2026-12-10"), [exist()])[0]), ["new", true]],
      ["different what (Piano lesson vs Soccer practice)", st(run(row("5:30-6:30 pm", "Piano lesson"), [exist()])[0]), ["new", true]],
      ["existing is canceled: still counts as on the tracker", st(run(row(), [exist({ status: "canceled" })])[0]), ["dup", false]]]);
    // Same day, kid and name but a different start time and no calendar id. Decided 2026-11-20 (plan section 7, "Time moved 5:30 to 6:00"): it is shown as a move,
    // old and new, and the row can be switched to "add as its own activity". Exact matches are claimed first, so a doubleheader pasted in full is never a move.
    const LK = { teams: new Map(), kids: KIDS, places: new Map(PLACES.map(p => [p.id, p])) };
    const two = run(row("6:30 pm", "Soccer practice"), [exist()])[0];
    const twoDefault = [st(two), two.changes, !!two.canSplit];
    two.asNew = true; KT.classify([two], [exist()], { kids: [] }, LK, toNum("2026-12-01"));
    const twoSplit = [st(two), two.changes, two.target];
    const dh = t => run("Date\tTime\tWhat\tKid\n" + t.map(x => `2026-12-03\t${x}\tSoccer practice\tAva`).join("\n"), [exist()]).map(it => [it.start, it.status, !!it.checked]).sort((a, b) => a[0] - b[0]);
    expectAll("import dupes", "a pasted row with the same kid, day and name at a DIFFERENT start time shows as a move (old and new, checked, can be split off); switched to 'add as its own activity' it is new and touches nothing; a doubleheader pasted in full, in either order, is one 'Already on the tracker' and one new", [
      ["default", twoDefault, [["moved", true], ["Time moved 5:30 p.m. to 6:30 p.m."], true]], ["split off", twoSplit, [["new", true], [], null]],
      ["5:30 then 6:30", dh(["5:30-6:30 pm", "6:30 pm"]), [[1050, "dup", false], [1110, "new", true]]], ["6:30 then 5:30", dh(["6:30 pm", "5:30-6:30 pm"]), [[1050, "dup", false], [1110, "new", true]]]]);
    const mv = run("BEGIN:VCALENDAR\r\n" + ev("UID:u1@example.test", "DTSTART:20261203T180000", "DTEND:20261203T190000", "SUMMARY:Soccer practice") + "\r\nEND:VCALENDAR", [exist({ source_uid: "u1@example.test" })], "2026-12-01", (t, today) => KT.parseIcs(t, ctx(today)));
    const same = run("BEGIN:VCALENDAR\r\n" + ev("UID:u1@example.test", "DTSTART:20261203T173000", "DTEND:20261203T183000", "SUMMARY:Soccer practice") + "\r\nEND:VCALENDAR", [exist({ source_uid: "u1@example.test" })], "2026-12-01", (t, today) => KT.parseIcs(t, ctx(today)));
    const dmv = run("BEGIN:VCALENDAR\r\n" + ev("UID:u1@example.test", "DTSTART:20261210T173000", "DTEND:20261210T183000", "SUMMARY:Soccer practice") + "\r\nEND:VCALENDAR", [exist({ source_uid: "u1@example.test" })], "2026-12-01", (t, today) => KT.parseIcs(t, ctx(today)));
    const can = run("BEGIN:VCALENDAR\r\n" + ev("UID:u1@example.test", "DTSTART:20261203T173000", "SUMMARY:Soccer practice", "STATUS:CANCELLED") + "\r\nEND:VCALENDAR", [exist({ source_uid: "u1@example.test" })], "2026-12-01", (t, today) => KT.parseIcs(t, ctx(today)));
    const can2 = run("BEGIN:VCALENDAR\r\n" + ev("UID:nope@example.test", "DTSTART:20261203T173000", "SUMMARY:Soccer practice", "STATUS:CANCELLED") + "\r\nEND:VCALENDAR", [], "2026-12-01", (t, today) => KT.parseIcs(t, ctx(today)));
    expectAll("import dupes", "same calendar id: a new time is a move (shows old and new, patch is start and end only, checked); the same time is a duplicate; a new day is a date move; canceled in the file cancels the existing one; canceled and not on the tracker is left out", [
      ["time moved", [mv[0].status, mv[0].changes, mv[0].patch, mv[0].target, mv[0].checked], ["moved", ["Time moved 5:30 p.m. to 6:00 p.m."], { start_time: "18:00", end_time: "19:00" }, "x1", true]],
      ["same time", st(same[0]), ["dup", false]],
      ["date moved", [dmv[0].status, dmv[0].changes, dmv[0].patch], ["moved", ["Date moved Dec 3 to Dec 10"], { day: "2026-12-10" }]],
      ["cancel", [can[0].status, can[0].changes, can[0].patch, can[0].checked], ["cancel", ["Canceled in the file"], { status: "canceled" }, true]],
      ["canceled, not on the tracker", can2[0].status, "gone"]]);
    const rows = (...a) => a.map(([kind, status]) => ({ kind, status: status || "new" }));
    expectAll("import wording", "headline: counts with singular and plural, practices before games, 'other activity' wording, canceled-and-absent rows not counted", [
      ["1 practice", KT.headline(rows(["practice"])), "I found 1 practice"], ["8 practices and 2 games", KT.headline(rows(...Array(8).fill(["practice"]), ["game"], ["game"])), "I found 8 practices and 2 games"],
      ["1 game", KT.headline(rows(["game"])), "I found 1 game"], ["all four kinds", KT.headline(rows(["practice"], ["game"], ["lesson"], ["other"], ["other"])), "I found 1 practice, 1 game, 1 lesson and 2 other activities"],
      ["other only, 1", KT.headline(rows(["other"])), "I found 1 activity"], ["other only, 3", KT.headline(rows(["other"], ["other"], ["other"])), "I found 3 activities"],
      ["practice and other", KT.headline(rows(["practice"], ["practice"], ["other"])), "I found 2 practices and 1 other activity"],
      ["gone rows are not counted", KT.headline(rows(["practice"], ["game", "gone"])), "I found 1 practice"], ["only canceled events that were never on the tracker", KT.headline(rows(["game", "gone"])), "Nothing to add or change"], ["no rows at all", KT.headline([]), "I couldn't find any activities"]]);
    // Fixed 2026-11-21 (executive review): the same new line listed twice in one paste is flagged, and a file holding only a canceled event that
    // was never on the tracker no longer says "Everything looks clear".
    const tw = t => run("Date\tTime\tWhat\tKid\n" + t.map(x => `2026-12-03\t${x[0]}\t${x[1] || "Soccer practice"}\t${x[2] || "Ava"}`).join("\n"), []);
    const tws = t => tw(t).map(it => [it.status, !!it.checked]);
    const t3 = tw([["5:30 pm"], ["5:30 pm"], ["5:30 pm"]]);
    const fix = tw([["5:30 pm"], ["5:30 pm"]]); fix[1].start = 1110; KT.classify(fix, [], { kids: [] }, LK, toNum("2026-12-01"));
    const onTracker = run("Date\tTime\tWhat\tKid\n2026-12-03\t5:30-6:30 pm\tSoccer practice\tAva\n2026-12-03\t5:30-6:30 pm\tSoccer practice\tAva", [exist()]).map(st);
    const flagged = t3.map(it => ({ ...it, flags: [] }));
    expectAll("import dupes", "the same new row listed twice in one paste: the first is new and checked, each later copy is 'twice' and unchecked; a different time, kid or name is not a copy; changing the copy's time makes it new and checked again; a second copy of a row that is already on the tracker, or that moves one, is also 'twice'", [
      ["same line twice", tws([["5:30 pm"], ["5:30 pm"]]), [["new", true], ["twice", false]]],
      ["same line three times", t3.map(st), [["new", true], ["twice", false], ["twice", false]]],
      ["with and without an end time", tws([["5:30-6:30 pm"], ["5:30 pm"]]), [["new", true], ["twice", false]]],
      ["different time", tws([["5:30 pm"], ["6:30 pm"]]), [["new", true], ["new", true]]],
      ["different kid", tws([["5:30 pm"], ["5:30 pm", "Soccer practice", "Max"]]), [["new", true], ["new", true]]],
      ["different name", tws([["5:30 pm"], ["5:30 pm", "Piano lesson"]]), [["new", true], ["new", true]]],
      ["copy edited to another time", fix.map(st), [["new", true], ["new", true]]],
      ["already on the tracker, pasted twice", onTracker, [["dup", false], ["twice", false]]],
      ["moved, pasted twice", run("Date\tTime\tWhat\tKid\n2026-12-03\t6:30 pm\tSoccer practice\tAva\n2026-12-03\t6:30 pm\tSoccer practice\tAva", [exist()]).map(st), [["moved", true], ["twice", false]]],
      ["summary", KT.summary(flagged, "the list you pasted"), "From the list you pasted. 2 are listed twice."],
      ["summary, one copy", KT.summary(flagged.slice(0, 2), "the list you pasted"), "From the list you pasted. 1 is listed twice."],
      ["headline still counts every row", KT.headline(t3), "I found 3 practices"],
      ["summary, only a canceled event that was never on the tracker", KT.summary(can2, "the calendar file Team.ics"), "From the calendar file Team.ics."],
      ["headline for the same", KT.headline(can2), "Nothing to add or change"]]);
    const dt = n => KT.str(n);
    const A = (day, kind, ...kids) => ({ n: toNum(day), kind, kidNames: kids });
    expectAll("import wording", "the text for a whole import: adds with kinds, kids and the date span; one day says 'on'; moved and canceled counts; singular and plural", [
      ["3 adds", KT.textLine({ me: "Heather", adds: [A("2027-01-19", "practice", "Ava"), A("2027-01-26", "practice", "Ava"), A("2027-01-23", "game", "Ava")], moved: 0, canceled: 0, dayText: dt }),
        "Kids Tracker: Heather added 3 activities (2 practices and 1 game) for Ava, 2027-01-19 to 2027-01-26."],
      ["1 add, one day", KT.textLine({ me: "Heather", adds: [A("2027-01-19", "practice", "Ava", "Max")], moved: 0, canceled: 0, dayText: dt }), "Kids Tracker: Heather added 1 activity (1 practice) for Ava and Max, on 2027-01-19."],
      ["add and moved", KT.textLine({ me: "Heather", adds: [A("2027-01-19", "game", "Ava")], moved: 2, canceled: 0, dayText: dt }), "Kids Tracker: Heather added 1 activity (1 game) for Ava, on 2027-01-19. Also updated 2 activities that moved."],
      ["moved only", KT.textLine({ me: "Heather", adds: [], moved: 1, canceled: 0, dayText: dt }), "Kids Tracker: Heather updated 1 activity that moved."],
      ["canceled only", KT.textLine({ me: "Brett", adds: [], moved: 0, canceled: 1, dayText: dt }), "Kids Tracker: Brett canceled 1 activity."]]);
  }
}

// ---------------------------------------------------------------------------
// Part 2: the Activities page
// ---------------------------------------------------------------------------
function dbActs(base) {
  const d = cl(base);
  d.settings[0].changed_at = FX.changed_at;
  ["kids", "homes", "places", "teams", "events", "event_comments", "contacts", "event_log"].forEach(t => { d[t] = cl(FX[t]); });
  d.events.forEach(e => { if (!e.created_at) e.created_at = "2026-11-25T15:00:00+00:00"; if (!e.created_by) e.created_by = "me"; if (!e.updated_at) e.updated_at = e.created_at; if (!e.updated_by) e.updated_by = e.created_by; if (!e.source) e.source = "hand"; });
  d.events.find(e => e.id === E(2)).source_uid = "uid-soccer-1@example.test";   // as if Dec 1 practice came from a calendar file earlier
  return d;
}
const X = t => `<b class="xss-mark">${t}</b><img src="x-${t}" onerror="(window.__ktXss=window.__ktXss||[]).push('${t}')">"'&`;
const ics = (...events) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Example//EN", ...events, "END:VCALENDAR", ""].join("\r\n");
const ev = (...lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const tsv = (...rows) => rows.map(r => r.join("\t")).join("\n");
const sk = x => (Array.isArray(x) ? x.map(sk) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sk(x[k])])) : x);
const HEAD = ["Date", "Time", "What", "Kid", "Place", "Unsure"];

// Reads the review screen as the person sees it.
function reviewLib() {
  const norm = s => (s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
  const $ = id => document.getElementById(id);
  const shown = el => !!(el && el.getClientRects().length);
  const sp = el => { const c = el.cloneNode(true); c.querySelectorAll("*").forEach(x => { x.before(" "); x.after(" "); }); return norm(c.textContent).replace(/\s+([.,:;!?)])/g, "$1"); };
  window.__ktr = {
    rv: () => ({ shown: shown($("vReview")), head: norm($("rvHead").textContent), sub: norm($("rvSub").textContent), notes: [...$("rvNotes").children].map(x => norm(x.textContent)),
      all: { kid: $("rvKid").selectedOptions[0] && norm($("rvKid").selectedOptions[0].textContent), team: norm($("rvTeam").selectedOptions[0].textContent), place: norm($("rvPlace").selectedOptions[0].textContent), newRow: shown($("rvNewRow")) },
      rows: [...$("rvList").children].filter(li => !li.hidden).map(li => ({ checked: li.querySelector("[data-ck]").checked, dup: li.classList.contains("dup"), text: sp(li.querySelector(".rv-main")),
        flags: [...li.querySelectorAll(".flag")].map(f => `${f.classList.contains("prob") ? "[red] " : f.classList.contains("soft") ? "[soft] " : ""}${norm(f.textContent)}`), editing: !!li.querySelector(".rv-ed") })),
      add: norm($("rvAdd").textContent), addDisabled: $("rvAdd").disabled, bodyScroll: document.body.style.overflow }),
    paste: () => ({ shown: shown($("pasteScrim")), msg: norm($("pasteMsg").textContent) }),
    help: () => ({ shown: shown($("helpScrim")), box: $("helpBox").value, fallback: shown($("helpFallback")) }),
    toastNow: () => (shown($("toast")) ? norm($("toast").textContent) : null),
    clearToast: () => { $("toast").hidden = true; },
    lay(scope) {
      const root = scope ? document.querySelector(scope) : document.body, vw = document.documentElement.clientWidth;
      const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
      const tag = el => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.classList.length ? "." + [...el.classList].join(".") : "");
      const wide = [], cut = [], small = new Map(), lowc = new Map();
      root.querySelectorAll("*").forEach(el => {
        if (!vis(el)) return;
        const r = el.getBoundingClientRect();
        if ((r.right > vw + 1 || r.left < -1) && wide.length < 8) wide.push(`${tag(el)} spans ${Math.round(r.left)} to ${Math.round(r.right)}`);
        const cs = getComputedStyle(el);
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && /hidden|clip/.test(cs.overflowX) && cut.length < 8 && !/^(svg|path|input|textarea|select)$/i.test(el.tagName)) cut.push(`${tag(el)} content ${el.scrollWidth}px in ${el.clientWidth}px`);
      });
      root.querySelectorAll('button, select, a[href], textarea, input:not([type=checkbox]):not([type=hidden]):not([type=file]), label.rv-ck').forEach(el => {
        if (!vis(el) || el.disabled) return; const r = el.getBoundingClientRect();
        if (r.height < 40 || r.width < 40) { const k = tag(el).replace(/#[\w-]+/, ""); if (!small.has(k)) small.set(k, `${k} ${Math.round(r.width)}x${Math.round(r.height)}`); }
      });
      // Text contrast against the nearest solid background.
      const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; };
      const bgOf = el => { let c = el; while (c) { const p = parse(getComputedStyle(c).backgroundColor); if (p && p.a >= 0.99) return p; c = c.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
      const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      root.querySelectorAll("*").forEach(el => {
        if (!vis(el) || el.disabled || !([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))) return;
        const fg = parse(getComputedStyle(el).color), bg = bgOf(el); if (!fg) return;
        const a = fg.a, mix = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
        const L1 = lum(mix), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        if (ratio < 4.5) { const k = tag(el); if (!lowc.has(k)) lowc.set(k, `${k} ${ratio.toFixed(2)}:1 "${norm(el.textContent).slice(0, 24)}"`); }
      });
      return { vw, docScrollWidth: document.documentElement.scrollWidth, wide, cut, small: [...small.values()], lowContrast: [...lowc.values()].slice(0, 8) };
    },
  };
}
const REVIEW_LIB = `(${reviewLib.toString()})();`;

export async function importPageChecks(h) {
  try { await importPageChecks2(h); } catch (e) { console.log("IMPORT PAGE ERROR", e && e.stack); throw e; }
}
async function importPageChecks2(h) {
  const { open, close, q, check, expectAll, setGolden, settle, takeCalls, BASE_DB, SHOT_DIR } = h;
  const ORIGIN = h.origin();
  const DB = dbActs(BASE_DB);
  const go = (label, o = {}) => open("activities", label, { at: T_ACT, fake: { db: cl(DB), role: "admin" }, ...o });
  const lib = async s => { await s.page.evaluate(REVIEW_LIB); };
  const R = (s, fn, ...args) => s.page.evaluate(([f, x]) => window.__ktr[f](...x), [fn, args]);
  const A = (s, fn, ...args) => s.page.evaluate(([f, x]) => window.__kta[f](...x), [fn, args]);
  const until = (s, fn, arg) => s.page.waitForFunction(fn, arg, { timeout: 8000 });
  const writes = calls => calls.filter(c => c.table && c.op !== "select");
  const wr = c => [c.table, c.op, c.payload, c.filters && c.filters.length ? c.filters : undefined];
  const dbOf = s => s.page.evaluate(() => JSON.parse(JSON.stringify(window.__KT_FAKE__.db)));
  const reviewOpen = async s => { await until(s, () => !document.getElementById("vReview").hidden); await settle(s); };
  const pasteIn = async (s, text) => { await s.page.locator("#optPaste").click(); await s.page.locator("#pasteBox").fill(text); await s.page.locator("#pasteGo").click(); await reviewOpen(s); };
  const fileIn = async (s, name, text, mime = "text/calendar") => { await R(s, "clearToast"); await s.page.setInputFiles("#icsFile", { name, mimeType: mime, buffer: Buffer.from(text) }); };
  const fileToReview = async (s, name, text) => { await fileIn(s, name, text); await reviewOpen(s); };
  const waitTxt = async s => { await until(s, () => !document.getElementById("txtScrim").hidden); await settle(s); };
  const toastAfter = async s => { await settle(s); await s.page.waitForTimeout(80); return R(s, "toastNow"); };
  const pickAll = async (s, kid, team) => { if (kid) await s.page.locator("#rvKid").selectOption({ label: kid }); if (team) await s.page.locator("#rvTeam").selectOption({ label: team }); await settle(s); };
  const placeIdOf = (db, name) => (db.places.find(p => p.name === name) || {}).id;
  const golden = {};

  // =========================================================================
  // 1. Paste a list: limits, review screen, apply to all, editing, saving
  // =========================================================================
  {
    // Fixed 2026-11-21 (executive review): the same line pasted twice. Not part of the golden snapshot.
    const s = await go("import twice"); await lib(s); const p = s.page, L = ["2027-02-09", "5-6 pm", "Soccer practice", "Ava", "", ""];
    await pasteIn(s, tsv(HEAD, L, L));
    const rv = await R(s, "rv");
    fs.mkdirSync(SHOT_DIR, { recursive: true }); await p.setViewportSize({ width: 375, height: 800 }); await settle(s);
    await p.locator("#rvHead").locator("xpath=..").screenshot({ path: path.join(SHOT_DIR, "import-twice-head-375-light.png") }); await p.locator("#rvList").screenshot({ path: path.join(SHOT_DIR, "import-twice-375-light.png") });
    await takeCalls(s); await p.locator("#rvAdd").click(); await waitTxt(s);
    const calls = writes(await takeCalls(s));
    expectAll("import page", "the same line pasted twice: the second row is dimmed, unticked and says 'Same as a row above', the summary says '1 is listed twice', and Add saves one activity, not two", [
      ["rows (ticked, dimmed, says same as above)", rv.rows.map(x => [x.checked, x.dup, /Same as a row above/.test(x.text)]), [[true, false, false], [false, true, true]]],
      ["summary", rv.sub, "From the list you pasted. 1 is listed twice."], ["button", rv.add, "Add 1 to the tracker"],
      ["saved", calls.map(c => [`${c.table}.${c.op}`, Array.isArray(c.payload) ? c.payload.length : 1]), [["events.insert", 1]]],
      ["no page errors", s.errors.filter(e => !/integrity/.test(e)), []]]);
    await close(s);
  }
  {
    const s = await go("import paste"); await lib(s); const p = s.page, r = golden.paste = {};
    await takeCalls(s);
    r.panel = await p.evaluate(() => ({ buttons: ["optPaste", "optFile", "optHelp", "addHand"].map(id => document.getElementById(id).textContent.replace(/\s+/g, " ").trim()), fileAccept: document.getElementById("icsFile").accept }));
    // Messages for text that cannot be read.
    await p.locator("#optPaste").click(); await p.locator("#pasteGo").click(); r.emptyMsg = (await R(s, "paste")).msg;
    await p.locator("#pasteBox").fill("hello there, nothing to see"); await p.locator("#pasteGo").click(); r.noDateMsg = (await R(s, "paste")).msg;
    await p.locator("#pasteBox").fill(["Date\tTime\tWhat\tKid", ...Array.from({ length: 301 }, (_, i) => `2027-02-${String((i % 27) + 1).padStart(2, "0")}\t5 pm\tGame\tAva`)].join("\n")); await p.locator("#pasteGo").click(); r.manyMsg = (await R(s, "paste")).msg;
    await p.locator("#pasteBox").fill("x".repeat(1048577)); await p.locator("#pasteGo").click(); r.bigMsg = (await R(s, "paste")).msg;
    r.stillOpen = (await R(s, "paste")).shown; await p.locator("#pasteScrim [data-close]").click(); r.closed = !(await R(s, "paste")).shown;
    r.msgCalls = writes(await takeCalls(s));
    expectAll("import page", "Paste a list: empty text, text with no date, 301 rows and over 1 MB each give a plain message, keep the sheet open, and write nothing; the panel shows Paste, Calendar file, Photo helper and Add by hand", [
      ["buttons", r.panel.buttons.map(t => t.replace(/ .*$/, "")), ["Paste", "Calendar", "Photo", "+"]], ["file input", r.panel.fileAccept, ".ics,text/calendar"],
      ["empty", r.emptyMsg, "Nothing to read yet. Paste your list first."], ["no date", r.noDateMsg, "I couldn't find a date or a time in that. Each row needs at least a date."],
      ["301 rows", r.manyMsg, "That is 301 rows. Paste up to 300 at a time."], ["over 1 MB", r.bigMsg, "That is too much text. Paste up to 1 MB at a time."],
      ["sheet stays open until Cancel", [r.stillOpen, r.closed], [true, true]], ["writes", r.msgCalls, []]]);

    // Three rows with no kid, team or place.
    await pasteIn(s, tsv(["Date", "Time", "What"], ["2027-01-19", "5:30-6:30 pm", "Practice"], ["2027-01-26", "5:30-6:30 pm", "Practice"], ["2027-01-23", "10:00 am - 11:00 am", "Game vs Eagles"]));
    r.rv1 = await R(s, "rv");
    expectAll("import page", "paste review, three rows with no kid: headline '2 practices and 1 game', every row checked, each marked in red 'Pick who it's for', soft 'No end time' note on the game, button 'Add 3 to the tracker'", [
      ["shown and page locked from scrolling", [r.rv1.shown, r.rv1.bodyScroll], [true, "hidden"]], ["headline", r.rv1.head, "I found 2 practices and 1 game"], ["sub", r.rv1.sub, "From the list you pasted. 3 need a quick look."],
      ["row 1", [r.rv1.rows[0].checked, r.rv1.rows[0].text, r.rv1.rows[0].flags], [true, "Tue, Jan 19, 2027 5:30 to 6:30 p.m. Practice Pick who it's for.", ["[red] Pick who it's for."]]],
      ["row 3", [r.rv1.rows[2].text, r.rv1.rows[2].flags], ["Sat, Jan 23, 2027 10:00 to 11:00 a.m. Game vs Eagles Pick who it's for.", ["[red] Pick who it's for."]]],
      ["button", [r.rv1.add, r.rv1.addDisabled], ["Add 3 to the tracker", false]], ["apply to all starts at Not set, No team, No place", [r.rv1.all.kid, r.rv1.all.team, r.rv1.all.place], ["Not set", "No team", "No place"]]]);
    // Add with rows still marked in red: nothing is sent.
    await takeCalls(s); await p.locator("#rvAdd").click(); r.redToast = await toastAfter(s); r.redOpen = (await R(s, "rv")).rows.filter(x => x.editing).length; r.redCalls = writes(await takeCalls(s));
    expectAll("import page", "Add with three rows still marked in red shows 'Fix 3 rows marked in red first, or untick them', opens their editors, and writes nothing", [["toast", r.redToast, "Fix 3 rows marked in red first, or untick them."], ["editors open", r.redOpen, 3], ["writes", r.redCalls, []]]);
    // Apply to all: kid, team and a new place by name.
    await pickAll(s, "Ava", "Soccer");
    await p.locator("#rvPlace").selectOption("__new"); await p.locator("#rvNewName").fill("North Court"); await settle(s);
    r.rv2 = await R(s, "rv");
    expectAll("import page", "Apply to all: kid Ava, team Soccer and a new place by name fill every row (chips show Ava, 'New place: North Court'), the red marks go, the new-place name box shows, and nothing is created yet", [
      ["new place box shown", r.rv2.all.newRow, true], ["row 1 text", r.rv2.rows[0].text, "Tue, Jan 19, 2027 5:30 to 6:30 p.m. Ava Soccer practice, New place: North Court"], ["row 3 text", r.rv2.rows[2].text, "Sat, Jan 23, 2027 10:00 to 11:00 a.m. Ava Soccer: Game vs Eagles, New place: North Court"],
      ["flags", r.rv2.rows.map(x => x.flags), [[], [], []]], ["sub", r.rv2.sub, "From the list you pasted. Everything looks clear."], ["writes so far", writes(await takeCalls(s)), []]]);
    // The checkboxes drive the button.
    await p.locator('[data-ck="1"]').uncheck(); r.cnt2 = (await R(s, "rv")).add;
    await p.locator('[data-ck="0"]').uncheck(); await p.locator('[data-ck="2"]').uncheck(); const none = await R(s, "rv"); r.none = [none.add, none.addDisabled];
    await p.locator('[data-ck="0"]').check(); await p.locator('[data-ck="1"]').check(); await p.locator('[data-ck="2"]').check(); r.cnt3 = (await R(s, "rv")).add;
    expectAll("import page", "the Add button count follows the checkboxes: 3 checked says 'Add 3', 2 says 'Add 2', none says 'Nothing selected' and is disabled", [["2", r.cnt2, "Add 2 to the tracker"], ["none", r.none, ["Nothing selected", true]], ["3", r.cnt3, "Add 3 to the tracker"]]);
    // Edit one row in place: no start time cannot be added until fixed.
    await p.locator('[data-r="0"] [data-f="start"]').fill(""); await settle(s);
    r.noStart = (await R(s, "rv")).rows[0];
    await takeCalls(s); await p.locator("#rvAdd").click(); r.noStartToast = await toastAfter(s); r.noStartCalls = writes(await takeCalls(s));
    expectAll("import page", "a row with no start time shows 'No time' and a red 'Needs a start time', and Add refuses ('Fix 1 row marked in red first, or untick it') with nothing written", [
      ["row", [r.noStart.text, r.noStart.flags], ["Tue, Jan 19, 2027 No time Ava Soccer practice, New place: North Court Needs a start time.", ["[red] Needs a start time."]]],
      ["toast", r.noStartToast, "Fix 1 row marked in red first, or untick it."], ["writes", r.noStartCalls, []]]);
    await p.locator('[data-r="0"] [data-f="start"]').fill("18:15"); await p.locator('[data-r="0"] [data-f="end"]').fill("19:15");
    await p.locator('[data-r="2"] [data-f="what"]').fill("Game vs Hawks"); await settle(s);
    r.edited = await R(s, "rv");
    expectAll("import page", "editing a row in place updates its line: start 6:15 pm and end 7:15 pm on row 1, new name on row 3, and the editors stay open while typing", [
      ["row 1", r.edited.rows[0].text, "Tue, Jan 19, 2027 6:15 to 7:15 p.m. Ava Soccer practice, New place: North Court"], ["row 3", r.edited.rows[2].text, "Sat, Jan 23, 2027 10:00 to 11:00 a.m. Ava Soccer: Game vs Hawks, New place: North Court"],
      ["editors still open", r.edited.rows.map(x => x.editing), [true, true, true]], ["button", r.edited.add, "Add 3 to the tracker"]]);
    // Add.
    await takeCalls(s); await p.locator("#rvAdd").click(); await waitTxt(s);
    const calls = writes(await takeCalls(s)), db = await dbOf(s), npId = placeIdOf(db, "North Court");
    r.save = { calls: calls.map(c => [`${c.table}.${c.op}`, c.returning, c.one]), place: calls[0] && calls[0].payload, events: calls[1] && calls[1].payload };
    const row = (day, st, en, kind, title) => ({ team_id: TEAM.soccer, kid_ids: [KID.ava], kind, title, day, start_time: st, end_time: en, place_id: npId, place_text: null, arrive_by: null, gear: null, note: null, source: "paste", source_uid: null });
    r.txt = await A(s, "txt"); r.toastAdd = await R(s, "toastNow"); r.hiddenAfter = !(await R(s, "rv")).shown; r.bodyScrollAfter = await p.evaluate(() => document.body.style.overflow);
    expectAll("import page", "Add on the paste review: one new place insert (name only), then ONE events insert for all 3 rows (Soccer, Ava, the new place, source 'paste', no calendar id, only editable fields), no updates; the review closes", [
      ["requests", r.save.calls, [["places.insert", true, "single"], ["events.insert", false, null]]],
      ["place", r.save.place, { name: "North Court" }],
      ["rows", r.save.events, [row("2027-01-19", "18:15", "19:15", "practice", null), row("2027-01-26", "17:30", "18:30", "practice", null), row("2027-01-23", "10:00", "11:00", "game", "Game vs Hawks")]],
      ["review closed and scrolling back", [r.hiddenAfter, r.bodyScrollAfter], [true, ""]], ["toast", r.toastAdd, "3 activities added."], ["only one North Court in the database", db.places.filter(x => x.name === "North Court").length, 1]]);
    expectAll("import page", "after Add the Text an update sheet opens with a sensible message (3 activities, 2 practices and 1 game, for Ava, Jan 19 to Jan 26), Heather shown but unchecked, and the link is the page's own link", [
      ["body", r.txt.body.split("\n")[0], "Kids Tracker: Heather added 3 activities (2 practices and 1 game) for Ava, Tue, Jan 19 to Tue, Jan 26."], ["recipients", r.txt.to, ["Brett [checked]", "Heather (you) [disabled]", "Angie (Grandma) [checked]"]],
      ["link line with Angie ticked is the family link", r.txt.body.split("\n")[1], `${ORIGIN}/#k=TESTTOKEN`]]);
    await p.locator("#to-grandma").uncheck(); r.txtNoAngie = await A(s, "txt");
    expectAll("import page", "unticking Angie in the import text switches the link to the page's own link (the family link is only for texts that can go to Angie)", [["link line", r.txtNoAngie.body.split("\n")[1], `${ORIGIN}/activities.html`]]);
    await p.locator("#txtScrim [data-close]").click();
    r.upCount = (await A(s, "up")).count;
    expectAll("import page", "the Upcoming list counts the 3 new activities (24 before, 27 after)", [["count", r.upCount, "27 coming up"]]);
    // Importing the same list again: all three are already there.
    await pasteIn(s, tsv(["Date", "Time", "What", "Kid"], ["2027-01-19", "6:15-7:15 pm", "Soccer practice", "Ava"], ["2027-01-26", "5:30-6:30 pm", "Soccer practice", "Ava"], ["2027-01-23", "10-11 am", "Game vs Hawks", "Ava"]));
    r.again = await R(s, "rv"); await takeCalls(s); await p.locator("#rvAdd").click({ force: true, timeout: 1500 }).catch(() => {}); r.againCalls = writes(await takeCalls(s));
    expectAll("import page", "pasting the same list again adds nothing: every row says 'Already on the tracker', unchecked, the sub line says 3 are already there, the button is disabled", [
      ["headline", r.again.head, "I found 2 practices and 1 game"], ["sub", r.again.sub, "From the list you pasted. 3 are already on the tracker."], ["rows", r.again.rows.map(x => [x.checked, x.dup, /Already on the tracker/.test(x.text)]), [[false, true, true], [false, true, true], [false, true, true]]],
      ["button", [r.again.add, r.again.addDisabled], ["Nothing selected", true]], ["writes after clicking the disabled button", r.againCalls, []]]);
    await p.locator("#rvCancel").click();
    // Singular wording, and Cancel saves nothing (both Cancel buttons).
    await pasteIn(s, tsv(["2027-02-09", "5 pm", "Piano lesson", "Ava"])); r.one = await R(s, "rv");
    await takeCalls(s); await p.locator("#rvCancel").click(); r.cancel1 = [(await R(s, "rv")).shown, writes(await takeCalls(s))];
    await pasteIn(s, tsv(["2027-02-09", "5 pm", "Piano lesson", "Ava"])); await p.locator("#rvCancelTop").click(); r.cancel2 = [(await R(s, "rv")).shown, writes(await takeCalls(s)), await p.evaluate(() => document.body.style.overflow)];
    expectAll("import page", "one row reads 'I found 1 lesson' and 'Add 1 to the tracker'; Cancel at the bottom and Cancel at the top both close the review and write nothing", [
      ["headline and button", [r.one.head, r.one.add], ["I found 1 lesson", "Add 1 to the tracker"]], ["bottom Cancel", r.cancel1, [false, []]], ["top Cancel", r.cancel2, [false, [], ""]]]);
    r.errors = s.errors.filter(e => !/integrity/.test(e));
    await close(s);
    check("import page", "paste flow: no console errors", !r.errors.length, r.errors);
    setGolden("import-paste", { rv1: r.rv1, rv2: r.rv2, edited: r.edited, save: r.save, txt: r.txt, again: r.again });
  }

  // =========================================================================
  // 2. Calendar file: the source_uid read, review, moves, duplicates, limits
  // =========================================================================
  const ICS = ics(
    ev("UID:uid-soccer-1@example.test", "DTSTART:20261201T180000", "DTEND:20261201T190000", "SUMMARY:Soccer practice"),
    ev("UID:uid-new-2@example.test", "DTSTART:20270120T173000", "DTEND:20270120T183000", "SUMMARY:Soccer practice", "RRULE:FREQ=WEEKLY;COUNT=3"),
    ev("UID:uid-new-3@example.test", "DTSTART:20270123T150000Z", "DTEND:20270123T160000Z", "SUMMARY:Game vs Eagles"),
    ev("UID:uid-old@example.test", "DTSTART:20261120T173000", "SUMMARY:Old practice"),
    ev("UID:uid-gone@example.test", "DTSTART:20261210T173000", "SUMMARY:Soccer practice", "STATUS:CANCELLED"));
  {
    const s = await go("import file"); await lib(s); const p = s.page, r = golden.file = {};
    await takeCalls(s);
    await fileToReview(s, "Team.ics", ICS);
    const rc = await takeCalls(s);
    r.reads = rc.map(c => ({ what: `${c.table}.${c.op}`, columns: c.columns, filters: c.filters }));
    r.rv1 = await R(s, "rv");
    expectAll("import file", "Calendar file: the page reads the stored calendar ids with select('id, source_uid') where source_uid is not null, and nothing else", [
      ["requests", r.reads, [{ what: "events.select", columns: "id, source_uid", filters: [{ kind: "not", col: "source_uid", op: "is", val: null }] }]]]);
    expectAll("import file", "calendar file review: headline '4 practices and 1 game'; the Dec 1 row shows 'Time moved 5:30 p.m. to 6:00 p.m.'; Jan 20, 27 and Feb 3 repeat; the UTC game is 10:00 a.m. on this device (New York); notes say 1 ended event, times converted, 1 canceled event not on the tracker; the canceled one is hidden", [
      ["headline", r.rv1.head, "I found 4 practices and 1 game"], ["sub", r.rv1.sub, "From the calendar file Team.ics. 5 need a quick look."],
      ["days", r.rv1.rows.map(x => x.text.replace(/ (\d+:\d+).*/, "")), ["Tue, Dec 1", "Wed, Jan 20, 2027", "Sat, Jan 23, 2027", "Wed, Jan 27, 2027", "Wed, Feb 3, 2027"]],
      ["moved row", [r.rv1.rows[0].text, r.rv1.rows[0].checked], ["Tue, Dec 1 6:00 to 7:00 p.m. Soccer practice Time moved 5:30 p.m. to 6:00 p.m. Changes this one: Soccer practice, Ava, Tue, Dec 1 5:30 to 6:30 p.m.", true]],
      ["game row", r.rv1.rows[2].text.replace(/ Pick.*$/, ""), "Sat, Jan 23, 2027 10:00 to 11:00 a.m. Game vs Eagles"],
      ["notes", r.rv1.notes, ["1 event had already ended, so I left it out.", "Times in the file were changed to this device's time zone.", "1 canceled event wasn't on the tracker, so I left it out."]]]);
    await pickAll(s, "Ava", "Soccer"); r.rv2 = await R(s, "rv");
    await takeCalls(s); await p.locator("#rvAdd").click(); await waitTxt(s);
    const calls = writes(await takeCalls(s)), db = await dbOf(s);
    const base = { team_id: TEAM.soccer, kid_ids: [KID.ava], place_id: null, place_text: null, arrive_by: null, gear: null, note: null, source: "file" };
    r.save = calls.map(wr); r.txt = await A(s, "txt"); r.eventsAfter = db.events.length; r.e2 = db.events.find(e => e.id === E(2));
    expectAll("import file", "Add on the file review: ONE events insert of the 4 new rows (source 'file', each with its own calendar id, repeats as id#date) and ONE update for the moved Dec 1 practice (start 18:00, end 19:00 only); no extra insert for the moved one", [
      ["insert", calls[0] && sk([calls[0].table, calls[0].op, calls[0].payload]), sk(["events", "insert", [
        { ...base, kind: "practice", title: null, day: "2027-01-20", start_time: "17:30", end_time: "18:30", source_uid: "uid-new-2@example.test#2027-01-20" },
        { ...base, kind: "game", title: "Game vs Eagles", day: "2027-01-23", start_time: "10:00", end_time: "11:00", source_uid: "uid-new-3@example.test" },
        { ...base, kind: "practice", title: null, day: "2027-01-27", start_time: "17:30", end_time: "18:30", source_uid: "uid-new-2@example.test#2027-01-27" },
        { ...base, kind: "practice", title: null, day: "2027-02-03", start_time: "17:30", end_time: "18:30", source_uid: "uid-new-2@example.test#2027-02-03" }]])],
      ["update", calls[1] && wr(calls[1]), ["events", "update", { start_time: "18:00", end_time: "19:00" }, [{ kind: "eq", col: "id", val: E(2) }]]], ["request count", calls.length, 2],
      ["rows in the database", r.eventsAfter, DB.events.length + 4], ["the moved row kept its id and calendar id", [r.e2.id, r.e2.source_uid, r.e2.start_time, r.e2.end_time], [E(2), "uid-soccer-1@example.test", "18:00", "19:00"]]]);
    expectAll("import file", "the text for a file import names the adds and the moved one: 4 activities (3 practices and 1 game) for Ava, Jan 20 to Feb 3, also updated 1 activity that moved", [
      ["body", r.txt.body.split("\n")[0], "Kids Tracker: Heather added 4 activities (3 practices and 1 game) for Ava, Wed, Jan 20 to Wed, Feb 3. Also updated 1 activity that moved."]]);
    await p.locator("#txtScrim [data-close]").click();
    // The same file again.
    await takeCalls(s); await fileToReview(s, "Team.ics", ICS); await takeCalls(s);
    r.again = await R(s, "rv");
    await p.locator("#rvAdd").click({ force: true, timeout: 1500 }).catch(() => {}); r.againCalls = writes(await takeCalls(s));
    expectAll("import file", "importing the same .ics a second time adds nothing: all 5 rows are 'Already on the tracker' and unchecked, the button is disabled, and no write is made", [
      ["sub", r.again.sub, "From the calendar file Team.ics. 5 are already on the tracker."], ["rows", r.again.rows.map(x => [x.checked, x.dup]), Array(5).fill([false, true])], ["button", [r.again.add, r.again.addDisabled], ["Nothing selected", true]], ["writes", r.againCalls, []]]);
    await p.locator("#rvCancel").click();
    // A later time change for the same id: old and new shown, an update, never an insert.
    const ICS2 = ics(ev("UID:uid-new-3@example.test", "DTSTART:20270123T160000Z", "DTEND:20270123T170000Z", "SUMMARY:Game vs Eagles", "LOCATION:Studio B"));
    await fileToReview(s, "Team2.ics", ICS2); await pickAll(s, "Ava", "Soccer"); r.mv = await R(s, "rv");
    await takeCalls(s); await p.locator("#rvAdd").click(); await waitTxt(s);
    const c2 = writes(await takeCalls(s)); r.mvTxt = (await A(s, "txt")).body.split("\n")[0]; await p.locator("#txtScrim [data-close]").click();
    expectAll("import file", "same calendar id with a new time and a new place shows old and new ('Time moved 10:00 a.m. to 11:00 a.m.', 'Place changed to Studio B') and on Add UPDATES the existing row: no insert, one update with start, end and place", [
      ["row", r.mv.rows[0].text, "Sat, Jan 23, 2027 11:00 a.m. to 12:00 p.m. Ava Soccer: Game vs Eagles, Studio B Time moved 10:00 a.m. to 11:00 a.m. Place changed to Studio B Changes this one: Soccer: Game vs Eagles, Ava, Sat, Jan 23 10:00 to 11:00 a.m."],
      ["requests", c2.map(wr), [["events", "update", { start_time: "11:00", end_time: "12:00", place_id: PLACE.studio, place_text: null }, [{ kind: "eq", col: "id", val: (db.events.find(e => e.source_uid === "uid-new-3@example.test") || {}).id }]]]],
      ["text", r.mvTxt, "Kids Tracker: Heather updated 1 activity that moved."]]);
    // A canceled event that is on the tracker.
    const ICS3 = ics(ev("UID:uid-new-3@example.test", "DTSTART:20270123T150000Z", "SUMMARY:Game vs Eagles", "STATUS:CANCELLED"));
    await fileToReview(s, "Team3.ics", ICS3); await pickAll(s, "Ava", "Soccer"); r.cx = await R(s, "rv");
    await takeCalls(s); await p.locator("#rvAdd").click(); await waitTxt(s);
    const c3 = writes(await takeCalls(s)); r.cxTxt = (await A(s, "txt")).body.split("\n")[0]; await p.locator("#txtScrim [data-close]").click();
    expectAll("import file", "an event the file marks canceled that is on the tracker shows 'Canceled in the file' and on Add updates status to canceled (no insert)", [
      ["chip", /Canceled in the file/.test(r.cx.rows[0].text), true], ["requests", c3.map(c => [c.table, c.op, c.payload]), [["events", "update", { status: "canceled" }]]], ["text", r.cxTxt, "Kids Tracker: Heather canceled 1 activity."]]);
    // Limits and messages.
    const tst = async (name, text, mime) => { await fileIn(s, name, text, mime); await settle(s); await p.waitForTimeout(150); return R(s, "toastNow"); };
    r.big = await tst("Big.ics", "BEGIN:VCALENDAR\r\n" + "X-FILLER:" + "a".repeat(1048577) + "\r\nEND:VCALENDAR\r\n");
    r.notCal = await tst("Notes.ics", "just some text"); await takeCalls(s);
    r.many = await tst("Many.ics", ics(...Array.from({ length: 301 }, (_, i) => ev(`UID:m${i}@example.test`, "DTSTART:20270201T173000", "SUMMARY:Practice"))));
    r.past = await tst("Past.ics", ics(ev("UID:uid-p@example.test", "DTSTART:20261120T173000", "SUMMARY:Old practice")));
    r.limitCalls = writes(await takeCalls(s)); r.reviewOpenAfter = (await R(s, "rv")).shown;
    expectAll("import file", "file limits: over 1 MB, not a calendar and 301 activities each show a plain message and write nothing", [
      ["over 1 MB", r.big, "That file is bigger than 1 MB. Export a shorter date range and try again."], ["not a calendar", r.notCal, "That doesn't look like a calendar file."],
      ["301", r.many, "That file has more than 300 activities, or goes back a long way. Export a shorter date range and try again."], ["writes", r.limitCalls, []], ["no review opened", r.reviewOpenAfter, false]]);
    expectAll("import file", "a file where everything already ended says plainly that nothing is coming up (not only the 'already ended' note)", [["message", r.past, "Nothing in that file is coming up. 1 event had already ended, so I left it out."]]);
    r.errors = s.errors.filter(e => !/integrity/.test(e));
    await close(s);
    check("import file", "calendar file flow: no console errors", !r.errors.length, r.errors);
    setGolden("import-file", { reads: r.reads, rv1: r.rv1, rv2: r.rv2, save: r.save, txt: r.txt, again: r.again, mv: r.mv, cx: r.cx, messages: { big: r.big, notCal: r.notCal, many: r.many } });
  }
  // The stored calendar ids cannot be read: the page still works and falls back to kid, date and name.
  {
    const s = await go("import file uid read fails"); await lib(s); const p = s.page, r = {};
    await p.evaluate(() => window.__KT_FAKE__.failNext.push({ table: "events", op: "select", error: { code: "42501", message: "permission denied for table events" } }));
    await fileToReview(s, "Team.ics", ICS); await pickAll(s, "Ava", "Soccer"); r.rv = await R(s, "rv"); r.toast = await R(s, "toastNow");
    // Nothing was added by the first review (it was cancelled), so with no ids and nothing on the tracker these are new, except the Dec 1 practice that matches on kid, date and name.
    r.statuses = r.rv.rows.map(x => [x.checked, x.dup, /Time moved/.test(x.text)]);
    r.errors = s.errors.filter(e => !/integrity/.test(e));
    await close(s);
    expectAll("import file", "when the stored calendar ids cannot be read the review still opens with no error message: the Dec 1 practice is matched by kid, date and name (a time change shows as moved), the other 4 rows are new", [
      ["review opened", r.rv.shown, true], ["toast", r.toast, null], ["rows", r.statuses, [[true, false, true], [true, false, false], [true, false, false], [true, false, false], [true, false, false]]], ["console errors", r.errors, []]]);
  }
  // A save that fails halfway: nothing is duplicated and the review stays open.
  {
    const s = await go("import save fails", { expectErrors: true }); await lib(s); const p = s.page, r = {};
    await pasteIn(s, tsv(["Date", "Time", "What"], ["2027-02-16", "5:30-6:30 pm", "Practice"])); await pickAll(s, "Ava", "Soccer");
    await p.locator("#rvPlace").selectOption("__new"); await p.locator("#rvNewName").fill("South Court"); await settle(s);
    await p.evaluate(() => window.__KT_FAKE__.failNext.push({ table: "events", op: "insert", error: { code: "42501", message: "permission denied for table events" } }));
    await takeCalls(s); await p.locator("#rvAdd").click(); r.failToast = await toastAfter(s); r.open = (await R(s, "rv")).shown;
    let db = await dbOf(s); r.eventsAfterFail = db.events.length; r.placesAfterFail = db.places.filter(x => x.name === "South Court").length;
    r.afterFail = (await R(s, "rv")).rows.map(x => [x.checked, x.dup]);
    await p.locator("#rvAdd").click(); await waitTxt(s); db = await dbOf(s);
    r.final = { events: db.events.length, newPlaces: db.places.filter(x => x.name === "South Court").length, eventsWithPlace: db.events.filter(e => e.day === "2027-02-16").length };
    await close(s);
    expectAll("import save", "an events insert that is refused shows a plain message, keeps the review open and nothing is added to events", [["toast", r.failToast, "Couldn't add them: this account isn't allowed to do that."], ["review still open", r.open, true], ["events unchanged", r.eventsAfterFail, DB.events.length]]);
    expectAll("import save", "retrying after a failed save adds the activity once and creates the new place once (the place made by the first try is reused, not made again)", [
      ["places named South Court", r.final.newPlaces, 1], ["events on Feb 16", r.final.eventsWithPlace, 1]]);
  }

  // =========================================================================
  // 3. Photo or PDF helper
  // =========================================================================
  {
    const s = await go("import helper"); await lib(s); const p = s.page, r = {};
    await p.locator("#optHelp").click(); r.opened = (await R(s, "help")).shown;
    await p.locator("#helpCopy").click(); await settle(s); await p.waitForTimeout(80); r.help = await R(s, "help");
    r.toast = await R(s, "toastNow"); const text = r.help.box;
    // Feed the helper's own header row plus one made-up answer to the paste reader, as the AI chat's reply would arrive.
    const head = text.split("\n").find(l => l.includes("\t")) || "";
    r.parsed = await p.evaluate(([hd, today]) => {
      const kids = [...document.querySelectorAll("#rvKid")].length ? [] : [];
      const r = window.KTImport.parseList(hd + "\n" + "2027-02-09\t5:30-6:30 pm\tGame vs Eagles\tAva\tEastside Gym\tGuessed the year", { today, kids: [{ id: "k1", name: "Ava", active: true }], places: [{ id: "p1", name: "Eastside Gym" }] });
      const it = r.items[0]; return { header: r.header, n: r.items.length, it: it && { day: it.day, start: it.start, end: it.end, kind: it.kind, kids: it.kids, place: it.place_id, flags: it.flags.map(f => f.f + ": " + f.t) } };
    }, [head, toNum(T_ACT.day)]);
    r.sheetText = await p.evaluate(() => document.getElementById("helpScrim").innerText.replace(/\s+/g, " "));
    await p.locator("#helpScrim [data-close]").click();
    expectAll("import helper", "Photo helper: the sheet opens with 4 plain steps; the copied request names the columns the paste reader reads (Date, Time, What, Kid, Place, Unsure, tab separated), today's date, the kids, saved places and active teams from the page's data; it is shown or copied", [
      ["opened", r.opened, true], ["steps", /Tap Copy the request\..*Open Claude.*Copy the rows it answers with\..*tap Paste a list and paste/.test(r.sheetText), true],
      ["header row", head, HEAD.join("\t")], ["today", /Today is 2026-12-01\./.test(text), true], ["kids", /Kid: one of Ava, Max, or Both\./.test(text), true],
      ["places (any order)", (/use one of these exactly if it matches: (.*?)\. Otherwise/.exec(text) || [, ""])[1].split(", ").sort(), ["Eastside Gym", "Rec Center Field 3", "Studio B", "Unused Field", "West Pool"]],
      ["active teams only (any order)", [(/Team names I already use.*?: (.*?)\./.exec(text) || [, ""])[1].split(", ").sort(), /Chess club/.test(text)], [["Basketball", "Soccer"], false]],
      ["copied or shown", r.toast === "Copied. Open your AI chat and paste it." || (r.help.fallback && /Couldn't copy/.test(r.toast || "")), true], ["no dashes", [8211, 8212].some(c => text.includes(String.fromCharCode(c))), false]]);
    expectAll("import helper", "the reply the request asks for (its own header row plus a row) reads straight into Paste a list: header recognised, date, time range, kid, place and the unsure text all land", [
      ["parsed", r.parsed, { header: true, n: 1, it: { day: "2027-02-09", start: 1050, end: 1110, kind: "game", kids: ["k1"], place: "p1", flags: ["unsure: Guessed the year"] } }]]);
    // A different family: none of the names come from the code.
    const d2 = cl(DB); d2.kids = [{ id: "a0000000-0000-4000-8000-0000000000f1", name: "Zoe", color: "orange", sort: 1, active: true }]; d2.places = [{ ...d2.places[0], name: "Tennis Hall" }]; d2.teams = []; d2.events = []; d2.event_log = []; d2.event_comments = [];
    const s2 = await open("activities", "import helper other family", { at: T_ACT, fake: { db: d2, role: "admin" } }); await lib(s2);
    await s2.page.locator("#optHelp").click(); await s2.page.locator("#helpCopy").click(); await settle(s2); await s2.page.waitForTimeout(80);
    const t2 = (await R(s2, "help")).box; await close(s2);
    const src = fs.readFileSync(path.join(h.ROOT, "import.js"), "utf8");
    expectAll("import helper", "the request uses the page's own names, nothing is hard-coded: another family's kid 'Zoe' and place 'Tennis Hall' appear, Ava, Max, Eastside Gym and Soccer do not, and import.js itself contains none of the made-up fixture names", [
      ["has Zoe and Tennis Hall", [/Zoe/.test(t2), /Tennis Hall/.test(t2)], [true, true]], ["no fixture names", /Ava|Max|Eastside|Soccer|Basketball/.test(t2), false],
      ["no team line without teams", /Team names/.test(t2), false], ["source has no fixture names", /\b(Ava|Max|Eastside|Rec Center|Studio B|Soccer|Basketball)\b/.test(src), false]]);
  }

  // No kids yet: Paste and Calendar file say so instead of opening.
  {
    const d3 = cl(DB); d3.kids = []; d3.teams = []; d3.events = []; d3.event_log = []; d3.event_comments = [];
    const s = await open("activities", "import no kids", { at: T_ACT, fake: { db: d3, role: "admin" } }); await lib(s); const p = s.page, r = {};
    await p.locator("#optPaste").click(); r.paste = [await toastAfter(s), (await R(s, "paste")).shown];
    await R(s, "clearToast"); await p.locator("#optFile").click({ trial: false }).catch(() => {}); r.file = [await toastAfter(s)];
    r.writes = writes(await takeCalls(s)); await close(s);
    expectAll("import page", "with no kids entered, Paste a list and Calendar file show 'Add a kid first, in the Kids section.' and open nothing", [["paste", r.paste, ["Add a kid first, in the Kids section.", false]], ["file", r.file, ["Add a kid first, in the Kids section."]], ["writes", r.writes, []]]);
  }

  // =========================================================================
  // 4. Signed in as the parent: the whole import flow touches no custody table
  // =========================================================================
  {
    const s = await go("import parent", { fake: { db: cl(DB), role: "parent" } }); await lib(s); const p = s.page, r = {};
    await pasteIn(s, tsv(["Date", "Time", "What", "Kid"], ["2027-02-17", "5:30-6:30 pm", "Practice", "Max"])); await pickAll(s, null, "Basketball");
    await takeCalls(s); await p.locator("#rvAdd").click(); await waitTxt(s); r.txt = await A(s, "txt"); await p.locator("#txtScrim [data-close]").click();
    await fileToReview(s, "Team.ics", ICS); await pickAll(s, "Ava", "Soccer"); await p.locator("#rvAdd").click(); await waitTxt(s); await p.locator("#txtScrim [data-close]").click();
    await p.locator("#optHelp").click(); await p.locator("#helpCopy").click(); await settle(s); await p.locator("#helpScrim [data-close]").click();
    await takeCalls(s);
    const all = s.allCalls; r.tables = [...new Set(all.filter(c => c.table).map(c => c.table))].sort(); r.forbidden = all.filter(c => FORBIDDEN_PARENT.includes(c.table)).map(c => `${c.table}.${c.op}`);
    r.inserts = all.filter(c => c.table === "events" && c.op === "insert").length; r.errors = s.errors.filter(e => !/integrity/.test(e));
    await close(s);
    expectAll("import parent", "as parent (Brett): paste, calendar file and helper never request settings, breaks, swaps, swap_details, share_links or app_users; the imports are saved (2 inserts) and the text offers Heather and Angie with the page's own link", [
      ["forbidden", r.forbidden, []], ["tables touched", r.tables, ["contacts", "events"]], ["inserts", r.inserts, 2],
      ["recipients", r.txt.to, ["Brett (you) [disabled]", "Heather [checked]", "Angie (Grandma) [checked]"]], ["link", r.txt.body.split("\n")[1], `${ORIGIN}/activities.html`], ["console errors", r.errors, []]]);
  }

  // =========================================================================
  // 5. Escaping: HTML and script text in every free-text field
  // =========================================================================
  {
    const s = await go("import escaping"); await lib(s); const p = s.page, r = {};
    const W = X("WHAT") + "</script>", KD = X("KIDTXT"), PL = X("PLACE"), US = X("UNSURE");
    await pasteIn(s, tsv(HEAD, ["2027-02-09", "5 pm", W, KD, PL, US]));
    const look = () => p.evaluate(() => ({ fired: (window.__ktXss || []).slice(), marks: document.querySelectorAll(".xss-mark").length, imgs: document.querySelectorAll('img[src^="x-"]').length, handlers: document.querySelectorAll("[onerror]").length, scripts: document.querySelectorAll("script").length, text: document.body.innerText }));
    r.rv = await look(); r.rvRows = await R(s, "rv");
    await pickAll(s, "Ava", null); await p.locator('[data-edit="0"]').click(); await settle(s);
    r.edit = await p.evaluate(() => ({ what: document.querySelector('[data-r="0"] [data-f="what"]').value, place: document.querySelector('[data-r="0"] [data-f="place"]').selectedOptions[0].textContent }));
    r.rvEdit = await look();
    await takeCalls(s); await p.locator('[data-r="0"] [data-edit]').click(); await p.locator("#rvAdd").click(); await waitTxt(s);
    r.stored = (await dbOf(s)).events.find(e => e.day === "2027-02-09"); r.txt = await A(s, "txt"); r.after = await look();
    await p.locator("#txtScrim [data-close]").click();
    r.upText = await p.evaluate(() => document.getElementById("upList").innerText);
    // The file path: file name, summary, location, description.
    const FN = '<img src="x-FILE" onerror="(window.__ktXss=window.__ktXss||[]).push(\'FILE\')">"\'&.ics';
    await fileToReview(s, FN, ics(ev("UID:esc1@example.test", "DTSTART:20270210T170000", "DTEND:20270210T180000", "SUMMARY:" + X("SUMM"), "LOCATION:" + X("LOC"), "DESCRIPTION:" + X("DESC"))));
    r.file = await look(); r.fileRows = await R(s, "rv"); await p.locator("#rvCancel").click();
    r.errors = s.errors.filter(e => !/integrity/.test(e));
    await close(s);
    const clean = o => [o.fired, o.marks, o.imgs, o.handlers];
    expectAll("import escaping", "paste with <img onerror>, quotes and </script> in What, Kid, Place and Unsure: on the review screen nothing runs, no element or event handler is created, and the text shows literally", [
      ["review screen", clean(r.rv), [[], 0, 0, 0]], ["what shows as typed", r.rv.text.includes('<img src="x-WHAT"'), true], ["place shows as typed", r.rv.text.includes('src="x-PLACE"'), true], ["unsure shows as typed", r.rv.text.includes('src="x-UNSURE"'), true],
      ["page script count unchanged (no injected script)", r.rv.scripts, r.after.scripts]]);
    expectAll("import escaping", "the same text in the row editor (input value, the typed-place option), after saving (text sheet, Upcoming list) never becomes markup; the saved title is exactly the typed text", [
      ["editor", clean(r.rvEdit), [[], 0, 0, 0]], ["editor what value is exact", r.edit.what, W], ["typed place option", r.edit.place.includes('src="x-PLACE"') && /\(typed in\)$/.test(r.edit.place), true],
      ["after save", clean(r.after), [[], 0, 0, 0]], ["saved title exact", r.stored && r.stored.title, W], ["upcoming list shows it as text", r.upText.includes('<img src="x-WHAT"'), true], ["text sheet has no markup", /<img|<b |onerror/.test(r.txt.body + (r.txt.href || "")), false]]);
    expectAll("import escaping", "a calendar file with the same text in its file name, summary, location and description: review shows it as text only, no handler, element or script", [
      ["clean", clean(r.file), [[], 0, 0, 0]], ["file name as text", r.file.text.includes('src="x-FILE"'), true], ["summary as text", r.file.text.includes('src="x-SUMM"'), true], ["location as text", r.file.text.includes('src="x-LOC"'), true]]);
    check("import escaping", "escaping flows: no console errors", !r.errors.length, r.errors);
  }

  // =========================================================================
  // 6. Layout at 375px and on desktop, light and dark
  // =========================================================================
  {
    const LONG = "Spring league championship game against the Eastside Eagles with a very long title that has to wrap";
    const text = tsv(HEAD, ["2027-02-09", "5:30-6:30 pm", LONG, "Ava, Sam", "Eastside Gym field two by the north entrance", "Guessed the year and the place because the flyer did not say which"], ["2027-02-10", "6-7", "Practice", "Both", "Studio B"]);
    const out = {};
    for (const [mode, o] of [["375 light", { mobile: true }], ["375 dark", { mobile: true, dark: true }], ["1280 light", {}], ["1280 dark", { dark: true }]]) {
      const s = await go("import layout " + mode, o); await lib(s); const p = s.page, L = out[mode] = {}, W = o.mobile ? 375 : 1280;
      const shot = async n => { fs.mkdirSync(SHOT_DIR, { recursive: true }); await p.screenshot({ path: path.join(SHOT_DIR, `import-${n}-${mode.replace(" ", "-")}.png`) }); };
      L.panel = await R(s, "lay", 'section[aria-labelledby="addT"]'); await shot("panel");
      await p.locator("#optPaste").click(); L.paste = await R(s, "lay", "#pasteScrim .sheet"); await shot("paste");
      await p.locator("#pasteBox").fill(text); await p.locator("#pasteGo").click(); await reviewOpen(s);
      await p.locator('[data-edit="0"]').click(); await settle(s);
      L.review = await R(s, "lay", "#vReview"); await shot("review");
      await p.locator("#rvCancel").click();
      await p.locator("#optHelp").click(); L.help = await R(s, "lay", "#helpScrim .sheet"); await shot("helper"); await p.locator("#helpScrim [data-close]").click();
      if (mode === "375 light") {     // one realistic review for the preview images: already on the tracker, a moved game, new ones and flagged rows (no checks here)
        await p.setViewportSize({ width: 375, height: 1500 });
        await pasteIn(s, tsv(["Date", "Time", "What"], ["Wed Dec 2", "6:00-7:30 pm", "Practice"], ["Sat Dec 5", "11:00 am-12:00 pm", "Game"], ["Wed Dec 9", "6:00-7:30 pm", "Practice"],
          ["Sat Dec 12", "10 am", "Game vs Hawks"], ["Dec 16", "6-7:30", "Practice"], ["Wed Dec 23", "6:00-7:30 pm", "Practice"]));
        await p.locator("#rvKid").selectOption("both"); await p.locator("#rvTeam").selectOption({ label: "Basketball" }); await settle(s);
        await shot("preview-review");
        await p.locator("#rvCancel").click();
      }
      L.errors = s.errors.filter(e => !/integrity/.test(e));
      await close(s);
      const bad = Object.entries(L).filter(([k]) => k !== "errors").flatMap(([k, v]) => [...(v.docScrollWidth > W ? [`${k}: page is ${v.docScrollWidth}px wide in ${W}px`] : []), ...v.wide.map(x => `${k}: ${x}`), ...v.cut.map(x => `${k}: cut off ${x}`)]);
      expectAll("import layout", `at ${mode}: Add activities panel, Paste sheet, Review screen (one editor open, long text) and Helper sheet have no sideways scroll and nothing cut off`, [["problems", bad, []]]);
      const small = Object.entries(L).filter(([k]) => k !== "errors").flatMap(([k, v]) => v.small.map(x => `${k}: ${x}`));
      if (o.mobile) expectAll("import layout", `at ${mode}: every button, select, link and field in those four views is at least 40px tall and wide`, [["small targets", small, []]]);
      const low = Object.entries(L).filter(([k]) => k !== "errors").flatMap(([k, v]) => v.lowContrast.map(x => `${k}: ${x}`));
      expectAll("import layout", `at ${mode}: text on the new views has contrast of at least 4.5 to 1 against its background (readable)`, [["low contrast", low, []]]);
      check("import layout", `at ${mode}: no console errors`, !L.errors.length, L.errors);
    }
    console.log(`INFO   import screenshots saved to tests/output/${path.basename(SHOT_DIR)}/ (import-*.png)`);
  }

}
