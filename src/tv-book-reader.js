import {
  BookPaginator,
  pageIndexToSpreadIndex,
  pairBookPages,
  spreadIndexToPageIndex,
} from "./book-paginator.js";
import { BookPageTurner } from "./book-page-turn.js";
import {
  formatBookProgress,
  moveBookGridSelection,
  wrapBookIndex,
} from "./books.js";

export class TvBookReader {
  constructor({
    elements,
    provider,
    progressStore,
    onActiveChange = () => {},
    onToast = () => {},
  }) {
    this.elements = elements;
    this.provider = provider;
    this.progressStore = progressStore;
    this.onActiveChange = onActiveChange;
    this.onToast = onToast;
    this.paginator = new BookPaginator({
      measureElement: elements.paginationMeasure,
    });
    this.pageTurner = new BookPageTurner({
      spread: elements.spread,
      leftPage: elements.leftPage,
      rightPage: elements.rightPage,
      leaf: elements.turningLeaf,
      front: elements.turningFront,
      back: elements.turningBack,
    });

    this.mode = "closed";
    this.books = [];
    this.selectedBookIndex = 0;
    this.book = null;
    this.chapterIndex = 0;
    this.chapterTitle = "";
    this.chapterHtml = "";
    this.chapterLayouts = new Map();
    this.pages = [];
    this.spreads = [];
    this.spreadIndex = 0;
    this.pageIndex = 0;
    this.pageCount = 1;
    this.tocSelection = 0;
    this.loading = false;
    this.initialized = false;
    this.renderToken = 0;
    this.resizeTimer = null;
    this.resizeObserver =
      typeof globalThis.ResizeObserver === "function"
        ? new globalThis.ResizeObserver(() => this.handleResize())
        : null;

    this.handleResize = () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        if (
          this.mode === "reader" &&
          this.chapterHtml &&
          !this.loading &&
          !this.pageTurner.turning
        ) {
          this.chapterLayouts.clear();
          void this.#paginateCurrentChapter(this.pageIndex).catch((error) => {
            this.onToast(`Unable to resize book: ${error.message}`, true);
          });
        }
      }, 180);
    };
  }

  get active() {
    return this.mode !== "closed";
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    this.books = await this.provider.listBooks();
    this.selectedBookIndex = Math.min(
      this.selectedBookIndex,
      Math.max(0, this.books.length - 1),
    );
    this.#renderLibrary();
    this.#bindPointerInput();
    globalThis.addEventListener?.("resize", this.handleResize);
    this.resizeObserver?.observe(this.elements.stage);
    this.initialized = true;
  }

  async openLibrary() {
    await this.initialize();
    this.mode = "library";
    this.book = null;
    this.chapterHtml = "";
    this.#setActive(true);
    this.#showView("library");
    this.elements.libraryStatus.textContent = this.books.length
      ? `${this.books.length} ${this.books.length === 1 ? "book" : "books"} available`
      : "No books available";
    this.#renderLibrarySelection();
  }

  close() {
    if (!this.active) {
      return;
    }
    this.#saveProgress();
    this.#cancelPendingRender();
    this.mode = "closed";
    this.book = null;
    this.chapterHtml = "";
    this.elements.shell.hidden = true;
    this.elements.toc.hidden = true;
    this.elements.readerLoading.hidden = true;
    this.#setActive(false);
  }

  dispose() {
    clearTimeout(this.resizeTimer);
    globalThis.removeEventListener?.("resize", this.handleResize);
    this.resizeObserver?.disconnect();
  }

  handleKey(key) {
    if (!this.active) {
      return false;
    }

    if (this.mode === "library") {
      this.#handleLibraryKey(key);
    } else if (this.mode === "reader") {
      this.#handleReaderKey(key);
    }
    return true;
  }

  #handleLibraryKey(key) {
    const direction = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    }[key];
    if (direction) {
      this.selectedBookIndex = moveBookGridSelection(
        this.selectedBookIndex,
        direction,
        this.books.length,
      );
      this.#renderLibrarySelection();
      return;
    }

    if (key === "Enter" || key === " ") {
      void this.#openSelectedBook();
    } else if (key === "Back" || key === "Escape") {
      this.close();
    }
  }

  #handleReaderKey(key) {
    if (!this.elements.toc.hidden) {
      this.#handleTocKey(key);
      return;
    }
    if (this.loading || this.pageTurner.turning) {
      return;
    }

    switch (key) {
      case "ArrowLeft":
        void this.#previousSpread();
        break;
      case "ArrowRight":
        void this.#nextSpread();
        break;
      case "ChannelUp":
        void this.#renderChapter(this.chapterIndex + 1, 0);
        break;
      case "ChannelDown":
        void this.#renderChapter(this.chapterIndex - 1, 0);
        break;
      case "ArrowUp":
        this.tocSelection = this.chapterIndex;
        this.elements.toc.hidden = false;
        this.#renderTocSelection();
        break;
      case "Enter":
      case " ":
      case "MediaPlayPause":
        this.onToast("Narration controls will use this key when the phone connects");
        break;
      case "Back":
      case "Escape":
        this.#returnToLibrary();
        break;
      default:
        break;
    }
  }

  #handleTocKey(key) {
    if (key === "ArrowUp") {
      this.tocSelection = wrapBookIndex(
        this.tocSelection - 1,
        this.book.chapters.length,
      );
      this.#renderTocSelection();
    } else if (key === "ArrowDown") {
      this.tocSelection = wrapBookIndex(
        this.tocSelection + 1,
        this.book.chapters.length,
      );
      this.#renderTocSelection();
    } else if (key === "Enter" || key === " ") {
      this.elements.toc.hidden = true;
      void this.#renderChapter(this.tocSelection, 0);
    } else if (
      key === "Back" ||
      key === "Escape" ||
      key === "ArrowLeft"
    ) {
      this.elements.toc.hidden = true;
    }
  }

  async #openSelectedBook() {
    const selected = this.books[this.selectedBookIndex];
    if (!selected || this.loading) {
      return;
    }

    const token = ++this.renderToken;
    this.loading = true;
    this.#showReaderLoading(`Opening ${selected.title}`);
    try {
      const book = await this.provider.openBook(selected.id);
      if (token !== this.renderToken || this.mode !== "library") {
        return;
      }

      this.book = book;
      this.chapterLayouts.clear();
      const progress = this.progressStore.get(
        this.book.id,
        this.book.chapters.length,
      );
      this.#renderToc();
      this.mode = "reader";
      this.#showView("reader");
      await this.#renderChapter(progress.chapterIndex, progress.pageIndex);
    } catch (error) {
      if (token === this.renderToken) {
        this.#showView("library");
        this.onToast(`Unable to open book: ${error.message}`, true);
      }
    } finally {
      if (token === this.renderToken) {
        this.loading = false;
      }
    }
  }

  async #renderChapter(chapterIndex, requestedPage) {
    if (
      !this.book ||
      chapterIndex < 0 ||
      chapterIndex >= this.book.chapters.length
    ) {
      return false;
    }

    const token = ++this.renderToken;
    this.loading = true;
    const chapter = this.book.chapters[chapterIndex];
    this.#showReaderLoading(`Loading ${chapter.title}`);
    try {
      await this.#ensurePageSurface();
      const layout = await this.#prepareChapterLayout(chapterIndex);
      if (token !== this.renderToken) {
        return false;
      }

      this.#applyChapterLayout(layout, requestedPage, { render: true });
      this.elements.readerLoading.hidden = true;
      this.#renderTocSelection();
      this.#saveProgress();
      this.#prefetchAdjacentChapters();
      return true;
    } catch (error) {
      if (token === this.renderToken) {
        const message = `Unable to load chapter: ${error.message}`;
        if (this.chapterHtml && this.spreads.length > 0) {
          this.elements.readerLoading.hidden = true;
        } else {
          this.elements.readerLoading.textContent = message;
        }
        this.onToast(message, true);
      }
      return false;
    } finally {
      if (token === this.renderToken) {
        this.loading = false;
      }
    }
  }

  async #paginateCurrentChapter(requestedPage) {
    await this.#ensurePageSurface();
    const layout = this.#paginateLoadedChapter({
      chapterIndex: this.chapterIndex,
      title: this.chapterTitle,
      html: this.chapterHtml,
    });
    this.#cacheChapterLayout(layout);
    this.#applyChapterLayout(layout, requestedPage, { render: true });
  }

  async #nextSpread() {
    if (this.spreadIndex < this.spreads.length - 1) {
      const token = this.renderToken;
      const targetIndex = this.spreadIndex + 1;
      const completed = await this.pageTurner.turn(
        this.spreads[this.spreadIndex],
        this.spreads[targetIndex],
        "next",
      );
      if (
        completed &&
        token === this.renderToken &&
        this.mode === "reader"
      ) {
        this.spreadIndex = targetIndex;
        this.pageIndex = spreadIndexToPageIndex(this.spreadIndex);
        this.#afterPositionChange();
      }
      return;
    }
    await this.#turnAcrossChapter(this.chapterIndex + 1, "next");
  }

  async #previousSpread() {
    if (this.spreadIndex > 0) {
      const token = this.renderToken;
      const targetIndex = this.spreadIndex - 1;
      const completed = await this.pageTurner.turn(
        this.spreads[this.spreadIndex],
        this.spreads[targetIndex],
        "previous",
      );
      if (
        completed &&
        token === this.renderToken &&
        this.mode === "reader"
      ) {
        this.spreadIndex = targetIndex;
        this.pageIndex = spreadIndexToPageIndex(this.spreadIndex);
        this.#afterPositionChange();
      }
      return;
    }
    await this.#turnAcrossChapter(this.chapterIndex - 1, "previous");
  }

  async #turnAcrossChapter(chapterIndex, direction) {
    if (
      chapterIndex < 0 ||
      chapterIndex >= this.book.chapters.length
    ) {
      return false;
    }

    const token = ++this.renderToken;
    this.loading = true;
    const previousStatus = this.elements.contextStatus.textContent;
    this.elements.contextStatus.textContent =
      direction === "next"
        ? "Preparing next chapter…"
        : "Preparing previous chapter…";
    try {
      const layout = await this.#prepareChapterLayout(chapterIndex);
      if (token !== this.renderToken || this.mode !== "reader") {
        return false;
      }
      const targetSpreadIndex =
        direction === "next" ? 0 : layout.spreads.length - 1;
      const completed = await this.pageTurner.turn(
        this.spreads[this.spreadIndex],
        layout.spreads[targetSpreadIndex],
        direction,
      );
      if (
        !completed ||
        token !== this.renderToken ||
        this.mode !== "reader"
      ) {
        return false;
      }

      const targetPage = spreadIndexToPageIndex(targetSpreadIndex);
      this.#applyChapterLayout(layout, targetPage, { render: false });
      this.#renderTocSelection();
      this.#saveProgress();
      this.#prefetchAdjacentChapters();
      return true;
    } catch (error) {
      if (token === this.renderToken && this.mode === "reader") {
        this.elements.contextStatus.textContent = previousStatus;
        this.onToast(`Unable to turn chapter: ${error.message}`, true);
      }
      return false;
    } finally {
      if (token === this.renderToken) {
        this.loading = false;
      }
    }
  }

  async #ensurePageSurface() {
    if (this.elements.leftPage.querySelector(".book-page-content")) {
      return;
    }
    this.pageTurner.renderSpread(pairBookPages([])[0]);
    await nextPaint();
  }

  async #prepareChapterLayout(chapterIndex) {
    await this.#ensurePageSurface();
    const dimensions = this.#pageDimensions();
    const chapter = this.book.chapters[chapterIndex];
    const cacheKey = this.#chapterLayoutKey(chapterIndex, dimensions);
    if (!this.chapterLayouts.has(cacheKey)) {
      const layoutPromise = this.provider
        .loadChapter(this.book.id, chapter.id)
        .then((loaded) =>
          this.#paginateLoadedChapter({
            chapterIndex,
            title: loaded.title,
            html: loaded.html,
            dimensions,
          }),
        )
        .catch((error) => {
          this.chapterLayouts.delete(cacheKey);
          throw error;
        });
      this.chapterLayouts.set(cacheKey, layoutPromise);
    }
    return this.chapterLayouts.get(cacheKey);
  }

  #paginateLoadedChapter({
    chapterIndex,
    title,
    html,
    dimensions = this.#pageDimensions(),
  }) {
    const pages = this.paginator
      .paginate(html, dimensions)
      .map((page) => ({
        ...page,
        bookTitle: this.book.title,
        chapterTitle: title,
        chapterIndex,
      }));
    return {
      chapterIndex,
      title,
      html,
      pages,
      spreads: pairBookPages(pages),
      dimensions,
    };
  }

  #applyChapterLayout(layout, requestedPage, { render }) {
    this.chapterIndex = layout.chapterIndex;
    this.chapterTitle = layout.title;
    this.chapterHtml = layout.html;
    this.pages = layout.pages;
    this.spreads = layout.spreads;
    this.pageCount = layout.pages.length;
    this.spreadIndex = pageIndexToSpreadIndex(
      requestedPage,
      layout.spreads.length,
    );
    this.pageIndex = spreadIndexToPageIndex(this.spreadIndex);
    this.tocSelection = layout.chapterIndex;
    this.pageTurner.setContext({
      bookTitle: this.book.title,
      chapterTitle: layout.title,
    });
    if (render) {
      this.pageTurner.renderSpread(layout.spreads[this.spreadIndex]);
    }
    this.#renderUnifiedBar();
  }

  #pageDimensions() {
    const contentBox =
      this.elements.leftPage.querySelector(".book-page-content");
    const width = Math.floor(contentBox?.clientWidth ?? 0);
    const height = Math.floor(contentBox?.clientHeight ?? 0);
    if (width <= 0 || height <= 0) {
      throw new Error("Book page dimensions are unavailable");
    }
    return { width, height };
  }

  #chapterLayoutKey(chapterIndex, dimensions) {
    return `${this.book.id}:${chapterIndex}:${dimensions.width}x${dimensions.height}`;
  }

  #cacheChapterLayout(layout) {
    const key = this.#chapterLayoutKey(
      layout.chapterIndex,
      layout.dimensions,
    );
    this.chapterLayouts.set(key, Promise.resolve(layout));
  }

  #prefetchAdjacentChapters() {
    for (const chapterIndex of [
      this.chapterIndex - 1,
      this.chapterIndex + 1,
    ]) {
      if (chapterIndex >= 0 && chapterIndex < this.book.chapters.length) {
        void this.#prepareChapterLayout(chapterIndex).catch((error) => {
          console.warn(
            `Unable to prefetch chapter ${chapterIndex + 1}:`,
            error,
          );
        });
      }
    }
  }

  #afterPositionChange() {
    this.#saveProgress();
    this.#renderUnifiedBar();
  }

  #overallProgress() {
    if (!this.book?.chapters.length) {
      return 0;
    }
    const pageFraction =
      this.pageCount > 0 ? this.pageIndex / this.pageCount : 0;
    return Math.min(
      1,
      (this.chapterIndex + pageFraction) / this.book.chapters.length,
    );
  }

  #returnToLibrary() {
    this.#saveProgress();
    this.#cancelPendingRender();
    this.mode = "library";
    this.elements.toc.hidden = true;
    this.elements.readerLoading.hidden = true;
    this.#showView("library");
    this.#renderLibrary();
  }

  #cancelPendingRender() {
    this.renderToken += 1;
    this.loading = false;
  }

  #saveProgress() {
    if (!this.book) {
      return;
    }
    try {
      this.progressStore.save(
        this.book.id,
        {
          chapterIndex: this.chapterIndex,
          pageIndex: this.pageIndex,
          pageCount: this.pageCount,
        },
        this.book.chapters.length,
      );
    } catch (error) {
      this.onToast(error.message, true);
    }
  }

  #renderLibrary() {
    this.elements.bookGrid.replaceChildren();
    for (const [index, book] of this.books.entries()) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "book-card";
      card.dataset.bookIndex = String(index);
      card.setAttribute("role", "option");

      const cover = document.createElement("img");
      cover.src = book.cover;
      cover.alt = "";

      const copy = document.createElement("span");
      copy.className = "book-card-copy";

      const title = document.createElement("strong");
      title.textContent = book.title;

      const author = document.createElement("span");
      author.textContent = book.author;

      const progress = document.createElement("small");
      const saved = this.progressStore.get(book.id, book.chapterCount);
      progress.textContent = formatBookProgress(
        saved,
        book.chapterCount,
      );

      copy.append(title, author, progress);
      card.append(cover, copy);
      this.elements.bookGrid.append(card);
    }
    this.#renderLibrarySelection();
    this.#renderUnifiedBar();
  }

  #renderLibrarySelection() {
    const cards = [...this.elements.bookGrid.querySelectorAll(".book-card")];
    for (const [index, card] of cards.entries()) {
      const selected = index === this.selectedBookIndex;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-selected", String(selected));
      if (selected) {
        card.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
    }
  }

  #renderToc() {
    this.elements.tocList.replaceChildren();
    for (const [index, chapter] of this.book.chapters.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.chapterIndex = String(index);
      button.setAttribute("role", "option");
      button.textContent = chapter.title;
      this.elements.tocList.append(button);
    }
  }

  #renderTocSelection() {
    const buttons = [...this.elements.tocList.querySelectorAll("button")];
    for (const [index, button] of buttons.entries()) {
      const selected = index === this.tocSelection;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", String(selected));
      if (selected && !this.elements.toc.hidden) {
        button.scrollIntoView?.({ block: "nearest" });
      }
    }
  }

  #renderUnifiedBar() {
    for (const button of this.elements.modeTabs) {
      const mode = button.dataset.bookMode;
      button.classList.toggle("is-selected", mode === this.mode);
      if (mode === "reader") {
        button.disabled = !this.book;
      } else if (mode === "learning") {
        button.disabled = true;
      }
    }

    if (this.mode === "library") {
      this.elements.contextStatus.textContent =
        `${this.books.length} ${this.books.length === 1 ? "book" : "books"} · ` +
        (this.book ? "Continue reading available" : "Choose a book");
      this.elements.contextKeys.innerHTML = `
        <span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> Choose</span>
        <span><kbd>OK</kbd> Open</span>
        <span><kbd>Back</kbd> Art</span>
      `;
      return;
    }

    if (this.mode === "reader" && this.book) {
      const spread = this.spreads[this.spreadIndex];
      const leftNumber = spread?.left?.number ?? 1;
      const rightNumber = spread?.right?.blank
        ? null
        : spread?.right?.number;
      const pageLabel = rightNumber
        ? `pp. ${leftNumber}–${rightNumber}`
        : `p. ${leftNumber}`;
      const percent = Math.round(this.#overallProgress() * 100);
      this.elements.contextStatus.textContent =
        `${this.book.title} · ${this.chapterTitle} · ${pageLabel} · ${percent}%`;
      this.elements.contextKeys.innerHTML = `
        <span><kbd>←</kbd><kbd>→</kbd> Turn</span>
        <span><kbd>CH</kbd> Chapter</span>
        <span><kbd>↑</kbd> Contents</span>
        <span><kbd>Back</kbd> Library</span>
      `;
    }
  }

  #showReaderLoading(message) {
    this.elements.readerLoading.hidden = false;
    this.elements.readerLoading.textContent = message;
  }

  #showView(view) {
    this.elements.shell.hidden = false;
    this.elements.library.hidden = view !== "library";
    this.elements.reader.hidden = view !== "reader";
    this.elements.shell.dataset.view = view;
    this.#renderUnifiedBar();
  }

  #setActive(active) {
    this.elements.shell.hidden = !active;
    this.onActiveChange(active);
  }

  #bindPointerInput() {
    this.elements.bookGrid.addEventListener("click", (event) => {
      const card = event.target.closest(".book-card");
      if (!card) {
        return;
      }
      this.selectedBookIndex = Number.parseInt(card.dataset.bookIndex, 10);
      this.#renderLibrarySelection();
      void this.#openSelectedBook();
    });

    this.elements.tocList.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) {
        return;
      }
      this.tocSelection = Number.parseInt(button.dataset.chapterIndex, 10);
      this.elements.toc.hidden = true;
      void this.#renderChapter(this.tocSelection, 0);
    });

    for (const button of this.elements.modeTabs) {
      button.addEventListener("click", () => {
        const mode = button.dataset.bookMode;
        if (mode === "art") {
          this.close();
        } else if (mode === "library") {
          this.#returnToLibrary();
        } else if (mode === "reader" && this.book) {
          this.mode = "reader";
          this.#showView("reader");
          this.pageTurner.renderSpread(this.spreads[this.spreadIndex]);
        } else if (mode === "learning") {
          this.onToast("Word learning will be added with phone dictionaries");
        }
      });
    }
  }
}

function nextPaint() {
  return new Promise((resolve) => {
    let finished = false;
    let firstFrame;
    let secondFrame;
    let timeoutId;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      resolve();
    };
    timeoutId = setTimeout(finish, 100);
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(finish);
    });
  });
}
