import test from "node:test";
import assert from "node:assert/strict";

import {
  BING_ARCHIVE_ENDPOINT,
  BingWallpaperProvider,
  MotivationProvider,
  normalizeBingPayload,
  parseMotivationJsonl,
  resolveBingMetadataEndpoint,
} from "../src/wallpapers.js";

const eligible = {
  startdate: "20261006",
  url: "/th?id=OHR.Example_EN-US123_1920x1080.jpg&pid=hp",
  copyright: "Example landscape (© Example Photographer/Getty Images)",
  copyrightlink: "https://www.bing.com/search?q=example",
  title: "Example title",
  wp: true,
  hsh: "abc123",
};

test("normalizes eligible Bing wallpaper metadata", () => {
  const [wallpaper] = normalizeBingPayload({ images: [eligible] });

  assert.equal(wallpaper.source, "Bing");
  assert.equal(wallpaper.title, "Example title");
  assert.equal(
    wallpaper.credit,
    "Example landscape (© Example Photographer/Getty Images)",
  );
  assert.match(wallpaper.src, /^https:\/\/www\.bing\.com\/th\?/);
});

test("filters images not licensed for wallpaper use", () => {
  const wallpapers = normalizeBingPayload({
    images: [eligible, { ...eligible, startdate: "20261005", wp: false }],
  });

  assert.equal(wallpapers.length, 1);
});

test("rejects malformed feed responses", () => {
  assert.throws(
    () => normalizeBingPayload({ images: [{ ...eligible, url: "https://example.com/image.jpg" }] }),
    /unexpected image URL/,
  );
  assert.throws(() => normalizeBingPayload({}), /invalid wallpaper response/);
});

test("uses a local metadata proxy only during desktop development", () => {
  assert.equal(
    resolveBingMetadataEndpoint({
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:8080",
    }),
    "http://127.0.0.1:8080/api/bing",
  );
  assert.equal(
    resolveBingMetadataEndpoint({
      hostname: "",
      origin: "file://",
    }),
    BING_ARCHIVE_ENDPOINT,
  );
});

test("motivation provider returns original local quote artwork", async () => {
  const catalog = [
    {
      id: "small-steps",
      text: "Small steps, kept daily,\nbecome distant horizons.",
      author: "MyTV Art community",
      license: "CC0-1.0",
    },
  ]
    .map(JSON.stringify)
    .join("\n");
  const wallpapers = await new MotivationProvider({
    fetchImpl: async () => ({
      ok: true,
      text: async () => catalog,
    }),
    random: () => 0.5,
  }).list();

  assert.equal(wallpapers.length, 1);
  assert.equal(wallpapers[0].source, "Motivation");
  assert.match(wallpapers[0].src, /^data:image\/svg\+xml/);
  assert.equal(
    wallpapers[0].credit,
    "MyTV Art community · CC0-1.0",
  );
});

test("motivation parser reports line-numbered validation errors", () => {
  const quote = {
    id: "same-id",
    text: "A valid line",
    author: "Contributor",
    license: "CC-BY-4.0",
  };

  assert.throws(
    () =>
      parseMotivationJsonl(
        `${JSON.stringify(quote)}\n${JSON.stringify(quote)}`,
      ),
    /line 2: duplicate id/,
  );
  assert.throws(
    () => parseMotivationJsonl(`${JSON.stringify(quote)}\n{broken`),
    /line 2: invalid JSON/,
  );
});

test("motivation artwork escapes contributed markup", async () => {
  const catalog = JSON.stringify({
    id: "escaped-text",
    text: "Keep <moving> & growing",
    author: "Contributor",
    license: "CC0-1.0",
  });
  const [wallpaper] = await new MotivationProvider({
    fetchImpl: async () => ({
      ok: true,
      text: async () => catalog,
    }),
  }).list();
  const svg = decodeURIComponent(wallpaper.src.split(",")[1]);

  assert.match(svg, /Keep &lt;moving&gt; &amp; growing/);
  assert.doesNotMatch(svg, /Keep <moving>/);
});

test("motivation provider shuffles quotes without repeating them", async () => {
  const catalog = ["first", "second", "third"]
    .map((id) =>
      JSON.stringify({
        id,
        text: `Quote ${id}`,
        author: "Contributor",
        license: "CC0-1.0",
      }),
    )
    .join("\n");
  const wallpapers = await new MotivationProvider({
    fetchImpl: async () => ({
      ok: true,
      text: async () => catalog,
    }),
    random: () => 0,
  }).list();

  assert.deepEqual(
    wallpapers.map((wallpaper) => wallpaper.id),
    ["motivation-second", "motivation-third", "motivation-first"],
  );
  assert.equal(new Set(wallpapers.map((wallpaper) => wallpaper.id)).size, 3);
});

test("motivation parser accepts optional safe images", () => {
  const [local, remote] = parseMotivationJsonl(
    [
      {
        id: "local-image",
        text: "Local background",
        author: "Contributor",
        license: "CC0-1.0",
        image: "assets/quotes/images/background.jpg",
      },
      {
        id: "remote-image",
        text: "Remote background",
        author: "Contributor",
        license: "CC-BY-4.0",
        image: "https://example.com/background.jpg",
      },
    ]
      .map(JSON.stringify)
      .join("\n"),
  );

  assert.equal(local.image, "assets/quotes/images/background.jpg");
  assert.equal(remote.image, "https://example.com/background.jpg");
  assert.throws(
    () =>
      parseMotivationJsonl(
        JSON.stringify({
          id: "unsafe-image",
          text: "Unsafe background",
          author: "Contributor",
          license: "CC0-1.0",
          image: "javascript:alert(1)",
        }),
      ),
    /image must use HTTPS/,
  );
});

test("motivation quotes may have an empty author", async () => {
  const catalog = JSON.stringify({
    id: "anonymous-quote",
    text: "Anonymous words",
    author: "",
    license: "CC0-1.0",
  });
  const [wallpaper] = await new MotivationProvider({
    fetchImpl: async () => ({
      ok: true,
      text: async () => catalog,
    }),
    random: () => 0.5,
  }).list();

  assert.equal(wallpaper.credit, "CC0-1.0");
});

test("Bing provider merges both supported archive windows", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const index = new URL(url).searchParams.get("idx");
    requests.push(index);
    return {
      ok: true,
      async json() {
        return {
          images: [
            {
              ...eligible,
              startdate: index === "0" ? "20261006" : "20260929",
              hsh: `hash-${index}`,
            },
          ],
        };
      },
    };
  };
  const provider = new BingWallpaperProvider({
    cache: { supported: false },
    fetchImpl,
    metadataEndpoint: BING_ARCHIVE_ENDPOINT,
  });

  const wallpapers = await provider.list();

  assert.deepEqual(requests, ["0", "7"]);
  assert.deepEqual(
    wallpapers.map((wallpaper) => wallpaper.startDate),
    ["20261006", "20260929"],
  );
});
