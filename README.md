# Programmatic Stretch — Standalone Script

Replicates the Prebid.js `enableProgrammaticStretch` behaviour as a dependency-free, drop-in script that publishers can add to any page.



https://github.com/user-attachments/assets/8b6c58a2-10f4-48c8-8b8b-2bc935bf1b34



The script listens for `postMessage` events sent by creatives rendered inside iframes. When a message with `action: "programmaticStretch"` is received, the ad slot (iframe + its parent container) is resized to full-width while keeping a fixed height — exactly matching the Prebid.js implementation.

## Local Development

Start a local server to test the example page:

```bash
npm run serve
```

Then open [http://localhost:3000/example.html](http://localhost:3000/example.html) in your browser. Or you can view the page here: [https://responsiveads.github.io/programmatic-stretch/example.html](https://responsiveads.github.io/programmatic-stretch/example.html)

## Build Minified Bundle

Create a minified artifact with the package version injected into the runtime script:

```bash
npm run build
```

This writes the output to `dest/programmaticStretch.min.js`.

## Running Tests

The test suite uses [Playwright](https://playwright.dev/). A local server is started automatically by the Playwright config, so you don't need to run one manually.

```bash
# Install browsers (first time only)
npx playwright install

# Run all tests
npm test

# Run in headed mode (opens a browser window)
npx playwright test --headed
```

## Triggering the Expansion from a Creative Iframe

The creative inside the iframe must post a JSON `postMessage` to the top window with the following structure:

```json
{
  "message": "Prebid Creative",
  "adId": "<ad-id>",
  "action": "programmaticStretch",
  "height": 250,
  "adUnitCode": "div-gpt-ad-123"
}
```

| Field        | Type   | Required | Description                                          |
| ------------ | ------ | -------- | ---------------------------------------------------- |
| `message`    | string | yes      | Must be `"Prebid Creative"`                         |
| `adId`       | string | no       | The ad identifier — used for GPT targeting lookup    |
| `action`     | string | yes      | Must be `"programmaticStretch"`                     |
| `height`     | number | no       | Override height in pixels                            |
| `adUnitCode` | string | no       | The slot div id — helps locate the iframe and match per-slot config |

### Identifying the slot

There are three ways the script can find the ad iframe. You can combine them for maximum reliability.

#### 1. `event.source` (automatic)

The script always compares `event.source` against every iframe's `contentWindow`. This works without any extra fields as long as the creative posts from within the iframe — no `adId` or `adUnitCode` needed.

```js
// Minimal — relies on event.source matching
window.top.postMessage(JSON.stringify({
  message: 'Prebid Creative',
  action: 'programmaticStretch',
  height: 250
}), '*');
```

#### 2. `adId` (GPT targeting lookup)

When `adId` is provided the script searches Google Publisher Tag slots for a targeting value that matches. Useful when GPT is on the page and the creative knows its Prebid ad ID.

```js
const adId =
  window?.parent?.ucTagData?.targetingMap?.hb_adid?.[0] || 'fooId';

window.top.postMessage(JSON.stringify({
  message: 'Prebid Creative',
  adId: adId,
  action: 'programmaticStretch',
  height: 250
}), '*');
```

#### 3. `adUnitCode` (APNTag / direct DOM lookup + per-slot config)

When `adUnitCode` is provided the script queries `window.apntag` and falls back to `document.getElementById`. It also uses this value to match publisher per-slot configuration (`slots[adUnitCode]`).

```js
window.top.postMessage(JSON.stringify({
  message: 'Prebid Creative',
  action: 'programmaticStretch',
  adUnitCode: 'div-gpt-ad-123',
  height: 250
}), '*');
```

#### Combining fields

For the best coverage, include both `adId` and `adUnitCode`. The script tries each strategy in order (`event.source` → GPT → APNTag → DOM id) and uses the first match.

```js
const adId =
  window?.parent?.ucTagData?.targetingMap?.hb_adid?.[0] || 'fooId';

window.top.postMessage(JSON.stringify({
  message: 'Prebid Creative',
  adId: adId,
  adUnitCode: 'div-gpt-ad-123',
  action: 'programmaticStretch',
  height: 250
}), '*');
```

> **Note:** If `adUnitCode` is not provided in the message the script will attempt to guess it by walking up the DOM from the matched iframe and using the first ancestor with an `id` attribute. This guessed value is then used for per-slot config lookup.

### 1. Add the script to the page - For Publishers

```html
<script src="programmaticStretch.js"></script>
```

Or if you are a publisher use CDN hosted minified script. Using this URL will pin the version. If there are updates you will need to update the URL.
```html
<script src="https://cdn.jsdelivr.net/gh/ResponsiveAds/programmatic-stretch@v1.0.2/dest/programmaticStretch.min.js"></script>
```



### 2. (Optional) Configure before or after the script loads

```html
<script>
  window.programmaticStretch = {
    // Enable / disable globally (default: true)
    enabled: true,

    // Send a postMessage back to the creative iframe to confirm
    // whether the expansion succeeded or failed (default: true).
    notify: true,

    // Per-slot overrides keyed by adUnitCode (the div id of the slot).
    slots: {
      'div-gpt-ad-123': {
        // Enable or disable stretch for this slot only.
        // true  → stretch even if enabled:false globally (allowlist)
        // false → skip this slot even if enabled:true globally (denylist)
        enabled: true,

        // Fixed height in pixels (overrides any height sent by the
        // creative and the iframe's current height).
        height: 250,

        // Optional custom resize function. When provided, the default
        // resize logic is skipped entirely.
        // Signature: resizeFunction(adId, height, meta)
        //   meta = { iframe, event }
        resizeFunction: null
      }
    }
  };
</script>
```

## Configuration Reference

### Global Options

| Property         | Type     | Default | Description                                                       |
| ---------------- | -------- | ------- | ----------------------------------------------------------------- |
| `enabled`        | boolean  | `true`  | Enable or disable the script globally                             |
| `notify`         | boolean  | `true`  | Send a postMessage back to the creative confirming success/failure |
| `resizeFunction` | function | `null`  | Global custom resize function — skips default resize when set     |
| `slots`          | object   | `{}`    | Per-slot overrides keyed by adUnitCode (div id)                   |

### Per-Slot Options (`slots[adUnitCode]`)

| Property         | Type     | Default | Description                                                                 |
| ---------------- | -------- | ------- | --------------------------------------------------------------------------- |
| `enabled`        | boolean  | —       | Enable (`true`) or disable (`false`) stretch for this slot. Overrides the global `enabled` flag for this slot only. |
| `height`         | number   | —       | Fixed height in pixels; overrides creative-sent and computed iframe height  |
| `resizeFunction` | function | `null`  | Custom resize function for this slot; skips default resize when set         |

### Custom Resize Function Signature

```js
function resizeFunction(adId, height, meta) {
  // adId   — the ad id from the message
  // height — resolved height value
  // meta   — { iframe, event }
}
```

## Per-Slot Enabled

The `enabled` flag can be set on individual slots to override the global setting.

### Allowlist — stretch only specific slots

Set `enabled: false` globally and opt specific slots back in:

```js
window.programmaticStretch = {
  enabled: false,
  slots: {
    'div-gpt-ad-banner': { enabled: true }   // only this slot stretches
  }
};
```

### Denylist — stretch everything except specific slots

Leave `enabled: true` (the default) and opt specific slots out:

```js
window.programmaticStretch = {
  // enabled: true is the default, so this key can be omitted
  slots: {
    'div-gpt-ad-sidebar': { enabled: false }  // this slot is skipped
  }
};
```

> **Note:** Both patterns work even when `adUnitCode` is not included in the creative's postMessage. The script always locates the iframe first, then resolves the slot id from the DOM before applying the enabled check.

## Height Resolution

Height is resolved with the following priority:

1. Publisher slot-level config (`slots[code].height`)
2. Height sent in the `postMessage` payload (`data.height`)
3. The iframe's computed height (via `getComputedStyle`)

## Iframe Lookup Strategies

The script locates the ad iframe using multiple strategies in order:

1. **`event.source` matching** — compares against every iframe's `contentWindow`
2. **GPT slot lookup** — searches Google Publisher Tag targeting for the `adId`
3. **APNTag lookup** — queries `window.apntag` by `adUnitCode`
4. **Direct DOM lookup** — uses `adUnitCode` as a DOM element id

## Default Resize Behaviour

When no custom `resizeFunction` is configured the script performs a multi-step resize:

1. **Iframe** — sets `width: 100%` and the resolved height via both CSS (`style.width`, `style.height`) and HTML attributes (`iframe.width`, `iframe.height`).
2. **Immediate parent** — sets `width: 100%`, `height`, and `max-width: none`.
3. **DOM walk (`walkAndStretch`)** — walks up from the parent towards `<body>`, widening every constraining ancestor:
   - Intermediate ancestors get `width: 100%; max-width: none; margin: 0; padding: 0`.
   - `overflow: hidden` / `overflow-x: hidden` is relaxed to `visible` so the breakout isn't clipped.
   - CSS `contain` is reset to `none` where present.
   - **Multi-column protection** — if an ancestor is a flex/grid child with visible siblings the walk stops there (the element is stretched to 100 % of its column but no further) to avoid breaking multi-column layouts.
   - **Height boundary** — if an ancestor is taller than the resolved ad height it is assumed to contain other page content; the walk stops and the breakout is applied to the previous (inner) element.
   - **Scrollbar-overflow protection** — if the element that would normally receive the breakout has `overflow-x: auto` or `overflow-x: scroll`, applying the breakout to an inner child would cause that element to grow a horizontal scrollbar. In this case the breakout is moved one parent higher (to the element itself) so no scrollbar is introduced. This check only triggers when the element still passes the height-boundary guard above.
4. **Breakout** — the chosen element receives a pixel-based breakout: its width is set to `document.documentElement.clientWidth` and a negative `margin-left` pins it to the viewport edge. Using `clientWidth` (which excludes the vertical scrollbar) prevents horizontal overflow.
5. **Viewport resize** — a throttled (100 ms) `resize` listener recalculates the breakout so the ad stays full-width after the window is resized.
