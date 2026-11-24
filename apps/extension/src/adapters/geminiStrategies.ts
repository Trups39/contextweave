import { getGenerativeModel, InferenceMode, InferenceSource as SdkSource } from 'firebase/ai';
import {
  buildExtractionPrompt, err, EXTRACTION_SCHEMA, mergeCandidates, ok, parseExtractionResponse,
  planExtractionInputs, type CandidateClaim, type ClaimExtractor, type CloudReviewer,
  type ExtractionInput, type ExtractionOutput, type InferenceSource, type Result,
} from '@contextweave/core';
import { initFirebase } from './firebase.ts';
import { config } from '../config.ts';

/** Provenance comes from the SDK response, never from the mode we requested. */
function mapSource(s: string | undefined): InferenceSource | undefined {
  if (s === SdkSource.ON_DEVICE) return 'ON_DEVICE';
  if (s === SdkSource.IN_CLOUD) return 'IN_CLOUD';
  return undefined;
}

const ENGLISH = [{ type: 'text' as const, languages: ['en'] }];

/**
 * MODEL strategy: Gemini Nano via Firebase AI Logic, ONLY_ON_DEVICE.
 * Fails closed: if the local model is missing, or a response does not report
 * ON_DEVICE, we return an error. There is no cloud fallback on this path.
 */
export class GeminiNanoExtractor implements ClaimExtractor {
  readonly method = 'MODEL' as const;

  async extract(input: ExtractionInput): Promise<Result<ExtractionOutput>> {
    const fb = await initFirebase();
    if (!('ai' in fb)) return err('MODEL_UNAVAILABLE', fb.status.problem ?? 'Firebase is not configured.');
    const model = getGenerativeModel(fb.ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: { expectedInputs: ENGLISH, expectedOutputs: ENGLISH },
        promptOptions: { responseConstraint: EXTRACTION_SCHEMA },
      },
    });
    const started = performance.now();
    const lists: CandidateClaim[][] = [];
    for (const chunk of planExtractionInputs(input)) {
      let text: string;
      let source: InferenceSource | undefined;
      try {
        const res = await model.generateContent(buildExtractionPrompt(chunk));
        text = res.response.text();
        source = mapSource(res.response.inferenceSource);
      } catch (e) {
        return err('MODEL_UNAVAILABLE', `On-device model unavailable: ${(e as Error).message}. Use "Save selection" instead.`);
      }
      if (source !== 'ON_DEVICE') {
        return err('MODEL_UNAVAILABLE', `Expected ON_DEVICE inference but the SDK reported ${source ?? 'no source'}; result discarded.`);
      }
      const parsed = parseExtractionResponse(text);
      if (!parsed.ok) return parsed;
      lists.push(parsed.value);
    }
    return ok({ candidates: mergeCandidates(lists), inferenceSource: 'ON_DEVICE', latencyMs: Math.round(performance.now() - started) });
  }
}

/** Warm-up: create the on-device session early so the first real call is faster. */
export async function warmUpNano(): Promise<void> {
  const fb = await initFirebase();
  if (!('ai' in fb)) return;
  try {
    const model = getGenerativeModel(fb.ai, { mode: InferenceMode.ONLY_ON_DEVICE });
    await model.generateContent('Reply with OK.');
  } catch { /* availability is reported by diagnostics */ }
}

/** Transient cloud failures worth retrying: overload, unavailable, rate limit. */
const TRANSIENT = /\[(429|500|503)\b|high demand|overloaded|unavailable/i;
const RETRY_DELAYS_MS = [1_500, 4_000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cloud strategy: ONLY_IN_CLOUD, called solely after explicit consent (see service.cloudReview). */
export class GeminiCloudReviewer implements CloudReviewer {
  async review(payloadJson: string) {
    const fb = await initFirebase();
    if (!('ai' in fb)) return err<never>('MODEL_UNAVAILABLE', fb.status.problem ?? 'Firebase is not configured.');
    const model = getGenerativeModel(fb.ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: { model: config.cloudModel } });
    const prompt = `You review research decisions. Follow "instruction" in this JSON exactly.\n${payloadJson}`;
    const started = performance.now();
    let lastError = '';
    // The same consented payload is re-sent; nothing new leaves the device on retry.
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await model.generateContent(prompt);
        const source = mapSource(res.response.inferenceSource);
        return ok({ text: res.response.text(), latencyMs: Math.round(performance.now() - started), ...(source ? { inferenceSource: source } : {}) });
      } catch (e) {
        lastError = (e as Error).message;
        if (!TRANSIENT.test(lastError) || attempt === RETRY_DELAYS_MS.length) break;
        await sleep(RETRY_DELAYS_MS[attempt]!);
      }
    }
    const friendly = TRANSIENT.test(lastError)
      ? 'Gemini in the cloud is busy right now. Your decision is unchanged; try Cloud review again in a minute.'
      : `Cloud review failed: ${lastError}`;
    return err<never>('MODEL_UNAVAILABLE', friendly);
  }
}

/** Chrome Prompt API availability, for Diagnostics only (not used for routing). */
export async function nanoAvailability(): Promise<string> {
  const lm = (globalThis as { LanguageModel?: { availability(o?: object): Promise<string> } }).LanguageModel;
  if (!lm) return 'unsupported (no Prompt API in this Chrome)';
  try {
    return await lm.availability({ expectedInputs: ENGLISH, expectedOutputs: ENGLISH });
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}
