import { test, expect, Page } from '@playwright/test';

// ─── Helpers ────────────────────────────────────────────────────────────────

//scrollbars
const TOLERANCE = 2; // matches FULL_WIDTH_TOLERANCE in programmaticStretch.js

/** Collect console errors during the test. Call before navigating. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore favicon 404s — not relevant to the tests
      if (text.includes('favicon') || msg.location().url?.includes('favicon')) return;
      errors.push(text);
    }
  });
  page.on('pageerror', (err) => {
    errors.push(err.message);
  });
  return errors;
}

/** Wait until the ad iframe has stretched to full viewport width. */
async function waitForStretch(page: Page, iframeSelector = '#ad-iframe') {
  await expect(async () => {
    const result = await page.evaluate((sel) => {
      const iframe = document.querySelector(sel) as HTMLIFrameElement;
      if (!iframe) return { width: 0, vpWidth: 1 };
      const rect = iframe.getBoundingClientRect();
      return {
        width: rect.width,
        vpWidth: document.documentElement.clientWidth,
      };
    }, iframeSelector);
    expect(Math.abs(result.width - result.vpWidth)).toBeLessThanOrEqual(TOLERANCE);
  }).toPass({ timeout: 5000 });
}

/** Get bounding rect of an element. */
async function getRect(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
}

/** Assert no horizontal scrollbar is present. */
async function assertNoOverflow(page: Page) {
  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  expect(hasOverflow).toBe(false);
}

// ─── A. Simple single parent ────────────────────────────────────────────────

test.describe('Simple single parent', () => {
  test('ad stretches to full viewport width', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/tests/fixtures/simple-single-parent.html');
    await waitForStretch(page);

    // iframe height should be 250px
    const rect = await getRect(page, '#ad-iframe');
    expect(rect).not.toBeNull();
    expect(rect!.height).toBeCloseTo(250, 0);

    await assertNoOverflow(page);
    expect(errors.filter((e) => !e.includes('[ProgrammaticStretch]'))).toEqual([]);
  });
});

// ─── B. Simple single parent + safe frame ───────────────────────────────────

test.describe('Simple single parent + safe frame', () => {
  test('ad stretches through sandboxed iframe', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/tests/fixtures/simple-single-parent-safeframe.html');
    await waitForStretch(page);

    const rect = await getRect(page, '#ad-iframe');
    expect(rect).not.toBeNull();
    expect(rect!.height).toBeCloseTo(250, 0);

    await assertNoOverflow(page);
    expect(errors.filter((e) => !e.includes('[ProgrammaticStretch]'))).toEqual([]);
  });
});

// ─── C. Nested parent containers ────────────────────────────────────────────

test.describe('Nested parent containers', () => {
  test('ad stretches despite multiple constraining ancestors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/tests/fixtures/nested-parents.html');
    await waitForStretch(page);

    const rect = await getRect(page, '#ad-iframe');
    expect(rect).not.toBeNull();
    expect(rect!.height).toBeCloseTo(250, 0);

    // Intermediate containers should have been widened
    const adWrapperWidth = await page.evaluate(() => {
      const el = document.querySelector('[id="ad-slot"]');
      return el ? el.getBoundingClientRect().width : 0;
    });
    const vpWidth = await page.evaluate(() => document.documentElement.clientWidth);
    // The ad-wrapper or an ancestor should be at least viewport width
    expect(adWrapperWidth).toBeGreaterThanOrEqual(vpWidth - TOLERANCE);

    await assertNoOverflow(page);
    expect(errors.filter((e) => !e.includes('[ProgrammaticStretch]'))).toEqual([]);
  });
});

// ─── D. Nested parent containers + safe frame ──────────────────────────────

test.describe('Nested parent containers + safe frame', () => {
  test('ad stretches through sandboxed iframe with nested parents', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/tests/fixtures/nested-parents-safeframe.html');
    await waitForStretch(page);

    const rect = await getRect(page, '#ad-iframe');
    expect(rect).not.toBeNull();
    expect(rect!.height).toBeCloseTo(250, 0);

    await assertNoOverflow(page);
    expect(errors.filter((e) => !e.includes('[ProgrammaticStretch]'))).toEqual([]);
  });
});

// ─── E. Complex page layout ────────────────────────────────────────────────

