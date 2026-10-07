export const BING_ORIGIN = "https://www.bing.com";
export const BING_ARCHIVE_ENDPOINT =
  `${BING_ORIGIN}/HPImageArchive.aspx?format=js&idx=0&n=8`;
export const BING_ARCHIVE_INDICES = [0, 7];
export const BING_HISTORY_LIMIT = 30;

function normalizeMarket(market) {
  return /^[a-z]{2}-[A-Z]{2}$/.test(market) ? market : "en-US";
}

function normalizeBingImage(entry) {
  if (!entry || entry.wp !== true) {
    return null;
  }

  const imageUrl = new URL(entry.url, BING_ORIGIN);
  if (
    imageUrl.protocol !== "https:" ||
    imageUrl.hostname !== "www.bing.com" ||
    !imageUrl.pathname.startsWith("/th")
  ) {
    throw new Error("Bing returned an unexpected image URL");
  }

  if (!entry.startdate || !entry.copyright) {
    throw new Error("Bing wallpaper metadata is incomplete");
  }

  return {
    id: `bing-${entry.startdate}-${entry.hsh ?? imageUrl.searchParams.get("id")}`,
    src: imageUrl.href,
    networkUrl: imageUrl.href,
    title: entry.title || "Bing daily wallpaper",
    collection: "Bing Wallpaper",
    credit: entry.copyright,
    copyrightLink: entry.copyrightlink || null,
    startDate: entry.startdate,
    source: "Bing",
    cached: false,
  };
}

export function normalizeBingPayload(payload) {
  if (!payload || !Array.isArray(payload.images)) {
    throw new Error("Bing returned an invalid wallpaper response");
  }

  return payload.images.map(normalizeBingImage).filter(Boolean);
}

export function resolveBingMetadataEndpoint(location = globalThis.location) {
  const isLocalDevelopment =
    location &&
    (location.hostname === "127.0.0.1" || location.hostname === "localhost");

  if (isLocalDevelopment) {
    return new URL("/api/bing", location.origin).href;
  }

  return BING_ARCHIVE_ENDPOINT;
}

export class BingWallpaperProvider {
  constructor({
    cache,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    market = normalizeMarket(globalThis.navigator?.language),
    metadataEndpoint = resolveBingMetadataEndpoint(),
    onWarning = () => {},
  } = {}) {
    if (!fetchImpl) {
      throw new Error("Bing wallpapers require the Fetch API");
    }

    this.cache = cache;
    this.fetchImpl = fetchImpl;
    this.market = normalizeMarket(market);
    this.metadataEndpoint = metadataEndpoint;
    this.onWarning = onWarning;
  }

  async list() {
    const cachedWallpapers = await this.#readCache();

    try {
      const payloads = await Promise.all(
        BING_ARCHIVE_INDICES.map(async (index) => {
          const response = await this.fetchImpl(
            this.#buildMetadataUrl(index),
            { cache: "no-store" },
          );
          if (!response.ok) {
            throw new Error(
              `Bing metadata request failed with HTTP ${response.status}`,
            );
          }
          return response.json();
        }),
      );

      const liveWallpapers = [
        ...new Map(
          payloads
            .flatMap(normalizeBingPayload)
            .map((wallpaper) => [wallpaper.id, wallpaper]),
        ).values(),
      ];
      if (liveWallpapers.length === 0) {
        throw new Error("Bing returned no wallpaper-eligible images");
      }

      const cachedById = new Map(
        cachedWallpapers.map((wallpaper) => [wallpaper.id, wallpaper]),
      );
      for (const wallpaper of liveWallpapers) {
        const cached = cachedById.get(wallpaper.id);
        if (cached) {
          wallpaper.src = cached.src;
          wallpaper.cached = true;
        }
      }

      const wallpapers = [
        ...new Map(
          [...liveWallpapers, ...cachedWallpapers].map((wallpaper) => [
            wallpaper.id,
            wallpaper,
          ]),
        ).values(),
      ]
        .sort((left, right) =>
          String(right.startDate).localeCompare(String(left.startDate)),
        )
        .slice(0, BING_HISTORY_LIMIT);

      void this.#cacheWallpapers(wallpapers);
      return wallpapers;
    } catch (error) {
      if (cachedWallpapers.length > 0) {
        this.onWarning(`Bing is offline; showing cached wallpapers. ${error.message}`);
        return cachedWallpapers;
      }
      throw error;
    }
  }

  dispose() {
    this.cache?.dispose();
  }

