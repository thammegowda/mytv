export function validateBookAlignment(
  payload,
  chapterId,
  chunk,
) {
  const sourceStart = chunk.sourceStart ?? chunk.start;
  const sourceEnd = chunk.sourceEnd ?? chunk.end;
  const offsetDelta = chunk.start - sourceStart;
  if (
    !payload ||
    payload.chapterId !== chapterId ||
    payload.chunkIndex !== chunk.index ||
    !Number.isFinite(payload.durationMs) ||
    payload.durationMs <= 0 ||
    !Array.isArray(payload.spans)
  ) {
    throw new Error("Book narration alignment is invalid");
  }

  let previousTextEnd = sourceStart;
  let previousTime = 0;
  const spans = payload.spans.map((candidate, index) => {
    const context = `Narration alignment span ${index + 1}`;
    if (
      !Number.isInteger(candidate?.start) ||
      !Number.isInteger(candidate?.end) ||
      !Number.isFinite(candidate?.startMs) ||
      !Number.isFinite(candidate?.endMs) ||
      candidate.start < sourceStart ||
      candidate.start < previousTextEnd ||
      candidate.end <= candidate.start ||
      candidate.end > sourceEnd ||
      candidate.startMs < previousTime ||
      candidate.endMs <= candidate.startMs ||
      candidate.endMs > payload.durationMs + 1
    ) {
      throw new Error(`${context} is invalid`);
    }
    previousTextEnd = candidate.end;
    previousTime = candidate.startMs;
    return {
      start: candidate.start + offsetDelta,
      end: candidate.end + offsetDelta,
      startMs: candidate.startMs,
      endMs: candidate.endMs,
    };
  });

  return {
    chapterId,
    chunkIndex: chunk.index,
    durationMs: payload.durationMs,
    spans,
  };
}

export function alignBookNarrationToPages(narration, pages) {
  if (!narration?.chunks?.length || !Array.isArray(pages)) {
    return null;
  }
  const pageText = pages.map((page) => page.text).join(" ");
  let cursor = 0;
  const chunks = narration.chunks.map((chunk) => {
    const mappedStart = pageText.indexOf(chunk.text, cursor);
    if (mappedStart < 0) {
      throw new Error(
        `Narration chunk ${chunk.index + 1} does not match paginated text`,
      );
    }
    const mappedEnd = mappedStart + chunk.text.length;
    cursor = mappedEnd;
    return {
      ...chunk,
      sourceStart: chunk.start,
      sourceEnd: chunk.end,
      start: mappedStart,
      end: mappedEnd,
    };
  });
  return {
    ...narration,
    chunks,
  };
}

export function narrationChunkIndexAtOffset(chunks, textOffset) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return -1;
  }
  const safeOffset = Number.isFinite(textOffset) ? textOffset : 0;
  const containing = chunks.findIndex(
    (chunk) => safeOffset >= chunk.start && safeOffset < chunk.end,
  );
  if (containing >= 0) {
    return containing;
  }
  const next = chunks.findIndex((chunk) => chunk.start >= safeOffset);
  return next >= 0 ? next : chunks.length - 1;
}

export function alignmentSpanIndexAtOffset(spans, textOffset) {
  if (!Array.isArray(spans) || spans.length === 0) {
    return -1;
  }
  const containing = spans.findIndex(
    (span) => textOffset >= span.start && textOffset < span.end,
  );
  if (containing >= 0) {
    return containing;
  }
  const next = spans.findIndex((span) => span.start >= textOffset);
  return next >= 0 ? next : spans.length - 1;
}

export function alignmentSpanIndexAtTime(spans, timeMillis) {
  if (!Array.isArray(spans) || spans.length === 0) {
    return -1;
  }
  const safeTime = Math.max(Number.isFinite(timeMillis) ? timeMillis : 0, 0);
  let low = 0;
  let high = spans.length - 1;
  let best = 0;
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    if (spans[midpoint].startMs <= safeTime) {
      best = midpoint;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }
  return best;
}

