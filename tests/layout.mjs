/* Kids Tracker harness: layout and navigation slice (activities panel hides empty days, Schedule | Activities switch, two columns from 900px,
   NS on phones). Test tooling only, never shipped. Run through run.mjs. Made-up names only. */
import { dbActs } from "./acts.mjs";

const T_ACT = { day: "2026-12-01", instant: "2026-12-01T12:00:00-05:00" };
const AT = d => ({ day: d, instant: `${d}T12:00:00-05:00` });
const clone = x => JSON.parse(JSON.stringify(x));

export async function layoutChecks(h) {
  const { open, close, check, expectAll, settle, familyResponse, BASE_DB } = h;
  const G = "layout nav";
  const DBA = dbActs(BASE_DB);
  const fam = (db, at) => body => ({ json: body && body.p_token === "TESTTOKEN" ? familyResponse(db, { at }) : null });
  const sized = async (s, w) => { await s.page.setViewportSize({ width: w, height: 900 }); await s.page.waitForTimeout(150); };
  const homeO = (o = {}) => ({ at: T_ACT, ...o, fake: { db: clone(DBA), role: "parent", ...(o.fake || {}) } });
  const date = d => d.replace(/ ?(Today|Handoff day)/g, "");
  const days = s => s.page.evaluate(() => [...document.querySelectorAll("#fActBody .aday")].map(d => ({ head: d.querySelector(".dt").textContent.replace(/\s+/g, " ").trim(), ev: d.querySelectorAll(".ev").length, pack: d.querySelectorAll(".pack li").length, handoff: !!d.querySelector(".handoff") })));
  const none = s => s.page.evaluate(() => { const n = document.querySelector("#fActBody .none"); return n ? n.textContent.trim() : null; });
  const rects = (s, sels) => s.page.evaluate(sels => Object.fromEntries(sels.map(x => { const e = document.querySelector(x), r = e && e.getClientRects().length ? e.getBoundingClientRect() : null; return [x, r && { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), left: Math.round(r.left), right: Math.round(r.right) }]; })), sels);
  const noScroll = s => s.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth, document.body.scrollWidth]);
  const vis = (s, sel) => s.page.evaluate(sel => { const e = document.querySelector(sel); return !!e && !e.hidden && e.getClientRects().length > 0; }, sel);
  const BLOCKS = ["#newBox", "#famNow", "#fActs", ".sec-month", ".sec-up", "#fRecent", "#updated", ".fam .foot"];

  // ---- 1. Activities panel: empty days are not listed ----
  {
    const s = await open("family", "layout: panel Dec 8", { at: AT("2026-12-08"), respond: fam(DBA, "2026-12-08T12:00:00-05:00") });
    const w = await days(s);
    await s.page.locator('[data-act="month"]').click(); const m = await days(s);
    await close(s);
    expectAll(G, "Activities panel on Tue Dec 8 (nothing that day): today is not listed, week starts at the next day with an activity", [
      ["week first day", w[0] && date(w[0].head), "Wed, Dec 9"], ["Today marker anywhere", w.concat(m).some(d => /Today/.test(d.head)), false], ["every listed day has an activity or a pack list", w.concat(m).every(d => d.ev > 0 || d.pack > 0), true]]);

    const d0 = clone(DBA); d0.events = [];
    const e = await open("family", "layout: no activities", { at: T_ACT, respond: fam(d0, T_ACT.instant) });
    const wk = { text: await none(e), days: (await days(e)).length }; await e.page.locator('[data-act="month"]').click();
    const mo = { text: await none(e), days: (await days(e)).length }; const shownKids = await vis(e, "#fActs");
    await close(e);
    expectAll(G, "empty range: This week says \"No activities this week.\" and Next 30 days says \"No activities in the next 30 days.\" (kids exist, no events); panel stays visible", [
      ["week", wk, { text: "No activities this week.", days: 0 }], ["month", mo, { text: "No activities in the next 30 days.", days: 0 }], ["panel visible", shownKids, true]]);

    // Handoff day with a pack list but nothing of its own: kept. Same handoff with nothing to pack: dropped.
    const dA = clone(DBA); dA.events = dA.events.filter(x => x.day !== "2026-12-06");
    const dB = clone(DBA); dB.events = dB.events.filter(x => !(x.day >= "2026-12-06" && x.day <= "2026-12-10"));
    const a = await open("family", "layout: handoff kept", { at: T_ACT, respond: fam(dA, T_ACT.instant) }); const dl = await days(a); const da = dl.find(d => date(d.head) === "Sun, Dec 6"); await close(a);
    const b = await open("family", "layout: handoff dropped", { at: T_ACT, respond: fam(dB, T_ACT.instant) }); const db = (await days(b)).find(d => date(d.head) === "Sun, Dec 6"); await close(b);
    expectAll(G, "handoff day with no activity of its own: kept when its pack list has content (Sun Dec 6), dropped when nothing to pack", [
      ["kept", da && { handoff: da.handoff, ev: da.ev, packHasContent: da.pack > 0 }, { handoff: true, ev: 0, packHasContent: true }], ["dropped", !!db, false]]);
  }

  // ---- 2. Header switch and aria-current ----
  {
    const s = await open("home", "layout: home switch", homeO()); const p = s.page;
    const nav = await p.evaluate(() => { const n = document.querySelector("nav.pageswitch"), vis = !!n && n.getClientRects().length > 0; return { vis, links: n ? [...n.querySelectorAll("a")].map(a => [a.textContent.trim(), a.getAttribute("href"), a.getAttribute("aria-current")]) : null, signOut: document.getElementById("signOut").classList.contains("quiet") }; });
    await close(s);
    expectAll(G, "signed-in home: switch shows Schedule (aria-current=page) and Activities (activities.html), quiet Sign out; only one link is current", [
      ["switch visible", nav.vis, true], ["links", nav.links, [["Schedule", "./", "page"], ["Activities", "activities.html", null]]], ["sign out quiet", nav.signOut, true]]);

    const f = await open("family", "layout: family link no nav", { at: T_ACT, respond: fam(DBA, T_ACT.instant) });
    const fl = await f.page.evaluate(() => ({ nav: [...document.querySelectorAll("nav.pageswitch, #homeBtns, #signOut")].filter(e => e.getClientRects().length > 0).length, sb: !!window.supabase, ed: !!window.KTEditor,
      scripts: [...document.scripts].map(x => x.src).filter(x => /supabase|editor/.test(x)), sbTag: document.getElementById("sbSrc").type }));
    const reqs = f.reqs ? f.reqs.filter(u => /supabase|editor/.test(String(u.url || u))) : [];
    const cdn = f.cdn.length; await close(f);
    expectAll(G, "family link: no switch, no Sign out, no supabase-js or editor.js loaded or requested", [["visible nav/buttons", fl.nav, 0], ["window.supabase", fl.sb, false], ["window.KTEditor", fl.ed, false], ["script srcs", fl.scripts, []], ["sbSrc tag stays inert", fl.sbTag, "text/plain"], ["cdn requests", cdn, 0], ["editor/supabase requests", reqs.length, 0]]);

    for (const role of ["parent", "admin"]) {
      const r = await open("activities", `layout: activities as ${role}`, { at: T_ACT, fake: { db: clone(DBA), role } });
      const x = await r.page.evaluate(() => { const vis = e => !e.hidden && e.getClientRects().length > 0, n = document.getElementById("pageSwitch"), b = document.getElementById("backBtn");
        return { sw: vis(n), cur: [...n.querySelectorAll("[aria-current]")].map(a => a.textContent.trim()), back: vis(b), href: b.getAttribute("href"), links: [...n.querySelectorAll("a")].map(a => a.getAttribute("href")) }; });
      await close(r);
      if (role === "parent") expectAll(G, "activities.html as parent: switch shown, Activities is aria-current, Schedule links to ./, Back to schedule hidden", [["switch", x.sw, true], ["current", x.cur, ["Activities"]], ["links", x.links, ["./", "activities.html"]], ["back", x.back, false]]);
      else expectAll(G, "activities.html as admin: unchanged (Back to schedule to admin.html, no switch)", [["switch", x.sw, false], ["back", x.back, true], ["href", x.href, "admin.html"]]);
    }
  }

  // ---- 3. Visual order below 900px; two columns from 900px ----
  {
    const seen = "localStorage.setItem('kt-seen','2000-01-01T00:00:00+00:00');";
    for (const w of [375, 768]) {
      const s = await open("family", `layout: order ${w}`, { at: T_ACT, respond: fam(DBA, T_ACT.instant), init: seen }); await sized(s, w);
      const r = await rects(s, BLOCKS); const dom = await s.page.evaluate(sel => sel.map(x => { const e = document.querySelector(x); return e ? e.compareDocumentPosition(document.querySelector("#famNow")) : 0; }), BLOCKS);
      await close(s);
      const shown = BLOCKS.filter(x => r[x]); const tops = shown.map(x => r[x].top);
      check(G, `at ${w}px the blocks stack in the old order: ${shown.join(", ")} (tops strictly increasing)`, tops.every((t, i) => !i || t > tops[i - 1]) && shown.includes("#newBox") && shown.length === BLOCKS.length, JSON.stringify(Object.fromEntries(BLOCKS.map(x => [x, r[x] && r[x].top]))));
      check(G, `at ${w}px every block is the full column width (single column)`, shown.every(x => Math.abs((r[x].right - r[x].left) - (r["#famNow"].right - r["#famNow"].left)) <= 1), JSON.stringify(r));
    }
    for (const w of [900, 1440]) {
      const s = await open("family", `layout: cols ${w}`, { at: T_ACT, respond: fam(DBA, T_ACT.instant), init: seen }); await sized(s, w);
      const r = await rects(s, BLOCKS), col = await rects(s, [".col-l", ".col-r"]); const sc = await noScroll(s);
      await close(s);
      const L = [r["#famNow"], r[".sec-month"], r[".sec-up"]], R = [r["#fActs"], r["#fRecent"]];
      check(G, `at ${w}px: Right now, month and Coming up share the left column; Activities and Recent changes share the right column to the right of the calendar`,
        L.every(x => x && x.left === L[0].left) && R.every(x => x && x.left === R[0].left) && R[0].left >= r[".sec-month"].right && r["#fActs"].top <= r["#famNow"].top + 1 && r["#fRecent"].top >= r["#fActs"].bottom && r[".sec-month"].top >= r["#famNow"].bottom, JSON.stringify(r));
      check(G, `at ${w}px: Updated box spans both columns above them; updated line and foot line sit below both columns, full width, updated above foot`,
        r["#newBox"].left <= col[".col-l"].left && r["#newBox"].right >= col[".col-r"].right && r["#newBox"].bottom <= col[".col-l"].top + 1
        && r["#updated"].top >= Math.max(col[".col-l"].bottom, col[".col-r"].bottom) && r[".fam .foot"].top >= r["#updated"].bottom - 1 && r["#updated"].left <= col[".col-l"].left && r["#updated"].right >= col[".col-r"].right, JSON.stringify({ r, col }));
      check(G, `at ${w}px: no sideways scroll`, sc[0] <= sc[1] && sc[2] <= sc[1], JSON.stringify(sc));
    }
  }

  // ---- 4. Hidden states still hide at 1440; message and sign-in states show no schedule ----
  {
    const bad = x => x.every(v => v === false);
    const s = await open("family", "layout: inactive link 1440", { respond: () => ({ json: null }) }); await sized(s, 1440);
    const a = [await vis(s, "#famContent"), await vis(s, ".col-l"), await vis(s, ".col-r"), await vis(s, "#famNow"), await vis(s, ".fam .foot"), await vis(s, "#updated")], msg = await vis(s, "#famMsg"); await close(s);
    check(G, "inactive link at 1440: message shown, schedule columns, Right now, updated and foot lines all hidden", msg && bad(a), JSON.stringify({ msg, a }));
    const o = await open("home", "layout: signed out 1440", { at: T_ACT, fake: { db: clone(DBA), signedIn: false } }); await sized(o, 1440);
    const b = [await vis(o, "#famContent"), await vis(o, ".col-l"), await vis(o, ".col-r"), await vis(o, "#famNow"), await vis(o, ".fam .foot"), await vis(o, "nav.pageswitch")], card = await vis(o, "#vSignin"); await close(o);
    check(G, "signed-out home at 1440: sign-in card shown, no schedule content, no switch", card && bad(b), JSON.stringify({ card, b }));
    const d1 = clone(DBA); d1.kids = []; d1.event_log = []; d1.events = []; d1.swaps = []; d1.swap_details = [];
    const k = await open("home", "layout: no kids 1440", homeO({ fake: { db: d1 } })); await sized(k, 1440);
    const c = [await vis(k, "#fActs"), await vis(k, "#fRecent"), await vis(k, "#newBox")], content = await vis(k, "#famContent"); await close(k);
    check(G, "no kids and no log at 1440: schedule shows, Activities panel, Recent changes and Updated box stay hidden", content && bad(c), JSON.stringify({ content, c }));
  }

  // ---- 5. No sideways scroll on every page, every width, light and dark ----
  {
    const bad = [];
    for (const [kind, label, mk] of [["home", "home", o => homeO(o)], ["family", "family link", o => ({ at: T_ACT, respond: fam(DBA, T_ACT.instant), ...o })], ["activities", "activities.html", o => ({ at: T_ACT, fake: { db: clone(DBA), role: "parent" }, ...o })]]) {
      for (const dark of [false, true]) {
        const s = await open(kind, `layout: scroll ${label}`, mk({ dark }));
        for (const w of [375, 768, 900, 1440]) { await sized(s, w); const x = await noScroll(s); if (x[0] > x[1] || x[2] > x[1]) bad.push(`${label} ${w}px ${dark ? "dark" : "light"}: ${x.join("/")}`); }
        await close(s);
      }
    }
    check(G, "no sideways scroll at 375, 768, 900 and 1440 on the home, the family link and activities.html, light and dark", !bad.length, bad);
  }

  // ---- 6. NS on phones, "No school" on wide screens ----
  {
    const read = s => s.page.evaluate(() => { const c = document.querySelector('#fGrid .day[aria-label*="Mon, Nov 23" i], #fGrid .day[aria-label*="November 23" i]') || [...document.querySelectorAll("#fGrid .day")].find(d => d.querySelector(".nos"));
      return { text: c.querySelector(".nos").innerText.trim(), aria: c.getAttribute("aria-label"), legend: document.getElementById("fLegend").innerText.replace(/\s+/g, " ") }; });
    const p = await open("family", "layout: NS phone", { mobile: true, width: 375 }), ph = await read(p); await close(p);
    const w = await open("family", "layout: NS wide", {}), wi = await read(w); await close(w);
    expectAll(G, "no-school cells say NS at 375px and No school at 1280px; legend says \"No school (NS)\" on phones and plain \"No school\" wide; the day button label is the same at both", [
      ["phone cell", ph.text, "NS"], ["wide cell", wi.text.toLowerCase(), "no school"], ["phone legend", /No school \(NS\)/.test(ph.legend), true], ["wide legend", [/No school/.test(wi.legend), /\(NS\)/.test(wi.legend)], [true, false]],
      ["aria label same and mentions no school", [ph.aria === wi.aria, /no school/i.test(ph.aria)], [true, true]]]);
  }

  // ---- 7. Keyboard order at phone width (information, not a pass/fail) ----
  {
    const s = await open("home", "layout: tab order", homeO({ mobile: true, width: 375 }));
    const t = await s.page.evaluate(() => { const els = [...document.querySelectorAll("#famContent a[href], #famContent button")].filter(e => e.getClientRects().length && !e.closest("[hidden]")); const tops = els.map(e => Math.round(e.getBoundingClientRect().top + scrollY));
      let jumps = 0; for (let i = 1; i < tops.length; i++) if (tops[i] < tops[i - 1] - 2) jumps++; return { n: els.length, jumps, first: els.slice(0, 1).map(e => e.id || e.textContent.trim()) }; });
    await close(s);
    console.log(`INFO   [layout nav] tab order at 375px: ${t.n} focusable controls in the schedule, ${t.jumps} places where focus jumps UP the page (DOM order differs from visual order)`);
  }
}