  #buildMetadataUrl(index) {
    const url = new URL(this.metadataEndpoint);
    url.searchParams.set("mkt", this.market);
    url.searchParams.set("idx", String(index));
    url.searchParams.set("n", "8");
    return url.href;
  }

  async #readCache() {
    if (!this.cache?.supported) {
      return [];
    }

    try {
      return await this.cache.list();
    } catch (error) {
      this.onWarning(error.message);
      return [];
    }
  }

  async #cacheWallpapers(wallpapers) {
    if (!this.cache?.supported) {
      return;
    }

    try {
      for (const wallpaper of wallpapers) {
        if (wallpaper.cached) {
          continue;
        }

        const response = await this.fetchImpl(wallpaper.networkUrl, {
          cache: "force-cache",
        });
        if (!response.ok) {
          throw new Error(
            `Bing image cache failed with HTTP ${response.status}`,
          );
        }

        const blob = await response.blob();
        if (!blob.type.startsWith("image/") || blob.size > 10 * 1024 * 1024) {
          throw new Error("Bing returned an invalid wallpaper image");
        }

        await this.cache.put(wallpaper, blob);
        const objectUrl = this.cache.createObjectUrl(blob);
        if (objectUrl) {
          wallpaper.src = objectUrl;
          wallpaper.cached = true;
        }
      }

      await this.cache.prune(
        new Set(wallpapers.map((wallpaper) => wallpaper.id)),
      );
    } catch (error) {
      this.onWarning(`Wallpaper caching stopped: ${error.message}`);
    }
  }
}

export class BundledWallpaperProvider {
  constructor(basePath = "assets/wallpapers") {
    this.basePath = basePath.replace(/\/$/, "");
  }

  async list() {
    return [
      {
        id: "aurora-glass",
        src: `${this.basePath}/aurora-glass.svg`,
        title: "Aurora Glass",
        collection: "Chromatic Atmospheres",
        credit: "Original artwork · MyTV Art",
        source: "MyTV Art",
      },
      {
        id: "quiet-dunes",
        src: `${this.basePath}/quiet-dunes.svg`,
        title: "Quiet Dunes",
        collection: "Desert Light",
        credit: "Original artwork · MyTV Art",
        source: "MyTV Art",
      },
      {
        id: "midnight-orbit",
        src: `${this.basePath}/midnight-orbit.svg`,
        title: "Midnight Orbit",
        collection: "Night Studies",
        credit: "Original artwork · MyTV Art",
        source: "MyTV Art",
      },
      {
        id: "coastal-mist",
        src: `${this.basePath}/coastal-mist.svg`,
        title: "Coastal Mist",
        collection: "Soft Horizons",
        credit: "Original artwork · MyTV Art",
        source: "MyTV Art",
      },
    ];
  }
}

const QUOTE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const QUOTE_LICENSES = new Set(["CC0-1.0", "CC-BY-4.0"]);
const QUOTE_PALETTES = [
  ["#07182b", "#1f736c", "#8ee7c7"],
  ["#24132f", "#854f78", "#f1b680"],
  ["#071c2a", "#1e5670", "#a9d6c5"],
  ["#2b1820", "#9a5548", "#f3c987"],
  ["#10162b", "#414d84", "#c2bbef"],
  ["#10251f", "#48775c", "#d1df9b"],
  ["#172034", "#536f92", "#d9c4b2"],
  ["#241b14", "#805f3b", "#eed49f"],
];

function quoteError(lineNumber, message) {
  return new Error(`Invalid motivation quote at line ${lineNumber}: ${message}`);
}

