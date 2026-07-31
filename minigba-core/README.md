# MiniGBA Core

MiniGBA Core is the standalone emulator runtime used by the MiniGBA WeChat mini program. It wraps a pinned mGBA revision behind a small, versioned C ABI and builds a single-threaded WebAssembly module for `WXWebAssembly`.

## Scope

- GBA-only mGBA core.
- No SDL, browser DOM, IndexedDB, pthreads, WebGL 2, or platform filesystem.
- Fixed RGBA8888 framebuffer and signed 16-bit stereo PCM output.
- Full key-mask input, battery save import/export, and state serialization.
- Deterministic native tests and ABI boundary tests.
- Ubuntu 22.04 bare-metal build support only for release artifacts.

## Repository layout

```text
include/             Public, versioned C ABI
src/                 mGBA adapter and platform-independent runtime
tests/               Native ABI and deterministic tests
cmake/               Emscripten and native build helpers
scripts/             Ubuntu 22.04 build and verification scripts
vendor/mgba/          Pinned mGBA Git submodule
```

## Prerequisites

Release builds require Ubuntu 22.04 with CMake, Ninja, Python 3, a pinned emsdk, and a checked-out mGBA submodule. No container or virtual machine workflow is supported.

## Build

```bash
git submodule update --init --recursive
./scripts/build-native.sh
./scripts/build-weapp.sh
node ./scripts/verify-wasm.mjs dist/minigba-core.wasm
node ./tests/wasm-smoke.mjs dist/minigba-core.wasm
```

## Test

```bash
ctest --test-dir build/native --output-on-failure
```

Tests never require or include commercial ROMs. ROM fixtures must be original homebrew or redistributable diagnostics with source and license metadata.

## ABI compatibility

The ABI version is returned by `mgba_wx_abi_version()`. ABI changes require a major ABI increment, a migration note in `CHANGELOG.md`, and matching updates in `@minigba/emulator-weapp`.

## Licensing

mGBA is licensed under MPL-2.0. The pinned upstream revision and local changes are recorded in `UPSTREAM.md`. Distribution artifacts must include mGBA and enabled third-party license notices. MiniGBA-owned wrapper code is Apache-2.0 licensed.

`scripts/build-weapp.sh` emits the WASM checksum, deterministic build metadata,
CycloneDX SBOM, the MiniGBA notice, the complete mGBA MPL-2.0 text, and the
pinned upstream record under `dist/`.
