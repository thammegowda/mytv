export function bookTurnSurfaces(currentSpread, targetSpread, direction) {
  if (!currentSpread || !targetSpread) {
    throw new Error("Page turn requires current and target spreads");
  }
  if (direction === "next") {
    return {
      baseLeft: currentSpread.left,
      baseRight: targetSpread.right,
      front: currentSpread.right,
      back: targetSpread.left,
    };
  }
  if (direction === "previous") {
    return {
      baseLeft: targetSpread.left,
      baseRight: currentSpread.right,
      front: currentSpread.left,
      back: targetSpread.right,
    };
  }
  throw new Error(`Unsupported page-turn direction "${direction}"`);
}

const PAGE_TURN_TIMEOUT_MS = 1_500;

export class BookPageTurner {
  constructor({
    spread,
    leftPage,
    rightPage,
    leaf,
    front,
    back,
    reducedMotion = globalThis.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ),
  }) {
    this.spread = spread;
    this.leftPage = leftPage;
    this.rightPage = rightPage;
    this.leaf = leaf;
    this.front = front;
    this.back = back;
    this.reducedMotion = reducedMotion;
    this.context = {
      bookTitle: "",
      chapterTitle: "",
    };
    this.turning = false;
  }

  setContext(context) {
    this.context = {
      ...this.context,
      ...context,
    };
  }

  renderSpread(spread) {
    renderBookPage(this.leftPage, spread.left, "left", this.context);
    renderBookPage(this.rightPage, spread.right, "right", this.context);
  }

  async turn(currentSpread, targetSpread, direction) {
    if (this.turning) {
      return false;
    }

    const surfaces = bookTurnSurfaces(
      currentSpread,
      targetSpread,
      direction,
    );
    if (this.reducedMotion?.matches) {
      this.renderSpread(targetSpread);
      return true;
    }

    this.turning = true;
    if (direction === "next") {
      renderBookPage(this.rightPage, surfaces.baseRight, "right", this.context);
      renderTurningFace(this.front, surfaces.front, "right", "front", this.context);
      renderTurningFace(this.back, surfaces.back, "left", "back", this.context);
    } else {
      renderBookPage(this.leftPage, surfaces.baseLeft, "left", this.context);
      renderTurningFace(this.front, surfaces.front, "left", "front", this.context);
      renderTurningFace(this.back, surfaces.back, "right", "back", this.context);
    }

    this.spread.classList.add(`is-turning-${direction}`);
    this.leaf.className = `book-turning-leaf is-${direction}`;
    try {
      await animationFinished(this.leaf);
      if (direction === "next") {
        renderBookPage(this.leftPage, targetSpread.left, "left", this.context);
      } else {
        renderBookPage(this.rightPage, targetSpread.right, "right", this.context);
      }
      return true;
    } finally {
      this.spread.classList.remove(
        "is-turning-next",
        "is-turning-previous",
      );
      this.leaf.className = "book-turning-leaf";
      this.front.replaceChildren();
      this.back.replaceChildren();
      this.turning = false;
    }
  }
}

function renderTurningFace(element, page, side, face, context) {
  element.className = `book-paper-page book-turning-face ${face} ${side}`;
  renderBookPageContent(element, page, side, context);
}

function renderBookPage(element, page, side, context) {
  element.className = `book-paper-page ${side}${page?.blank ? " is-blank" : ""}`;
  renderBookPageContent(element, page, side, context);
}

function renderBookPageContent(element, page, side, context) {
  const pageContext = {
    bookTitle: page?.bookTitle ?? context.bookTitle,
    chapterTitle: page?.chapterTitle ?? context.chapterTitle,
  };
  const runningLeft =
    side === "left" ? pageContext.bookTitle : pageContext.chapterTitle;
  const runningRight =
    side === "left" ? pageContext.chapterTitle : pageContext.bookTitle;
  element.innerHTML = `
    <div class="book-running-head">
      <span>${escapeHtml(runningLeft)}</span>
      <span>${escapeHtml(runningRight)}</span>
    </div>
    <div class="book-page-content">${page?.html ?? ""}</div>
    <span class="book-paper-number">${page?.blank ? "" : page?.number ?? ""}</span>
  `;
}

function animationFinished(element) {
  return new Promise((resolve) => {
    let finished = false;
    let timeoutId;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      element.removeEventListener("animationend", onAnimationEnd);
      element.removeEventListener("animationcancel", onAnimationEnd);
      resolve();
    };
    const onAnimationEnd = (event) => {
      if (event.target !== element) {
        return;
      }
      finish();
    };
    element.addEventListener("animationend", onAnimationEnd);
    element.addEventListener("animationcancel", onAnimationEnd);
    timeoutId = setTimeout(finish, PAGE_TURN_TIMEOUT_MS);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
