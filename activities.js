/* Kids Tracker: the Activities page (activities.html). Signed in as Heather (admin) or Brett (parent).
   Reads the schedule only through get_editor_schedule(). It never reads the custody tables (settings, breaks, swaps,
   swap_details, app_users): a parent's sign-in cannot, and this page does not try. The one exception is share_links,
   read only when the signed-in role is admin, to put the family link in a text to Angie.
   Reads contacts directly (the payload leaves them out). Writes events, event_comments, teams, places, kids and contacts.
   The database stamps who and when, writes the change log and enforces every limit; this page never sends those fields. */
(() => {
  "use strict";
  const CFG = window.KT_CONFIG || {};
  const CONFIGURED = /^https:\/\//.test(CFG.url || "") && CFG.key && !/PASTE_/.test(CFG.key);
  const { toNum, toStr, fmt, isDate, todayNum, wd, SD } = window.KTCore;
  const K = window.KTActs, E = window.KTEditor, esc = K.esc;
  const $ = id => document.getElementById(id);
  let T0 = todayNum();

  // ---------- State ----------
  const st = {
    settings: { myName: "Heather", coName: "Brett", anchor: null, trackFrom: null },
    swaps: new Map(), breaks: {},   // the family-safe custody view from get_editor_schedule, so "who has the kids" is right
    contacts: [], role: null, me: null,
    kidFilter: "all", upMax: 40, logMax: 30,
  };
  const S = () => st.settings;
  const sched = window.KTCore.schedule(st);
  const acts = K.create(sched, S);
  const A = () => acts.data;
  let sb = null, entering = false;

  // ---------- Small helpers ----------
  let tT;
  const toast = m => { const el = $("toast"); el.textContent = m; el.hidden = false; clearTimeout(tT); tT = setTimeout(() => { el.hidden = true; }, 3600); };
  const views = ["vLoading", "vSetup", "vSignin", "vNotAdmin", "vApp"];
  const show = id => { views.forEach(v => { $(v).hidden = v !== id; }); $("topBtns").hidden = id !== "vApp"; };
  const one = s => String(s == null ? "" : s).replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();   // one-line fields
  const multi = s => String(s == null ? "" : s).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();         // notes
  const intIn = id => { const v = $(id).value.trim(); if (v === "") return null; const n = Number(v); return Number.isInteger(n) ? n : NaN; };
  const dayText = K.dayText, clock = K.clock, timeText = K.timeText;
  const longDay = n => fmt(n, { weekday: "long", month: "long", day: "numeric" });
  const HOUSE_LABEL = { me: () => S().myName + "'s", co: () => S().coName + "'s", grandma: () => "Angie's" };
  // Database answers in plain words.
  function why(e) {
    const c = e && e.code;
    if (c === "23514") return "something is too long, or has a line break where it can't";
    if (c === "23505") return "that one is already on the tracker";
    if (c === "42501") return "this account isn't allowed to do that";
    if (c === "23502") return "something required is missing";
    return (e && e.message) || "check your connection";
  }
  const fail = (what, e) => { console.error(e); toast(`Couldn't ${what}: ${why(e)}.`); };
  const closeTop = () => { const open = [...document.querySelectorAll(".scrim")].filter(s => !s.hidden); if (open.length) open[open.length - 1].hidden = true; };

  // ---------- Loading ----------
  async function load() {
    const [r, c] = await Promise.all([
      sb.rpc("get_editor_schedule"),
      (async () => { try { return await sb.from("contacts").select("*"); } catch (e) { return { data: null, error: e }; } })(),
    ]);
    if (r.error) throw r.error;
    if (!r.data) return false;   // not an editor
    const d = r.data, s = d.settings || {};
    st.settings = { myName: s.my_name || "Heather", coName: s.co_name || "Brett", anchor: isDate(s.anchor) ? s.anchor : toStr(T0 - ((wd(T0) + 2) % 7)), trackFrom: null };
    st.breaks = {}; (d.breaks || []).forEach(b => { st.breaks[b.year] = b.data || {}; });
    st.swaps = new Map();
    (d.swaps || []).forEach(w => { if (isDate(w.day)) st.swaps.set(w.day, { date: w.day, had: w.had, with: w.caregiver || "", reason: w.reason || "", note: w.note || "", pnote: "", updatedAt: w.updated_at || null }); });
    acts.load(d);
    if (!c.error && Array.isArray(c.data)) st.contacts = c.data;
    return true;
  }
  async function refresh() {
    try { await load(); } catch (e) { fail("reload", e); }
    render();
    if (!$("evScrim").hidden && ed && ed.id) renderComments();
  }
  async function enter() {
    if (entering) return; entering = true;
    try {
      show("vLoading");
      const { data: role, error } = await sb.rpc("my_role");
      if (error) throw error;
      if (role !== "admin" && role !== "parent") { show("vNotAdmin"); return; }
      st.role = role; st.me = role === "admin" ? "me" : "co";
      if (!(await load())) { show("vNotAdmin"); return; }
      // Heather's sign-in may read the family link (the database allows it for admin only), so a text to Angie can
      // open the activity on the family page. A parent's sign-in never asks for it and could not read it.
      st.famTok = null;
      if (role === "admin") {
        try {
          const { data } = await sb.from("share_links").select("token").eq("active", true).order("created_at", { ascending: false }).limit(1);
          const t = data && data[0] && data[0].token;
          st.famTok = /^[A-Za-z0-9]+$/.test(t || "") ? t : null;
        } catch (e) { st.famTok = null; }
      }
      show("vApp"); $("backBtn").hidden = role !== "admin";
      render(); openFromHash();
    } catch (e) { fail("load activities", e); show("vSignin"); }
    finally { entering = false; }
  }
  function render() {
    T0 = todayNum(); sched.rebuild();
    renderUp(); renderTeams(); renderPlaces(); renderKids(); renderContacts(); renderLog();
  }

  // ---------- Upcoming ----------
  function renderUp() {
    const ks = A().kids;
    if (st.kidFilter !== "all" && !A().kid.has(st.kidFilter)) st.kidFilter = "all";
    $("upFilter").innerHTML = ks.length > 1 ? `<span>Show</span><button type="button" class="fbtn" data-kid="all" aria-pressed="${st.kidFilter === "all"}">All</button>${ks.map(k =>
      `<button type="button" class="fbtn kchip c-${k.color}" data-kid="${esc(k.id)}" aria-pressed="${st.kidFilter === k.id}">${esc(k.name)}</button>`).join("")}` : "";
    const list = A().events.filter(e => e.n >= T0 && (st.kidFilter === "all" || e.kid_ids.includes(st.kidFilter)));
    $("upCount").textContent = list.length ? `${list.length} coming up` : "";
    $("upList").innerHTML = list.length ? list.slice(0, st.upMax).map(upRow).join("")
      : `<li style="display:block"><p class="empty">${ks.length ? "Nothing coming up. Tap Add one by hand to add a practice, game or lesson." : "Add your kids first (Kids, below). Then add activities."}</p></li>`;
    $("upMore").hidden = list.length <= st.upMax;
  }
  function upRow(e) {
    const p = acts.placeOf(e), h = sched.actual(e.n), n = (A().cmts.get(e.id) || []).length;
    return `<li><button type="button" class="up-row${e.canceled ? " canceled" : ""}" data-ev="${esc(e.id)}">
      <span class="when num">${fmt(e.n, SD)}<small>${fmt(e.n, { weekday: "short" })}</small></span>
      <span class="what"><span class="ln">${e.canceled ? `<span class="chip plain">Canceled</span>` : ""}${acts.kidsOf(e.kid_ids).map(acts.kchip).join("")}<strong class="ev-name">${esc(acts.label(e))}</strong></span>
        <span class="ln sub2 num">${K.timeSpan(e.start, e.end)}${p ? ", " + esc(p.name) : e.place_text ? ", " + esc(e.place_text) : ""}</span>
        <span class="ln sub2"><span class="chip ${K.holderKey(h)}">${esc(sched.nameOf(h, sched.recOf(e.n)))}</span>${acts.isHandoff(e.n) ? "Handoff day" : "has the kids"}${n ? `. ${n} comment${n === 1 ? "" : "s"}` : ""}</span></span>
      <span class="go" aria-hidden="true">Edit</span></button></li>`;
  }

  // ---------- Kid picker (activity and team sheets) ----------
  // With exactly two active kids: one kid, or Both. Otherwise each kid toggles on and off (at least one stays on).
  function kidPick(el, sel) {
    const all = A().kids, active = all.filter(k => k.active), two = active.length === 2;
    const both = two && sel.length === 2 && active.every(k => sel.includes(k.id));
    $(el).innerHTML = all.filter(k => k.active || sel.includes(k.id)).map(k =>
      `<button type="button" class="kid c-${k.color}" data-pk="${esc(k.id)}" aria-pressed="${!both && sel.includes(k.id)}">${esc(k.name)}</button>`).join("")
      + (two ? `<button type="button" data-pk="both" aria-pressed="${both}">Both</button>` : "")
      || `<p class="sub">Add a kid first (Kids section).</p>`;
  }
  function kidClick(sel, v) {
    const active = A().kids.filter(k => k.active);
    if (v === "both") return active.map(k => k.id);
    if (active.length === 2) return [v];
    const s = new Set(sel); if (s.has(v)) s.delete(v); else s.add(v);
    return s.size ? [...s] : [v];
  }

  // ---------- Gear chips (activity and team sheets) ----------
  // Type an item and press return to add it. Tap the x to remove it. Up to 50 items of up to 80 characters.
  function gearEditor(el, list, onChange) {
    const box = $(el);
    box.innerHTML = list.map((g, i) => `<span>${esc(g)} <button type="button" class="gx" data-gx="${i}" aria-label="Remove ${esc(g)}">&times;</button></span>`).join("")
      + `<input type="text" maxlength="80" placeholder="+ add gear" aria-label="Add gear" autocomplete="off" enterkeyhint="done">`;
    const inp = box.querySelector("input");
    box.onclick = e => { const x = e.target.closest("[data-gx]"); if (!x) return; const next = list.slice(); next.splice(Number(x.dataset.gx), 1); onChange(next); };
    inp.onkeydown = e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addGear(list, inp, onChange, true); } };
  }
  // Adds what is typed in the gear box. Also used on Save so a typed item is never lost.
  function addGear(list, inp, onChange, refocus) {
    const t = one(inp.value).slice(0, 80);
    if (!t) return list;
    if (list.length >= 50) { toast("A gear list can have up to 50 items."); return list; }
    const next = list.some(g => g.toLowerCase() === t.toLowerCase()) ? list.slice() : list.concat(t);
    inp.value = ""; onChange(next);
    if (refocus) { const again = inp.isConnected ? inp : document.activeElement; if (again && again.focus) again.focus(); }
    return next;
  }
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // ---------- Place picker (activity and team sheets) ----------
  function placeOptions(sel, extraText, noneText) {
    const ps = A().places.slice().sort((a, b) => a.name.localeCompare(b.name));
    return `<option value="">${esc(noneText || "No place")}</option>${extraText ? `<option value="__text">${esc(extraText)} (typed in)</option>` : ""}${ps.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}<option value="__new">+ Add a new place</option>`;
  }
  // Wires a place select with its "Add a new place" row. get/set read and write the chosen place id.
  function wirePlace(selId, rowId, nameId, addId, onPick) {
    let prev = "";
    $(selId).addEventListener("focus", () => { prev = $(selId).value; });
    $(selId).addEventListener("change", () => {
      if ($(selId).value === "__new") { $(selId).value = prev; $(rowId).hidden = false; $(nameId).value = ""; $(nameId).focus(); return; }
      prev = $(selId).value; onPick($(selId).value);
    });
    const add = async () => {
      const name = one($(nameId).value);
      if (!name) { toast("Type a name for the place."); return; }
      $(addId).disabled = true;
      try {
        const { data, error } = await sb.from("places").insert({ name }).select().single(); if (error) throw error;
        const p = { ...data, name: String(data.name || name) };
        A().places.push(p); A().place.set(p.id, p);
        $(rowId).hidden = true;
        onPick(p.id, true);
        toast(`${p.name} added. Add its address and drive times in Places when you have them.`);
      } catch (e) { fail("add the place", e); }
      finally { $(addId).disabled = false; }
    };
    $(addId).onclick = add;
    $(nameId).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  }

  // ---------- One activity: add or edit ----------
  let ed = null;   // the activity being edited
  function openEv(id) {
    const e = id ? A().event.get(id) : null;
    if (id && !e) { toast("That activity isn't on the tracker anymore."); return; }
    if (!e && !A().kids.some(k => k.active)) { toast("Add a kid first, in the Kids section."); return; }
    const active = A().kids.filter(k => k.active);
    ed = e ? { id: e.id, kids: e.kid_ids.slice(), kind: e.kind || "other", team_id: e.team_id || "", place: e.place_id || (e.place_text ? "__text" : ""), placeText: e.place_text || "",
        gear: e.gear ? e.gear.slice() : null, status: e.status, orig: e }
      : { id: null, kids: active.length === 1 ? [active[0].id] : [], kind: "practice", team_id: "", place: "", placeText: "", gear: null, status: "on", orig: null };
    $("evName").value = e ? e.title || "" : "";
    $("evDay").value = e ? e.day : toStr(T0);
    $("evStart").value = e ? K.hhmm(e.start) : "";
    $("evEnd").value = e && e.end != null ? K.hhmm(e.end) : "";
    $("evArrive").value = e && e.arrive != null ? K.hhmm(e.arrive) : "";
    $("evRepeat").value = ""; $("evRepField").hidden = !!e;
    $("evNote").value = e ? e.note || "" : "";
    $("evNewPlace").hidden = true; $("evRmConfirm").hidden = true;
    $("evCancel").hidden = !e; $("evRemove").hidden = !e;
    $("evCmtField").hidden = !e; $("cmtBody").value = "";
    renderEv();
    if (e) renderComments();
    $("evScrim").hidden = false;
    $("evScrim").querySelector(".sheet").scrollTop = 0;
  }
  const teamOf = () => (ed && ed.team_id && A().team.get(ed.team_id)) || null;
  const draft = () => ({ team_id: ed.team_id || null, kind: ed.kind, title: one($("evName").value), start: K.mins($("evStart").value), arrive: K.mins($("evArrive").value),
    place_id: ed.place && ed.place !== "__text" ? ed.place : null, place_text: ed.place === "__text" ? ed.placeText : null, kid_ids: ed.kids, n: isDate($("evDay").value) ? toNum($("evDay").value) : null });
  // The heading: what it is, the day, and who has the kids that day (the person responsible for getting them there).
  function renderHead() {
    const d = draft();
    $("evTitle").textContent = ed.id ? acts.label(d) : "New activity";
    if (d.n != null) {
      const h = sched.actual(d.n);
      $("evSub").textContent = `${longDay(d.n)}. ${sched.nameOf(h, sched.recOf(d.n))} has the kids that day.${acts.isHandoff(d.n) ? " Handoff day." : ""}${ed.status === "canceled" ? " Canceled." : ""}`;
    } else $("evSub").textContent = "Pick a date.";
  }
  function renderEv() {
    const t = teamOf(), tp = t && t.place_id && A().place.get(t.place_id);
    renderHead();
    kidPick("evKids", ed.kids);
    $("evKind").innerHTML = Object.entries(K.KINDS).map(([k, l]) => `<button type="button" data-kind="${k}" aria-pressed="${ed.kind === k}">${l}</button>`).join("");
    const teams = A().teams.filter(x => x.active || x.id === ed.team_id).sort((a, b) => a.name.localeCompare(b.name));
    $("evTeam").innerHTML = `<option value="">No team</option>${teams.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}`;
    $("evTeam").value = ed.team_id || "";
    $("evName").placeholder = t ? "Optional, for example Team photos" : "Needed without a team, for example Piano";
    $("evPlace").innerHTML = placeOptions(ed.place, ed.placeText, tp ? `The team's usual place (${tp.name})` : "");
    $("evPlace").value = ed.place || "";
    $("evCancel").textContent = ed.status === "canceled" ? "Restore" : `Cancel this ${ed.kind === "other" ? "activity" : ed.kind}`;
    renderGear(); renderCalc();
  }
  function renderGear() {
    const t = teamOf(), list = ed.gear != null ? ed.gear : t ? t.gear.slice() : [];
    gearEditor("evGear", list, next => { ed.gear = next; renderGear(); });
    $("evGearHint").textContent = t ? (ed.gear == null || sameList(ed.gear, t.gear) ? `Same as the ${t.name} gear list. Changes here are for this activity only.` : `Changed for this activity only. The ${t.name} list is not changed.`)
      : "Type an item and press return to add it. Tap the \u00d7 to remove it.";
  }
  function renderCalc() {
    const d = draft(), out = [];
    if (d.start == null) { $("evCalc").innerHTML = `<p>Pick a start time to see when to arrive and leave.</p>`; return; }
    const a = acts.arriveBy(d);
    if (!a) { $("evCalc").innerHTML = `<p>No arrive-by time. Pick a team, or set an arrive-by time above.</p>`; return; }
    out.push(`<p><strong>Arrive by ${clock(a.m)}</strong> (${a.set ? "set for this activity" : a.early ? `${a.early} minutes early` : "at the start time"})</p>`);
    const p = acts.placeOf(d), h = d.n != null ? sched.actual(d.n) : null;
    if (!p) out.push(`<p>Pick a place to see leave-by times.</p>`);
    else ["me", "co", "grandma"].forEach(w => {
      const m = acts.drive(p, w), name = w === "grandma" ? "Angie's" : acts.house(w);
      if (m == null) out.push(`<p class="miss">From ${esc(name)}: <button type="button" class="link-btn" data-editplace="${esc(p.id)}">add drive time</button></p>`);
      else out.push(`<p>${w === h ? "<strong>" : ""}Leave by ${clock(a.m - m)} from ${esc(name)}${w === h ? "</strong>" : ""} (${m} min drive)</p>`);
    });
    $("evCalc").innerHTML = out.join("");
  }
  // Builds the row to save, or explains what is missing.
  function evRow() {
    const t = teamOf(), title = one($("evName").value), day = $("evDay").value, start = $("evStart").value, end = $("evEnd").value, arrive = $("evArrive").value;
    if (!ed.kids.length) return "Pick who it's for.";
    if (!t && !title) return "Pick a team or type a title.";
    if (!isDate(day) || day < "2000-01-01" || day > "2100-12-31") return "Pick a date.";
    if (K.mins(start) == null) return "Pick a start time.";
    const inp = $("evGear").querySelector("input");
    if (inp && one(inp.value)) ed.gear = addGear(ed.gear != null ? ed.gear : t ? t.gear.slice() : [], inp, () => {}, false);
    let gear = ed.gear;
    if (gear != null && t && sameList(gear, t.gear)) gear = null;    // same as the team: store nothing, so team changes flow through
    if (gear != null && !t && !gear.length) gear = null;
    return { team_id: t ? t.id : null, kid_ids: ed.kids.slice(), kind: ed.kind, title: title || null, day, start_time: start, end_time: K.mins(end) == null ? null : end,
      place_id: ed.place && ed.place !== "__text" ? ed.place : null, place_text: ed.place === "__text" ? ed.placeText || null : null,
      arrive_by: K.mins(arrive) == null ? null : arrive, gear, note: multi($("evNote").value) || null };
  }
  async function saveEv() {
    const row = evRow();
    if (typeof row === "string") { toast(row); return; }
    let days = [toNum(row.day)];
    if (!ed.id && isDate($("evRepeat").value)) {
      const until = toNum($("evRepeat").value);
      if (until < days[0]) { toast("Repeat weekly until has to be on or after the date."); return; }
      for (let n = days[0] + 7; n <= until; n += 7) days.push(n);
      if (days.length > 60) { toast(`That is ${days.length} weeks. Add up to 60 at a time.`); return; }
    }
    $("evSave").disabled = true;
    try {
      let firstId = ed.id;
      if (ed.id) {
        const { error } = await sb.from("events").update(row).eq("id", ed.id); if (error) throw error;
      } else {
        // Every week in one request, so they share one line in the change log.
        const { data, error } = await sb.from("events").insert(days.map(n => ({ ...row, day: toStr(n) }))).select("id, day"); if (error) throw error;
        firstId = data && data[0] && data[0].id;
      }
      const wasNew = !ed.id, before = ed.orig;
      await refresh();
      $("evScrim").hidden = true;
      const e = A().event.get(firstId) || { ...row, id: firstId, n: days[0], start: K.mins(row.start_time), kid_ids: row.kid_ids };
      toast(wasNew ? (days.length > 1 ? `Added ${days.length} activities.` : "Activity added.") : "Saved. The family link shows it now.");
      textFor(wasNew ? "added" : "changed", e, { count: days.length, last: days[days.length - 1], before });
    } catch (e) { fail("save", e); }
    finally { $("evSave").disabled = false; }
  }
  async function setStatus() {
    const next = ed.status === "canceled" ? "on" : "canceled", id = ed.id;
    try {
      const { error } = await sb.from("events").update({ status: next }).eq("id", id); if (error) throw error;
      await refresh(); $("evScrim").hidden = true;
      const e = A().event.get(id) || ed.orig;
      toast(next === "canceled" ? "Canceled. It stays on the schedule, crossed out." : "Back on.");
      textFor(next === "canceled" ? "canceled" : "restored", e);
    } catch (e) { fail(next === "canceled" ? "cancel it" : "restore it", e); }
  }
  async function removeEv() {
    const e = ed.orig;
    try {
      const { error } = await sb.from("events").delete().eq("id", ed.id); if (error) throw error;
      await refresh(); $("evScrim").hidden = true; toast("Removed.");
      textFor("removed", e);
    } catch (err) { fail("remove it", err); }
  }

  // ---------- Comments ----------
  function renderComments() {
    const list = A().cmts.get(ed.id) || [];
    $("evCmts").innerHTML = list.length ? list.map(c => `<div class="cmt"><p class="meta"><span class="chip ${c.author === "co" ? "co" : "me"}">${esc(acts.who(c.author))}</span>${esc(K.stampDay(c.at))}, ${esc(K.stampTime(c.at))}${c.share_family ? ` <span class="chip plain">On the family link</span>` : ""}${c.author === st.me ? ` <button type="button" class="link-btn" data-delc="${esc(c.id)}">Delete</button>` : ""}</p>
      <p>${c.tagged.map(t => `<span class="at">@${esc(acts.tagName(t))}</span> `).join("")}${esc(c.body)}</p></div>`).join("") : `<p class="sub">No comments yet.</p>`;
    $("cmtTags").innerHTML = `<span>Tag</span>${["me", "co", "grandma"].filter(w => w !== st.me).map(w => `<label><input type="checkbox" id="tag-${w}"> ${esc(acts.tagName(w))}</label>`).join("")}<button type="button" class="btn primary" id="cmtPost" style="margin-left:auto">Post</button>`;
  }
  async function postComment() {
    const body = multi($("cmtBody").value);
    if (!body) { toast("Write a comment first."); return; }
    const tagged = ["me", "co", "grandma"].filter(w => w !== st.me && $("tag-" + w) && $("tag-" + w).checked), id = ed.id;
    $("cmtPost").disabled = true;
    try {
      const { error } = await sb.from("event_comments").insert({ event_id: id, body, tagged }); if (error) throw error;
      $("cmtBody").value = "";
      await refresh();
      toast(tagged.includes("grandma") ? "Posted. It shows on the family link." : "Posted.");
      if (tagged.length) textFor("comment", A().event.get(id) || ed.orig, { body, tagged });
    } catch (e) { fail("post the comment", e); }
    finally { if ($("cmtPost")) $("cmtPost").disabled = false; }
  }
  let delArm = null;
  async function deleteComment(btn) {
    const id = btn.dataset.delc;
    if (delArm !== id) { delArm = id; btn.textContent = "Tap again to delete"; setTimeout(() => { if (delArm === id) { delArm = null; if (btn.isConnected) btn.textContent = "Delete"; } }, 4000); return; }
    delArm = null;
    try { const { error } = await sb.from("event_comments").delete().eq("id", id); if (error) throw error; await refresh(); toast("Comment deleted."); }
    catch (e) { fail("delete the comment", e); }
  }

  // ---------- Text an update ----------
  // A text that includes Angie links to the family page (Heather's sign-in reads the active link when the page opens).
  // Everyone else gets a link to this page. A parent's sign-in never has a family link.
  function famToken() { return st.role === "admin" ? (st.famTok || null) : null; }
  const linkFor = id => whos => {
    const tok = famToken();
    return tok && whos.includes("grandma") ? new URL("./", location.href).href + "#k=" + tok + "&e=" + id : new URL("activities.html", location.href).href + "#e=" + id;
  };
  function whatOf(e) {
    const ks = acts.kidsOf(e.kid_ids || []).map(k => k.name);
    const kids = ks.length ? (ks.length === 1 ? ks[0] : ks.slice(0, -1).join(", ") + " and " + ks[ks.length - 1]) + "'s " : "";
    return `${kids}${acts.label(e)} on ${dayText(e.n)} at ${timeText(e.start)}`;
  }
  function textFor(kind, e, o = {}) {
    if (!e) return;
    const me = acts.who(st.me);
    const end = s => (/[.!?]$/.test(s) ? s : s + ".");   // times already end in "a.m." or "p.m."
    let msg;
    if (kind === "added") msg = `Kids Tracker: ${o.count > 1 ? `${me} added ${whatOf(e)}, then every week through ${dayText(o.last)} (${o.count} in all).` : end(`${me} added ${whatOf(e)}`)}`;
    else if (kind === "changed") msg = `Kids Tracker: ${end(`${me} updated ${whatOf(e)}`)}${o.before && (o.before.n !== e.n || o.before.start !== e.start) ? ` It was ${dayText(o.before.n)} at ${timeText(o.before.start)}` : ""}`;
    else if (kind === "canceled") msg = `Kids Tracker: ${whatOf(e)} is canceled.`;
    else if (kind === "restored") msg = `Kids Tracker: ${whatOf(e)} is back on.`;
    else if (kind === "removed") msg = `Kids Tracker: ${end(`${me} removed ${whatOf(e)}`)}`;
    else msg = `Kids Tracker: ${me} commented on ${whatOf(e)}:\n"${o.body}"`;
    E.openText({ body: msg, me: st.me, checked: kind === "comment" ? o.tagged : null, link: kind === "removed" ? null : linkFor(e.id),
      people: E.recipients(st.contacts, CFG, { me: S().myName, co: S().coName }) });
  }

  // ---------- Teams ----------
  function renderTeams() {
    const ts = A().teams.slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
    $("teamList").innerHTML = ts.length ? ts.map(t => {
      const p = t.place_id && A().place.get(t.place_id);
      return `<li class="two-col"><div class="what"><p>${acts.kidsOf(t.kid_ids).map(acts.kchip).join("")}<strong>${esc(t.name)}</strong>${t.active ? "" : ` <span class="chip plain">Off</span>`}</p>
        <p class="sub2">${p ? esc(p.name) + ". " : ""}Arrive ${t.early_practice} min early, ${t.early_game} for games.</p>
        ${t.gear.length ? `<div class="gearlist ro">${t.gear.map(g => `<span>${esc(g)}</span>`).join("")}</div>` : `<p class="sub2">No gear yet.</p>`}
        ${t.note ? `<p class="sub2 pre"><strong>Note:</strong> ${esc(t.note)}</p>` : ""}</div>
        <button type="button" class="link-btn" data-team="${esc(t.id)}">Edit</button></li>`;
    }).join("") : `<li style="display:block"><p class="empty">No teams yet. A team saves you typing the same place, times and gear for every practice.</p></li>`;
  }
  let tm = null;
  function openTeam(id) {
    const t = id ? A().team.get(id) : null;
    if (!t && !A().kids.some(k => k.active)) { toast("Add a kid first, in the Kids section."); return; }
    const active = A().kids.filter(k => k.active);
    tm = { id: t ? t.id : null, kids: t ? t.kid_ids.slice() : active.length === 1 ? [active[0].id] : [], place: t ? t.place_id || "" : "", gear: t ? t.gear.slice() : [] };
    $("tmTitle").textContent = t ? t.name : "New team";
    $("tmName").value = t ? t.name : "";
    $("tmEarlyP").value = t ? t.early_practice : 10; $("tmEarlyG").value = t ? t.early_game : 20;
    $("tmNote").value = t ? t.note || "" : ""; $("tmActive").checked = t ? t.active : true;
    $("tmRemove").hidden = !t; $("tmRmConfirm").hidden = true; $("tmNewPlace").hidden = true;
    renderTeamSheet();
    $("teamScrim").hidden = false;
  }
  function renderTeamSheet() {
    kidPick("tmKids", tm.kids);
    $("tmPlace").innerHTML = placeOptions(tm.place, ""); $("tmPlace").value = tm.place || "";
    gearEditor("tmGear", tm.gear, next => { tm.gear = next; renderTeamSheet(); });
  }
  async function saveTeam() {
    const name = one($("tmName").value), ep = intIn("tmEarlyP"), eg = intIn("tmEarlyG");
    if (!name) { toast("Give the team a name."); return; }
    if (!tm.kids.length) { toast("Pick who the team is for."); return; }
    if ([ep, eg].some(v => v != null && (Number.isNaN(v) || v < 0 || v > 240))) { toast("Arrive-early minutes go from 0 to 240."); return; }
    const inp = $("tmGear").querySelector("input");
    if (inp && one(inp.value)) tm.gear = addGear(tm.gear, inp, () => {}, false);
    const row = { name, kid_ids: tm.kids.slice(), place_id: tm.place || null, early_practice: ep || 0, early_game: eg || 0, gear: tm.gear.slice(), note: multi($("tmNote").value) || null, active: $("tmActive").checked };
    $("tmSave").disabled = true;
    try {
      const { error } = tm.id ? await sb.from("teams").update(row).eq("id", tm.id) : await sb.from("teams").insert(row);
      if (error) throw error;
      await refresh(); $("teamScrim").hidden = true; toast(tm.id ? "Team saved." : "Team added.");
      if (!$("evScrim").hidden && ed) renderEv();
    } catch (e) { fail("save the team", e); }
    finally { $("tmSave").disabled = false; }
  }
  async function removeTeam() {
    try {
      const { error } = await sb.from("teams").delete().eq("id", tm.id); if (error) throw error;
      await refresh(); $("teamScrim").hidden = true; toast("Team removed.");
    } catch (e) {
      $("tmRmConfirm").hidden = true;
      if (e && e.code === "23503") toast("This team is used by an activity, so it can't be removed. Turn it off instead.");
      else fail("remove the team", e);
    }
  }

  // ---------- Places ----------
  function driveLine(p) {
    const known = [], missing = [];
    ["me", "co", "grandma"].forEach(w => { const m = acts.drive(p, w), nm = HOUSE_LABEL[w](); if (m == null) missing.push(nm); else known.push(known.length ? `${m} from ${nm}` : `${m} min from ${nm}`); });
    return `${known.length ? esc(known.join(", ")) + "." : ""}${missing.length ? ` <span class="miss">Add drive time from ${esc(missing.join(missing.length > 2 ? ", " : " and ").replace(/, ([^,]*)$/, " and $1"))}.</span>` : ""}`;
  }
  function renderPlaces() {
    const ps = A().places.slice().sort((a, b) => a.name.localeCompare(b.name));
    $("placeCount").textContent = ps.length ? `${ps.length} saved` : "";
    $("placeList").innerHTML = ps.length ? ps.map(p => `<li class="two-col"><div class="what"><p><strong>${esc(p.name)}</strong></p>
      ${p.address ? `<p class="sub2">${esc(p.address)}</p>` : ""}<p class="sub2 num">${driveLine(p)}</p>${p.note ? `<p class="sub2 pre"><strong>Note:</strong> ${esc(p.note)}</p>` : ""}</div>
      <button type="button" class="link-btn" data-editplace="${esc(p.id)}">Edit</button></li>`).join("")
      : `<li style="display:block"><p class="empty">No places yet.</p></li>`;
  }
  let pl = null;
  function openPlace(id) {
    const p = A().place.get(id); if (!p) return;
    pl = { id };
    $("plTitle").textContent = p.name;
    $("plName").value = p.name; $("plAddr").value = p.address || ""; $("plNote").value = p.note || "";
    $("plMe").value = p.drive_me != null ? p.drive_me : ""; $("plCo").value = p.drive_co != null ? p.drive_co : ""; $("plGm").value = p.drive_grandma != null ? p.drive_grandma : "";
    $("plMeL").textContent = S().myName + "'s"; $("plCoL").textContent = S().coName + "'s";
    $("plRemove").hidden = false; $("plRmConfirm").hidden = true;
    $("placeScrim").hidden = false;
  }
  async function savePlace() {
    const name = one($("plName").value), dm = intIn("plMe"), dc = intIn("plCo"), dg = intIn("plGm");
    if (!name) { toast("Give the place a name."); return; }
    if ([dm, dc, dg].some(v => v != null && (Number.isNaN(v) || v < 0 || v > 600))) { toast("Drive minutes go from 0 to 600."); return; }
    const row = { name, address: multi($("plAddr").value) || null, drive_me: dm, drive_co: dc, drive_grandma: dg, note: multi($("plNote").value) || null };
    $("plSave").disabled = true;
    try {
      const { error } = await sb.from("places").update(row).eq("id", pl.id); if (error) throw error;
      await refresh(); $("placeScrim").hidden = true; toast("Place saved.");
      if (!$("evScrim").hidden && ed) renderEv();
    } catch (e) { fail("save the place", e); }
    finally { $("plSave").disabled = false; }
  }
  async function removePlace() {
    try {
      const { error } = await sb.from("places").delete().eq("id", pl.id); if (error) throw error;
      await refresh(); $("placeScrim").hidden = true; toast("Place removed.");
    } catch (e) {
      $("plRmConfirm").hidden = true;
      if (e && e.code === "23503") toast("This place is used by an activity or a team, so it can't be removed.");
      else fail("remove the place", e);
    }
  }
  async function quickPlace() {
    const name = one($("quickPlace").value);
    if (!name) { toast("Type a name for the place."); return; }
    $("quickPlaceAdd").disabled = true;
    try {
      const { error } = await sb.from("places").insert({ name }); if (error) throw error;
      $("quickPlace").value = ""; await refresh(); toast(`${name} added.`);
    } catch (e) { fail("add the place", e); }
    finally { $("quickPlaceAdd").disabled = false; }
  }

  // ---------- Kids ----------
  function renderKids() {
    const ks = A().kids;
    $("kidList").innerHTML = ks.length ? ks.map(k => `<li class="two-col"><div class="what"><p><span class="kbdg c-${k.color}" aria-hidden="true">${esc(K.initial(k.name))}</span> <span class="kchip c-${k.color}">${esc(k.name)}</span>${k.active ? "" : `<span class="chip plain">Off</span>`}</p>
      <p class="sub2">${esc(K.COLORS[k.color])}. Order ${k.sort}.</p></div><button type="button" class="link-btn" data-kidedit="${esc(k.id)}">Edit</button></li>`).join("")
      : `<li style="display:block"><p class="empty">No kids yet. Add each kid once with a color.</p></li>`;
  }
  let kd = null;
  function openKid(id) {
    const k = id ? A().kid.get(id) : null, used = new Set(A().kids.map(x => x.color));
    kd = { id: k ? k.id : null, color: k ? k.color : Object.keys(K.COLORS).find(c => !used.has(c)) || "orange" };
    $("kdTitle").textContent = k ? k.name : "New kid";
    $("kdName").value = k ? k.name : ""; $("kdSort").value = k ? k.sort : (A().kids.length ? Math.max(...A().kids.map(x => x.sort)) + 1 : 1);
    $("kdActive").checked = k ? k.active : true;
    renderKidColors();
    $("kidScrim").hidden = false;
  }
  function renderKidColors() {
    $("kdColor").innerHTML = Object.entries(K.COLORS).map(([c, l]) => `<button type="button" class="kid c-${c}" data-color="${c}" aria-pressed="${kd.color === c}"><span class="kbdg c-${c}" aria-hidden="true"></span> ${l}</button>`).join("");
  }
  async function saveKid() {
    const name = one($("kdName").value), sort = intIn("kdSort");
    if (!name) { toast("Type the kid's name."); return; }
    if (sort != null && (Number.isNaN(sort) || sort < 0 || sort > 99)) { toast("Order is a number from 0 to 99."); return; }
    const row = { name, color: kd.color, sort: sort || 0, active: $("kdActive").checked };
    $("kdSave").disabled = true;
    try {
      const { error } = kd.id ? await sb.from("kids").update(row).eq("id", kd.id) : await sb.from("kids").insert(row);
      if (error) throw error;
      await refresh(); $("kidScrim").hidden = true; toast(kd.id ? "Saved." : `${name} added.`);
    } catch (e) { fail("save", e); }
    finally { $("kdSave").disabled = false; }
  }

  // ---------- Contacts for texting (Heather edits, Brett sees) ----------
  function renderContacts() {
    const people = E.recipients(st.contacts, {}, { me: S().myName, co: S().coName }), saved = new Map((st.contacts || []).map(c => [c.who, c]));
    const fallback = !people.some(p => p.phone);
    if (st.role !== "admin") {
      $("conBody").innerHTML = `<ul class="log">${people.map(p => `<li class="two-col"><div class="what"><p><strong>${esc(p.label)}</strong></p><p class="sub2 num">${p.phone ? esc(p.phone) : "No number yet"}</p></div></li>`).join("")}</ul>
        <p class="hint">${esc(S().myName)} keeps these up to date. They are used by the Text an update button.</p>`;
      return;
    }
    $("conBody").innerHTML = `<div class="contacts">${people.map(p => { const r = saved.get(p.who) || {}; return `<div class="con-row"><span class="con-who">${p.who === "co" ? esc(S().coName) : p.who === "me" ? esc(S().myName) + " (you)" : "Grandma"}</span>
      <div class="field"><label for="cl-${p.who}">Name shown</label><input type="text" id="cl-${p.who}" maxlength="60" value="${esc(r.label || "")}" placeholder="${esc(p.label)}" autocomplete="off"></div>
      <div class="field"><label for="cp-${p.who}">Phone</label><input type="tel" id="cp-${p.who}" maxlength="40" value="${esc(r.phone || "")}" placeholder="+1 555 555 0100" autocomplete="off"></div></div>`; }).join("")}</div>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn primary" id="conSave">Save contacts</button></div>
      <p class="hint">${fallback ? "No numbers here yet, so texts use the two numbers in the site settings file for now. " : ""}Only you can change these. ${esc(S().coName)} sees them.</p>`;
  }
  async function saveContacts() {
    const rows = E.ORDER.map(w => ({ who: w, label: one($("cl-" + w).value) || null, phone: one($("cp-" + w).value) || null }));
    if (rows.some(r => r.phone && !/\d{7,}/.test(r.phone.replace(/\D/g, "")))) { toast("Check the phone numbers. Each needs at least 7 digits."); return; }
    $("conSave").disabled = true;
    try {
      const { error } = await sb.from("contacts").upsert(rows); if (error) throw error;
      await refresh(); toast("Contacts saved.");
    } catch (e) { fail("save the contacts", e); }
    finally { if ($("conSave")) $("conSave").disabled = false; }
  }

  // ---------- Change log ----------
  function renderLog() {
    const ls = acts.lines();
    $("actLog").innerHTML = ls.length ? ls.slice(0, st.logMax).map(l => `<li class="rc"><div class="when num">${esc(K.stampDay(l.at))}<small>${esc(K.stampTime(l.at))}</small></div>
      <div class="what"><p>${l.kids.map(acts.kdot).join("")}<strong>${esc(acts.who(l.who))}</strong> ${esc(l.head)}</p>${l.sub ? `<p class="sub2">${esc(l.sub)}</p>` : ""}</div></li>`).join("")
      : `<li style="display:block"><p class="empty">Nothing changed in the last 90 days.</p></li>`;
    $("logMore").hidden = ls.length <= st.logMax;
  }

  // ---------- A link from a text: activities.html#e=<id> opens that activity ----------
  function openFromHash() {
    const m = location.hash.match(/[#&]e=([0-9A-Za-z-]{8,64})/);
    if (!m || $("vApp").hidden) return;
    if (A().event.has(m[1])) openEv(m[1]); else toast("That activity isn't on the tracker anymore.");
  }

  // ---------- Events ----------
  document.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-close]")) { closeTop(); return; }
    if (t.classList.contains("scrim")) { t.hidden = true; return; }
    if ($("vApp").hidden) return;
    const up = t.closest(".up-row"); if (up) { openEv(up.dataset.ev); return; }
    const fk = t.closest("[data-kid]"); if (fk) { st.kidFilter = fk.dataset.kid; st.upMax = 40; renderUp(); return; }
    const ep = t.closest("[data-editplace]"); if (ep) { openPlace(ep.dataset.editplace); return; }
    const te = t.closest("[data-team]"); if (te) { openTeam(te.dataset.team); return; }
    const ke = t.closest("[data-kidedit]"); if (ke) { openKid(ke.dataset.kidedit); return; }
    const dc = t.closest("[data-delc]"); if (dc) { deleteComment(dc); return; }
    if (t.closest("#cmtPost")) { postComment(); return; }
    const pk = t.closest("[data-pk]");
    if (pk) {
      if (pk.closest("#evKids")) { ed.kids = kidClick(ed.kids, pk.dataset.pk); renderEv(); }
      else if (pk.closest("#tmKids")) { tm.kids = kidClick(tm.kids, pk.dataset.pk); kidPick("tmKids", tm.kids); }
      return;
    }
    const kn = t.closest("[data-kind]"); if (kn) { ed.kind = kn.dataset.kind; renderEv(); return; }
    const co = t.closest("[data-color]"); if (co) { kd.color = co.dataset.color; renderKidColors(); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeTop(); });

  function wire() {
    $("addHand").onclick = () => openEv(null);
    $("upMore").onclick = () => { st.upMax += 40; renderUp(); };
    $("logMore").onclick = () => { st.logMax += 30; renderLog(); };
    $("evSave").onclick = saveEv; $("evCancel").onclick = setStatus;
    $("evRemove").onclick = () => { $("evRmConfirm").hidden = false; };
    $("evRmYes").onclick = removeEv; $("evRmNo").onclick = () => { $("evRmConfirm").hidden = true; };
    $("evTeam").onchange = () => {
      ed.team_id = $("evTeam").value; const t = teamOf();
      if (t) { const ids = t.kid_ids.filter(id => A().kid.has(id)); if (ids.length) ed.kids = ids; if (!ed.place && t.place_id) ed.place = t.place_id; if (ed.kind === "other") ed.kind = "practice"; }
      ed.gear = null; renderEv();
    };
    ["evName", "evDay", "evStart", "evArrive"].forEach(id => $(id).addEventListener("input", () => { renderHead(); renderCalc(); }));
    wirePlace("evPlace", "evNewPlace", "evNewPlaceName", "evNewPlaceAdd", (id, added) => { ed.place = id; if (added) renderEv(); else renderCalc(); });
    wirePlace("tmPlace", "tmNewPlace", "tmNewPlaceName", "tmNewPlaceAdd", (id, added) => { tm.place = id; if (added) renderTeamSheet(); });
    $("addTeam").onclick = () => openTeam(null); $("tmSave").onclick = saveTeam;
    $("tmRemove").onclick = () => { $("tmRmConfirm").hidden = false; }; $("tmRmYes").onclick = removeTeam; $("tmRmNo").onclick = () => { $("tmRmConfirm").hidden = true; };
    $("plSave").onclick = savePlace;
    $("plRemove").onclick = () => { $("plRmConfirm").hidden = false; }; $("plRmYes").onclick = removePlace; $("plRmNo").onclick = () => { $("plRmConfirm").hidden = true; };
    $("quickPlaceAdd").onclick = quickPlace; $("quickPlace").addEventListener("keydown", e => { if (e.key === "Enter") quickPlace(); });
    $("addKid").onclick = () => openKid(null); $("kdSave").onclick = saveKid;
    $("conBody").addEventListener("click", e => { if (e.target.closest("#conSave")) saveContacts(); });
    window.addEventListener("hashchange", openFromHash);
  }

  async function boot() {
    if (!CONFIGURED || !window.supabase) return show("vSetup");
    wire();
    sb = E.client(CFG);
    await E.signin(sb, { show, enter });
  }
  boot();
})();
