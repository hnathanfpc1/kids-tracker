// TEST ONLY. The harness serves this in place of the real config.js so a test run
// can never reach the real Supabase project and never shows real phone numbers.
// Everything here is made up. The host name ends in .invalid, which never resolves.
window.KT_CONFIG = {
  url: "https://kt-mock.invalid",
  key: "test-publishable-key-not-real",
  contacts: [
    { name: "Mom",   phone: "+15555550101" },
    { name: "Brett", phone: "+15555550102" },
  ],
};
