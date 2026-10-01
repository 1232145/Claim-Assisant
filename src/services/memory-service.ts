import type { ExtractedMessageSignals } from "../shared/index.js";
import type { RememberedHints, SessionState } from "../shared/index.js";
import { normalizeText } from "./fixture-loader.js";

const months = "january|february|march|april|may|june|july|august|september|october|november|december";

/** Returns the first capture group matched by a regular expression. */
function firstMatch(message: string, pattern: RegExp): string | undefined {
  return pattern.exec(message)?.[1];
}

/**
 * Extracts non-sensitive claim-selection hints from every caller message.
 * These hints are intentionally advisory and do not include protected claim
 * facts obtained from fixtures.
 */
export function extractRememberedHints(message: string): RememberedHints {
  const normalized = normalizeText(message);
  const claimType = firstMatch(normalized, /\b(healthcare|medical|dental|auto|automobile)\s+claim\b/);
  const status = firstMatch(normalized, /\b(denied|closed|open|approved|pending|paid|settled|completed|in\s+progress)\b(?=\s+(?:\w+\s+){0,2}claim\b)/)
    ?? firstMatch(normalized, /\bclaim\b\s+(?:was\s+)?\b(denied|closed|open|approved|pending|paid|settled|completed|in\s+progress)\b/);
  const dateReference = firstMatch(normalized, new RegExp(`\\b(${months})(?:\\s+\\d{4})?\\b`))
    ?? firstMatch(normalized, /\b(20\d{2})\b/);
  return {
    ...(claimType ? { claimType: claimType === "medical" ? "healthcare" : claimType === "automobile" ? "auto" : claimType } : {}),
    ...(status ? { status: ["paid", "settled", "completed"].includes(status) ? "closed" : status === "in progress" ? "open" : status } : {}),
    ...(dateReference ? { dateReference } : {}),
    ...(message.trim() ? { rawText: message } : {}),
  };
}

/**
 * Merges newly extracted hints into session memory without deleting existing
 * hints. Memory may inform later intent/claim selection, but never authorizes
 * a phase transition or exposes protected claim data.
 */
export function mergeRememberedHints(current: RememberedHints, incoming: RememberedHints): RememberedHints {
  return {
    ...current,
    ...(incoming.claimType ? { claimType: incoming.claimType } : {}),
    ...(incoming.status ? { status: incoming.status } : {}),
    ...(incoming.dateReference ? { dateReference: incoming.dateReference } : {}),
    ...(incoming.rawText ? { rawText: incoming.rawText } : {}),
  };
}

/**
 * Returns a copied session state with the current message's claim hints
 * captured. The input state is not mutated and its workflow phase is preserved.
 */
export function captureMessageMemory(state: SessionState, message: string): SessionState {
  return { ...state, rememberedHints: mergeRememberedHints(state.rememberedHints, extractRememberedHints(message)) };
}

/**
 * Combines deterministic memory extraction with model-provided signals so the
 * adapter cannot accidentally discard useful hints from the raw user message.
 */
export function signalsWithCapturedMemory(signals: ExtractedMessageSignals, message: string): ExtractedMessageSignals {
  return {
    ...signals,
    // The raw caller message is authoritative for selection hints. Provider
    // hints may supplement fields the local extractor missed, but cannot
    // overwrite an explicit status, type, or date from the message.
    rememberedHints: mergeRememberedHints(signals.rememberedHints, extractRememberedHints(message)),
  };
}
