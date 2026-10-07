export const INTERVAL_OPTIONS = [
  60_000,
  300_000,
  900_000,
  1_800_000,
  3_600_000,
  10_800_000,
  43_200_000,
];
export const FIT_OPTIONS = ["cover", "contain"];
export const SOURCE_OPTIONS = ["bing", "motivation"];

export const DEFAULT_SETTINGS = Object.freeze({
  intervalMs: 3_600_000,
  fit: "cover",
  transitionMs: 1_600,
  sourceId: "bing",
});

export function normalizeSettings(candidate = {}) {
  const intervalMs = INTERVAL_OPTIONS.includes(candidate.intervalMs)
    ? candidate.intervalMs
    : DEFAULT_SETTINGS.intervalMs;
  const fit = FIT_OPTIONS.includes(candidate.fit)
    ? candidate.fit
    : DEFAULT_SETTINGS.fit;
  const sourceId = SOURCE_OPTIONS.includes(candidate.sourceId)
    ? candidate.sourceId
    : DEFAULT_SETTINGS.sourceId;
  const transitionMs =
    Number.isFinite(candidate.transitionMs) &&
    candidate.transitionMs >= 0 &&
    candidate.transitionMs <= 5_000
      ? candidate.transitionMs
      : DEFAULT_SETTINGS.transitionMs;

  return {
    intervalMs,
    fit,
    sourceId,
    transitionMs,
  };
}

export function loadSettings(storage, key = "mytv-art-settings-v3") {
  const serialized = storage?.getItem(key);
  if (!serialized) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    return normalizeSettings(JSON.parse(serialized));
  } catch (error) {
    throw new Error(`Stored settings are invalid: ${error.message}`);
  }
}

export function saveSettings(storage, settings, key = "mytv-art-settings-v3") {
  if (!storage) {
    throw new Error("Settings storage is unavailable");
  }

  const normalized = normalizeSettings(settings);
  storage.setItem(key, JSON.stringify(normalized));
  return normalized;
}

export function cycleOption(options, currentValue) {
  const currentIndex = options.indexOf(currentValue);
  return options[(currentIndex + 1) % options.length];
}
