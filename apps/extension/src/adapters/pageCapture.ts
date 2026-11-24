import { err, ok, type RawCapture, type Result } from '@contextweave/core';

/**
 * Browser adapter: reads the active tab ONLY when the user clicks Save or
 * Re-check. Nothing runs in the background and no page scripts are executed;
 * we inject one self-contained function that returns visible text.
 *
 * Permission trade-off: `activeTab` alone is lost when the page reloads
 * (e.g. the demo's v1→v2 toggle), so the first capture asks once for optional
 * http(s) host access. Code paths still only read a page on an explicit click.
 */

const HOSTS = { origins: ['https://*/*', 'http://*/*'] };

export async function ensureHostAccess(): Promise<boolean> {
  if (await chrome.permissions.contains(HOSTS)) return true;
  // Must run inside the click's user activation.
  return chrome.permissions.request(HOSTS);
}

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
  try {
    const [frame] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
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
  } catch (e) {
    return err('UNSUPPORTED_URL', `Cannot read this page (${(e as Error).message}). Chrome pages and the Web Store are not capturable.`);
  }
}
