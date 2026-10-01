import type {
  ScopeEmotionAnalysis,
  ScopeEmotionAnalyzer,
} from "../shared/contracts.js";
import type { SessionState } from "../shared/types.js";
import { isIdentityRefusal } from "./identity-service.js";

const inScopePattern = /\b(?:insurance|claims?|cases?|matter|issue|policy|policyholder|identity|verify|verification|denial|denied|documents?|paperwork|submissions?|files?|appeal|processing|review|next|steps?|needed|reimburse|payment|status|coverage|summary|summarize|about|representative|human|agent|what\s+(?:do\s+i|i)\s+have|tell\s+me|talk\s+about|go\s+over|explain|all\s+of\s+them)\b/i;
const explicitOutOfScopePattern = /\b(?:weather|recipe|recipes|sports?|football|basketball|news|politics|program(?:ming|me)|code|coding|javascript|typescript|math|mathematics|rl)\b/i;
const questionPattern = /\?|\b(?:what|why|when|where|how|can|could|would|is|are|do|does)\b/i;
const greetingPattern = /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))\b[!.\s]*$/i;
const identityAnswerPattern = /\b(?:my\s+name\s+is|name\s+is|call\s+me|policy(?:\s+number)?\s*(?:is|:)|dob|date\s+of\s+birth|phone|email|ssn|last\s+four)\b/i;
const capabilityQuestionPattern = /\b(?:what|how)\s+can\s+you\s+(?:help|do|assist)(?:\s+me)?(?:\s+with)?\b|\bwhat\s+(?:kind\s+of\s+)?(?:help|support)\s+(?:is\s+)?available\b/i;

/** Recognizes questions about the assistant's capabilities, not a claim answer. */
export function isCapabilityQuestion(message: string): boolean {
  return capabilityQuestionPattern.test(message);
}

/** Detects a direct request to be transferred to a person. */
export function requestsHumanRepresentative(message: string): boolean {
  return /\b(?:speak|talk|connect|transfer|put me)\b.{0,30}\b(?:human|person|representative|agent)\b/i.test(message)
    || /\b(?:human|person|representative|agent)\b.{0,30}\b(?:please|now|instead|help)\b/i.test(message)
    || /\b(?:real person|live agent|human assistance)\b/i.test(message);
}

/** Classifies the caller's emotional state with deterministic, privacy-safe rules. */
export function detectEmotionalState(message: string): ScopeEmotionAnalysis["emotionalState"] {
  if (isIdentityRefusal(message)) return "refusal";
  if (/\b(?:furious|怒|enough|ridiculous|outrageous|unacceptable|damn|angry|mad)\b|!{2,}/i.test(message)) return "angry";
  if (/\b(?:frustrat(?:ed|ing)|annoyed|tired of|sick of|fed up|ridiculous|again)\b/i.test(message)) return "frustrated";
  if (/\b(?:anxious|worried|worry|stress(?:ed)?|nervous|scared|concerned|afraid)\b/i.test(message)) return "anxious";
  if (/\b(?:confused|unclear|don't understand|do not understand|what does that mean|help me understand)\b/i.test(message)) return "confused";
  return "neutral";
}

/** Returns a short, safe response lead-in appropriate to the detected emotion. */
export function empathyGuidance(emotionalState: ScopeEmotionAnalysis["emotionalState"]): string {
  switch (emotionalState) {
    case "refusal":
      return "I understand you would rather not provide more information. Verification protects your claim information, so please share at least three accepted identity details or ask for a human representative.";
    case "angry":
      return "I’m sorry this has been frustrating. I need to follow the verification and claim-support steps to protect your information, and I can connect you with a human representative if you prefer.";
    case "frustrated":
      return "I understand this is frustrating. I’ll keep this focused and help with the next available insurance-claims step.";
    case "anxious":
      return "I understand this may feel stressful. I’ll explain each step clearly and help you move forward with your claim.";
    case "confused":
      return "I can walk through this one step at a time and clarify the insurance-claims process.";
    case "neutral":
      return "I can help with insurance claims, identity verification, documents, status, or next steps.";
  }
}

/** Deterministically identifies messages outside the insurance-claims support scope. */
export function isOutOfScopeMessage(message: string): boolean {
  const normalized = message.trim();
  if (!normalized || greetingPattern.test(normalized)) return false;
  if (isCapabilityQuestion(normalized)) return false;
  if (/\b(?:what happened with it|what about it|tell me more|and what about that)\b/i.test(normalized)) return false;
  if (identityAnswerPattern.test(normalized)) return false;
  if (explicitOutOfScopePattern.test(normalized)) return true;
  if (inScopePattern.test(normalized)) return false;
  // Ambiguous questions are not automatically out of scope. The LLM gets the
  // conversation context and can interpret them as claim-support requests.
  return false;
}

/** Provides the authoritative scope, emotion, refusal, and transfer signals to the workflow. */
export class DeterministicScopeEmotionAnalyzer implements ScopeEmotionAnalyzer {
  analyze(_state: SessionState, message: string): ScopeEmotionAnalysis {
    const emotionalState = detectEmotionalState(message);
    const requestsHuman = requestsHumanRepresentative(message);
    const identityRefusal = emotionalState === "refusal";
    return {
      isOutOfScope: !requestsHuman && isOutOfScopeMessage(message),
      emotionalState,
      requestsHuman,
      identityRefusal,
      guidance: empathyGuidance(emotionalState),
    };
  }
}

export const defaultScopeEmotionAnalyzer = new DeterministicScopeEmotionAnalyzer();
