# Publishing checklist

Where things stand, so the work can be picked up from any device. Tick items as they're done.

## 1. Ready in the code (done 2026-10-20)

- [x] `manifest.json` at the repo root: id `hebrew-da`, no "Obsidian" in id/name, one-sentence description ending in a period, `minAppVersion` 1.4.10 (needed for the folder suggester)
- [x] `versions.json`, `LICENSE` (MIT), `README.md` with screenshot
- [x] Guidelines review: command names don't repeat the plugin name; no static inline styles (moved to CSS classes); user-entered paths go through `normalizePath`; every CSS rule is scoped to `.hda-` / `.hds-` classes (plus one file-explorer rule that only matches `.hda` files); `innerHTML` not used; no network requests; PNG export writes through the vault API; no default hotkeys
- [x] `npm run build` and `npx tsc --noEmit` pass
- [x] `.github/workflows/release.yml`: pushing a version tag builds the plugin and creates the Release with `main.js`, `manifest.json`, `styles.css`
- [x] Web version builds into `docs/` (`npm run web`)

## 2. GitHub (done 2026-10-20)

- [x] Create the public repo `SotS1689/hebrew-da` and push `main`
- [x] Turn on GitHub Pages: branch `main`, folder `/docs` → https://sots1689.github.io/hebrew-da/
- [x] Push tag `0.1.0`; check the Release has the three files

## 3. Beta test with BRAT

- [ ] In a test vault, install BRAT, add `SotS1689/hebrew-da`, confirm it installs, opens a `.hda` file, and imports an `.xlsm`

## 4. Submit to Community Plugins (only the author can do this)

1. Sign in at https://community.obsidian.md with an Obsidian account.
2. Link the GitHub account `SotS1689`.
3. Submit the plugin, pointing it at `SotS1689/hebrew-da`. The site checks `manifest.json` and the latest Release automatically.
4. A reviewer reads the code later and may ask for changes. This can take weeks.

## Every release after that

1. Bump `version` in `manifest.json` and `package.json`; add `"x.y.z": "<minAppVersion>"` to `versions.json`.
2. `npm run build` and test in the vault; `npm run web` to update the web version.
3. Commit ("Bump version to x.y.z"), push, then push the tag `x.y.z` (no "v"). The workflow makes the Release; Obsidian picks it up.
