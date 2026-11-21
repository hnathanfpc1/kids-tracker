/* Kids Tracker test harness: slice 1C audit, what a signed-in parent (Brett) sees and can do. Test tooling only, never shipped with the site.
   Run through run.mjs ("npm test"). Everything is made up: kids Ava and Max, example.test addresses, +1555555 numbers.
   Covers what acts.mjs section 8 and import.mjs section 4 do NOT: add, edit, cancel, remove and comment as a parent, every table and rpc the
   parent session calls, the controls offered for contacts, kids, places and teams, admin.html as a parent, an account with no role,
   the sign-in card, the deep link through sign-in, and 375px light and dark. */
import fs from "node:fs";
import path from "node:path";
import { dbActs } from "./acts.mjs";

const KID = { ava: "a0000000-0000-4000-8000-000000000001", max: "a0000000-0000-4000-8000-000000000002" };
const TEAM = { soccer: "c0000000-0000-4000-8000-000000000001" };
const PLACE = { rec: "b0000000-0000-4000-8000-000000000001" };
const E = n => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T_ACT = { day: "2026-12-01", instant: "2026-12-01T12:00:00-05:00" };
const FORBIDDEN = ["settings", "breaks", "swaps", "swap_details", "share_links", "app_users"];

export async function parentChecks(h) {
  const { open, close, check, expectAll, settle, takeCalls, ready, BASE_DB, ROOT } = h;
  const DB = dbActs(BASE_DB);
  const SHOTS = path.join(ROOT, "private", "preview-1C");
  fs.mkdirSync(SHOTS, { recursive: true });
  const a = (s, fn, ...args) => s.page.evaluate(([f, x]) => window.__kta[f](...x), [fn, args]);
  const until = (s, fn, arg) => s.page.waitForFunction(fn, arg, { timeout: 8000 });
  const waitTxt = async s => { await until(s, () => !document.getElementById("txtScrim").hidden); await settle(s); };
  const openEv = async (s, id) => { await s.page.evaluate(x => { location.hash = "#x"; location.hash = "#e=" + x; }, id); await until(s, () => !document.getElementById("evScrim").hidden && document.getElementById("evTitle").textContent !== ""); await settle(s); };
  const writes = calls => calls.filter(c => c.table && c.op !== "select");
  const views = s => s.page.evaluate(() => ["vLoading", "vSetup", "vSignin", "vNotAdmin", "vApp"].filter(id => { const e = document.getElementById(id); return e && !e.hidden; }));
  const rail = calls => [...new Set(calls.map(c => c.rpc ? "rpc:" + c.rpc : c.table ? `${c.table}.${c.op}` : c.auth ? "auth:" + c.auth : "?"))].sort();
  const scrollW = s => s.page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  const shot = (s, name, clip) => s.page.screenshot({ path: path.join(SHOTS, name), clip });
  const errs = s => s.errors.filter(e => !/integrity/.test(e));
  const parentOpts = (o = {}) => ({ at: T_ACT, fake: { db: JSON.parse(JSON.stringify(DB)), role: "parent", ...(o.fake || {}) }, ...o, });
  const r = {};

  // ---- 1 and 2 and 5. Every parent flow on activities.html, one session ----
  {
    const s = await open("activities", "parent audit flows", parentOpts()), p = s.page;
    r.load = { views: await views(s), errors: errs(s), up: (await a(s, "up")).rows.length, back: (await a(s, "lists")).back, signOut: (await a(s, "lists")).signOut };
    // add by hand
    await p.locator("#addHand").click(); await settle(s);
    await p.locator(`#evKids [data-pk="${KID.ava}"]`).click(); await p.locator("#evTeam").selectOption(TEAM.soccer);
    await p.locator("#evDay").fill("2026-12-02"); await p.locator("#evStart").fill("17:30");
    await takeCalls(s); await p.locator("#evSave").click(); await waitTxt(s);
    r.add = { w: writes(await takeCalls(s)).map(c => `${c.table}.${c.op}`), txt: await a(s, "txt") };
    await p.locator("#txtScrim [data-close]").click();
    // edit
    await openEv(s, E(7)); await p.locator("#evNote").fill("Bring the blue ball."); await takeCalls(s); await p.locator("#evSave").click(); await settle(s);
    if (await p.evaluate(() => !document.getElementById("txtScrim").hidden)) { r.edit = { txt: await a(s, "txt") }; await p.locator("#txtScrim [data-close]").click(); } else r.edit = { txt: null };
    r.edit.w = writes(await takeCalls(s)).map(c => `${c.table}.${c.op}`);
    // cancel
    await openEv(s, E(11)); await takeCalls(s); await p.locator("#evCancel").click(); await waitTxt(s);
    r.cancel = { w: writes(await takeCalls(s)).map(c => `${c.table}.${c.op}`), txt: await a(s, "txt") }; await p.locator("#txtScrim [data-close]").click();
    // comment without a tag
    await openEv(s, E(7)); await p.locator("#cmtBody").fill("Running late."); await takeCalls(s); await p.locator("#cmtPost").click(); await settle(s);
    r.comment = { w: writes(await takeCalls(s)).map(c => `${c.table}.${c.op}`), txt: await p.evaluate(() => !document.getElementById("txtScrim").hidden) };
    if (r.comment.txt) await p.locator("#txtScrim [data-close]").click();
    await p.locator("#evScrim [data-close]").click();
    // remove
    await openEv(s, E(24)); await p.locator("#evRemove").click(); await takeCalls(s); await p.locator("#evRmYes").click(); await waitTxt(s);
    r.remove = { w: writes(await takeCalls(s)).map(c => `${c.table}.${c.op}`), txt: await a(s, "txt") }; await p.locator("#txtScrim [data-close]").click();
    // contacts, kids, places, teams controls
    r.controls = await p.evaluate(() => {
      const vis = el => !!el && !el.hidden && el.getClientRects().length > 0;
      const con = document.getElementById("conBody");
      return { conInputs: con.querySelectorAll("input,select,textarea").length, conButtons: [...con.querySelectorAll("button")].map(b => b.textContent.trim()), conSave: !!document.getElementById("conSave"),
        addTeam: vis(document.getElementById("addTeam")), teamEdit: document.querySelectorAll("#teamList [data-team]").length,
        addKid: vis(document.getElementById("addKid")), kidEdit: document.querySelectorAll("#kidList [data-kidedit]").length,
        placeEdit: document.querySelectorAll("#placeList [data-editplace]").length, quickPlace: vis(document.getElementById("quickPlace")),
        conHint: con.querySelector(".hint") ? con.querySelector(".hint").textContent.trim() : "", driveLines: [...document.querySelectorAll("#placeList .sub2.num")].map(x => x.textContent.trim()).slice(0, 2) };
    });
    // kids / place / team sheets open for a parent
    await p.locator("#kidList [data-kidedit]").first().click(); r.kidSheet = await p.evaluate(() => ({ title: document.getElementById("kdTitle").textContent, active: !!document.getElementById("kdActive") })); await p.locator("#kidScrim [data-close]").click();
    await p.locator("#placeList [data-editplace]").first().click(); r.placeSheet = await p.evaluate(() => ({ me: document.getElementById("plMeL").textContent, co: document.getElementById("plCoL").textContent, remove: !document.getElementById("plRemove").hidden })); await p.locator("#placeScrim [data-close]").click();
    await p.locator("#teamList [data-team]").first().click(); r.teamSheet = await p.evaluate(() => ({ remove: !document.getElementById("tmRemove").hidden })); await p.locator("#teamScrim [data-close]").click();
    await settle(s); await takeCalls(s);
    r.calls = rail(s.allCalls); r.forbidden = s.allCalls.filter(c => FORBIDDEN.includes(c.table)).map(c => `${c.table}.${c.op}`);
    r.fam = s.famCalls.length; r.errors = errs(s);
    await close(s);
  }
  const noKFamily = t => !/#k=/.test(t || "");
  expectAll("parent audit", "activities.html as parent: loads on the app view with no console error, shows upcoming activities, no Back to admin button, Sign out shown", [
    ["views", r.load.views, ["vApp"]], ["errors", r.load.errors, []], ["upcoming > 0", r.load.up > 0, true], ["back", r.load.back, false], ["signOut", r.load.signOut, true]]);
  expectAll("parent audit", "parent add by hand, edit, cancel, remove and comment each work: add = 1 events insert, edit = 1 events update, cancel = 1 events update, comment = 1 event_comments insert, remove = 1 events delete", [
    ["add", r.add.w, ["events.insert"]], ["edit", r.edit.w, ["events.update"]], ["cancel", r.cancel.w, ["events.update"]], ["comment", r.comment.w, ["event_comments.insert"]], ["remove", r.remove.w, ["events.delete"]]]);
  check("parent audit", "every parent text sheet (add, edit, cancel, remove) carries activities.html#e=<id> or the page address and never a #k= family link",
    [r.add.txt, r.edit.txt, r.cancel.txt, r.remove.txt].filter(Boolean).every(t => noKFamily(t.body)) && [r.add.txt, r.edit.txt, r.cancel.txt].every(t => /activities\.html#e=/.test(t.body)),
    [r.add.txt, r.edit.txt, r.cancel.txt, r.remove.txt].filter(Boolean).map(t => t.body.split("\n").slice(-1)[0]));
  expectAll("parent audit", "text sheet as parent on every action: Brett (you) shown, unchecked and disabled, order Brett, Heather, Angie", [r.add, r.edit, r.cancel, r.remove].map((x, i) => [["add", "edit", "cancel", "remove"][i], x.txt && x.txt.to.map(t => t.replace(/ \[checked\]/, "")), ["Brett (you) [disabled]", "Heather", "Angie (Grandma)"]]));
  check("parent audit", `network across every parent flow: no request to ${FORBIDDEN.join(", ")}, and no get_schedule call with a token (${r.fam} family calls). Touched: ${r.calls.join(", ")}`, !r.forbidden.length && r.fam === 0, [...r.forbidden, `family calls ${r.fam}`, ...r.calls]);
  expectAll("parent audit", "contacts as parent: read-only list, no inputs, no Save button, no buttons at all", [["inputs", r.controls.conInputs, 0], ["buttons", r.controls.conButtons, []], ["save", r.controls.conSave, false]]);
  console.log(`INFO   parent controls on Kids, Places, Teams (the database allows kids insert/update, places and teams all, so these are allowed): ${JSON.stringify({ addTeam: r.controls.addTeam, teamEdit: r.controls.teamEdit, addKid: r.controls.addKid, kidEdit: r.controls.kidEdit, placeEdit: r.controls.placeEdit, quickPlace: r.controls.quickPlace, kidSheet: r.kidSheet, placeSheet: r.placeSheet, teamSheet: r.teamSheet })}`);
  console.log(`INFO   parent contacts hint: ${r.controls.conHint}`);
  check("parent audit", "no console errors across all parent flows", !r.errors.length, r.errors);

  // ---- 6 and 7. admin.html as a parent, and an account with no role, on both pages ----
  const none = {};
  for (const [label, role] of [["parent", "parent"], ["norole", null]]) for (const page of ["admin", "activities"]) {
    const s = await open(page, `${page} as ${label}`, { at: T_ACT, fake: { db: JSON.parse(JSON.stringify(DB)), role } });
    const d = await s.page.evaluate(() => { const v = document.getElementById("vNotAdmin"), vis = el => !!el && !el.hidden && el.getClientRects().length > 0;
      return { views: ["vLoading", "vSignin", "vNotAdmin", "vApp"].filter(id => !document.getElementById(id).hidden), heading: v.querySelector("h2").textContent, msg: v.querySelector(".msg").textContent,
        links: [...v.querySelectorAll("a")].map(x => x.getAttribute("href")), buttons: [...v.querySelectorAll("button")].map(b => b.textContent.trim()), headerSignOut: vis(document.getElementById("signOut")),
        headerLinks: [...document.querySelectorAll("header a, #topBtns a")].filter(vis).map(x => x.getAttribute("href")), text: document.body.innerText.slice(0, 300) }; });
    d.calls = rail(await takeCalls(s)); d.forbidden = s.allCalls.filter(c => FORBIDDEN.includes(c.table)).map(c => c.table); d.errors = errs(s);
    none[`${page}-${label}`] = d;
    if (page === "admin" && label === "parent") await shot(s, "admin-as-parent-375.png", { x: 0, y: 0, width: 375, height: 420 }).catch(() => {});
    await close(s);
  }
  // admin as parent at 375 for the screenshot
  { const s = await open("admin", "admin as parent 375", { at: T_ACT, mobile: true, fake: { db: JSON.parse(JSON.stringify(DB)), role: "parent" } });
    await shot(s, "admin-as-parent-375.png", { x: 0, y: 0, width: 375, height: 440 }); none.adminParent375 = await scrollW(s); await close(s); }
  for (const k of Object.keys(none)) if (none[k].calls) console.log(`INFO   ${k}: views ${JSON.stringify(none[k].views)}; "${none[k].heading}" / "${none[k].msg}"; buttons ${JSON.stringify(none[k].buttons)}; links ${JSON.stringify(none[k].links)}; header links ${JSON.stringify(none[k].headerLinks)}; calls ${none[k].calls.join(",")}`);
  expectAll("parent audit", "admin.html as parent and both pages with no role: only my_role is asked (no custody data, no schedule, no contacts) before the role check, nothing from the custody tables, no console error", ["admin-parent", "activities-norole", "admin-norole"].map(k => [k, { calls: none[k].calls, forbidden: none[k].forbidden, errors: none[k].errors }, { calls: ["rpc:my_role"], forbidden: [], errors: [] }]));
  check("parent audit", "admin.html as parent: the message is kind and clear and offers a way to the Activities page (a link to activities.html) as well as Sign out",
    none["admin-parent"].links.includes("activities.html") && !/isn't set up to edit the tracker/.test(none["admin-parent"].msg),
    [`heading: ${none["admin-parent"].heading}`, `message: ${none["admin-parent"].msg}`, `links: ${JSON.stringify(none["admin-parent"].links)}`, `buttons: ${JSON.stringify(none["admin-parent"].buttons)}`]);
  expectAll("parent audit", "no-role account on both pages: heading says it can't make changes, a Sign out button is the only way on", [
    ["admin", [none["admin-norole"].heading, none["admin-norole"].buttons], ["This account can't make changes", ["Sign out"]]],
    ["activities", [none["activities-norole"].heading, none["activities-norole"].buttons], ["This account can't make changes", ["Sign out"]]]]);

  // ---- 8. Sign-in card ----
  {
    const s = await open("activities", "parent sign-in card", { at: T_ACT, fake: { db: JSON.parse(JSON.stringify(DB)), role: "parent", signedIn: false } }), p = s.page;
    await p.locator("#email").fill("brett@example.test"); await p.locator("#password").fill("wrong"); await p.locator("#pwSignIn").click(); await settle(s);
    r.wrong = await p.evaluate(() => document.getElementById("signinMsg").textContent);
    r.card = await p.evaluate(() => ({ text: document.getElementById("vSignin").innerText.replace(/\s+/g, " "), buttons: [...document.querySelectorAll("#vSignin button")].map(b => b.textContent.trim()), links: [...document.querySelectorAll("#vSignin a")].map(x => x.textContent.trim()) }));
    await p.locator("#sendCode").click(); await settle(s);
    r.magic = (await takeCalls(s)).filter(c => c.auth === "signInWithOtp").map(c => c.redirectTo);
    await close(s);
    console.log(`INFO   sign-in card: wrong password says "${r.wrong}"; buttons ${JSON.stringify(r.card.buttons)}; links ${JSON.stringify(r.card.links)}; no forgot or set-new-password path exists (no resetPasswordForEmail or updateUser in editor.js)`);
    expectAll("parent audit", "sign-in card: wrong password gives the plain message; the card has a password button and an emailed-link button and no forgot-password path (reported as it is today)", [
      ["wrong password", r.wrong, "That email and password didn't match. Check them and try again."], ["no forgot link", r.card.links, []]]);
  }

  // ---- 9. Deep link through sign-in ----
  {
    const s = await open("activities", "parent deep link sign in", { at: T_ACT, hash: `#e=${E(7)}`, fake: { db: JSON.parse(JSON.stringify(DB)), role: "parent", signedIn: false } }), p = s.page;
    r.dl0 = await views(s);
    await p.locator("#email").fill("brett@example.test"); await p.locator("#password").fill("correct-test-password"); await p.locator("#pwSignIn").click();
    await p.waitForFunction(() => !document.getElementById("vApp").hidden, null, { timeout: 8000 }); await settle(s); await p.waitForTimeout(100);
    r.dl = await a(s, "sheet");
    await p.locator("#email").count();
    await close(s);
    expectAll("parent audit", "deep link activities.html#e=<id> opened signed out, then signing in with a password as a parent, lands on that activity's sheet", [
      ["signed out first", r.dl0, ["vSignin"]], ["sheet", [r.dl.shown, r.dl.title], [true, "Basketball game"]]]);
    // The emailed link comes back to the page address without the #e=<id> part, so the page remembers the activity before the email goes out (for an hour).
    {
      const s2 = await open("activities", "parent deep link emailed link", { at: T_ACT, hash: `#e=${E(7)}`, fake: { db: JSON.parse(JSON.stringify(DB)), role: "parent", signedIn: false } }), p2 = s2.page;
      await p2.locator("#email").fill("brett@example.test"); await p2.locator("#sendCode").click(); await settle(s2);
      const kept = await p2.evaluate(() => { const v = localStorage.getItem("kt-open"); history.replaceState(null, "", location.pathname); return v; });
      await p2.locator("#password").fill("correct-test-password"); await p2.locator("#pwSignIn").click();
      await p2.waitForFunction(() => !document.getElementById("vApp").hidden, null, { timeout: 8000 }); await settle(s2); await p2.waitForTimeout(100);
      const back = await a(s2, "sheet"), left = await p2.evaluate(() => [location.hash, localStorage.getItem("kt-open")]);
      await close(s2);
      const s3 = await open("activities", "parent stale remembered activity", { at: T_ACT, fake: { db: JSON.parse(JSON.stringify(DB)), role: "parent", signedIn: false } }), p3 = s3.page;
      await p3.evaluate(id => localStorage.setItem("kt-open", id + "|" + (Date.now() - 2 * 3600000)), E(7));
      await p3.locator("#email").fill("brett@example.test"); await p3.locator("#password").fill("correct-test-password"); await p3.locator("#pwSignIn").click();
      await p3.waitForFunction(() => !document.getElementById("vApp").hidden, null, { timeout: 8000 }); await settle(s3); await p3.waitForTimeout(100);
      const stale = await a(s3, "sheet"), left3 = await p3.evaluate(() => localStorage.getItem("kt-open"));
      await close(s3);
      expectAll("parent audit", "deep link through the emailed-link button: the activity is remembered before the email goes out, opens after coming back with no #e= part, and is forgotten after use or after an hour", [
        ["remembered", (kept || "").split("|")[0], E(7)], ["opens on return", [back.shown, back.title], [true, "Basketball game"]], ["cleared after use", left, ["", null]],
        ["older than an hour does not open", [stale.shown, left3], [false, null]]]);
    }
  }

  // ---- 10. 375px, light and dark ----
  for (const dark of [false, true]) {
    const s = await open("activities", `parent 375 ${dark ? "dark" : "light"}`, { at: T_ACT, mobile: true, dark, fake: { db: JSON.parse(JSON.stringify(DB)), role: "parent" } }), p = s.page;
    const out = { top: await scrollW(s) };
    if (!dark) await shot(s, "activities-parent-375-light-top.png", { x: 0, y: 0, width: 375, height: 640 });
    out.bottom = await p.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); return { doc: document.documentElement.scrollWidth, win: window.innerWidth }; });
    await openEv(s, E(7)); out.sheet = await scrollW(s);
    await p.locator("#cmtBody").fill("Angie, see you there."); await p.locator("#tag-grandma").check(); await p.locator("#cmtPost").click(); await waitTxt(s);
    out.txt = await scrollW(s);
    if (!dark) await shot(s, "text-sheet-parent-375-light.png", { x: 0, y: 0, width: 375, height: 700 });
    const small = await p.evaluate(() => [...document.querySelectorAll("#txtScrim button, #txtScrim label, #evScrim button")].filter(e => e.getClientRects().length).map(e => { const b = e.getBoundingClientRect(); return b.height < 40 ? `${(e.textContent || "").trim().slice(0, 20)} ${Math.round(b.height)}px` : null; }).filter(Boolean));
    out.small = small; out.errors = errs(s);
    console.log(`INFO   parent 375 ${dark ? "dark" : "light"} tap targets under 40px tall in the event and text sheets (same controls as the admin sign-in, not parent specific): ${out.small.join("; ")}`);
    await close(s);
    expectAll("parent audit", `parent views at 375px ${dark ? "dark" : "light"}: no sideways scroll on the page, the activity sheet or the text sheet, no console error`, [
      ["top", out.top.doc, 375], ["bottom", out.bottom.doc, 375], ["event sheet", out.sheet.doc, 375], ["text sheet", out.txt.doc, 375], ["errors", out.errors, []]]);
  }
}
