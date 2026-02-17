# Programmatic Stretch — Standalone Script

Replicates the Prebid.js `enableProgrammaticStretch` behaviour as a dependency-free, drop-in script that publishers can add to any page.

The script listens for `postMessage` events sent by creatives rendered inside iframes. When a message with `action: "programmaticStretch"` is received, the ad slot (iframe + its parent container) is resized to full-width while keeping a fixed height — exactly matching the Prebid.js implementation.

## Message Format

The creative inside the iframe sends a `postMessage` with the following structure:

```json
{
  "message": "Prebid Creative",
  "adId": "<ad-id>",
  "action": "programmaticStretch",
  "height": 250
}
```

| Field     | Type   | Required | Description                          |
| --------- | ------ | -------- | ------------------------------------ |
| `message` | string | yes      | Must be `"Prebid Creative"`         |
| `adId`    | string | yes      | The ad identifier                    |
| `action`  | string | yes      | Must be `"programmaticStretch"`     |
| `height`  | number | no       | Override height in pixels            |

## Publisher Integration

### 1. Add the script to the page

```html
<script src="programmaticStretch.js"></script>
```

### 2. (Optional) Configure before or after the script loads

```html
<script>
  window.programmaticStretch = {
    // Enable / disable globally (default: true)
    enabled: true,

    // Per-slot overrides keyed by adUnitCode (the div id of the slot).
    slots: {
      'div-gpt-ad-123': {
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
| `resizeFunction` | function | `null`  | Global custom resize function — skips default resize when set     |
| `slots`          | object   | `{}`    | Per-slot overrides keyed by adUnitCode (div id)                   |

### Per-Slot Options (`slots[adUnitCode]`)

| Property         | Type     | Default | Description                                                                 |
| ---------------- | -------- | ------- | --------------------------------------------------------------------------- |
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

## Height Resolution

Height is resolved with the following priority:

1. Publisher slot-level config (`slots[code].height`)
2. Height sent in the `postMessage` payload (`data.height`)
3. The iframe's computed height (via `getComputedStyle`)

## Iframe Lookup Strategies

The script locates the ad iframe using multiple strategies in order:

1. **`event.source` matching** — compares against every iframe's `contentWindow`
2. **GPT slot lookup** — searches Google Publisher Tag targeting for the `adId`
3. **AppNexus AST lookup** — queries `window.apntag` by `adUnitCode`
4. **Direct DOM lookup** — uses `adUnitCode` as a DOM element id

## Default Resize Behaviour

When no custom `resizeFunction` is configured, the script sets width to `100%` and height to the resolved value on both the iframe and its immediate parent element, and updates iframe element attributes.
