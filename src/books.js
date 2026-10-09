const DEFAULT_CATALOG_URL = "assets/books/catalog.json";
const DEFAULT_PROGRESS_KEY = "mytv-book-progress-v1";

export function validateBookCatalog(payload) {
  if (!payload || !Array.isArray(payload.books)) {
    throw new Error("Book catalog must contain a books array");
  }

  const ids = new Set();
  return payload.books.map((candidate, index) => {
    const context = `Book catalog entry ${index + 1}`;
    const id = requireIdentifier(candidate?.id, `${context} id`);
    if (ids.has(id)) {
      throw new Error(`${context} repeats id "${id}"`);
    }
    ids.add(id);

    return {
      id,
      title: requireText(candidate.title, `${context} title`),
      author: requireText(candidate.author, `${context} author`),
      format: requireText(candidate.format, `${context} format`),
      chapterCount:
        Number.isInteger(candidate.chapterCount) && candidate.chapterCount > 0
          ? candidate.chapterCount
          : 1,
      cover: requireAssetPath(candidate.cover, `${context} cover`),
      manifest: requireAssetPath(candidate.manifest, `${context} manifest`),
    };
  });
}

export function validateBookManifest(payload, expectedBookId) {
  if (
    !payload ||
    !Array.isArray(payload.chapters) ||
    payload.chapters.length === 0
  ) {
    throw new Error("Book manifest must contain at least one chapter");
  }

  const id = requireIdentifier(payload.id, "Book manifest id");
  if (expectedBookId && id !== expectedBookId) {
    throw new Error(
      `Book manifest id "${id}" does not match "${expectedBookId}"`,
    );
  }

  const chapterIds = new Set();
  const chapters = payload.chapters.map((candidate, index) => {
    const context = `Chapter ${index + 1}`;
    const chapterId = requireIdentifier(candidate?.id, `${context} id`);
    if (chapterIds.has(chapterId)) {
      throw new Error(`${context} repeats id "${chapterId}"`);
    }
    chapterIds.add(chapterId);

    return {
      id: chapterId,
      title: requireText(candidate.title, `${context} title`),
      href: requireAssetPath(candidate.href, `${context} href`),
      narration:
        candidate.narration == null
          ? null
          : requireAssetPath(
              candidate.narration,
              `${context} narration`,
            ),
    };
  });

  return {
    id,
    title: requireText(payload.title, "Book manifest title"),
    author: requireText(payload.author, "Book manifest author"),
    language: requireText(payload.language ?? "en", "Book manifest language"),
    chapters,
  };
}

export function validateBookNarration(payload, expectedChapterId) {
  if (!payload || !Array.isArray(payload.chunks)) {
    throw new Error("Book narration must contain a chunks array");
  }
  const chapterId = requireIdentifier(
    payload.chapterId,
    "Book narration chapter id",
  );
  if (expectedChapterId && chapterId !== expectedChapterId) {
    throw new Error(
      `Book narration chapter id "${chapterId}" does not match "${expectedChapterId}"`,
    );
  }

  let previousEnd = 0;
  const chunks = payload.chunks.map((candidate, index) => {
    const context = `Narration chunk ${index + 1}`;
    if (candidate?.index !== index) {
      throw new Error(`${context} index must be ${index}`);
    }
    if (
      !Number.isInteger(candidate.start) ||
      !Number.isInteger(candidate.end) ||
      candidate.start < previousEnd ||
      candidate.end <= candidate.start ||
      typeof candidate.text !== "string" ||
      candidate.text.length !== candidate.end - candidate.start
    ) {
      throw new Error(`${context} has invalid text offsets`);
    }
    previousEnd = candidate.end;
    return {
      index,
      text: requireText(candidate.text, `${context} text`),
      start: candidate.start,
      end: candidate.end,
      audio: requireAssetPath(candidate.audio, `${context} audio`),
      alignment: requireAssetPath(
        candidate.alignment,
        `${context} alignment`,
      ),
    };
  });

  return {
    chapterId,
    language: requireText(
      payload.language ?? "und",
      "Book narration language",
    ),
    chunks,
  };
}

