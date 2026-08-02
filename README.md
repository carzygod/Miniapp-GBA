# MiniGBA App

MiniGBA App is the standalone Taro/React/TypeScript client for the WeChat mini program. It provides a Cloudflare R2-backed ROM catalog, local library, per-session play history, game details, emulator player, virtual controls, local saves, save states, cloud synchronization, storage management, and privacy controls.

## Target

- Build target: `weapp` only.
- Release build host: Ubuntu 22.04 bare metal.
- Runtime: iOS and Android WeChat mini program.
- No H5 production fallback, WebView emulator wrapper, container, or virtual machine workflow.

## Product boundaries

- Users import ROMs they are legally allowed to use.
- The app never uploads user ROMs. Catalog license metadata is displayed when supplied; missing rights metadata is shown as unmarked and is not inferred from an R2 object name.
- ROM files remain local by default. Cloud synchronization stores save data only.
- The app uses the separately versioned `minigba-core` WXWebAssembly artifact.

## Repository layout

```text
config/                 Taro build configuration
src/pages/library/      Local game library and ROM import
src/pages/game/         Download/play actions, play history, save and ROM details
src/catalog/            R2 manifest fetch, cache, object metadata and URL validation
src/player/             Player subpackage, Canvas runtime, and controls
src/pages/saves/        Local/cloud versions and conflicts
src/pages/settings/     Display, audio, controls, storage, privacy
src/components/         Reusable Taro components
src/emulator/           WXWebAssembly ABI loader, input, and audio
src/storage/            ROM index, play history, atomic saves, and persistent sync queue
src/cloud/              API client, history, conflicts, and synchronization
src/platform/           WeChat filesystem adapter
src/assets/             Pinned core binary and provenance manifest
scripts/                Ubuntu build and miniprogram-ci upload
```

## Design direction

The player is a quiet handheld work surface: a graphite display field, cool-white information, teal status light, and raspberry action keys. The 3:2 game image and thumb reach determine the layout. Decorative cards, marketing sections, and UI that obscures the playfield are intentionally excluded.

## Develop

```bash
npm ci
npm run dev:weapp
```

For a deterministic import, build once and open the generated output directory in WeChat Developer Tools:

```bash
npm run build:weapp
```

```text
minigba-app/dist
```

Do not import the repository root or `src`. The project pins WeChat base library `3.16.1`; the production validator rejects a different generated `libVersion` and unsupported WXSS universal selectors. This pin also avoids the incomplete `3.17.0` vendor cache observed with WeChat Developer Tools 2.01.2510290, which surfaced as a simulator HTTP 500 before application code loaded.

Production uploads use `miniprogram-ci` from an Ubuntu 22.04 bare-metal build host.

The checked-in development WASM asset is provenance-pinned in `src/assets/minigba-core.manifest.json`. A release candidate must replace it with the output of `minigba-core/scripts/build-weapp.sh` built on the same Ubuntu host, then verify the hash before running `scripts/build-release.sh`.

## Verify

```bash
export TARO_APP_API_BASE_URL=https://api.example.invalid
export TARO_APP_ROM_CATALOG_URL=https://rom.sid.mom/catalog/v2/roms.json
export TARO_APP_ROM_CATALOG_REMOTE_ENABLED=false
export TARO_APP_ROM_DOWNLOAD_HOSTS=rom.sid.mom
npm run typecheck
npm run lint
npm test
npm run validate:catalog -- catalog.example.json
npm run build:weapp
```

`catalog.r2.json` is generated from the authenticated R2 object listing and currently contains 981 `gba/` objects. It is also bundled as the startup catalog so the ROM plaza does not depend on an unpublished remote manifest. Keep `TARO_APP_ROM_CATALOG_REMOTE_ENABLED=false` until the same schema v2 file is publicly readable at `TARO_APP_ROM_CATALOG_URL`; set it to `true` only after remote validation succeeds. `r2-objects.example.json` documents the generator input. Catalog schema v2 requires a stable catalog ID, exact object key, byte length and allowlisted HTTPS URL; it does not contain or validate a predeclared SHA-256. Downloads still require HTTP 200, matching response/file length and a valid GBA header before atomic import. A local content ID is calculated after import only for deduplication and save isolation. R2 credentials are never compiled into the mini program.

For an approved AppID, CI private key, and already-built `dist`:

```bash
MINIGBA_WECHAT_APP_ID=wx... \
MINIGBA_MINIPROGRAM_PRIVATE_KEY=/secure/private.key \
MINIGBA_RELEASE_VERSION=0.1.0 \
./scripts/upload.sh
```

Real-device iOS and Android checks are required for WXWebAssembly, Canvas, multi-touch, WebAudio, background recovery, and save durability. Simulator-only results are not release evidence.

## Licensing and dependency reports

MiniGBA-owned client code is Apache-2.0 licensed. `THIRD_PARTY_NOTICES.md`
records the runtime boundaries, and the release build writes a CycloneDX SBOM,
license table, npm audit JSON, and time-bounded security exception into
`artifacts/reports/`. Reports stay outside the WeChat upload root `dist/`.
