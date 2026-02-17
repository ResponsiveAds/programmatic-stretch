/**
 * Programmatic Stretch — Standalone Script
 *
 *
 * The script listens for `postMessage` events sent by creatives rendered
 * inside iframes. When a message with `action: "programmaticStretch"` is
 * received the ad slot (iframe + its parent container) is resized to
 * full-width while keeping a fixed height — exactly matching the Prebid.js
 *
 */
(function (window, document) {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────
  // Constants
  // ──────────────────────────────────────────────────────────────────────
  var MESSAGE_CREATIVE = 'Prebid Creative';
  var ACTION_PROGRAMMATIC_STRETCH = 'programmaticStretch';

  // ──────────────────────────────────────────────────────────────────────
  // Configuration helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Return the publisher configuration object, or an empty object if none
   * has been provided.
   */
  function getConfig() {
    return window.programmaticStretch || {};
  }

  /**
   * Return the slot-level config for a given `adUnitCode` (div id), or
   * `null` if no per-slot config exists.
   */
  function getSlotConfig(adUnitCode) {
    var cfg = getConfig();
    return (cfg.slots && adUnitCode && cfg.slots[adUnitCode]) || null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Element lookup
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Try to locate the iframe that sent the postMessage by comparing
   * `event.source` against every iframe's `contentWindow`.
   */
  function findIframeBySource(ev) {
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      try {
        if (iframes[i].contentWindow === ev.source) {
          return iframes[i];
        }
      } catch (e) {
        // Cross-origin access may throw — skip silently.
      }
    }
    return null;
  }

  /**
   * Look up the ad slot element via Google Publisher Tag (GPT) targeting.
   * Returns the visible iframe inside the slot container, or `null`.
   */
  function findIframeByGptAdId(adId) {
    if (!adId) return null;
    try {
      if (typeof window.googletag !== 'undefined' && window.googletag && typeof window.googletag.pubads === 'function') {
        var slots = window.googletag.pubads().getSlots();
        for (var i = 0; i < slots.length; i++) {
          var keys = slots[i].getTargetingKeys();
          for (var k = 0; k < keys.length; k++) {
            var values = slots[i].getTargeting(keys[k]);
            if (values && values.indexOf(adId) !== -1) {
              var el = document.getElementById(slots[i].getSlotElementId());
              if (el) {
                return el.querySelector('iframe:not([style*="display: none"])');
              }
            }
          }
        }
      }
    } catch (e) {
      // GPT may not be available.
    }
    return null;
  }

  /**
   * Look up an iframe via AppNexus AST tag (window.apntag).
   */
  function findIframeByApnTag(adUnitCode) {
    if (!adUnitCode) return null;
    try {
      if (typeof window.apntag !== 'undefined' && window.apntag && typeof window.apntag.getTag === 'function') {
        var tag = window.apntag.getTag(adUnitCode);
        if (tag && tag.targetId) {
          var el = document.getElementById(tag.targetId);
          if (el) {
            return el.querySelector('iframe:not([style*="display: none"])');
          }
        }
      }
    } catch (e) {
      // apntag may not be available.
    }
    return null;
  }

  /**
   * Locate the ad iframe using all available strategies.
   *
   * Priority:
   *  1. `event.source` matching (works for both same-origin and
   *     cross-origin iframes)
   *  2. GPT slot lookup by adId targeting
   *  4. Direct getElementById on adUnitCode
   */
  function findAdIframe(ev, adId, adUnitCode) {
    return findIframeBySource(ev)
      || findIframeByGptAdId(adId)
      || findIframeByApnTag(adUnitCode)
      || (function () {
        // Last resort: try the adUnitCode as a DOM id
        if (adUnitCode) {
          var el = document.getElementById(adUnitCode);
          if (el) {
            return el.querySelector('iframe:not([style*="display: none"])') || null;
          }
        }
        return null;
      })();
  }

  /**
   * Attempt to determine the adUnitCode (slot div id) from the iframe
   * that was found. Walks up the DOM looking for a div whose id could
   * be a slot container (heuristic: the first ancestor with an id).
   */
  function guessAdUnitCode(iframe) {
    if (!iframe) return null;
    var el = iframe.parentElement;
    while (el && el !== document.body) {
      if (el.id) return el.id;
      el = el.parentElement;
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Resize logic
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Convert a numeric pixel value to a CSS dimension string.
   * `null` / `undefined` / `0` → `'100%'`  (full-width behaviour).
   * Any positive number → `'<n>px'`.
   */
  function getDimension(value) {
    return value ? value + 'px' : '100%';
  }

  /**
   * Resolve the height to use. Priority:
   *  1. Publisher slot-level config (`slots[code].height`)
   *  2. Height sent in the postMessage (`data.height`)
   *  3. The iframe's computed height (via getComputedStyle)
   */
  function resolveHeight(slotCfg, data, iframe) {
    // 1. Publisher config
    if (slotCfg && typeof slotCfg.height === 'number' && slotCfg.height > 0) {
      return slotCfg.height;
    }
    // 2. Message payload
    if (typeof data.height === 'number' && data.height > 0) {
      return data.height;
    }
    // 3. Iframe's computed height
    if (iframe) {
      var computed = window.getComputedStyle(iframe);
      if (computed) {
        var h = parseInt(computed.height, 10);
        if (h > 0) return h;
      }
    }
    return null;
  }

  /**
   * Default resize: set width to 100 % and height to the resolved value
   * on both the iframe and its immediate parent element — identical to
   */
  function defaultResize(iframe, width, height) {
    var widthCSS = getDimension(width);
    var heightCSS = getDimension(height);

    [iframe, iframe.parentElement].forEach(function (el) {
      if (el && el.style) {
        el.style.width = widthCSS;
        el.style.height = heightCSS;
      }
    });

    // Also update iframe element attributes (GPT may use these).
    if (iframe) {
      if (width) {
        iframe.width = width;
      } else {
        iframe.width = '100%';
      }
      if (height) {
        iframe.height = height;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // postMessage handler
  // ──────────────────────────────────────────────────────────────────────

  function onMessage(ev) {
    // ── Parse the message ───────────────────────────────────────────
    var data;
    var raw = ev.data != null ? ev.data : ev.message;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw); } catch (e) { return; }
    } else if (typeof raw === 'object') {
      data = raw;
    } else {
      return;
    }

    // ── Is this a programmaticStretch message? ──────────────────────
    if (!data
      || data.message !== MESSAGE_CREATIVE
      || data.action !== ACTION_PROGRAMMATIC_STRETCH) {
      return;
    }

    var adId = data.adId || null;
    var adUnitCode = data.adUnitCode || null;

    // ── Check global enabled flag ───────────────────────────────────
    var cfg = getConfig();
    if (cfg.enabled === false) {
      logWarn('Received programmaticStretch message but script is globally disabled.');
      return;
    }

    // ── Find the ad iframe ──────────────────────────────────────────
    var iframe = findAdIframe(ev, adId, adUnitCode);
    if (!iframe) {
      logWarn('Received programmaticStretch message but could not locate the ad iframe (adId: ' + adId + ').');
      return;
    }

    // Resolve adUnitCode from the iframe if not provided
    if (!adUnitCode) {
      adUnitCode = guessAdUnitCode(iframe);
    }

    // ── Per-slot config ─────────────────────────────────────────────
    var slotCfg = getSlotConfig(adUnitCode);

    // ── Resolve height ──────────────────────────────────────────────
    var height = resolveHeight(slotCfg, data, iframe);

    // Width is always null (→ 100 %) in programmaticStretch, matching
    // the Prebid behaviour: `deps.resizeFn(null, bidResponse.height)`
    var width = null;

    // ── Custom resize function ──────────────────────────────────────
    if (slotCfg && typeof slotCfg.resizeFunction === 'function') {
      try {
        slotCfg.resizeFunction(adId, height, { iframe: iframe, event: ev });
      } catch (e) {
        logError('Custom resizeFunction threw: ' + (e && e.message));
      }
      return;
    }

    // Also check top-level resizeFunction
    if (typeof cfg.resizeFunction === 'function') {
      try {
        cfg.resizeFunction(adId, height, { iframe: iframe, event: ev });
      } catch (e) {
        logError('Custom resizeFunction threw: ' + (e && e.message));
      }
      return;
    }

    // ── Default resize ──────────────────────────────────────────────
    defaultResize(iframe, width, height);

    logInfo('programmaticStretch applied — adId: ' + adId + ', width: 100%, height: ' + (height || '100%'));
  }

  // ──────────────────────────────────────────────────────────────────────
  // Logging helpers
  // ──────────────────────────────────────────────────────────────────────

  var PREFIX = '[ProgrammaticStretch]';

  function logInfo() {
    if (typeof console !== 'undefined' && console.log) {
      var args = Array.prototype.slice.call(arguments);
      args.unshift(PREFIX);
      console.log.apply(console, args);
    }
  }

  function logWarn() {
    if (typeof console !== 'undefined' && console.warn) {
      var args = Array.prototype.slice.call(arguments);
      args.unshift(PREFIX);
      console.warn.apply(console, args);
    }
  }

  function logError() {
    if (typeof console !== 'undefined' && console.error) {
      var args = Array.prototype.slice.call(arguments);
      args.unshift(PREFIX);
      console.error.apply(console, args);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Bootstrap
  // ──────────────────────────────────────────────────────────────────────

  window.addEventListener('message', onMessage, false);

  logInfo('Listener registered — waiting for programmaticStretch messages.');

})(window, document);