export function parseMotivationJsonl(source) {
  if (typeof source !== "string") {
    throw new TypeError("Motivation catalog must be text");
  }

  const quotes = [];
  const ids = new Set();

  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let quote;
    try {
      quote = JSON.parse(line);
    } catch (error) {
      throw quoteError(lineNumber, `invalid JSON: ${error.message}`);
    }

    if (!QUOTE_ID_PATTERN.test(quote.id ?? "")) {
      throw quoteError(lineNumber, "id must be unique lowercase kebab-case");
    }
    if (ids.has(quote.id)) {
      throw quoteError(lineNumber, `duplicate id "${quote.id}"`);
    }
    if (typeof quote.text !== "string" || quote.text.trim().length === 0) {
      throw quoteError(lineNumber, "text is required");
    }

    const lines = quote.text.split(/\r?\n/).map((text) => text.trim());
    if (lines.length < 1 || lines.length > 3) {
      throw quoteError(lineNumber, "text must contain one to three lines");
    }
    if (lines.some((text) => text.length === 0 || text.length > 80)) {
      throw quoteError(
        lineNumber,
        "each display line must contain 1 to 80 characters",
      );
    }
    if (
      typeof quote.author !== "string" ||
      quote.author.trim().length > 120
    ) {
      throw quoteError(lineNumber, "author must be a string up to 120 characters");
    }
    if (!QUOTE_LICENSES.has(quote.license)) {
      throw quoteError(
        lineNumber,
        "license must be CC0-1.0 or CC-BY-4.0",
      );
    }
    const image = normalizeQuoteImage(quote.image, lineNumber);

    ids.add(quote.id);
    quotes.push({
      id: quote.id,
      lines,
      author: quote.author.trim(),
      license: quote.license,
      image,
    });
  }

  if (quotes.length === 0) {
    throw new Error("Motivation catalog contains no quotes");
  }

  return quotes;
}

function normalizeQuoteImage(image, lineNumber) {
  if (image === undefined || image === null || image === "") {
    return null;
  }
  if (typeof image !== "string" || image.length > 500) {
    throw quoteError(lineNumber, "image must be a valid path or HTTPS URL");
  }

  if (/^https:\/\/[^ ]+$/i.test(image)) {
    return image;
  }
  if (
    /^assets\/quotes\/images\/[a-zA-Z0-9/_-]+\.(?:jpe?g|png|webp|svg)$/.test(
      image,
    ) &&
    !image.includes("..")
  ) {
    return image;
  }

  throw quoteError(
    lineNumber,
    "image must use HTTPS or assets/quotes/images/",
  );
}

function escapeXml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  );
}

function paletteForId(id) {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return QUOTE_PALETTES[hash % QUOTE_PALETTES.length];
}

function createQuoteSvg(quote) {
  const palette = paletteForId(quote.id);
  const text = quote.lines
    .map(
      (line, index) =>
        `<tspan x="960" dy="${index === 0 ? 0 : 92}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const background = quote.image
    ? `<image href="${escapeXml(quote.image)}" width="1920" height="1080" preserveAspectRatio="xMidYMid slice"/>
       <rect width="1920" height="1080" fill="#071018" opacity=".42"/>`
    : `<rect width="1920" height="1080" fill="url(#bg)"/>
       <circle cx="1450" cy="210" r="620" fill="url(#light)"/>
       <path d="M0 870c356-168 679-139 973-25 293 114 589 112 947-42v277H0Z" fill="#02050a" opacity=".22"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${palette[0]}"/>
        <stop offset=".62" stop-color="${palette[1]}"/>
        <stop offset="1" stop-color="${palette[2]}"/>
      </linearGradient>
      <radialGradient id="light">
        <stop offset="0" stop-color="#fff" stop-opacity=".24"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    ${background}
    <text x="960" y="475" fill="#fff" font-family="Helvetica Neue,Arial,sans-serif" font-size="74" font-weight="500" text-anchor="middle" letter-spacing="-1">${text}</text>
    <text x="960" y="710" fill="#fff" opacity=".62" font-family="Helvetica Neue,Arial,sans-serif" font-size="22" text-anchor="middle" letter-spacing="5">MYTV ART · DAILY MOTIVATION</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export class MotivationProvider {
  constructor({
    catalogUrl = "assets/quotes/motivation.jsonl",
    fetchImpl = globalThis.fetch?.bind(globalThis),
    random = Math.random,
  } = {}) {
    if (!fetchImpl) {
      throw new Error("Motivation quotes require the Fetch API");
    }
    this.catalogUrl = catalogUrl;
    this.fetchImpl = fetchImpl;
    this.random = random;
  }

  async list() {
    const response = await this.fetchImpl(this.catalogUrl, {
      cache: "no-cache",
    });
    if (!response.ok) {
      throw new Error(
        `Motivation catalog request failed with HTTP ${response.status}`,
      );
    }

    const wallpapers = parseMotivationJsonl(await response.text()).map((quote) => ({
      id: `motivation-${quote.id}`,
      src: createQuoteSvg(quote),
      title: quote.lines.join(" "),
      collection: "Daily Motivation",
      credit: [quote.author, quote.license].filter(Boolean).join(" · "),
      source: "Motivation",
      cached: true,
    }));
    return shuffle(wallpapers, this.random);
  }
}

function shuffle(items, random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [
      shuffled[target],
      shuffled[index],
    ];
  }
  return shuffled;
}
