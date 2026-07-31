# Upstream mGBA

- Project: [mGBA](https://github.com/mgba-emu/mgba)
- Release: `0.10.5`
- Commit: `26b7884bc25a5933960f3cdcd98bac1ae14d42e2`
- License: Mozilla Public License 2.0
- Local integration: the upstream source is an unmodified Git submodule. MiniGBA-owned code is a headless adapter linked against the GBA core.

The release pipeline must include `vendor/mgba/LICENSE` and the notices for every enabled upstream dependency. The production build disables all mGBA frontends and optional platform integrations.