test.describe('Complex page layout', () => {
  test('ad does not stretch to full width when sidebar is present', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/tests/fixtures/complex-layout.html');

    // Allow time for any stretch logic to run
    await page.waitForTimeout(1000);

    const vpWidth = await page.evaluate(() => document.documentElement.clientWidth);

    // Ad should NOT be full viewport width — the sidebar prevents it
    const adRect = await getRect(page, '#ad-iframe');
    expect(adRect).not.toBeNull();
    expect(adRect!.width).toBeLessThan(vpWidth - TOLERANCE);

    // Header is still at top-left of page
    const headerRect = await getRect(page, '[data-testid="header"]');
    expect(headerRect).not.toBeNull();
    expect(headerRect!.x).toBeCloseTo(0, 0);
    expect(headerRect!.y).toBeCloseTo(0, 0);
    expect(headerRect!.width).toBeGreaterThanOrEqual(vpWidth - TOLERANCE);

    // Footer is visible (has positive height and is in the document flow)
    const footerRect = await getRect(page, '[data-testid="footer"]');
    expect(footerRect).not.toBeNull();
    expect(footerRect!.height).toBeGreaterThan(0);

    // Sidebar is still visible and has not been pushed off-screen
    const sidebarRect = await getRect(page, '[data-testid="sidebar"]');
    expect(sidebarRect).not.toBeNull();
    expect(sidebarRect!.width).toBeGreaterThan(0);
    expect(sidebarRect!.height).toBeGreaterThan(0);
    expect(sidebarRect!.x).toBeGreaterThanOrEqual(0);
    expect(sidebarRect!.x + sidebarRect!.width).toBeLessThanOrEqual(vpWidth + TOLERANCE);

    // Main content didn't shift to a negative x position
    const mainRect = await getRect(page, '[data-testid="main-content"]');
    expect(mainRect).not.toBeNull();
    expect(mainRect!.x).toBeGreaterThanOrEqual(0);

    // Multi-column safety: structural wrappers should not be force-styled.
    const structuralInlineStyles = await page.evaluate(() => {
      var main = document.querySelector('[data-testid="main-content"]') as HTMLElement | null;
      var container = document.querySelector('[data-testid="container"]') as HTMLElement | null;
      return {
        mainWidth: main ? main.style.width : '',
        mainMaxWidth: main ? main.style.maxWidth : '',
        containerWidth: container ? container.style.width : '',
        containerMaxWidth: container ? container.style.maxWidth : ''
      };
    });
    expect(structuralInlineStyles.mainWidth).toBe('');
    expect(structuralInlineStyles.mainMaxWidth).toBe('');
    expect(structuralInlineStyles.containerWidth).toBe('');
    expect(structuralInlineStyles.containerMaxWidth).toBe('');

    await assertNoOverflow(page);
    expect(errors.filter((e) => !e.includes('[ProgrammaticStretch]'))).toEqual([]);
  });
});

// ─── F. Multiple ads ────────────────────────────────────────────────────────

test.describe('Multiple ads', () => {
  test('both ads stretch independently without breaking page', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/tests/fixtures/multiple-ads.html');

    // Wait for both ads
    await waitForStretch(page, '#ad-iframe-masthead');
    await waitForStretch(page, '#ad-iframe-incontent');

    const vpWidth = await page.evaluate(() => document.documentElement.clientWidth);

    // Masthead ad at full width, height 90
    const mastheadRect = await getRect(page, '#ad-iframe-masthead');
    expect(mastheadRect).not.toBeNull();
    expect(Math.abs(mastheadRect!.width - vpWidth)).toBeLessThanOrEqual(TOLERANCE);
    expect(mastheadRect!.height).toBeCloseTo(90, 0);

    // In-content ad at full width, height 250
    const incontentRect = await getRect(page, '#ad-iframe-incontent');
    expect(incontentRect).not.toBeNull();
    expect(Math.abs(incontentRect!.width - vpWidth)).toBeLessThanOrEqual(TOLERANCE);
    expect(incontentRect!.height).toBeCloseTo(250, 0);

    // Content between ads is visible (text-before and text-after)
    const textBefore = await getRect(page, '[data-testid="text-before"]');
    expect(textBefore).not.toBeNull();
    expect(textBefore!.height).toBeGreaterThan(0);

    const textAfter = await getRect(page, '[data-testid="text-after"]');
    expect(textAfter).not.toBeNull();
    expect(textAfter!.height).toBeGreaterThan(0);

    // In-content ad is below masthead ad (no overlap)
    expect(incontentRect!.y).toBeGreaterThan(mastheadRect!.y + mastheadRect!.height - 1);

    await assertNoOverflow(page);
    expect(errors.filter((e) => !e.includes('[ProgrammaticStretch]'))).toEqual([]);
  });
});

