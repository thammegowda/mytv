import { createPlatform } from "./platform.js";
import {
  BookProgressStore,
  BundledBookProvider,
} from "./books.js";
import { TvBookReader } from "./tv-book-reader.js";
import {
  DEFAULT_SETTINGS,
  FIT_OPTIONS,
  INTERVAL_OPTIONS,
  cycleOption,
  loadSettings,
  saveSettings,
} from "./settings.js";
import { CrossfadeRenderer, SlideshowController } from "./slideshow.js";
import { IndexedDbWallpaperCache } from "./wallpaper-cache.js";
import {
  BingWallpaperProvider,
  BundledWallpaperProvider,
  MotivationProvider,
} from "./wallpapers.js";

const SOURCE_TABS = ["bing", "motivation"];
const tabs = ["bing", "motivation", "books", "about", "settings"];
const BING_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;

const elements = {
  app: document.querySelector("#app"),
  layers: [
    document.querySelector("#wallpaper-a"),
    document.querySelector("#wallpaper-b"),
  ],
  loading: document.querySelector("#loading"),
  loadingText: document.querySelector("#loading span"),
  kicker: document.querySelector("#wallpaper-kicker"),
  title: document.querySelector("#wallpaper-title"),
  credit: document.querySelector("#wallpaper-credit"),
  metadata: document.querySelector("#metadata"),
  attribution: document.querySelector("#attribution"),
  tabButtons: [...document.querySelectorAll("[data-tab]")],
  tabPanels: [...document.querySelectorAll("[data-tab-panel]")],
  settingRows: [...document.querySelectorAll("[data-setting]")],
  fitSettingValue: document.querySelector("#fit-setting-value"),
  intervalSettingValue: document.querySelector("#interval-setting-value"),
  exitDialog: document.querySelector("#exit-dialog"),
  exitButtons: [...document.querySelectorAll("[data-exit-choice]")],
  toast: document.querySelector("#toast"),
  bookShell: document.querySelector("#book-shell"),
  bookLibrary: document.querySelector("#book-library"),
  bookLibraryStatus: document.querySelector("#book-library-status"),
  bookGrid: document.querySelector("#book-grid"),
  bookModeTabs: [...document.querySelectorAll("[data-book-mode]")],
  bookContextStatus: document.querySelector("#book-context-status"),
  bookContextKeys: document.querySelector("#book-context-keys"),
  bookReader: document.querySelector("#book-reader"),
  bookReaderLoading: document.querySelector("#book-reader-loading"),
  bookStage: document.querySelector("#book-stage"),
  bookSpread: document.querySelector("#book-spread"),
  bookLeftPage: document.querySelector("#book-left-page"),
  bookRightPage: document.querySelector("#book-right-page"),
  bookTurningLeaf: document.querySelector("#book-turning-leaf"),
  bookTurningFront: document.querySelector("#book-turning-front"),
  bookTurningBack: document.querySelector("#book-turning-back"),
  bookPaginationMeasure: document.querySelector("#book-pagination-measure"),
  bookToc: document.querySelector("#book-toc"),
  bookTocList: document.querySelector("#book-toc-list"),
};

const platform = createPlatform();
const bookReader = new TvBookReader({
  elements: {
    shell: elements.bookShell,
    library: elements.bookLibrary,
    libraryStatus: elements.bookLibraryStatus,
    bookGrid: elements.bookGrid,
    modeTabs: elements.bookModeTabs,
    contextStatus: elements.bookContextStatus,
    contextKeys: elements.bookContextKeys,
    reader: elements.bookReader,
    readerLoading: elements.bookReaderLoading,
    stage: elements.bookStage,
    spread: elements.bookSpread,
    leftPage: elements.bookLeftPage,
    rightPage: elements.bookRightPage,
    turningLeaf: elements.bookTurningLeaf,
    turningFront: elements.bookTurningFront,
    turningBack: elements.bookTurningBack,
    paginationMeasure: elements.bookPaginationMeasure,
    toc: elements.bookToc,
    tocList: elements.bookTocList,
  },
  provider: new BundledBookProvider(),
  progressStore: new BookProgressStore(),
  onActiveChange: handleBookModeChange,
  onToast: showToast,
});
let settings = { ...DEFAULT_SETTINGS };
let slideshow;
let renderer;
let provider;
let detailsVisible = false;
let activeTabIndex = 0;
let activeSettingIndex = 0;
let sourceChangeInProgress = false;
let toastTimeoutId;
let sourceRefreshTimerId;
let exitDialogVisible = false;
let exitChoice = "no";
let ambientPlaybackBeforeBooks = true;