export function clearBookNarrationHighlight(documentRef = globalThis.document) {
  documentRef?.getSelection?.()?.removeAllRanges();
}

export function highlightBookTextRange(
  pageElement,
  start,
  end,
  documentRef = globalThis.document,
) {
  const content = pageElement?.querySelector?.(".book-page-content");
  if (!content || !documentRef?.createTreeWalker || end <= start) {
    clearBookNarrationHighlight(documentRef);
    return false;
  }

  const points = [];
  let pendingSpace = false;
  const walker = documentRef.createTreeWalker(
    content,
    globalThis.NodeFilter?.SHOW_TEXT ?? 4,
  );
  let node = walker.nextNode();
  while (node) {
    const raw = node.nodeValue ?? "";
    for (let index = 0; index < raw.length; index += 1) {
      if (/\s/.test(raw[index])) {
        pendingSpace = true;
        continue;
      }
      if (pendingSpace && points.length > 0) {
        points.push({ node, offset: index });
      }
      points.push({ node, offset: index });
      pendingSpace = false;
    }
    node = walker.nextNode();
  }

  if (start < 0 || end > points.length || end <= start) {
    clearBookNarrationHighlight(documentRef);
    return false;
  }
  const first = points[start];
  const last = points[end - 1];
  const range = documentRef.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  const selection = documentRef.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export class BookNarrator {
  constructor({
    audioElement,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    onPosition = () => {},
    onStateChange = () => {},
    onChapterEnd = () => {},
    onError = () => {},
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
    cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  }) {
    if (!audioElement || !fetchImpl) {
      throw new Error("BookNarrator requires audio and Fetch APIs");
    }
    this.audio = audioElement;
    this.fetchImpl = fetchImpl;
    this.onPosition = onPosition;
    this.onStateChange = onStateChange;
    this.onChapterEnd = onChapterEnd;
    this.onError = onError;
    this.requestFrame =
      requestFrame ?? ((callback) => setTimeout(callback, 100));
    this.cancelFrame = cancelFrame ?? clearTimeout;
    this.narration = null;
    this.chunkIndex = -1;
    this.desiredOffset = 0;
    this.currentAlignment = null;
    this.currentSpanIndex = -1;
    this.preparedKey = "";
    this.generation = 0;
    this.frameId = null;
    this.status = "idle";
    this.activated = false;
    this.speechRate = 1;
    this.alignmentCache = new Map();

    this.handleEnded = () => {
      void this.#advanceChunk();
    };
    this.handleError = () => {
      if (this.status === "playing") {
        this.#fail(new Error("Unable to play streamed narration"));
      }
    };
    this.audio.addEventListener("ended", this.handleEnded);
    this.audio.addEventListener("error", this.handleError);
  }

  get available() {
    return Boolean(this.narration?.chunks?.length);
  }

  get playing() {
    return this.status === "playing";
  }

  setNarration(narration, textOffset = 0) {
    this.#resetAudio();
    this.narration = narration?.chunks?.length ? narration : null;
    this.activated = false;
    this.desiredOffset = Math.max(textOffset, 0);
    this.chunkIndex = this.narration
      ? narrationChunkIndexAtOffset(
          this.narration.chunks,
          this.desiredOffset,
        )
      : -1;
    this.#setStatus(this.available ? "ready" : "unavailable");
  }

  async toggle() {
    if (!this.available) {
      return false;
    }
    if (this.playing) {
      this.pause();
      return true;
    }
    this.activated = true;
    await this.#startPlayback();
    return true;
  }

  pause() {
    if (!this.playing && this.status !== "loading") {
      return false;
    }
    this.generation += 1;
    this.audio.pause();
    this.#cancelTicker();
    this.#setStatus("paused");
    return true;
  }

  pauseForNavigation() {
    const resume = this.playing;
    if (resume || this.status === "loading") {
      this.pause();
    }
    return resume;
  }

  async seekToOffset(textOffset, { resume = false } = {}) {
    if (!this.available) {
      return false;
    }
    this.desiredOffset = Math.max(textOffset, 0);
    const nextChunkIndex = narrationChunkIndexAtOffset(
      this.narration.chunks,
      this.desiredOffset,
    );
    const chunkChanged = nextChunkIndex !== this.chunkIndex;
    if (chunkChanged) {
      this.audio.pause();
      this.#cancelTicker();
      this.chunkIndex = nextChunkIndex;
      this.preparedKey = "";
      this.currentAlignment = null;
      this.currentSpanIndex = -1;
    }
    if (!this.activated && !resume) {
      this.#setStatus("ready");
      return true;
    }

    try {
      const prepared = await this.#prepareCurrentChunk();
      if (!prepared) {
        return false;
      }
      await this.#seekPreparedAudio(this.desiredOffset);
      this.#publishCurrentSpan();
      if (resume) {
        await this.audio.play();
        this.#setStatus("playing");
        this.#startTicker();
      } else {
        this.#setStatus("paused");
      }
      return true;
    } catch (error) {
      this.#fail(error);
      return false;
    }
  }

  stop() {
    this.#resetAudio();
    this.narration = null;
    this.activated = false;
    this.chunkIndex = -1;
    this.#setStatus("idle");
    this.onPosition(null);
  }

  dispose() {
    this.stop();
    this.audio.removeEventListener("ended", this.handleEnded);
    this.audio.removeEventListener("error", this.handleError);
  }

  async #startPlayback() {
    try {
      const prepared = await this.#prepareCurrentChunk();
      if (!prepared) {
        return;
      }
      await this.#seekPreparedAudio(this.desiredOffset);
      this.#publishCurrentSpan();
      await this.audio.play();
      this.#setStatus("playing");
      this.#startTicker();
      this.#prefetchNextAlignment();
    } catch (error) {
      this.#fail(error);
    }
  }

  async #prepareCurrentChunk() {
    const chunk = this.narration?.chunks?.[this.chunkIndex];
    if (!chunk) {
      throw new Error("Narration chunk is unavailable");
    }
    const preparedKey = `${this.chunkIndex}:${this.speechRate}`;
    if (
      this.preparedKey === preparedKey &&
      this.currentAlignment &&
      this.audio.src
    ) {
      return true;
    }

    const generation = ++this.generation;
    this.#setStatus("loading");
    const alignment = await this.#loadAlignment(chunk);
    if (generation !== this.generation) {
      return false;
    }
    this.currentAlignment = alignment;
    this.currentSpanIndex = -1;
    this.audio.src = withSpeechRate(chunk.audio, this.speechRate);
    this.audio.load();
    await waitForMediaReady(this.audio);
    if (generation !== this.generation) {
      return false;
    }
    this.preparedKey = preparedKey;
    this.#setStatus("ready");
    return true;
  }

  async #loadAlignment(chunk) {
    const url = withSpeechRate(chunk.alignment, this.speechRate);
    const chapterId = this.narration.chapterId;
    if (!this.alignmentCache.has(url)) {
      this.alignmentCache.set(
        url,
        this.fetchImpl(url, {
          cache: "no-cache",
          headers: { Accept: "application/json" },
        })
          .then(async (response) => {
            if (!response.ok) {
              throw new Error(
                `Narration alignment failed with HTTP ${response.status}`,
              );
            }
            return validateBookAlignment(
              await response.json(),
              chapterId,
              chunk,
            );
          })
          .catch((error) => {
            this.alignmentCache.delete(url);
            throw error;
          }),
      );
    }
    return this.alignmentCache.get(url);
  }

  async #seekPreparedAudio(textOffset) {
    const spans = this.currentAlignment?.spans ?? [];
    const spanIndex = alignmentSpanIndexAtOffset(spans, textOffset);
    this.currentSpanIndex = spanIndex;
    const startMillis = spans[spanIndex]?.startMs ?? 0;
    const durationMillis = this.currentAlignment?.durationMs ?? 0;
    const targetSeconds =
      Math.min(startMillis, Math.max(durationMillis - 1, 0)) / 1_000;
    await seekMedia(this.audio, targetSeconds);
  }

  #startTicker() {
    this.#cancelTicker();
    const tick = () => {
      if (!this.playing) {
        return;
      }
      const spans = this.currentAlignment?.spans ?? [];
      const spanIndex = alignmentSpanIndexAtTime(
        spans,
        this.audio.currentTime * 1_000,
      );
      if (spanIndex !== this.currentSpanIndex) {
        this.currentSpanIndex = spanIndex;
        this.#publishCurrentSpan();
      }
      this.frameId = this.requestFrame(tick);
    };
    this.frameId = this.requestFrame(tick);
  }

  #cancelTicker() {
    if (this.frameId != null) {
      this.cancelFrame(this.frameId);
      this.frameId = null;
    }
  }

  #publishCurrentSpan() {
    const span = this.currentAlignment?.spans?.[this.currentSpanIndex];
    if (span) {
      this.desiredOffset = span.start;
      this.onPosition(span);
    }
  }

  async #advanceChunk() {
    this.#cancelTicker();
    if (
      !this.narration ||
      this.chunkIndex >= this.narration.chunks.length - 1
    ) {
      this.#setStatus("ended");
      this.onPosition(null);
      try {
        await this.onChapterEnd();
      } catch (error) {
        this.#fail(error);
      }
      return;
    }

    this.chunkIndex += 1;
    this.desiredOffset = this.narration.chunks[this.chunkIndex].start;
    this.preparedKey = "";
    this.currentAlignment = null;
    this.currentSpanIndex = -1;
    await this.#startPlayback();
  }

  #prefetchNextAlignment() {
    const nextChunk = this.narration?.chunks?.[this.chunkIndex + 1];
    if (nextChunk) {
      void this.#loadAlignment(nextChunk).catch((error) => {
        console.warn("Unable to prefetch narration alignment", error);
      });
    }
  }

  #resetAudio() {
    this.generation += 1;
    this.#cancelTicker();
    this.status = "idle";
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.preparedKey = "";
    this.currentAlignment = null;
    this.currentSpanIndex = -1;
  }

  #setStatus(status) {
    this.status = status;
    this.onStateChange({
      status,
      chunkIndex: this.chunkIndex,
      chunkCount: this.narration?.chunks?.length ?? 0,
    });
  }

  #fail(error) {
    this.audio.pause();
    this.#cancelTicker();
    this.#setStatus("error");
    this.onError(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

function withSpeechRate(url, speechRate) {
  const parsed = new URL(url, globalThis.location?.href);
  parsed.searchParams.set("rate", String(speechRate));
  return parsed.href;
}

function waitForMediaReady(audio) {
  if (audio.readyState >= 3) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let timeoutId;
    const cleanup = () => {
      clearTimeout(timeoutId);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Unable to load streamed narration audio"));
    };
    audio.addEventListener("canplay", onReady);
    audio.addEventListener("error", onError);
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Streamed narration audio timed out"));
    }, 30_000);
  });
}

function seekMedia(audio, targetSeconds) {
  if (Math.abs(audio.currentTime - targetSeconds) < 0.02) {
    return Promise.resolve();
  }
  if (!audio.seekable) {
    audio.currentTime = targetSeconds;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let timeoutId;
    const cleanup = () => {
      clearTimeout(timeoutId);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Unable to seek streamed narration audio"));
    };
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("error", onError);
    audio.currentTime = targetSeconds;
    timeoutId = setTimeout(() => {
      cleanup();
      if (Math.abs(audio.currentTime - targetSeconds) < 0.25) {
        resolve();
      } else {
        reject(new Error("Streamed narration seek timed out"));
      }
    }, 5_000);
  });
}