// ─── G. Page with vertical scrollbar ────────────────────────────────────────

test.describe('Page with vertical scrollbar', () => {
  test('ad stretches to full visible width without horizontal scrollbar', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/tests/fixtures/scrollbar-page.html');

    // Confirm the page actually has a vertical scrollbar
    const hasVerticalScrollbar = await page.evaluate(() => {
      return document.documentElement.scrollHeight > document.documentElement.clientHeight;
    });
    expect(hasVerticalScrollbar).toBe(true);

    await waitForStretch(page);

    const rect = await getRect(page, '#ad-iframe');
    expect(rect).not.toBeNull();
    expect(rect!.height).toBeCloseTo(250, 0);

    // The key assertion: no horizontal overflow despite a vertical scrollbar
    await assertNoOverflow(page);
    expect(errors.filter((e) => !e.includes('[ProgrammaticStretch]'))).toEqual([]);
  });
});

// ─── H. Full-width flex parent (not multi-column) ──────────────────────────

test.describe('Full-width flex parent', () => {
  test('ad stretches to full width when flex parent spans the viewport', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/tests/fixtures/full-width-flex-parent.html');
    await waitForStretch(page);

    const vpWidth = await page.evaluate(() => document.documentElement.clientWidth);

    // Ad should be full viewport width — the full-width flex parent
    // should not be treated as a multi-column constraint.
    const adRect = await getRect(page, '#ad-iframe');
    expect(adRect).not.toBeNull();
    expect(Math.abs(adRect!.width - vpWidth)).toBeLessThanOrEqual(TOLERANCE);
    expect(adRect!.height).toBeCloseTo(250, 0);

    await assertNoOverflow(page);
    expect(errors.filter((e) => !e.includes('[ProgrammaticStretch]'))).toEqual([]);
  });
});

/** Assert that the given iframe has NOT been stretched to full viewport width. */
async function assertNotStretched(page: Page, iframeSelector: string) {
  await page.waitForTimeout(800);
  const result = await page.evaluate((sel) => {
    const iframe = document.querySelector(sel) as HTMLIFrameElement;
    const rect = iframe ? iframe.getBoundingClientRect() : { width: 0 };
    return { width: rect.width, vpWidth: document.documentElement.clientWidth };
  }, iframeSelector);
  expect(result.width).toBeLessThan(result.vpWidth - TOLERANCE);
}

// ─── J. Per-slot enabled — denylist ────────────────────────────────────────

test.describe('Per-slot enabled — denylist', () => {
  test('disabled slot does not stretch; non-configured slot stretches normally', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/tests/fixtures/per-slot-enabled-denylist.html');

    // The slot with no per-slot config inherits global enabled:true and should stretch
    await waitForStretch(page, '#ad-iframe-allowed');

    // The slot with enabled:false should not stretch
    await assertNotStretched(page, '#ad-iframe-denied');

    await assertNoOverflow(page);
    expect(errors.filter((e) => !e.includes('[ProgrammaticStretch]'))).toEqual([]);
  });
});

// ─── K. Per-slot enabled — allowlist ───────────────────────────────────────

test.describe('Per-slot enabled — allowlist', () => {
  test('only the allowlisted slot stretches; globally-disabled slots do not', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/tests/fixtures/per-slot-enabled-allowlist.html');

    // The slot with enabled:true overrides the global enabled:false and stretches
    await waitForStretch(page, '#ad-iframe-allowed');

    // The slot with no per-slot config is blocked by global enabled:false
    await assertNotStretched(page, '#ad-iframe-other');

    await assertNoOverflow(page);
    expect(errors.filter((e) => !e.includes('[ProgrammaticStretch]'))).toEqual([]);
  });
});

// ─── I. Viewport resize ────────────────────────────────────────────────────

test.describe('Viewport resize', () => {
  test('ad stays full width after viewport resize', async ({ page }) => {
    await page.goto('/tests/fixtures/nested-parents.html');
    await waitForStretch(page);

    // Resize viewport from 1280 → 800
    await page.setViewportSize({ width: 800, height: 720 });

    // Give the throttled resize handler time to fire (100ms + buffer)
    await page.waitForTimeout(300);

    // Ad should still be full width at the new viewport size
    await waitForStretch(page);

    const vpWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(vpWidth).toBe(800);

    await assertNoOverflow(page);
  });
});