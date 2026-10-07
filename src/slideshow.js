export function wrapIndex(index, itemCount) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) {
    throw new RangeError("itemCount must be a positive integer");
  }

  return ((index % itemCount) + itemCount) % itemCount;
}

export class CrossfadeRenderer {
  constructor({ layers, transitionMs = 1_600, timeoutMs = 15_000 }) {
    if (!Array.isArray(layers) || layers.length !== 2) {
      throw new Error("CrossfadeRenderer requires exactly two image layers");
    }

    this.layers = layers;
    this.transitionMs = transitionMs;
    this.timeoutMs = timeoutMs;
    this.activeLayerIndex = -1;
    this.renderToken = 0;
  }

  setFit(fit) {
    for (const layer of this.layers) {
      layer.style.objectFit = fit;
    }
  }

  setTransitionDuration(transitionMs) {
    this.transitionMs = transitionMs;
    for (const layer of this.layers) {
      layer.style.setProperty("--transition-duration", `${transitionMs}ms`);
    }
  }

  async show(wallpaper) {
    const token = ++this.renderToken;
    const nextLayerIndex = this.activeLayerIndex === 0 ? 1 : 0;
    const nextLayer = this.layers[nextLayerIndex];
    const currentLayer =
      this.activeLayerIndex >= 0 ? this.layers[this.activeLayerIndex] : null;

    nextLayer.crossOrigin = "anonymous";
    nextLayer.src = wallpaper.src;
    nextLayer.alt = wallpaper.title;

    try {
      await this.#decode(nextLayer);
    } catch (error) {
      nextLayer.removeAttribute("src");
      throw new Error(`Unable to load “${wallpaper.title}”: ${error.message}`);
    }

    if (token !== this.renderToken) {
      nextLayer.removeAttribute("src");
      return false;
    }

    nextLayer.classList.add("is-visible");
    currentLayer?.classList.remove("is-visible");
    this.activeLayerIndex = nextLayerIndex;

    if (currentLayer) {
      await this.#waitForTransition();
      if (token === this.renderToken) {
        currentLayer.removeAttribute("src");
        currentLayer.alt = "";
      }
    }

    return true;
  }

  getCurrentDimensions() {
    if (this.activeLayerIndex < 0) {
      return null;
    }

    const layer = this.layers[this.activeLayerIndex];
    return {
      naturalWidth: layer.naturalWidth,
      naturalHeight: layer.naturalHeight,
    };
  }

  getCurrentImage() {
    return this.activeLayerIndex < 0
      ? null
      : this.layers[this.activeLayerIndex];
  }

  async #decode(image) {
    const imageReady =
      typeof image.decode === "function"
        ? image.decode()
        : new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error("image decode failed"));
          });

    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs,
      );
    });

    try {
      await Promise.race([imageReady, timeout]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  #waitForTransition() {
    if (this.transitionMs === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      setTimeout(resolve, this.transitionMs + 50);
    });
  }
}

export class SlideshowController {
  constructor({
    items,
    renderer,
    intervalMs,
    onChange = () => {},
    onPlaybackChange = () => {},
    onError = () => {},
  }) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("SlideshowController requires at least one wallpaper");
    }

    this.items = items;
    this.renderer = renderer;
    this.intervalMs = intervalMs;
    this.onChange = onChange;
    this.onPlaybackChange = onPlaybackChange;
    this.onError = onError;
    this.currentIndex = 0;
    this.requestedIndex = 0;
    this.playing = false;
    this.timerId = null;
    this.navigationQueue = Promise.resolve();
  }

  async start(index = 0) {
    this.currentIndex = wrapIndex(index, this.items.length);
    this.requestedIndex = this.currentIndex;
    this.playing = true;
    this.onPlaybackChange(this.playing);
    await this.#displayCurrent();
    this.#schedule();
  }

  async next() {
    return this.goTo(this.requestedIndex + 1);
  }

  async previous() {
    return this.goTo(this.requestedIndex - 1);
  }

  goTo(index) {
    const nextIndex = wrapIndex(index, this.items.length);
    this.requestedIndex = nextIndex;
    this.#clearTimer();

    const navigate = async () => {
      try {
        const rendered = await this.renderer.show(this.items[nextIndex]);
        if (!rendered) {
          return false;
        }

        this.currentIndex = nextIndex;
        this.onChange(this.current, this.currentIndex);
        this.#schedule();
        return true;
      } catch (error) {
        this.onError(error);
        this.#schedule();
        return false;
      }
    };

    const operation = this.navigationQueue.then(navigate, navigate);
    this.navigationQueue = operation.catch(() => {});
    return operation;
  }

  togglePlayback() {
    this.playing = !this.playing;
    this.onPlaybackChange(this.playing);
    if (this.playing) {
      this.#schedule();
    } else {
      this.#clearTimer();
    }
    return this.playing;
  }

  setInterval(intervalMs) {
    this.intervalMs = intervalMs;
    this.#schedule();
  }

  stop() {
    this.playing = false;
    this.#clearTimer();
    this.onPlaybackChange(this.playing);
  }

  get current() {
    return this.items[this.currentIndex];
  }

  async #displayCurrent() {
    try {
      await this.renderer.show(this.current);
      this.onChange(this.current, this.currentIndex);
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  #schedule() {
    this.#clearTimer();
    if (!this.playing) {
      return;
    }

    this.timerId = setTimeout(() => {
      void this.next();
    }, this.intervalMs);
  }

  #clearTimer() {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}
