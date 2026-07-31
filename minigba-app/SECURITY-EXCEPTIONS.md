# Time-bounded dependency exceptions

Last reviewed: 2026-07-28. Expiry: 2026-10-31 23:59:59 UTC.

The release gate runs `npm audit --omit=dev` and accepts only the package names
listed in `scripts/audit-production.mjs` until the expiry above. A new package
finding or an expired exception fails the release.

## Taro 4.2.1 build graph

Taro 4.2.1 is the current published Taro release at the review date. npm reports
findings through its component and build-tool dependency graph, including:

- `swiper` 11.1.15 prototype pollution, GHSA-hmx5-qpq5-p643;
- webpack development-server and SockJS findings;
- glob, minimatch, brace-expansion, rimraf and SCSS build-tool findings;
- esbuild, uuid and Babel build-tool findings.

MiniGBA does not render Taro's `Swiper`, does not start a development server in
production, and deploys only the generated WeChat files under `dist/`; it never
ships `node_modules`. The production bundle contains Taro's metadata for the
native WeChat `swiper` tag, but not the third-party Swiper JS implementation or
its CSS runtime. This reduces reachability but does not erase the source-tree
finding, so the full npm JSON report is retained with each release.

The npm-proposed fix downgrades the direct Taro packages to incompatible 3.x
versions and is not accepted. Re-review immediately when Taro publishes a fixed
dependency graph, or before the expiry date, whichever comes first.
