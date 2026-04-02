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
  var VERSION = '__VERSION__';

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

  /** Tolerance in px — an element within this of viewport width is "full width". */
  var FULL_WIDTH_TOLERANCE = 2;
  var COLUMN_ALIGNMENT_TOLERANCE = 8;
  var MAX_MULTI_COLUMN_STRETCH_DEPTH = 3;

  /**
   * Check whether an element already spans the full viewport width.
   */
  function isFullWidth(el) {
    var vpWidth = document.documentElement.clientWidth;
    var rect = el.getBoundingClientRect();
    return (Math.abs(rect.width - vpWidth) <= FULL_WIDTH_TOLERANCE)
      && (Math.abs(rect.left) <= FULL_WIDTH_TOLERANCE);
  }

  /**
   * Return true when a container has at least two child elements that are
   * visually side-by-side (same row, different x positions).
   */
  function hasSideBySideChildren(parent) {
    var siblings = parent.children;
    var boxes = [];
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i].nodeType !== 1) continue;
      var sStyle = window.getComputedStyle(siblings[i]);
      if (sStyle.display === 'none' || sStyle.visibility === 'hidden') continue;
      var rect = siblings[i].getBoundingClientRect();
      if (rect.width <= FULL_WIDTH_TOLERANCE || rect.height <= FULL_WIDTH_TOLERANCE) continue;
      boxes.push(rect);
    }

    if (boxes.length < 2) return false;

    for (var a = 0; a < boxes.length; a++) {
      for (var b = a + 1; b < boxes.length; b++) {
        var rectA = boxes[a];
        var rectB = boxes[b];
        var verticalOverlap = Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top);
        var sameRow = Math.abs(rectA.top - rectB.top) <= COLUMN_ALIGNMENT_TOLERANCE || verticalOverlap > COLUMN_ALIGNMENT_TOLERANCE;
        var differentColumns = Math.abs(rectA.left - rectB.left) > FULL_WIDTH_TOLERANCE;
        if (sameRow && differentColumns) return true;
      }
    }

    return false;
  }

  /**
   * Check whether an element (or any of its ancestors) sits inside a
   * multi-column area that should not be broken out of.
   */
  function isMultiColumnChild(el) {
    var current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      var parent = current.parentElement;
      if (!parent) break;

      // A full-width parent means the ad can safely break out — not multi-column.
      if (isFullWidth(parent)) return false;

      var parentStyle = window.getComputedStyle(parent);
      var display = parentStyle.display;
      var isFlex = display.indexOf('flex') !== -1;
      var isGrid = display.indexOf('grid') !== -1;
      var isColumnFlow = parentStyle.columnCount !== 'auto' && parseInt(parentStyle.columnCount, 10) > 1;

      // For flex containers, only row/row-reverse indicates column layout.
      if (isFlex && parentStyle.flexDirection.indexOf('column') !== -1) {
        isFlex = false;
      }

      var hasColumns = hasSideBySideChildren(parent);
      if ((isFlex || isGrid || isColumnFlow || hasColumns) && hasColumns) {
        return true;
      }

      current = parent;
    }
    return false;
  }

  /**
   * Return the number of visible, layout-relevant child elements.
   */
  function getVisibleMeaningfulChildCount(el) {
    var children = el.children;
    var count = 0;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.nodeType !== 1) continue;
      var tag = child.tagName ? child.tagName.toLowerCase() : '';
      if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta') continue;
      var cs = window.getComputedStyle(child);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var rect = child.getBoundingClientRect();
      if (rect.width <= FULL_WIDTH_TOLERANCE || rect.height <= FULL_WIDTH_TOLERANCE) continue;
      count++;
    }
    return count;
  }

  /**
   * Heuristic guard: allow multi-column stretch only on ad-scoped wrappers.
   */
  function isSafeMultiColumnStretchTarget(el, adHeight) {
    if (!el || el === document.body || el === document.documentElement) return false;

    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'main' || tag === 'section' || tag === 'article' || tag === 'aside'
      || tag === 'header' || tag === 'footer' || tag === 'nav') {
      return false;
    }

    var idClass = ((el.id || '') + ' ' + (el.className || '')).toLowerCase();
    if (/\b(content|main|section|layout|container|grid|row|column|sidebar|wrapper|shell)\b/.test(idClass)) {
      return false;
    }

    var cs = window.getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'sticky' || cs.display === 'contents') return false;

    if (adHeight > 0 && getOuterHeight(el) > adHeight + FULL_WIDTH_TOLERANCE) return false;
    if (hasSideBySideChildren(el)) return false;

    return getVisibleMeaningfulChildCount(el) <= 1;
  }

  /**
   * Return the outer height of an element (border-box height + margins).
   */
  function getOuterHeight(el) {
    var rect = el.getBoundingClientRect();
    return rect.height;
  }

  /**
   * Return true if an element has a scrollable overflow style on the X axis
   * (i.e. `overflow[-x]: auto | scroll`).  Such an element will grow a
   * horizontal scrollbar if a child is wider than it — so the breakout must
   * be applied to *this* element rather than to a child inside it.
   */
  function hasScrollbarOverflow(el) {
    var cs = window.getComputedStyle(el);
    var ox = cs.overflowX !== 'visible' ? cs.overflowX : cs.overflow;
    return ox === 'auto' || ox === 'scroll';
  }

  /**
   * Apply the breakout to a single element so it spans the full visible
   * viewport width.  Uses `document.documentElement.clientWidth` which
   * excludes any vertical scrollbar, avoiding horizontal overflow.
   */
  function applyBreakout(el) {
    var vpWidth = document.documentElement.clientWidth;
    el.style.maxWidth = 'none';
    el.style.boxSizing = 'border-box';
    // Reset margin before measuring so getBoundingClientRect is accurate
    el.style.marginLeft = '0';
    el.style.width = vpWidth + 'px';
    var left = el.getBoundingClientRect().left;
    el.style.marginLeft = (-left) + 'px';
  }

  /**
   * Walk up the DOM from `startEl` towards `<body>`.
   *
   * For every ancestor that is narrower than the viewport:
   *   – Set it to `width: 100%` and neutralise `max-width`, `padding`,
   *     `box-sizing`, and `overflow` so it no longer constrains children.
   *
   * The *first* ancestor whose parent IS the full viewport width (or
   * `<body>` / `<html>`) receives a pixel-based breakout that pins it
   * to the left edge of the viewport at the exact `clientWidth`
   * (which excludes the scrollbar, preventing horizontal overflow).
   *
   * Returns an array of elements that were modified (used by the resize
   * handler to reapply).
   */
  function walkAndStretch(startEl, adHeight) {
    var modified = [];
    var el = startEl;
    var prevEl = null;

    // If the ad sits anywhere inside a multi-column (flex/grid) layout,
    // only apply guarded width:100% on ad-scoped wrappers — no breakout.
    if (isMultiColumnChild(startEl)) {
      var depth = 0;
      while (el && el !== document.body && el !== document.documentElement) {
        if (!isSafeMultiColumnStretchTarget(el, adHeight)) break;
        el.style.width = '100%';
        el.style.maxWidth = 'none';
        el.style.boxSizing = 'border-box';
        modified.push({ el: el, role: 'stretch' });

        var next = el.parentElement;
        depth++;
        if (!next || depth >= MAX_MULTI_COLUMN_STRETCH_DEPTH) break;
        if (!isSafeMultiColumnStretchTarget(next, adHeight)) break;

        el = next;
      }
      return modified;
    }

    while (el && el !== document.body && el !== document.documentElement) {
      var cs = window.getComputedStyle(el);

      // Stop if this element is taller than the ad — it likely contains
      // other content and stretching it would break the page layout.
      if (adHeight > 0 && getOuterHeight(el) > adHeight + FULL_WIDTH_TOLERANCE) {
        if (prevEl) {
          applyBreakout(prevEl);
          for (var m = 0; m < modified.length; m++) {
            if (modified[m].el === prevEl) {
              modified[m].role = 'breakout';
              break;
            }
          }
        }
        break;
      }

      // Fix overflow that would clip the breakout
      if (cs.overflow === 'hidden' || cs.overflowX === 'hidden') {
        el.style.overflowX = 'visible';
      }
      // Fix CSS containment
      if (cs.contain && cs.contain !== 'none') {
        el.style.contain = 'none';
      }

      if (isFullWidth(el)) {
        // This element is already full width.
        // Normally the breakout targets the previous (inner) element.
        // Exception: if el has scrollable overflow (auto/scroll) a breakout
        // on prevEl would make el grow a horizontal scrollbar — move one
        // parent higher and break out el itself instead.
        if (prevEl) {
          if (hasScrollbarOverflow(el)) {
            applyBreakout(el);
            modified.push({ el: el, role: 'breakout' });
          } else {
            applyBreakout(prevEl);
            // Update its role in modified list
            for (var m = 0; m < modified.length; m++) {
              if (modified[m].el === prevEl) {
                modified[m].role = 'breakout';
                break;
              }
            }
          }
        }
        break;
      }

      // Check if the *parent* is full-width (or is body/html).
      var parent = el.parentElement;
      if (!parent
        || parent === document.body
        || parent === document.documentElement
        || isFullWidth(parent)) {

        if (prevEl) {
          // Normally apply breakout to the previous (inner) element.
          // Exception: if el has scrollable overflow (auto/scroll) the
          // breakout on prevEl would give el a horizontal scrollbar — move
          // one parent higher and break out el itself instead.
          // (The height check is already guaranteed to have passed for el
          //  since it runs earlier in the loop — this stays within bounds.)
          if (hasScrollbarOverflow(el)) {
            applyBreakout(el);
            modified.push({ el: el, role: 'breakout' });
          } else {
            applyBreakout(prevEl);
            for (var m = 0; m < modified.length; m++) {
              if (modified[m].el === prevEl) {
                modified[m].role = 'breakout';
                break;
              }
            }
          }
        } else {
          // Only one constraining element — apply breakout directly.
          applyBreakout(el);
          modified.push({ el: el, role: 'breakout' });
        }
        break;
      }

      // Intermediate ancestor — make it fill its parent for now
      el.style.width = '100%';
      el.style.maxWidth = 'none';
      el.style.boxSizing = 'border-box';
      el.style.margin = '0';
      el.style.padding = '0';
      modified.push({ el: el, role: 'stretch' });

      prevEl = el;
      el = parent;
    }

    return modified;
  }

  /**
   * Re-apply the breakout after a viewport resize.
   * Stretched (100%) elements stay fine, but the breakout element
   * needs its width and margin recalculated for the new viewport.
   */
  function reapplyBreakout(modified) {
    for (var i = 0; i < modified.length; i++) {
      var entry = modified[i];
      if (entry.role === 'breakout') {
        applyBreakout(entry.el);
      }
    }
  }

  /**
   * Default resize: walks up the DOM from the iframe making every
   * constraining ancestor 100 % wide, then applies a pixel-based
   * breakout on the outermost constraining wrapper so the ad spans
   * the full visible viewport (excluding any scrollbar).
   */
  function defaultResize(iframe, width, height) {
    var heightCSS = getDimension(height);

    // 1. Size the iframe to fill its container
    iframe.style.width = '100%';
    iframe.style.height = heightCSS;
    iframe.width = '100%';
    if (height) {
      iframe.height = height;
    }

    // 2. Size the immediate container
    var container = iframe.parentElement;
    if (!container || container === document.body) return;
    container.style.width = '100%';
    container.style.height = heightCSS;
    container.style.maxWidth = 'none';

    // 3. Walk up the DOM — stretch intermediates, breakout at the edge
    var modified = walkAndStretch(container, height);

    // 4. Recalculate on viewport resize (throttled)
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        reapplyBreakout(modified);
      }, 100);
    });
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

  window.programmaticStretch = window.programmaticStretch || {};
  window.programmaticStretch.version = VERSION;

  window.addEventListener('message', onMessage, false);

  logInfo('Listener registered — waiting for programmaticStretch messages.');

})(window, document);
