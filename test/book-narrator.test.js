import test from "node:test";
import assert from "node:assert/strict";

import {
  alignBookNarrationToPages,
  BookNarrator,
  alignmentSpanIndexAtOffset,
  alignmentSpanIndexAtTime,
  narrationChunkIndexAtOffset,
  validateBookAlignment,
} from "../src/book-narrator.js";

const chunks = [
  {
    index: 0,
    text: "First paragraph.",
    start: 0,
    end: 16,
    audio: "http://127.0.0.1/audio/0.wav",
    alignment: "http://127.0.0.1/alignment/0.json",
  },
  {
    index: 1,
    text: "Second paragraph.",
    start: 17,
    end: 34,
    audio: "http://127.0.0.1/audio/1.wav",
    alignment: "http://127.0.0.1/alignment/1.json",
  },
];

test("maps text and playback positions to narration ranges", () => {
  const spans = [
    { start: 17, end: 23, startMs: 0, endMs: 400 },
    { start: 24, end: 34, startMs: 400, endMs: 1_000 },
  ];

  assert.equal(narrationChunkIndexAtOffset(chunks, 8), 0);
  assert.equal(narrationChunkIndexAtOffset(chunks, 16), 1);
  assert.equal(alignmentSpanIndexAtOffset(spans, 25), 1);
  assert.equal(alignmentSpanIndexAtTime(spans, 650), 1);
});

test("aligns phone narration offsets to paginated TV text", () => {
  const narration = alignBookNarrationToPages(
    {
      chapterId: "chapter-1",
      language: "en-US",
      chunks: [
        {
          ...chunks[1],
          start: 200,
          end: 217,
        },
      ],
    },
    [
      { text: "First paragraph." },
      { text: "Second paragraph." },
    ],
  );

  assert.equal(narration.chunks[0].sourceStart, 200);
  assert.equal(narration.chunks[0].start, 17);
  const alignment = validateBookAlignment(
    {
      chapterId: "chapter-1",
      chunkIndex: 1,
      durationMs: 1_000,
      spans: [
        { start: 200, end: 206, startMs: 0, endMs: 400 },
      ],
    },
    "chapter-1",
    narration.chunks[0],
  );
  assert.equal(alignment.spans[0].start, 17);
  assert.equal(alignment.spans[0].end, 23);
});

test("validates global text and time alignment", () => {
  const alignment = validateBookAlignment(
    {
      chapterId: "chapter-1",
      chunkIndex: 1,
      durationMs: 1_000,
      spans: [
        { start: 17, end: 23, startMs: 0, endMs: 400 },
        { start: 24, end: 34, startMs: 400, endMs: 1_000 },
      ],
    },
    "chapter-1",
    chunks[1],
  );

  assert.equal(alignment.spans.length, 2);
  assert.throws(
    () =>
      validateBookAlignment(
        {
          chapterId: "chapter-1",
          chunkIndex: 1,
          durationMs: 1_000,
          spans: [
            { start: 10, end: 23, startMs: 0, endMs: 400 },
          ],
        },
        "chapter-1",
        chunks[1],
      ),
    /span 1 is invalid/,
  );
});

test("streams a prepared chunk and seeks by global text offset", async () => {
  const audio = new FakeAudio();
  const positions = [];
  const narrator = new BookNarrator({
    audioElement: audio,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        chapterId: "chapter-1",
        chunkIndex: 1,
        durationMs: 1_000,
        spans: [
          { start: 17, end: 23, startMs: 0, endMs: 400 },
          { start: 24, end: 34, startMs: 400, endMs: 1_000 },
        ],
      }),
    }),
    onPosition: (position) => positions.push(position),
    requestFrame: () => 1,
    cancelFrame: () => {},
  });
  narrator.setNarration(
    {
      chapterId: "chapter-1",
      language: "en-US",
      chunks,
    },
    24,
  );

  await narrator.toggle();

  assert.equal(narrator.playing, true);
  assert.equal(audio.currentTime, 0.4);
  assert.equal(positions.at(-1).start, 24);

  const resume = narrator.pauseForNavigation();
  await narrator.seekToOffset(17, { resume });

  assert.equal(narrator.playing, true);
  assert.equal(audio.currentTime, 0);
  assert.equal(positions.at(-1).start, 17);
  narrator.dispose();
});

test("does not synthesize while browsing before narration starts", async () => {
  const audio = new FakeAudio();
  let fetchCount = 0;
  const narrator = new BookNarrator({
    audioElement: audio,
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error("Narration should not be fetched");
    },
    requestFrame: () => 1,
    cancelFrame: () => {},
  });
  narrator.setNarration(
    {
      chapterId: "chapter-1",
      language: "en-US",
      chunks,
    },
    0,
  );

  assert.equal(await narrator.seekToOffset(24), true);
  assert.equal(fetchCount, 0);
  assert.equal(audio.src, "");
  narrator.dispose();
});

class FakeAudio {
  constructor() {
    this.src = "";
    this.currentTime = 0;
    this.readyState = 4;
    this.paused = true;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type) {
    this.listeners.delete(type);
  }

  removeAttribute(name) {
    if (name === "src") {
      this.src = "";
    }
  }

  load() {
    this.readyState = 4;
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}
