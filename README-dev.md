# MyTV Art developer guide

MyTV Art is a dependency-free Tizen web application targeting Samsung TVs running Tizen 6.5 or newer. The primary test device is a 2023 QN85C running Tizen 7.

## Architecture

```text
assets/wallpapers/     Original offline artwork
assets/quotes/         Community quote JSONL catalog and contribution guide
scripts/dev-server.mjs Local Bing metadata development proxy
scripts/install-tizen-sdk.sh
src/app.js             UI, tabs, source switching, and lifecycle
src/books.js           Book provider contract and persistent progress
src/book-paginator.js  DOM measurement and two-page spread models
src/book-page-turn.js  Seamless forward/reverse page animation
src/tv-book-reader.js  Library, remote input, reader state, and UI
src/platform.js        Samsung/Tizen API adapter
src/settings.js        Validated persistent settings
src/slideshow.js       Renderer and slideshow state
src/wallpaper-cache.js IndexedDB wallpaper cache
src/wallpapers.js      Bing, Motivation, and bundled providers
test/                  Dependency-free Node tests
assets/books/          Original bundled reader fixture
prototypes/            Interactive design references; excluded from TV packages
config.xml             Tizen application manifest
```

The default presentation is artwork-only. Details, source selection, copyright information, project information, and settings are shown only after the user presses Up.

The Books tab opens a full-screen TV library and a near-full-screen two-page reading theater. The bundled provider implements the same asynchronous catalog, manifest, and chapter interface intended for the future Android book server. Chapters are sanitized, measured into addressable page models, paired into spreads, and turned with four pre-rendered page surfaces. Reading progress is stored locally in `localStorage`.

Samsung's hardware Back key (`keyCode 10009`) first closes details. From artwork-only mode it opens a No/Yes exit dialog; No is selected by default.

## Browser development

Requirements:

- Node.js
- npm

Start the local server:

```sh
npm run dev
```

Open `http://127.0.0.1:8080`.

The development server proxies only the Bing metadata request because `HPImageArchive.aspx` does not return a CORS header. Wallpaper images are downloaded directly from Bing.

Run checks:

```sh
npm test
npm run check
xmllint --noout config.xml
```

## Samsung TV SDK

The repository uses an isolated Tizen Studio installation under `.tools/tizen-studio`. Nothing is added permanently to the system `PATH`.

Install Tizen Studio Web CLI 6.1 and the Samsung TV packages:

```sh
./scripts/install-tizen-sdk.sh
```

The script:

1. Installs Rosetta 2 on Apple Silicon when required.
2. Downloads the official Tizen Studio Web CLI 6.1 installer.
3. Installs it into `.tools/tizen-studio`.
4. Configures the package-manager JDK when missing.
5. Installs:
   - `TV-SAMSUNG-Public`
   - `TV-SAMSUNG-Public-WebAppDevelopment`
   - `TV-SAMSUNG-Extension-Tools`
   - `TV-SAMSUNG-Extension-Resources`
6. Verifies the `tizen` and `sdb` commands.

Load the environment in each terminal:

```sh
source env.sh
```

The Samsung TV emulator is not expected to run on Apple Silicon. Use the physical TV for final testing.

## Enable Developer Mode

1. Connect the TV and development Mac to the same LAN.
2. Open **Apps** on the TV.
3. Enter `12345`.
4. Enable Developer Mode.
5. Enter the Mac's LAN IP address.
6. Restart the TV.

Find the Mac IP:

```sh
ipconfig getifaddr en0
```

Connect from the Mac:

```sh
source env.sh
sdb connect TV_IP_ADDRESS:26101
sdb devices
```

Permit developer-signed application installation after connecting:

```sh
tizen install-permit -s TV_IP_ADDRESS:26101
```

## Certificates

The TV requires a Samsung author certificate and a distributor certificate containing the TV's DUID.

Use Samsung Certificate Manager after installing the TV SDK:

1. Create a Samsung certificate profile.
2. Select the TV device type.
3. Create or import an author certificate.
4. Create a distributor certificate.
5. Add the connected TV's DUID.

Back up the author certificate and its password. Losing it prevents updates under the same application identity.

## Build and package

Use the staging packager so SDK files, tests, and documentation cannot enter the widget:

```sh
./scripts/package-tv.sh YOUR_CERTIFICATE_PROFILE
```

The signed widget is written to `dist/tizen/.buildResult/`. Build output and `.wgt` files are ignored by Git.

Install and run using Tizen Studio, the VS Code TV extension, or:

```sh
tizen install-permit -s DEVICE_SERIAL
cd dist/tizen/.buildResult
tizen install -n MyTVArt.wgt -s DEVICE_SERIAL
tizen run -p TVWallppr1.Wallpaper -s DEVICE_SERIAL
```

Use `sdb devices` to find `DEVICE_SERIAL`, such as `192.168.68.59:26101`.

## Bing integration

The app requests the two useful recent-history windows:

```text
https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=en-US
https://www.bing.com/HPImageArchive.aspx?format=js&idx=7&n=8&mkt=en-US
```

The windows overlap by one day and provide up to 15 unique recent dates. Higher indices currently clamp to the second window. Only records with `wp: true` are accepted. The supplied 1920x1080 images and complete copyright strings are retained.

Eligible images accumulate in IndexedDB up to the newest 30 entries, allowing the slideshow to grow beyond Bing's live archive window. When Bing is the active source, the app checks for updates every six hours and also refreshes whenever the app starts.

The endpoint is operated by Bing but is not a documented developer API. This integration is intended for personal, noncommercial sideloading. Do not enable it in a public store build without appropriate permission.

Direct Bing metadata and image access has been verified on a physical QN85C running the Tizen 9 firmware upgrade. The metadata proxy in `scripts/dev-server.mjs` is needed only for desktop-browser CORS behavior.

## Visual design

Temporary controls use lightweight CSS overlays:

- Semi-opaque neutral backgrounds
- Subtle directional gradients
- Thin highlight borders
- Static shadows
- No `backdrop-filter`
- No WebGL contexts or render loops
- No duplicated wallpaper sampling

This avoids visible alignment differences between the wallpaper and overlays and keeps the controls inexpensive on TV hardware.

## Planned work

- Add a reviewed remote quote catalog from the project Git repository, with the bundled JSONL file as offline fallback
- Add a `tizen.ml` capability and inference benchmark
- Research public Samsung APIs for Bluetooth now-playing metadata and controls
- Test long-running memory behavior on the physical QN85C
