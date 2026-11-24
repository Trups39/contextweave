import { err, ok, type RawCapture, type Result } from '@contextweave/core';

/**
 * Browser adapter: reads the active tab ONLY when the user clicks Save or
 * Re-check. Nothing runs in the background and no page scripts are executed;
 * we inject one self-contained function that returns visible text.
 *
 * Permissions, narrowest first:
 *  - the hosted demo origin is declared at build time (see vite.config.ts);
 *  - `activeTab` covers any page after the user clicks the toolbar icon;
 *  - after a successful capture we ask once to remember THAT site only, so a
 *    reload (which drops activeTab) does not break Re-check. Never "all sites".
 */

/** Runs inside the page. Must not reference anything outside its own body. */
function readPage() {
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const root = document.querySelector('main, article, [role="main"]') ?? document.body;
  const headings = [...root.querySelectorAll('h1, h2, h3')]
    .map((h) => (h as HTMLElement).innerText.trim())
    .filter(Boolean);
  return {
    url: location.href,
    canonicalUrl: canonical,
    title: document.title,
    text: (root as HTMLElement).innerText,
    headings,
    selection: window.getSelection()?.toString() ?? '',
  };
}

export async function captureActiveTab(): Promise<Result<RawCapture>> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return err('INVALID_INPUT', 'No active tab.');
  let frame;
  try {
    [frame] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
  } catch (e) {
    const msg = (e as Error).message;
    if (/permission|Cannot access contents/i.test(msg)) {
      return err('PERMISSION_NEEDED', 'ContextWeave can\'t read this page yet. Click the ContextWeave toolbar icon while on this page, then try again.');
    }
    return err('UNSUPPORTED_URL', `Cannot read this page (${msg}). Chrome pages and the Web Store can't be captured.`);
  }
  const r = frame?.result;
  if (!r) return err('EMPTY_CAPTURE', 'The page returned no content.');
  return ok({
    url: r.url,
    ...(r.canonicalUrl ? { canonicalUrl: r.canonicalUrl } : {}),
    title: r.title,
    text: r.text,
    // Offsets are re-derived from clean text by the core pipeline.
    sections: r.headings.map((heading) => ({ heading, start: -1 })),
    ...(r.selection.trim() ? { selection: r.selection } : {}),
    userInitiated: true,
  });
}

/**
 * Ask (once per site) to keep access to the site the user just captured, so a
 * later Re-check works after the page reloads. Best-effort: if Chrome declines
 * or the click's user activation has expired, the activeTab path still works.
 */
export async function rememberSite(url: string): Promise<void> {
  let origins: string[];
  try {
    origins = [`${new URL(url).origin}/*`];
  } catch {
    return;
  }
  try {
    if (await chrome.permissions.contains({ origins })) return;
    await chrome.permissions.request({ origins });
  } catch { /* not fatal */ }
}
