import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  FIT_OPTIONS,
  INTERVAL_OPTIONS,
  cycleOption,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from "../src/settings.js";

function createStorage(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) {
    values.set("mytv-art-settings-v3", initialValue);
  }

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("normalizeSettings rejects unsupported values", () => {
  assert.deepEqual(
    normalizeSettings({
      intervalMs: 99,
      fit: "stretch",
      sourceId: "unknown",
      transitionMs: -1,
    }),
    DEFAULT_SETTINGS,
  );
});

test("settings round-trip through storage", () => {
  const storage = createStorage();
  const saved = saveSettings(storage, {
    ...DEFAULT_SETTINGS,
    fit: "contain",
    intervalMs: 900_000,
    sourceId: "motivation",
  });

  assert.deepEqual(loadSettings(storage), saved);
});

test("invalid stored JSON produces an actionable error", () => {
  const storage = createStorage("{not-json");
  assert.throws(() => loadSettings(storage), /Stored settings are invalid/);
});

test("cycleOption wraps to the first item", () => {
  assert.equal(cycleOption(FIT_OPTIONS, "contain"), "cover");
});

test("uses the requested interval choices and one-hour default", () => {
  assert.deepEqual(INTERVAL_OPTIONS, [
    60_000,
    300_000,
    900_000,
    1_800_000,
    3_600_000,
    10_800_000,
    43_200_000,
  ]);
  assert.equal(DEFAULT_SETTINGS.intervalMs, 3_600_000);
});
