import test from "node:test";
import assert from "node:assert/strict";

import {
  findBookTextBoundary,
  normalizeBookText,
  pageIndexToSpreadIndex,
  pairBookPages,
  spreadIndexToPageIndex,
} from "../src/book-paginator.js";
import {
  BookPageTurner,
  bookTurnSurfaces,
} from "../src/book-page-turn.js";

function page(number) {
  return {
    number,
    html: `<p>Page ${number}</p>`,
    text: `Page ${number}`,
  };
}

function element() {
  const listeners = new Map();
  const classes = new Set();
  return {
    className: "",
    innerHTML: "",
    classList: {
      add(...names) {
        for (const name of names) {
          classes.add(name);
        }
      },
      remove(...names) {
        for (const name of names) {
          classes.delete(name);
        }
      },
      contains(name) {
        return classes.has(name);
      },
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    replaceChildren() {
      this.innerHTML = "";
    },
    dispatch(type) {
      listeners.get(type)?.({ target: this });
    },
  };
}

test("normalizes book text for stable offsets", () => {
  assert.equal(
    normalizeBookText("  One\u00a0line.\n\n Another\tline. "),
    "One line. Another line.",
  );
});

test("finds a word boundary without exceeding requested length", () => {
  const text = "one two three four";
  const boundary = findBookTextBoundary(text, 13);

  assert.equal(text.slice(0, boundary), "one two");
});

test("pairs logical pages into spreads and fills an odd final page", () => {
  const spreads = pairBookPages([page(1), page(2), page(3)]);

  assert.equal(spreads.length, 2);
  assert.equal(spreads[0].left.number, 1);
  assert.equal(spreads[0].right.number, 2);
  assert.equal(spreads[1].left.number, 3);
  assert.equal(spreads[1].right.blank, true);
});

test("converts between logical page and spread indices", () => {
  assert.equal(pageIndexToSpreadIndex(5, 8), 2);
  assert.equal(pageIndexToSpreadIndex(99, 3), 2);
  assert.equal(spreadIndexToPageIndex(3), 6);
});

test("stages seamless forward page-turn surfaces", () => {
  const current = {
    left: page(24),
    right: page(25),
  };
  const target = {
    left: page(26),
    right: page(27),
  };

  const surfaces = bookTurnSurfaces(current, target, "next");

  assert.equal(surfaces.baseLeft.number, 24);
  assert.equal(surfaces.baseRight.number, 27);
  assert.equal(surfaces.front.number, 25);
  assert.equal(surfaces.back.number, 26);
});

test("stages seamless reverse page-turn surfaces", () => {
  const current = {
    left: page(26),
    right: page(27),
  };
  const target = {
    left: page(24),
    right: page(25),
  };

  const surfaces = bookTurnSurfaces(current, target, "previous");

  assert.equal(surfaces.baseLeft.number, 24);
  assert.equal(surfaces.baseRight.number, 27);
  assert.equal(surfaces.front.number, 26);
  assert.equal(surfaces.back.number, 25);
});

test("finishes a page turn when its animation is canceled", async () => {
  const spread = element();
  const leftPage = element();
  const rightPage = element();
  const leaf = element();
  const front = element();
  const back = element();
  const turner = new BookPageTurner({
    spread,
    leftPage,
    rightPage,
    leaf,
    front,
    back,
    reducedMotion: { matches: false },
  });
  turner.setContext({
    bookTitle: "The Quiet Hour",
    chapterTitle: "Attention",
  });

  const current = {
    left: { ...page(4), chapterTitle: "Attention" },
    right: { ...page(5), chapterTitle: "Attention" },
  };
  const target = {
    left: { ...page(1), chapterTitle: "Returning" },
    right: { ...page(2), chapterTitle: "Returning" },
  };
  const turning = turner.turn(current, target, "next");

  assert.match(front.innerHTML, /Attention/);
  assert.match(back.innerHTML, /Returning/);
  leaf.dispatch("animationcancel");

  assert.equal(await turning, true);
  assert.match(leftPage.innerHTML, /Returning/);
  assert.match(rightPage.innerHTML, /Returning/);
  assert.equal(turner.turning, false);
  assert.equal(spread.classList.contains("is-turning-next"), false);
});