void initialize();

async function initialize() {
  try {
    try {
      settings = loadSettings(localStorage);
    } catch (error) {
      settings = { ...DEFAULT_SETTINGS };
      showToast(`${error.message}. Defaults restored.`, true);
    }

    renderer = new CrossfadeRenderer({
      layers: elements.layers,
      transitionMs: settings.transitionMs,
    });
    renderer.setFit(settings.fit);
    renderer.setTransitionDuration(settings.transitionMs);

    await configureTvIntegration();
    bindInput();
    renderSettings();
    selectTab(tabs.indexOf(settings.sourceId));
    await activateSource(settings.sourceId, { initial: true });
    elements.loading.classList.add("is-hidden");
  } catch (error) {
    showToast(`Startup failed: ${error.message}`, true, 0);
    elements.loadingText.textContent = "Unable to start gallery";
  }
}

async function createSource(sourceId) {
  if (sourceId === "motivation") {
    const motivationProvider = new MotivationProvider();
    return {
      items: await motivationProvider.list(),
      provider: motivationProvider,
    };
  }

  const cache = new IndexedDbWallpaperCache();
  const bingProvider = new BingWallpaperProvider({
    cache,
    onWarning: (message) => showToast(message, true, 5_000),
  });

  try {
    return {
      items: await bingProvider.list(),
      provider: bingProvider,
    };
  } catch (error) {
    bingProvider.dispose();
    showToast(
      `Bing wallpapers unavailable; using bundled artwork. ${error.message}`,
      true,
      6_000,
    );
    const bundledProvider = new BundledWallpaperProvider();
    return {
      items: await bundledProvider.list(),
      provider: bundledProvider,
    };
  }
}

async function activateSource(
  sourceId,
  { initial = false, refresh = false } = {},
) {
  if (
    !SOURCE_TABS.includes(sourceId) ||
    sourceChangeInProgress ||
    (!initial && !refresh && settings.sourceId === sourceId)
  ) {
    if (!initial && !refresh && settings.sourceId === sourceId) {
      showToast(`${sourceLabel(sourceId)} is already active`);
    }
    return;
  }

  clearTimeout(sourceRefreshTimerId);
  sourceChangeInProgress = true;
  const previousProvider = provider;
  slideshow?.stop();

  if (!initial && !refresh) {
    elements.loadingText.textContent = `Loading ${sourceLabel(sourceId)}`;
    elements.loading.classList.remove("is-hidden");
  }

  try {
    const source = await createSource(sourceId);
    const nextSlideshow = new SlideshowController({
      items: source.items,
      renderer,
      intervalMs: settings.intervalMs,
      onChange: updateWallpaperMetadata,
      onPlaybackChange: handlePlaybackChange,
      onError: (error) => showToast(error.message, true),
    });

    slideshow = nextSlideshow;
    provider = source.provider;
    settings.sourceId = sourceId;
    persistSettings();
    updateSourceUi();
    await slideshow.start();
    previousProvider?.dispose?.();
    scheduleSourceRefresh();
  } catch (error) {
    showToast(`Unable to switch source: ${error.message}`, true);
    throw error;
  } finally {
    sourceChangeInProgress = false;
    elements.loading.classList.add("is-hidden");
  }
}

async function configureTvIntegration() {
  try {
    const result = await platform.registerRemoteKeys();
    if (!result.supported) {
      console.info("Samsung remote API unavailable; using keyboard controls.");
    }
  } catch (error) {
    showToast(error.message, true);
  }
}

function bindInput() {
  window.addEventListener("keydown", handleKeyDown);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("beforeunload", restoreScreenSaver);
  for (const button of elements.exitButtons) {
    button.addEventListener("click", () => {
      selectExitChoice(button.dataset.exitChoice);
      void confirmExitChoice();
    });
  }
  for (const [index, row] of elements.settingRows.entries()) {
    row.addEventListener("click", () => {
      activeSettingIndex = index;
      renderSettings();
      cycleActiveSetting();
    });
  }
}

