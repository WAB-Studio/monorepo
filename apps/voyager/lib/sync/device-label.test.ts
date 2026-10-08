import assert from "node:assert/strict";
import { test } from "node:test";

import { deviceLabel } from "./device-label";

const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
const OPERA_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0";

test("Chrome on Android is chrome:android", () => {
  assert.equal(deviceLabel(CHROME_ANDROID), "chrome:android");
});

test("a missing header is unknown:unknown", () => {
  assert.equal(deviceLabel(null), "unknown:unknown");
  assert.equal(deviceLabel(""), "unknown:unknown");
});

test("the browsers that also say Chrome or Safari keep their own code", () => {
  assert.equal(deviceLabel(EDGE_WINDOWS), "edge:windows");
  assert.equal(deviceLabel(OPERA_MAC), "opera:macos");
  assert.equal(deviceLabel(SAFARI_IPHONE), "safari:ios");
  assert.equal(deviceLabel(FIREFOX_LINUX), "firefox:linux");
});

test("an unrecognised agent is other:other", () => {
  assert.equal(deviceLabel("curl/8.0"), "other:other");
});

test("a label is only codes: lowercase letters and one colon, no space", () => {
  for (const ua of [CHROME_ANDROID, SAFARI_IPHONE, EDGE_WINDOWS, FIREFOX_LINUX, OPERA_MAC, "curl/8.0", null]) {
    assert.match(deviceLabel(ua), /^(edge|opera|firefox|chrome|safari|other|unknown):(android|ios|windows|macos|linux|other|unknown)$/);
  }
});
