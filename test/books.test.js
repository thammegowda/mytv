import test from "node:test";
import assert from "node:assert/strict";

import {
  BookProgressStore,
  BundledBookProvider,
  formatBookProgress,
  moveBookGridSelection,
  normalizeBookProgress,
  validateBookCatalog,
  validateBookManifest,
  validateBookNarration,
  wrapBookIndex,
} from "../src/books.js";

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

test("validates a safe book catalog and manifest", () => {
  const [book] = validateBookCatalog({
    books: [
      {
        id: "quiet-hour",
        title: "The Quiet Hour",
        author: "MyTV Art",
        format: "EPUB",
        chapterCount: 2,
        cover: "quiet-hour/cover.svg",
        manifest: "quiet-hour/manifest.json",
      },
    ],
  });
  const manifest = validateBookManifest(
    {
      id: "quiet-hour",
      title: "The Quiet Hour",
      author: "MyTV Art",
      chapters: [
        { id: "one", title: "One", href: "one.html" },
        { id: "two", title: "Two", href: "two.html" },
      ],
    },
    book.id,
  );

  assert.equal(book.chapterCount, 2);
  assert.deepEqual(
    manifest.chapters.map((chapter) => chapter.id),
    ["one", "two"],
  );
});

test("rejects unsafe paths and mismatched manifests", () => {
  assert.throws(
    () =>
      validateBookCatalog({
        books: [
          {
            id: "unsafe",
            title: "Unsafe",
            author: "Author",
            format: "EPUB",
            cover: "../cover.svg",
            manifest: "manifest.json",
          },
        ],
      }),
    /safe relative asset path/,
  );
  assert.throws(
    () =>
      validateBookManifest(
        {
          id: "another-book",
          title: "Book",
          author: "Author",
          chapters: [{ id: "one", title: "One", href: "one.html" }],
        },
        "expected-book",
      ),
    /does not match/,
  );
});

test("validates ordered narration chunks and aligned text offsets", () => {
  const narration = validateBookNarration(
    {
      chapterId: "chapter-1",
      language: "en-US",
      chunks: [
        {
          index: 0,
          text: "First paragraph.",
          start: 0,
          end: 16,
          audio: "audio/chapter-1/0.wav",
          alignment: "alignment/chapter-1/0.json",
        },
        {
          index: 1,
          text: "Second paragraph.",
          start: 17,
          end: 34,
          audio: "audio/chapter-1/1.wav",
          alignment: "alignment/chapter-1/1.json",
        },
      ],
    },
    "chapter-1",
  );

  assert.equal(narration.chunks.length, 2);
  assert.throws(
    () =>
      validateBookNarration({
        chapterId: "chapter-1",
        chunks: [
          {
            index: 0,
            text: "Too short",
            start: 0,
            end: 20,
            audio: "audio.wav",
            alignment: "alignment.json",
          },
        ],
      }),
    /invalid text offsets/,
  );
});

test("bundled provider resolves catalog-relative assets", async () => {
  const requests = [];
  const provider = new BundledBookProvider({
    catalogUrl: "assets/books/catalog.json",
    fetchImpl: async (url) => {
      requests.push(url);
      if (url === "assets/books/catalog.json") {
        return jsonResponse({
          books: [
            {
              id: "quiet-hour",
              title: "The Quiet Hour",
              author: "MyTV Art",
              format: "EPUB",
              chapterCount: 1,
              cover: "quiet-hour/cover.svg",
              manifest: "quiet-hour/manifest.json",
            },
          ],
        });
      }
      if (url === "assets/books/quiet-hour/manifest.json") {
        return jsonResponse({
          id: "quiet-hour",
          title: "The Quiet Hour",
          author: "MyTV Art",
          chapters: [
            { id: "one", title: "One", href: "chapter-one.html" },
          ],
        });
      }
      if (url === "assets/books/quiet-hour/chapter-one.html") {
        return {
          ok: true,
          text: async () => "<h1>One</h1><p>Hello.</p>",
        };
      }
      return { ok: false, status: 404 };
    },
  });

  const [book] = await provider.listBooks();
  const manifest = await provider.openBook(book.id);
  const chapter = await provider.loadChapter(book.id, "one");

  assert.equal(book.cover, "assets/books/quiet-hour/cover.svg");
  assert.equal(manifest.chapters.length, 1);
  assert.match(chapter.html, /Hello/);
  assert.deepEqual(requests, [
    "assets/books/catalog.json",
    "assets/books/quiet-hour/manifest.json",
    "assets/books/quiet-hour/chapter-one.html",
  ]);
});

