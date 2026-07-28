# Third-party notices

The exact npm package versions, distribution URLs, and declared licenses are
generated from `package-lock.json` into `artifacts/reports/sbom.cdx.json` and
`artifacts/reports/licenses.tsv` for every release.

| Component | Version | License | Usage |
| --- | --- | --- | --- |
| mGBA | 0.10.5 (`26b7884bc25a5933960f3cdcd98bac1ae14d42e2`) | MPL-2.0 | GBA core compiled to WXWebAssembly |
| Taro | 4.2.1 | MIT | WeChat mini program framework |
| React | 18.3.1 | MIT | UI runtime |
| fflate | 0.8.2 | MIT | Bounded single-ROM ZIP extraction |

The mGBA source corresponding to the shipped binary is available at:

`https://github.com/mgba-emu/mgba/tree/26b7884bc25a5933960f3cdcd98bac1ae14d42e2`

The separately versioned Core release includes the complete mGBA MPL-2.0 text,
the pinned upstream record, its CycloneDX SBOM, and build metadata. MiniGBA does
not copy code from the inspected gbajs repositories into the production core.
