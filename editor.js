/* Kids Tracker: the parts the two signed-in pages share (admin.html and activities.html).
     1. The email and password sign-in card.
     2. The "Text an update?" sheet: opens Messages with a prefilled note. Nothing is sent automatically.
   Both pages use the same element ids for these (vSignin, email, password, txtScrim, txtBody, txtTo, txtGo and so on). */
window.KTEditor = (() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Sign-in ----------
  const client = cfg => window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  // show(id) switches between the page's cards. enter() runs once someone is signed in.
  async function signin(sb, { show, enter }) {
    sb.auth.onAuthStateChange((ev, session) => {
      if (session && (ev === "SIGNED_IN" || ev === "INITIAL_SESSION") && $("vApp").hidden) setTimeout(enter, 0);
      if (ev === "SIGNED_OUT") show("vSignin");
    });
    const { data } = await sb.auth.getSession();
    if (data && data.session) enter(); else show("vSignin");

    $("sendCode").onclick = async () => {
      const email = $("email").value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $("signinMsg").textContent = "Enter your email address."; return; }
      $("sendCode").disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split("#")[0] } });
      $("sendCode").disabled = false;
      if (error) { $("signinMsg").textContent = "Couldn't send the email: " + error.message; return; }
      $("signinMsg").textContent = "Check your email and tap the Sign in link on this same device. It brings you right back here, signed in.";
    };
    $("pwSignIn").onclick = async () => {
      const email = $("email").value.trim().toLowerCase(), password = $("password").value;
      if (!email || !password) { $("signinMsg").textContent = "Enter your email and password."; return; }
      $("pwSignIn").disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email, password });
      $("pwSignIn").disabled = false;
      if (error) $("signinMsg").textContent = "That email and password didn't match. Check them and try again.";
    };
    $("email").addEventListener("keydown", e => { if (e.key === "Enter") $("password").focus(); });
    $("password").addEventListener("keydown", e => { if (e.key === "Enter") $("pwSignIn").click(); });
    // Reload after signing out so nothing from the session (contacts, phone numbers, the last text) stays in the page.
    const out = async () => { try { await sb.auth.signOut(); } finally { show("vSignin"); location.replace(location.pathname); } };
    $("signOut").onclick = out; $("signOut2").onclick = out;
  }

  // ---------- Who a text can go to ----------
  // Always in this order: Brett, Heather, Angie (Grandma). Numbers come from the contacts table.
  // Until any number is entered there, the two numbers in config.js are used so nothing breaks.
  const ORDER = ["co", "me", "grandma"];
  const GRANDMA_LABEL = "Angie (Grandma)";
  const phoneOk = p => String(p || "").replace(/[^\d+]/g, "");     // what goes into the Messages link
  function whoFromName(name, names) {
    const n = String(name || "").trim().toLowerCase();
    if (/^(mom|grandma|angie)\b/.test(n)) return "grandma";
    if (n && n === String(names.co || "").toLowerCase()) return "co";
    if (n && n === String(names.me || "").toLowerCase()) return "me";
    return null;
  }
  // rows: the contacts table (or nothing). cfg: config.js. names: { me, co } from the schedule settings.
  function recipients(rows, cfg, names) {
    const by = {};
    (Array.isArray(rows) ? rows : []).forEach(r => { if (r && ORDER.includes(r.who)) by[r.who] = { label: r.label, phone: r.phone }; });
    if (!ORDER.some(w => by[w] && phoneOk(by[w].phone))) {
      (cfg && Array.isArray(cfg.contacts) ? cfg.contacts : []).forEach(c => { const w = c && whoFromName(c.name, names); if (w && !(by[w] && phoneOk(by[w].phone))) by[w] = { label: (by[w] && by[w].label) || "", phone: c.phone }; });
    }
    const fallback = { me: names.me || "Heather", co: names.co || "Brett", grandma: GRANDMA_LABEL };
    return ORDER.map(w => ({ who: w, label: String((by[w] && by[w].label) || "").trim() || fallback[w], phone: phoneOk(by[w] && by[w].phone) }));
  }

  // ---------- The text sheet ----------
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  let cur = { people: [], link: null, linkText: "" };
  function smsHref() {
    const phones = cur.people.filter(p => { const el = $("to-" + p.who); return el && el.checked && !el.disabled; }).map(p => p.phone);
    const body = encodeURIComponent($("txtBody").value);
    if (!phones.length) return `sms:${isApple ? "&" : "?"}body=${body}`;
    return isApple ? `sms://open?addresses=${phones.join(",")}&body=${body}` : `sms:${phones.join(",")}?body=${body}`;
  }
  const checkedWho = () => cur.people.filter(p => { const el = $("to-" + p.who); return el && el.checked && !el.disabled; }).map(p => p.who);
  // The link line can depend on who is checked (the family link only works for Angie). Keep it in step if the box still holds it.
  function relink() {
    if (!cur.link) return;
    const next = cur.link(checkedWho()) || "", body = $("txtBody").value;
    if (next !== cur.linkText && cur.linkText && body.includes(cur.linkText)) $("txtBody").value = body.split(cur.linkText).join(next);
    cur.linkText = next;
  }
  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    $("txtBody").addEventListener("input", () => { $("txtGo").href = smsHref(); });
    $("txtTo").addEventListener("change", () => { relink(); $("txtGo").href = smsHref(); });
    $("txtGo").addEventListener("click", () => { setTimeout(() => { $("txtScrim").hidden = true; }, 300); });
  }
  // body: the message. people: from recipients(). me: who is signed in ("me" or "co"); shown, but unchecked and off.
  // checked: who to tick (default: everyone else with a number). link(whoList): optional; its result is added as the last line.
  function openText({ body, people, me, checked, link }) {
    wire();
    cur = { people: people || [], link: link || null, linkText: "" };
    const want = p => p.who !== me && !!p.phone && (checked ? checked.includes(p.who) : true);
    const any = cur.people.some(p => p.who !== me && p.phone);
    $("txtTo").innerHTML = any ? cur.people.map(p => {
      const off = p.who === me || !p.phone;
      return `<label${off ? ` class="off"` : ""}><input type="checkbox" id="to-${p.who}"${want(p) ? " checked" : ""}${off ? " disabled" : ""}> ${esc(p.label)}${p.who === me ? " (you)" : !p.phone ? " (no number yet)" : ""}</label>`;
    }).join("") : `<p class="sub">No contacts set up. Messages will open and you can pick who to send to.</p>`;
    let text = body;
    if (cur.link) { cur.linkText = cur.link(checkedWho()) || ""; if (cur.linkText) text += "\n" + cur.linkText; }
    $("txtBody").value = text;
    $("txtGo").href = smsHref();
    $("txtScrim").hidden = false;
  }

  return { client, signin, recipients, openText, GRANDMA_LABEL, ORDER };
})();
