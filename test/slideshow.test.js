import test from "node:test";
import assert from "node:assert/strict";

import { SlideshowController, wrapIndex } from "../src/slideshow.js";

test("wrapIndex advances and wraps forward", () => {
  assert.equal(wrapIndex(4, 4), 0);
  assert.equal(wrapIndex(5, 4), 1);
});

test("wrapIndex wraps backward", () => {
  assert.equal(wrapIndex(-1, 4), 3);
  assert.equal(wrapIndex(-5, 4), 3);
});

test("wrapIndex rejects an empty collection", () => {
  assert.throws(() => wrapIndex(0, 0), /positive integer/);
});

test("rapid navigation is serialized and preserves every key press", async () => {
  const rendered = [];
  const renderer = {
    async show(item) {
      await Promise.resolve();
      rendered.push(item.id);
      return true;
    },
  };
  const slideshow = new SlideshowController({
    items: [{ id: "one" }, { id: "two" }, { id: "three" }],
    renderer,
    intervalMs: 60_000,
  });

  await slideshow.start();
  slideshow.stop();
  const first = slideshow.next();
  const second = slideshow.next();
  await Promise.all([first, second]);
  slideshow.stop();

  assert.deepEqual(rendered, ["one", "two", "three"]);
  assert.equal(slideshow.current.id, "three");
});
