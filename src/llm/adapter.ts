import type {
  ClaimIntent,
  EmotionalState,
  ExtractedMessageSignals,
  IdentityCandidate,
  LlmTurnProposal,
  ProposedAction,
  SessionState,
} from "../shared/index.js";
import { extractIdentityCandidates, extractRememberedHints, isCapabilityQuestion, signalsWithCapturedMemory } from "../services/index.js";
import { LLM_RESPONSE_SCHEMA, LLM_SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import type { LlmAdapterOptions, LlmCompletionClient, LlmMessage, ProposalResolver } from "./types.js";

const intents: ClaimIntent[] = ["claim_status", "denial_reason", "required_documents", "document_alternatives", "submission_method", "processing_time", "appeal_next_steps", "general_claim_question", "human_representative"];
const actions: ProposedAction["kind"][] = ["ask_for_identity", "verify_identity", "resolve_intent", "answer_claim_question", "offer_email_summary", "record_email_consent", "escalate_to_human", "redirect_in_scope"];
const emotions: EmotionalState[] = ["neutral", "frustrated", "angry", "anxious", "confused", "refusal"];
const capabilityResponse = "I can help with claim status, claim summaries, denial explanations, required documents, document alternatives, submission methods, processing times, appeal next steps, and human support. Which would you like to explore?";

export class EnvironmentLlmClient implements LlmCompletionClient {
  private readonly token: string;
  private readonly endpoint: string;
  private readonly model: string;

  /** Configures the API client from environment variables without exposing the token. */
  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.token = env.INSURANCE_CLAIMS_API_TOKEN ?? "";
    this.endpoint = env.INSURANCE_CLAIMS_API_URL ?? "https://api.openai.com/v1/chat/completions";
    this.model = env.INSURANCE_CLAIMS_MODEL ?? "gpt-4o-mini";
  }

  /** Sends a schema-constrained completion request and parses its JSON content. */
  async complete(messages: LlmMessage[], responseSchema: object): Promise<unknown> {
    if (!this.token) throw new Error("INSURANCE_CLAIMS_API_TOKEN is required when LLM mode is enabled");
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ model: this.model, messages, temperature: 0, response_format: { type: "json_schema", json_schema: { name: "insurance_claims_turn", strict: true, schema: responseSchema } } }),
    });
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 500);
      throw new Error(`LLM request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM response did not contain structured content");
    return JSON.parse(content) as unknown;
  }
}

export class LlmProposalAdapter implements ProposalResolver {
  private readonly client: LlmCompletionClient;

  /** Creates a real or mock proposal adapter according to the supplied options. */
  constructor(options: LlmAdapterOptions = {}) {
    const env = options.env ?? process.env;
    this.client = options.client ?? (env.INSURANCE_CLAIMS_LLM_MODE === "mock" ? new MockLlmClient() : new EnvironmentLlmClient(env));
  }

  /** Obtains and validates a model proposal without mutating session state. */
  async propose(state: SessionState, message: string): Promise<LlmTurnProposal> {
    try {
      const raw = await this.client.complete([{ role: "system", content: LLM_SYSTEM_PROMPT }, { role: "user", content: buildUserPrompt(state, message) }], LLM_RESPONSE_SCHEMA);
      return normalizePhaseProposal(state, message, validateProposal(raw, message));
    } catch (error) {
      // Any provider outage, malformed response, or unsupported action must
      // leave the workflow usable without allowing the model to bypass it.
      return fallbackProposal(state, message);
    }
  }
}

/** Prevents an overly cautious model action from discarding explicit identity fields. */
async function normalizePhaseProposal(state: SessionState, message: string, proposal: LlmTurnProposal): Promise<LlmTurnProposal> {
  const identitySafe = state.phase === "VERIFY_ID" && proposal.signals.identityCandidates.length > 0 && proposal.proposedAction.kind === "ask_for_identity"
    ? { ...proposal, proposedAction: { ...proposal.proposedAction, kind: "verify_identity" as const } }
    : proposal;
  const overviewSafe = state.phase === "RESOLVE_INTENT"
    && isClaimOverviewMessage(message)
    && identitySafe.proposedAction.kind === "resolve_intent"
    && identitySafe.proposedAction.intent !== "general_claim_question"
    ? { ...identitySafe, proposedAction: { ...identitySafe.proposedAction, intent: "general_claim_question" as const } }
    : identitySafe;
  const capabilitySafe = state.phase === "RESOLVE_INTENT" && isCapabilityQuestion(message)
    ? { ...overviewSafe, proposedAction: { kind: "resolve_intent" as const, responseText: capabilityResponse } }
    : overviewSafe;
  const needsIntentFallback = state.phase === "RESOLVE_INTENT"
    && capabilitySafe.proposedAction.kind !== "resolve_intent"
    && capabilitySafe.proposedAction.kind !== "escalate_to_human";
  return needsIntentFallback ? fallbackProposal(state, message) : capabilitySafe;
}

/** Recognizes broad claims-list requests that must not be narrowed to one claim. */
function isClaimOverviewMessage(message: string): boolean {
  return /\b(?:what|which)\s+(?:(?:are|is)\s+)?(?:all\s+)?(?:the\s+)?(?:my\s+)?(?:current\s+)?(?:claims?|cases?)(?:\s+(?:do\s+i\s+have|i\s+have))?\b(?!\s+about)|\b(?:list|show)\s+(?:all\s+)?(?:the\s+)?(?:my\s+)?(?:current\s+)?(?:claims?|cases?)\b/i.test(message);
}

/** Uses the safe local proposal only when a provider proposal cannot drive the current phase. */
async function fallbackProposal(state: SessionState, message: string): Promise<LlmTurnProposal> {
  const fallback = await new MockLlmClient().complete([{ role: "user", content: buildUserPrompt(state, message) }]);
  return validateProposal(fallback, message);
}

/** Deterministic model substitute for local demos and tests; it only proposes. */
export class MockLlmClient implements LlmCompletionClient {
  /** Produces deterministic phase-aware proposals for local tests and demos. */
  async complete(messages: LlmMessage[]): Promise<unknown> {
    const user = messages.find((item) => item.role === "user")?.content ?? "";
    const phase = /"phase"\s*:\s*"(VERIFY_ID|RESOLVE_INTENT|PROCESS_CASE|POST_PROCESS)"/.exec(user)?.[1] ?? "VERIFY_ID";
    const message = user.split("Caller message:\n").pop() ?? user;
    const candidates = extractIdentityCandidates(message);
    const rememberedHints = extractRememberedHints(message);
    const requestsHuman = /\b(human|representative|agent|person)\b/i.test(message);
    const isOutOfScope = /\bwhat is (?:rl|the weather|a recipe)\b/i.test(message);
    const isAmbiguous = /^(tell me about it|what can you do|help me|i have a question|what now)\??$/i.test(message.trim());
    const intent = classifyIntent(message);
    let proposedAction: ProposedAction;
    if (requestsHuman) proposedAction = { kind: "escalate_to_human" };
    else if (phase === "VERIFY_ID") proposedAction = candidates.length > 0 ? { kind: "verify_identity" } : { kind: "ask_for_identity", responseText: isCapabilityQuestion(message) ? "I can help with claim status, claim summaries, denial explanations, required documents, submission methods, processing times, next steps, and human support. I’ll need to verify your identity before discussing your specific claim." : "Please provide at least three identity details so I can verify you." };
    else if (phase === "RESOLVE_INTENT") proposedAction = isCapabilityQuestion(message) ? { kind: "resolve_intent", responseText: capabilityResponse } : isAmbiguous ? { kind: "resolve_intent", responseText: "Could you clarify whether you want the claim status, a summary, the denial reason, required documents, submission instructions, processing time, or next steps?" } : { kind: "resolve_intent", intent };
    else if (phase === "PROCESS_CASE") proposedAction = { kind: "answer_claim_question" };
    else proposedAction = { kind: "record_email_consent", consentStatus: /\b(yes|accept|approve|send)\b/i.test(message) ? "approved" : /\b(no|decline|do not)\b/i.test(message) ? "declined" : "pending" };
    const signals: ExtractedMessageSignals = { identityCandidates: candidates, rememberedHints, ...(phase === "RESOLVE_INTENT" ? { intent: intent as ClaimIntent } : {}), requestsHuman, isOutOfScope };
    return { signals, proposedAction };
  }
}

/** Classifies common fallback wording for every supported claim operation. */
function classifyIntent(message: string): ClaimIntent {
  if (/\b(denied|denial|why was.*denied)\b/i.test(message)) return "denial_reason";
  if (/\b(?:cannot|can't|can not|unable|don't have|do not have|lost|alternative|substitute|replacement)\b.*\b(?:documents?|reports?|notes?|paperwork|files?)\b/i.test(message)) return "document_alternatives";
  if (/\b(?:submit|send|upload|provide|turn in)\b.*\b(?:documents?|reports?|notes?|paperwork|files?)\b|\bwhere\s+(?:do|can)\s+i\s+(?:send|submit|upload)\b/i.test(message)) return "submission_method";
  if (/\b(?:how long|processing time|when will|how soon)\b/i.test(message)) return "processing_time";
  if (/\b(?:next step|what should i do|appeal|appeal process)\b/i.test(message)) return "appeal_next_steps";
  if (/\b(?:what|which)\s+(?:(?:are|is)\s+)?(?:all\s+)?(?:the\s+)?(?:my\s+)?(?:current\s+)?(?:claims?|cases?)(?:\s+(?:do\s+i\s+have|i\s+have))?\b(?!\s+about)|\b(?:list|show)\s+(?:all\s+)?(?:the\s+)?(?:my\s+)?(?:current\s+)?(?:claims?|cases?)\b|\b(case|claim)\b.*\b(about|summarize|summary)\b/i.test(message)) return "general_claim_question";
  if (/\b(status|where.*claim)\b/i.test(message)) return "claim_status";
  if (/\bdocuments?\b|\bpaperwork\b/i.test(message)) return "required_documents";
  return "general_claim_question";
}

/** Validates and sanitizes untrusted model output into the shared proposal contract. */
function validateProposal(value: unknown, message: string): LlmTurnProposal {
  if (!value || typeof value !== "object") throw new Error("LLM response must be an object");
  const root = value as Record<string, unknown>;
  const rawSignals = root.signals;
  const rawAction = root.proposedAction;
  if (!rawSignals || typeof rawSignals !== "object" || !rawAction || typeof rawAction !== "object") throw new Error("LLM response must include signals and proposedAction");
  const s = rawSignals as Record<string, unknown>;
  const a = rawAction as Record<string, unknown>;
  if (!actions.includes(a.kind as ProposedAction["kind"])) throw new Error("LLM proposed an unknown action");
  const modelIdentityCandidates = Array.isArray(s.identityCandidates) ? s.identityCandidates.filter(isIdentityCandidate) : [];
  // The model remains the primary language interpreter, but local extraction
  // supplements safety-critical identity fields when a provider omits one.
  const identityCandidates = mergeIdentityCandidates(extractIdentityCandidates(message), modelIdentityCandidates);
  const signals: ExtractedMessageSignals = {
    identityCandidates,
    rememberedHints: signalsWithCapturedMemory({ identityCandidates: [], rememberedHints: isHints(s.rememberedHints) ? s.rememberedHints : {}, requestsHuman: Boolean(s.requestsHuman), isOutOfScope: Boolean(s.isOutOfScope) }, message).rememberedHints,
    ...(intents.includes(s.intent as ClaimIntent) ? { intent: s.intent as ClaimIntent } : {}),
    ...(emotions.includes(s.emotionalState as EmotionalState) ? { emotionalState: s.emotionalState as EmotionalState } : {}),
    requestsHuman: Boolean(s.requestsHuman),
    isOutOfScope: Boolean(s.isOutOfScope),
  };
  const action: ProposedAction = {
    kind: a.kind as ProposedAction["kind"],
    ...(intents.includes(a.intent as ClaimIntent) ? { intent: a.intent as ClaimIntent } : {}),
    ...(typeof a.claimId === "string" ? { claimId: a.claimId } : {}),
    ...(typeof a.responseText === "string" ? { responseText: a.responseText } : {}),
    ...(typeof a.consentStatus === "string" && ["pending", "approved", "declined", "timeout"].includes(a.consentStatus) ? { consentStatus: a.consentStatus as SessionState["emailConsent"] } : {}),
  };
  return { signals, proposedAction: action };
}

/** Checks whether an unknown model value has the minimum candidate shape. */
function isIdentityCandidate(value: unknown): value is IdentityCandidate {
  return Boolean(value && typeof value === "object" && typeof (value as Record<string, unknown>).field === "string" && typeof (value as Record<string, unknown>).value === "string");
}

/** Checks whether an unknown model value can be treated as remembered hints. */
function isHints(value: unknown): value is ExtractedMessageSignals["rememberedHints"] {
  return Boolean(value && typeof value === "object");
}

/** Merges model and local identity signals without allowing model omissions to erase fields. */
function mergeIdentityCandidates(local: IdentityCandidate[], model: IdentityCandidate[]): IdentityCandidate[] {
  const byField = new Map(local.map((candidate) => [candidate.field, candidate]));
  for (const candidate of model) {
    if (!byField.has(candidate.field)) byField.set(candidate.field, candidate);
  }
  return [...byField.values()];
}

export { LLM_RESPONSE_SCHEMA, LLM_SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
export * from "./tool-adapter.js";
export type * from "./types.js";