function handleKeyDown(event) {
  const key = platform.resolveRemoteKey(event);
  const handled = [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Enter",
    " ",
    "MediaPlayPause",
    "ChannelUp",
    "ChannelDown",
    "Back",
    "Escape",
  ].includes(key);

  if (handled) {
    event.preventDefault();
  }

  if (exitDialogVisible) {
    handleExitDialogKey(key);
    return;
  }

  if (bookReader.active) {
    bookReader.handleKey(key);
    return;
  }

  switch (key) {
    case "ArrowRight":
      if (detailsVisible) {
        selectTab(activeTabIndex + 1);
      } else {
        void slideshow.next();
      }
      break;
    case "ArrowLeft":
      if (detailsVisible) {
        selectTab(activeTabIndex - 1);
      } else {
        void slideshow.previous();
      }
      break;
    case "Enter":
    case " ":
      if (detailsVisible && SOURCE_TABS.includes(tabs[activeTabIndex])) {
        void activateSource(tabs[activeTabIndex]);
      } else if (detailsVisible && tabs[activeTabIndex] === "books") {
        void openBookLibrary();
      } else if (detailsVisible && tabs[activeTabIndex] === "settings") {
        cycleActiveSetting();
      } else if (!detailsVisible) {
        const playing = slideshow.togglePlayback();
        showToast(playing ? "Playing" : "Paused");
      }
      break;
    case "MediaPlayPause":
      showToast(slideshow.togglePlayback() ? "Playing" : "Paused");
      break;
    case "ArrowUp":
      if (detailsVisible && tabs[activeTabIndex] === "settings") {
        moveSettingSelection(-1);
      } else {
        toggleDetails();
      }
      break;
    case "ArrowDown":
      if (detailsVisible && tabs[activeTabIndex] === "settings") {
        moveSettingSelection(1);
      } else if (detailsVisible) {
        toggleDetails(false);
      }
      break;
    case "Back":
    case "Escape":
      if (detailsVisible) {
        toggleDetails(false);
      } else {
        showExitDialog();
      }
      break;
    default:
      break;
  }
}

function handleExitDialogKey(key) {
  switch (key) {
    case "ArrowLeft":
    case "ArrowRight":
      selectExitChoice(exitChoice === "no" ? "yes" : "no");
      break;
    case "Enter":
    case " ":
      void confirmExitChoice();
      break;
    case "Back":
    case "Escape":
      hideExitDialog();
      break;
    default:
      break;
  }
}

function showExitDialog() {
  exitDialogVisible = true;
  selectExitChoice("no");
  elements.exitDialog.classList.add("is-visible");
  elements.exitDialog.setAttribute("aria-hidden", "false");
}

function hideExitDialog() {
  exitDialogVisible = false;
  elements.exitDialog.classList.remove("is-visible");
  elements.exitDialog.setAttribute("aria-hidden", "true");
}

function selectExitChoice(choice) {
  exitChoice = choice === "yes" ? "yes" : "no";
  for (const button of elements.exitButtons) {
    const selected = button.dataset.exitChoice === exitChoice;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
  }
}

async function confirmExitChoice() {
  if (exitChoice === "yes") {
    hideExitDialog();
    await exitApplication();
  } else {
    hideExitDialog();
  }
}

function toggleDetails(force) {
  detailsVisible =
    typeof force === "boolean" ? force : !detailsVisible;
  elements.app.classList.toggle("details-open", detailsVisible);
}

function selectTab(index) {
  activeTabIndex = ((index % tabs.length) + tabs.length) % tabs.length;
  const activeTab = tabs[activeTabIndex];

  for (const button of elements.tabButtons) {
    const selected = button.dataset.tab === activeTab;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
  }

  for (const panel of elements.tabPanels) {
    panel.hidden = panel.dataset.tabPanel !== activeTab;
  }

  if (activeTab === "settings") {
    renderSettings();
  }
}

async function exitApplication() {
  await updateScreenSaver(true);
  if (!platform.exit()) {
    showToast("Back exits the app on a Samsung TV");
  }
}

