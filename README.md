# OpenBench Web (GitHub Pages)

A static, client‑side CPU benchmark you can deploy with GitHub Actions to GitHub Pages.
Runs fully in the browser—no server required. Detects cores and architecture hints,
runs single‑core and multi‑core tests, and finishes in ~30s (Quick mode).

## Quick start
1. Create an empty **public** GitHub repo, default branch `main`.
2. Download the ZIP from ChatGPT, unzip, and upload all files to the repo.
3. Push/commit.
4. The included workflow will auto‑enable Pages and deploy.
5. Open the Pages URL from the workflow summary or the repo’s Settings → Pages.

> If you previously saw:  
> `Error: Get Pages site failed ... consider exploring the enablement parameter`  
> This template already fixes it via `actions/configure-pages@v5` with `enablement: true`.

## What it does
- Detects CPU hints (`architecture`, `cores`) and browser features.
- Bench suite (default quick mode ~30s total):
  - Single‑core: float, integer, memory (≈3s each)
  - Multi‑core: float, integer, memory (≈6s each)
- Adjustable “Extended” mode (~60s).
- Parallel execution via Web Workers (no SharedArrayBuffer required).
- Exports results as JSON/CSV.
- Pure static site (just HTML/CSS/JS).

## Local development (optional)
Open `site/index.html` with a static server (e.g. VS Code Live Server).

## License
MIT
