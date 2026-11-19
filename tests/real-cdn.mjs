#!/usr/bin/env node
/* Kids Tracker: the ONE check that uses the real internet. Test tooling only, never shipped with the site.

   HOW TO RUN (from the tests folder)
     npm run check:cdn

   WHY IT IS SEPARATE
     "npm test" never leaves this Mac: supabase-js is replaced with tests/lib/fake-supabase.js. That means
     "npm test" cannot tell whether the integrity hash on the supabase-js script tag in admin.html matches the
     real file on jsDelivr. If the hash were wrong, the browser would refuse the library and Heather could not
     sign in. This script loads the real admin.html with the REAL library from jsDelivr and checks that.

   WHAT IT TOUCHES
     - cdn.jsdelivr.net: one GET for the pinned supabase-js file. Nothing about Heather or the project is sent.
     - Nothing else. config.js is replaced with tests/fixtures/config.test.js (a made-up .invalid address),
       web fonts are stubbed, and every other outside request is blocked and reported.
     It never talks to the real Supabase project and never uses a real family link.

   CHECKS
     1. Real library, untouched: window.supabase.createClient is a function, it is not the test fake, the
        console has no integrity error, and the page reaches the Sign in card.
     2. The bytes jsDelivr sent hash to exactly the value in the integrity attribute (computed here with SHA-384).
     3. Control: the same real file with one extra byte added IS refused by the browser. This proves check 1
        would notice a wrong hash instead of passing by accident. */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PINNED = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js";
const TEST_CONFIG = fs.readFileSync(path.join(HERE, "fixtures", "config.test.js"), "utf8");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

const results = [];
function check(name, ok, detail = []) {
  results.push(ok);
  console.log(`${ok ? "PASS " : "FAIL "}  [real network] ${name}`);
  (Array.isArray(detail) ? detail : [detail]).filter(Boolean).forEach(l => console.log(`         ${l}`));
}

function startServer() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (rel === "/") rel = "/index.html";
    const file = path.join(ROOT, rel), ext = path.extname(file);
    if (path.dirname(file) !== ROOT || !MIME[ext] || !fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[ext], "cache-control": "no-store" });
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

async function load(browser, origin, { tamper }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const s = { errors: [], cdn: [], blocked: [], body: null, status: null };
  await ctx.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === origin) {
      if (url.pathname === "/config.js") return route.fulfill({ status: 200, contentType: "application/javascript", body: TEST_CONFIG });
      return route.continue();
    }
    if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return route.fulfill({ status: 200, contentType: "text/css", body: "/* web fonts are stubbed */" });
    if (req.url() === PINNED) {
      s.cdn.push(req.url());
      if (!tamper) return route.continue();     // untouched: Chrome itself fetches the real file from jsDelivr
      const res = await route.fetch();          // control: the real file again, with one extra byte added
      return route.fulfill({ response: res, body: Buffer.concat([await res.body(), Buffer.from("\n")]) });
    }
    s.blocked.push(`${req.method()} ${req.url()}`);
    return route.abort("blockedbyclient");
  });
  const page = await ctx.newPage();
  page.on("console", m => { if (m.type() === "error") s.errors.push(m.text()); });
  page.on("pageerror", e => s.errors.push(`Uncaught: ${e.message}`));
  const got = [];
  page.on("response", r => { if (r.url() === PINNED) got.push(r); });
  await page.goto(`${origin}/admin.html`);
  await page.waitForFunction(() => ["vSetup", "vSignin", "vNotAdmin", "vApp"].some(id => !document.getElementById(id).hidden), null, { timeout: 30000 });
  s.page = await page.evaluate(() => ({
    hasSupabase: typeof window.supabase !== "undefined", createClient: typeof (window.supabase || {}).createClient, isFake: !!(window.supabase && window.supabase.__ktFake),
    shown: ["vLoading", "vSetup", "vSignin", "vNotAdmin", "vApp"].filter(id => !document.getElementById(id).hidden),
    tag: (() => { const t = document.querySelector('script[src*="supabase"]'); return t ? { src: t.getAttribute("src"), integrity: t.getAttribute("integrity"), crossorigin: t.getAttribute("crossorigin") } : null; })(),
  }));
  if (!tamper && got[0]) { s.status = got[0].status(); s.body = await got[0].body().catch(() => null); }
  await ctx.close();
  return s;
}

const { server, origin } = await startServer();
const browser = await chromium.launch({ channel: "chrome", headless: true });
console.log(`Kids Tracker REAL NETWORK check. admin.html served from ${ROOT}. Chrome ${browser.version()}.`);
console.log(`The only outside address used is ${PINNED}\n`);
try {
  const real = await load(browser, origin, { tamper: false });
  const integrityErrors = real.errors.filter(e => /integrity|digest/i.test(e));
  check("admin.html loads the real supabase-js from jsDelivr: createClient is a function and the browser accepted the integrity hash",
    real.cdn.length === 1 && real.status === 200 && real.page.createClient === "function" && !real.page.isFake && !integrityErrors.length && !real.errors.length && eq(real.page.shown, ["vSignin"]),
    [`requested: ${real.cdn.join(", ") || "nothing"} (HTTP ${real.status})`, `typeof window.supabase.createClient: ${real.page.createClient}, test fake in use: ${real.page.isFake}`,
      `page shows: ${real.page.shown.join(", ")} (signed out, so the Sign in card is expected)`, `console errors: ${real.errors.length ? real.errors.join(" | ") : "none"}`]);
  const hash = real.body ? "sha384-" + crypto.createHash("sha384").update(real.body).digest("base64") : "(no file received)";
  check("the file jsDelivr sent hashes to exactly the integrity value in admin.html, and the tag is the pinned 2.117.3 address with crossorigin",
    !!real.page.tag && real.page.tag.src === PINNED && real.page.tag.integrity === hash && real.page.tag.crossorigin === "anonymous",
    [`computed here: ${hash} (${real.body ? real.body.length : 0} bytes)`, `in admin.html:  ${real.page.tag ? real.page.tag.integrity : "(no tag)"}`, `crossorigin: ${real.page.tag ? real.page.tag.crossorigin : "(no tag)"}`]);
  check("nothing else left this Mac during the real-library load", !real.blocked.length, real.blocked);

  const bad = await load(browser, origin, { tamper: true });
  const refused = bad.errors.filter(e => /integrity/i.test(e));
  check("control: the same file with one extra byte is refused by the browser (so a wrong hash could not pass check 1 by accident)",
    refused.length === 1 && !bad.page.hasSupabase && eq(bad.page.shown, ["vSetup"]),
    [`integrity errors in the console: ${refused.length}`, `window.supabase defined: ${bad.page.hasSupabase}`, `page shows: ${bad.page.shown.join(", ")} ("Almost there" is what the page shows when the library does not load)`,
      refused[0] ? `browser said: ${refused[0].slice(0, 160)}` : ""]);
} finally {
  await browser.close().catch(() => {});
  server.close();
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
console.log(failed ? "RESULT: NOT GREEN" : "RESULT: GREEN (real jsDelivr file matches the integrity hash in admin.html)");
process.exit(failed ? 1 : 0);
