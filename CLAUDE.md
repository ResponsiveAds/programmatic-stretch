# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run serve    # Start dev server on port 3000
npm test         # Run Playwright E2E tests (auto-starts server on port 3333)
npm run build    # Minify programmaticStretch.js → dest/programmaticStretch.min.js
```

Run a single test file or test by name:
```bash
npx playwright test tests/programmatic-stretch.spec.ts
npx playwright test --grep "scrollbar"
```

Playwright runs a local server automatically during tests (`reuseExistingServer` in non-CI). Tests use `http://localhost:3333` as baseURL.

## Architecture

**Single-file library**: All logic lives in `programmaticStretch.js` — a standalone IIFE that attaches to `window.programmaticStretch` and registers a `message` event listener. No bundler required; the file runs as-is in any browser.

**Build**: `build.js` replaces the `__VERSION__` placeholder with the version from `package.json`, then minifies via terser into `dest/programmaticStretch.min.js`.

### How it works

The script listens for `postMessage` events from ad creatives (format: `{ message: "Prebid Creative", action: "programmaticStretch", ... }`). When received:

1. **Iframe lookup** — identifies the source iframe using 4 strategies in priority order: `event.source` matching → GPT slot lookup via adId → APNTag lookup → direct DOM id
2. **Height resolution** — 3-tier priority: publisher config → message payload → computed iframe height
3. **DOM walk & stretch** (`walkAndStretch`) — walks up the DOM from the iframe, stretching each ancestor to 100% width, resetting constraining CSS (padding, margin, overflow, contain), and applying a pixel-based breakout to the outermost constraining element. Stops when an element is taller than the ad (assumes other content). Skips multi-column layouts.
4. **Notification** — sends a postMessage confirmation back to the creative (`success: true/false`)
5. **Resize listener** — throttled (100ms) re-application of breakout widths on viewport resize

### Configuration

Publishers configure via `window.programmaticStretch = { enabled: true, slots: { "div-id": { ... } } }`. Per-slot config overrides global config. Custom `resizeFunction` can replace `defaultResize` entirely.

### Tests

Each test fixture in `tests/fixtures/` targets a specific layout scenario (simple, nested, safeframe, multi-column, flex, scrollbar). Tests use helpers: `waitForStretch()` (polls until iframe matches viewport width), `assertNoOverflow()` (no horizontal scrollbar), `getRect()`.
