# Vendored security / compatibility pins

These packages are vendored because we need versions or export maps that are
not cleanly available from the npm feed used here, without install-time hacks.

| Package | Version | Why |
|---------|---------|-----|
| `brace-expansion` | 5.0.9 | Fixes GHSA-rgw5-rvv9-x895 / related DoS advisories |
| `fast-uri` | 4.1.2 | Fixes GHSA-7p8r-x3mc-p8w7 host-confusion advisory |
| `vscode-jsonrpc` | 9.0.1 | Ships ESM exports map + `./node.js` alias needed by `@github/copilot-sdk` |

Applied via `package.json` `overrides` as `file:packages/vendor/...`.

When the npm feed carries these versions natively, switch overrides back to
semver ranges and delete the corresponding vendor folders.
