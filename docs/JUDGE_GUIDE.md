# Judge guide

## Requirements

- **Chrome desktop 139 or later** (Windows, macOS or Linux).
- For on-device extraction: a device that meets Chrome's built-in AI hardware and storage requirements, with the Gemini Nano model downloaded. Check Google's current guide: <https://developer.chrome.com/docs/ai/get-started>.
- **No supported hardware?** Every step except AI extraction still works. Highlight a sentence and use **Save selection**. Verification, linking, re-check and flagging are plain code.

## Install

1. Download `contextweave-extension.zip` from the latest GitHub release and unzip it.
   Or build it yourself: `npm install && npm run build`, then use `apps/extension/dist`.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the unzipped folder.
3. Click the ContextWeave toolbar icon to open the side panel.
4. Optional, for Cloud review: open **Diagnostics** in the side panel, paste the App Check debug token from the private testing instructions, and click **Save token & reload**.

## Walkthrough

Demo page: `https://YOUR-PROJECT.web.app/docs/`. Provider A is fictional; the yellow bar switches versions at the same URL.

1. With **v1 · 1,000** selected, click **Save evidence**. The demo site needs no extra permission. On other sites, Chrome asks once to allow that site only. The first on-device run can take 10–20 seconds while the model loads. Claims appear with **Verified exact** and **ON_DEVICE** badges. Without Nano, highlight the rate-limit sentence and click **Save selection**. Its badge reads **Manual**.
2. Create a decision, for example *Which provider for ingestion?* → *Provider A*. On the rate-limit claim, click **Link to decision**.
3. Click **v2 · 300** on the page, then **Re-check this page** in the side panel. The decision shows **NEEDS_REVIEW** with the old and new sentences highlighted.
4. Optional: click **Cloud review…**, read the JSON, then click **Send** (or **Cancel**; nothing is sent).
5. Click **Keep** or **Revise…**. **Revise…** can switch the decision's evidence to the current sentence. Open **History** to see the audit trail.
6. Click **v2 + unrelated edit**, then **Re-check**. Nothing new is flagged. Click **v3 · 500**, then **Re-check**. The decision is flagged again.

## Troubleshooting

- **"Nano: unavailable" or "downloadable"**: the model isn't ready on this device. Use **Save selection**.
- **Cloud review fails with an App Check error**: the debug token is missing or was revoked.
- **"Cannot read this page"**: `chrome://` pages and the Chrome Web Store can't be captured.
- **"Can't read this page yet"**: click the ContextWeave toolbar icon while on the page, then try again.
- **"Gemini in the cloud is busy"**: a temporary overload on Google's side. Wait a minute and retry; nothing was changed.