test("book provider resolves assets from an absolute phone catalog URL", async () => {
  const requests = [];
  const provider = new BundledBookProvider({
    catalogUrl: "http://127.0.0.1:8787/v1/catalog.json",
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.endsWith("/catalog.json")) {
        return jsonResponse({
          books: [
            {
              id: "phone-book",
              title: "Phone Book",
              author: "Areada phone",
              format: "EPUB",
              chapterCount: 1,
              cover: "books/phone-book/cover.svg",
              manifest: "books/phone-book/manifest.json",
            },
          ],
        });
      }
      if (url.endsWith("/manifest.json")) {
        return jsonResponse({
          id: "phone-book",
          title: "Phone Book",
          author: "Areada phone",
          chapters: [
            {
              id: "chapter-1",
              title: "One",
              href: "chapters/chapter-1.html",
              narration: "narration/chapter-1.json",
            },
          ],
        });
      }
      if (url.endsWith("/narration/chapter-1.json")) {
        return jsonResponse({
          chapterId: "chapter-1",
          language: "en-US",
          chunks: [
        {
          index: 0,
          text: "From the phone.",
          start: 0,
          end: 15,
          audio: "audio/chapter-1/0.wav",
          alignment: "alignment/chapter-1/0.json",
        },
          ],
        });
      }
      if (url.endsWith("/chapter-1.html")) {
        return {
          ok: true,
          text: async () => "<h1>One</h1><p>From the phone.</p>",
        };
      }
      return { ok: false, status: 404 };
    },
  });

  const [book] = await provider.listBooks();
  await provider.openBook(book.id);
  const chapter = await provider.loadChapter(book.id, "chapter-1");
  const narration = await provider.loadNarration(book.id, "chapter-1");

  assert.equal(
    book.cover,
    "http://127.0.0.1:8787/v1/books/phone-book/cover.svg",
  );
  assert.match(chapter.html, /From the phone/);
  assert.equal(
    narration.chunks[0].audio,
    "http://127.0.0.1:8787/v1/books/phone-book/audio/chapter-1/0.wav",
  );
  assert.deepEqual(requests, [
    "http://127.0.0.1:8787/v1/catalog.json",
    "http://127.0.0.1:8787/v1/books/phone-book/manifest.json",
    "http://127.0.0.1:8787/v1/books/phone-book/chapters/chapter-1.html",
    "http://127.0.0.1:8787/v1/books/phone-book/narration/chapter-1.json",
  ]);
});

test("book progress is normalized and persisted", () => {
  const store = new BookProgressStore(createStorage());
  const saved = store.save(
    "quiet-hour",
    { chapterIndex: 8, pageIndex: -4, pageCount: 7 },
    3,
  );

  assert.deepEqual(saved, {
    chapterIndex: 2,
    pageIndex: 0,
    pageCount: 7,
  });
  assert.deepEqual(store.get("quiet-hour", 3), saved);
  assert.deepEqual(normalizeBookProgress({}, 3), {
    chapterIndex: 0,
    pageIndex: 0,
    pageCount: 1,
  });
});

test("remote selection and pagination helpers stay in bounds", () => {
  assert.equal(wrapBookIndex(-1, 4), 3);
  assert.equal(moveBookGridSelection(1, "down", 7, 4), 5);
  assert.equal(moveBookGridSelection(6, "right", 7, 4), 6);
});

test("formats library progress from chapter and page state", () => {
  assert.equal(formatBookProgress(null, 3), "Not started");
  assert.equal(
    formatBookProgress(
      { chapterIndex: 1, pageIndex: 2, pageCount: 4 },
      2,
    ),
    "75% read",
  );
});
