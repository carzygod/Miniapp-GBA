# MiniGBA App

MiniGBA App is the standalone Taro/React/TypeScript client for the WeChat mini program. It provides the game library, emulator player, virtual controls, local saves, save states, cloud synchronization, storage management, and privacy controls.

## Target

- Build target: `weapp` only.
- Release build host: Ubuntu 22.04 bare metal.
- Runtime: iOS and Android WeChat mini program.
- No H5 production fallback, WebView emulator wrapper, container, or virtual machine workflow.

## Product boundaries

- Users import ROMs they are legally allowed to use.
- The app does not bundle, list, search, upload, or distribute commercial ROMs.
- ROM files remain local by default. Cloud synchronization stores save data only.
- The app uses the separately versioned `minigba-core` WXWebAssembly artifact.

## Repository layout

```text
config/                 Taro build configuration
src/pages/library/      Local game library and ROM import
src/pages/player/       Canvas player and virtual controls
src/pages/saves/        Local/cloud versions and conflicts
src/pages/settings/     Display, audio, controls, storage, privacy
src/components/         Reusable Taro components
src/emulator/           WXWebAssembly ABI loader, input, and audio
src/storage/            ROM index, atomic saves, and persistent sync queue
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

Open the generated `dist` project through the approved WeChat workflow. Production uploads use `miniprogram-ci` from an Ubuntu 22.04 bare-metal build host.

The checked-in development WASM asset is provenance-pinned in `src/assets/minigba-core.manifest.json`. A release candidate must replace it with the output of `minigba-core/scripts/build-weapp.sh` built on the same Ubuntu host, then verify the hash before running `scripts/build-release.sh`.

## Verify

```bash
npm run typecheck
npm run lint
npm test
npm run build:weapp
```

For an approved AppID, CI private key, and already-built `dist`:

```bash
MINIGBA_WECHAT_APP_ID=wx... \
MINIGBA_MINIPROGRAM_PRIVATE_KEY=/secure/private.key \
MINIGBA_RELEASE_VERSION=0.1.0 \
./scripts/upload.sh
```

Real-device iOS and Android checks are required for WXWebAssembly, Canvas, multi-touch, WebAudio, background recovery, and save durability. Simulator-only results are not release evidence.