export class BundledBookProvider {
  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    catalogUrl = DEFAULT_CATALOG_URL,
  } = {}) {
    if (!fetchImpl) {
      throw new Error("Book provider requires the Fetch API");
    }

    this.fetchImpl = fetchImpl;
    this.catalogUrl = catalogUrl;
    this.catalogPromise = null;
    this.manifests = new Map();
    this.narrations = new Map();
  }

  async listBooks() {
    const catalog = await this.#catalog();
    return catalog.map(({ manifest, ...book }) => ({
      ...book,
      cover: resolveRelativeAssetUrl(this.catalogUrl, book.cover),
    }));
  }

  async openBook(bookId) {
    const catalog = await this.#catalog();
    const record = catalog.find((book) => book.id === bookId);
    if (!record) {
      throw new Error(`Book "${bookId}" is not in the catalog`);
    }

    if (!this.manifests.has(bookId)) {
      const manifestUrl = resolveRelativeAssetUrl(
        this.catalogUrl,
        record.manifest,
      );
      this.manifests.set(
        bookId,
        this.#fetchJson(manifestUrl)
          .then((payload) => ({
            manifest: validateBookManifest(payload, bookId),
            manifestUrl,
          }))
          .catch((error) => {
            this.manifests.delete(bookId);
            throw error;
          }),
      );
    }

    const { manifest } = await this.manifests.get(bookId);
    return {
      ...manifest,
      cover: resolveRelativeAssetUrl(this.catalogUrl, record.cover),
      format: record.format,
    };
  }

  async loadChapter(bookId, chapterId) {
    const manifest = await this.openBook(bookId);
    const chapter = manifest.chapters.find((item) => item.id === chapterId);
    if (!chapter) {
      throw new Error(`Chapter "${chapterId}" is not in book "${bookId}"`);
    }

    const cached = await this.manifests.get(bookId);
    const chapterUrl = resolveRelativeAssetUrl(
      cached.manifestUrl,
      chapter.href,
    );
    const response = await this.fetchImpl(chapterUrl, {
      cache: "no-cache",
      headers: { Accept: "text/html" },
    });
    if (!response.ok) {
      throw new Error(`Chapter request failed with HTTP ${response.status}`);
    }

    return {
      ...chapter,
      html: await response.text(),
    };
  }

  async loadNarration(bookId, chapterId) {
    const manifest = await this.openBook(bookId);
    const chapter = manifest.chapters.find((item) => item.id === chapterId);
    if (!chapter) {
      throw new Error(`Chapter "${chapterId}" is not in book "${bookId}"`);
    }
    if (!chapter.narration) {
      return null;
    }

    const cacheKey = `${bookId}:${chapterId}`;
    if (!this.narrations.has(cacheKey)) {
      const cached = await this.manifests.get(bookId);
      const narrationUrl = resolveRelativeAssetUrl(
        cached.manifestUrl,
        chapter.narration,
      );
      this.narrations.set(
        cacheKey,
        this.#fetchJson(narrationUrl)
          .then((payload) => {
            const narration = validateBookNarration(payload, chapterId);
            return {
              ...narration,
              chunks: narration.chunks.map((chunk) => ({
                ...chunk,
                audio: resolveRelativeAssetUrl(
                  cached.manifestUrl,
                  chunk.audio,
                ),
                alignment: resolveRelativeAssetUrl(
                  cached.manifestUrl,
                  chunk.alignment,
                ),
              })),
            };
          })
          .catch((error) => {
            this.narrations.delete(cacheKey);
            throw error;
          }),
      );
    }
    return this.narrations.get(cacheKey);
  }

  async #catalog() {
    if (!this.catalogPromise) {
      this.catalogPromise = this.#fetchJson(this.catalogUrl)
        .then(validateBookCatalog)
        .catch((error) => {
          this.catalogPromise = null;
          throw error;
        });
    }
    return this.catalogPromise;
  }

  async #fetchJson(url) {
    const response = await this.fetchImpl(url, {
      cache: "no-cache",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Book request failed with HTTP ${response.status}`);
    }
    return response.json();
  }
}

export class BookProgressStore {
  constructor(storage = globalThis.localStorage, key = DEFAULT_PROGRESS_KEY) {
    this.storage = storage;
    this.key = key;
  }

  get(bookId, chapterCount) {
    const allProgress = this.#read();
    return normalizeBookProgress(allProgress[bookId], chapterCount);
  }

  save(bookId, progress, chapterCount) {
    if (!this.storage) {
      throw new Error("Book progress storage is unavailable");
    }

    const allProgress = this.#read();
    const normalized = normalizeBookProgress(progress, chapterCount);
    allProgress[bookId] = {
      ...normalized,
      updatedAt: Date.now(),
    };
    this.storage.setItem(this.key, JSON.stringify(allProgress));
    return normalized;
  }

  #read() {
    const serialized = this.storage?.getItem(this.key);
    if (!serialized) {
      return {};
    }

    try {
      const parsed = JSON.parse(serialized);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (error) {
      throw new Error(`Stored book progress is invalid: ${error.message}`);
    }
  }
}

export function normalizeBookProgress(candidate = {}, chapterCount = 1) {
  const safeChapterCount =
    Number.isInteger(chapterCount) && chapterCount > 0 ? chapterCount : 1;
  const chapterIndex = Number.isInteger(candidate?.chapterIndex)
    ? candidate.chapterIndex
    : 0;
  const pageIndex = Number.isInteger(candidate?.pageIndex)
    ? candidate.pageIndex
    : 0;

  return {
    chapterIndex: Math.min(
      Math.max(chapterIndex, 0),
      safeChapterCount - 1,
    ),
    pageIndex: Math.max(pageIndex, 0),
    pageCount:
      Number.isInteger(candidate?.pageCount) && candidate.pageCount > 0
        ? candidate.pageCount
        : 1,
  };
}

export function wrapBookIndex(index, itemCount) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) {
    return 0;
  }
  return ((index % itemCount) + itemCount) % itemCount;
}

export function moveBookGridSelection(
  index,
  direction,
  itemCount,
  columns = 4,
) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) {
    return 0;
  }
  const safeIndex = Math.min(Math.max(index, 0), itemCount - 1);
  const safeColumns = Math.max(1, columns);
  switch (direction) {
    case "left":
      return Math.max(0, safeIndex - 1);
    case "right":
      return Math.min(itemCount - 1, safeIndex + 1);
    case "up":
      return Math.max(0, safeIndex - safeColumns);
    case "down":
      return Math.min(itemCount - 1, safeIndex + safeColumns);
    default:
      return safeIndex;
  }
}

export function formatBookProgress(progress, chapterCount) {
  if (!progress || !Number.isInteger(chapterCount) || chapterCount <= 0) {
    return "Not started";
  }
  const chapterFraction = progress.chapterIndex / chapterCount;
  const pageFraction =
    progress.pageCount > 0
      ? progress.pageIndex / progress.pageCount / chapterCount
      : 0;
  const percent = Math.round(
    Math.min(Math.max(chapterFraction + pageFraction, 0), 1) * 100,
  );
  return percent > 0 ? `${percent}% read` : "Ready to read";
}

function requireText(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function requireIdentifier(value, name) {
  const text = requireText(value, name);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) {
    throw new Error(`${name} must be lowercase kebab-case`);
  }
  return text;
}

function requireAssetPath(value, name) {
  const text = requireText(value, name);
  if (
    text.startsWith("/") ||
    text.includes("..") ||
    /^[a-z][a-z0-9+.-]*:/i.test(text)
  ) {
    throw new Error(`${name} must be a safe relative asset path`);
  }
  return text;
}

function resolveRelativeAssetUrl(baseUrl, relativePath) {
  const cleanBase = String(baseUrl).split(/[?#]/, 1)[0];
  const directory = cleanBase.slice(0, cleanBase.lastIndexOf("/") + 1);
  return `${directory}${relativePath}`;
}
