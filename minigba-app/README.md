# MiniGBA App

MiniGBA App is the standalone Taro/React/TypeScript client for WeChat and Douyin mini programs. It provides a Cloudflare R2-backed ROM catalog, local library, per-session play history, game details, emulator player, virtual controls, local saves, save states, storage management, and platform-specific cloud synchronization.

## Target

- Build targets: `weapp` and `tt`.
- Release build host: Ubuntu 22.04 bare metal.
- Runtime: iOS and Android WeChat mini program.
- Douyin branch runtime: Douyin mini program with `TTWebAssembly`; WeChat identity cloud sync and arbitrary local file transfer are disabled until Douyin-specific platform services are configured.
- No H5 production fallback, WebView emulator wrapper, container, or virtual machine workflow.

## Product boundaries

- Users import ROMs they are legally allowed to use.
- The app never uploads user ROMs. Catalog license metadata is displayed when supplied; missing rights metadata is shown as unmarked and is not inferred from an R2 object name.
- ROM files remain on-device and are never uploaded. WeChat keeps imported ROMs in its persistent user directory; Douyin keeps downloaded ROMs in temporary storage because its mini-program user directory is limited to 10 MiB, and downloads them again on play if the host has evicted the temporary file. Cloud synchronization stores save data only.
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

Build the Douyin target and import its generated project root into Douyin Developer Tools:

```bash
npm run build:douyin
```

```text
minigba-app/dist-douyin
```

The generated project uses `testAppId` for local import. Replace it with a real Douyin Mini Program AppID through `TARO_APP_ID` when building an authenticated project. Do not import `project.tt.json` directly; the generated `dist-douyin/project.config.json` has `miniprogramRoot` normalized to `./`.

Douyin catalog ROMs use `tt.downloadFile` temporary storage instead of the 10 MiB persistent user directory. The library persists only metadata and save files; when a temporary ROM has been evicted, opening the player downloads the same allowlisted HTTPS object again and verifies its declared length and GBA header. This intentionally does not add a catalog SHA-256 requirement.

Do not import the repository root or `src`. The project pins the locally complete WeChat base library `3.15.2`; the production validator rejects a different generated `libVersion` and unsupported WXSS universal selectors. This avoids the gray `3.16.1` selection and the incomplete `3.17.0` vendor cache observed with WeChat Developer Tools 2.01.2510290.

When `TARO_APP_API_BASE_URL` is empty, cloud login and synchronization are intentionally disabled and no relative `/v1/*` request is emitted. This is the expected local build mode until the HTTPS API is deployed. If Developer Tools still shows an old request after rebuilding, clear the console and use **Compile > Clear cache and compile** against the same `dist` directory.

Fresh installations do not have game, save, or history directories yet. The filesystem adapter treats WeChat `ENOENT` failures as empty data and normalizes object-shaped API failures through `errMsg`, so a real failure is readable instead of appearing as `[object Object]`.

Local builds default `TARO_APP_ROM_DOWNLOAD_HOSTS` to the audited bundled-catalog host `rom.sid.mom`. Every `build:weapp` validates all 981 bundled entries before compilation and then verifies that both compiled ROM host allowlists are present in `dist`; Ubuntu release builds still require an explicit environment value.

To diagnose a Developer Tools import, run `node scripts/validate-weapp-output.mjs` from this directory. A valid local artifact reports AppID `wx4a8213e3dfa88565`, base library `3.15.2`, ROM host `rom.sid.mom`, two compiled ROM host sets, and eight WXSS files. The Developer Tools "do not verify legal domains" switch affects WeChat's platform check only; it does not and should not bypass the application's compiled ROM host allowlist.

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

The checked-in WeChat AppID is `wx4a8213e3dfa88565`. The AppSecret is server-only and must never be added to this repository or the mini-program build. For the matching CI private key and already-built `dist`:

```bash
MINIGBA_WECHAT_APP_ID=wx4a8213e3dfa88565 \
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