function updateWallpaperMetadata(wallpaper, index) {
  elements.metadata.classList.toggle(
    "is-source-hidden",
    wallpaper.source === "Motivation",
  );
  elements.kicker.textContent = wallpaper.collection;
  elements.title.textContent = wallpaper.title;
  elements.credit.textContent = `${index + 1} of ${slideshow.items.length}`;
  elements.attribution.textContent =
    wallpaper.source === "Bing"
      ? `Featured by Bing · ${wallpaper.credit}`
      : wallpaper.credit;
  elements.attribution.title = wallpaper.copyrightLink ?? wallpaper.credit;
}

function updateSourceUi() {
  for (const button of elements.tabButtons) {
    button.classList.toggle(
      "is-active-source",
      button.dataset.tab === settings.sourceId,
    );
  }
}

function handlePlaybackChange(playing) {
  void updateScreenSaver(!(playing || bookReader.active));
}

async function updateScreenSaver(enabled) {
  try {
    await platform.setScreenSaver(enabled);
  } catch (error) {
    showToast(error.message, true);
  }
}

function restoreScreenSaver() {
  clearTimeout(sourceRefreshTimerId);
  provider?.dispose?.();
  bookReader.dispose();
  void platform.setScreenSaver(true).catch((error) => {
    console.error(error);
  });
}

function scheduleSourceRefresh() {
  clearTimeout(sourceRefreshTimerId);
  if (settings.sourceId !== "bing") {
    return;
  }

  sourceRefreshTimerId = setTimeout(() => {
    void activateSource("bing", { refresh: true }).catch((error) => {
      showToast(`Bing refresh failed: ${error.message}`, true);
      scheduleSourceRefresh();
    });
  }, BING_REFRESH_INTERVAL_MS);
}

function handleVisibilityChange() {
  if (document.hidden) {
    void updateScreenSaver(true);
  } else if (bookReader.active || slideshow?.playing) {
    void updateScreenSaver(false);
  }
}

async function openBookLibrary() {
  toggleDetails(false);
  try {
    await bookReader.openLibrary();
  } catch (error) {
    bookReader.close();
    showToast(`Unable to open library: ${error.message}`, true);
  }
}

function handleBookModeChange(active) {
  elements.app.classList.toggle("books-open", active);
  if (active) {
    clearTimeout(sourceRefreshTimerId);
    ambientPlaybackBeforeBooks = Boolean(slideshow?.playing);
    if (slideshow?.playing) {
      slideshow.togglePlayback();
    }
    void updateScreenSaver(false);
    return;
  }

  if (ambientPlaybackBeforeBooks && slideshow && !slideshow.playing) {
    slideshow.togglePlayback();
  }
  scheduleSourceRefresh();
  void updateScreenSaver(!slideshow?.playing);
}

function moveSettingSelection(delta) {
  activeSettingIndex =
    (activeSettingIndex + delta + elements.settingRows.length) %
    elements.settingRows.length;
  renderSettings();
}

function cycleActiveSetting() {
  const setting = elements.settingRows[activeSettingIndex]?.dataset.setting;
  if (setting === "fit") {
    settings.fit = cycleOption(FIT_OPTIONS, settings.fit);
    renderer.setFit(settings.fit);
  } else if (setting === "interval") {
    settings.intervalMs = cycleOption(
      INTERVAL_OPTIONS,
      settings.intervalMs,
    );
    slideshow.setInterval(settings.intervalMs);
  } else {
    return;
  }

  persistSettings();
  renderSettings();
}

function renderSettings() {
  elements.fitSettingValue.textContent =
    settings.fit === "cover" ? "Crop" : "Fit";
  elements.intervalSettingValue.textContent = formatDuration(
    settings.intervalMs,
  );
  for (const [index, row] of elements.settingRows.entries()) {
    const selected = index === activeSettingIndex;
    row.classList.toggle("is-selected", selected);
    row.setAttribute("aria-selected", String(selected));
  }
}

function persistSettings() {
  try {
    settings = saveSettings(localStorage, settings);
  } catch (error) {
    showToast(error.message, true);
  }
}

function showToast(message, isError = false, duration = 3_500) {
  clearTimeout(toastTimeoutId);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.classList.add("is-visible");

  if (duration > 0) {
    toastTimeoutId = setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, duration);
  }
}

function sourceLabel(sourceId) {
  return sourceId === "motivation" ? "Daily Motivation" : "Bing Wallpapers";
}

function formatDuration(milliseconds) {
  if (milliseconds < 3_600_000) {
    const minutes = milliseconds / 60_000;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const hours = milliseconds / 3_600_000;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
