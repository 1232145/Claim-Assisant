import { randomUUID } from "node:crypto";
import type {
  ExtractedMessageSignals,
  IdentityService,
  LlmTurnProposal,
  PolicyholderService,
  ProposedAction,
  ScopeEmotionAnalyzer,
  SendMessageResponse,
  SessionStore,
  WorkflowEngine,
} from "../shared/contracts.js";
import type {
  AuditEvent,
  ClaimIntent,
  IdentityCandidate,
  IdentityField,
  SessionState,
  Phase,
} from "../shared/types.js";
import { defaultScopeEmotionAnalyzer, empathyGuidance } from "../services/scope-emotion-service.js";
import { mergeRememberedHints } from "../services/memory-service.js";

export const DEFAULT_MAX_VERIFICATION_ATTEMPTS = 3;
export const DEFAULT_MAX_OUT_OF_SCOPE_ATTEMPTS = 3;

const identityFieldLabels: Record<IdentityField, string> = {
  full_name: "your name",
  date_of_birth: "your date of birth",
  phone_number: "your phone number",
  email_address: "your email address",
  policy_number: "your policy number",
  id_last4: "your ID last four digits",
};

export interface WorkflowProposalResolver {
  propose(state: SessionState, message: string): Promise<LlmTurnProposal>;
}

export interface ImmediateClaimProcessor {
  answer(request: { partyId: string; intent: ClaimIntent; hints: SessionState["rememberedHints"]; message: string; claimId?: string }): { ok: boolean; claimId?: string; claimCount?: number; text: string; requiresHuman?: boolean };
}

export interface WorkflowEngineDependencies {
  proposals: WorkflowProposalResolver;
  identity: IdentityService;
  policyholders: PolicyholderService;
  maxVerificationAttempts?: number;
  maxOutOfScopeAttempts?: number;
  scopeEmotionAnalyzer?: ScopeEmotionAnalyzer;
  claimProcessor?: ImmediateClaimProcessor;
  now?: () => string;
}

/** Stores session state for the current process; replace with a durable store in production. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  /** Creates and stores a new unverified workflow session. */
  create(sessionId = randomUUID()): SessionState {
    const state = createInitialState(sessionId);
    this.sessions.set(sessionId, state);
    return cloneState(state);
  }

  /** Retrieves a defensive copy of a stored session, if it exists. */
  get(sessionId: string): SessionState | null {
    const state = this.sessions.get(sessionId);
    return state ? cloneState(state) : null;
  }

  /** Stores a defensive copy of the current workflow state. */
  save(state: SessionState): void {
    this.sessions.set(state.sessionId, cloneState(state));
  }

  /** Removes a session from the in-memory store. */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

/** Creates a new unverified session at the first SOP phase with no protected claim state. */
export function createInitialState(sessionId: string = randomUUID()): SessionState {
  return {
    sessionId,
    phase: "VERIFY_ID",
    verified: false,
    verifiedFields: [],
    verificationAttempts: 0,
    rememberedHints: {},
    irrelevantAttempts: 0,
    escalationRequired: false,
  };
}

/** Identifies actions that could reveal protected claim information or expose a claim summary. */
export function isProtectedAction(action: ProposedAction["kind"]): boolean {
  return action === "answer_claim_question" || action === "offer_email_summary";
}

/** Allows only the next phase in the prescribed SOP order. Same-phase handling is implicit. */
export function canTransition(from: Phase, to: Phase): boolean {
  const order: Phase[] = ["VERIFY_ID", "RESOLVE_INTENT", "PROCESS_CASE", "POST_PROCESS"];
  return order.indexOf(to) === order.indexOf(from) + 1;
}

/**
 * Applies an LLM proposal only after deterministic workflow and privacy checks.
 * The proposal may suggest wording and intent, but it cannot bypass phase gates.
 */
export class SopWorkflowEngine implements WorkflowEngine {
  private readonly identityCandidates = new Map<string, IdentityCandidate[]>();
  private readonly maxVerificationAttempts: number;
  private readonly maxOutOfScopeAttempts: number;
  private readonly scopeEmotionAnalyzer: ScopeEmotionAnalyzer;
  private readonly now: () => string;

  /** Creates an engine with deterministic services and proposal resolution dependencies. */
  constructor(private readonly dependencies: WorkflowEngineDependencies) {
    this.maxVerificationAttempts = dependencies.maxVerificationAttempts ?? DEFAULT_MAX_VERIFICATION_ATTEMPTS;
    this.maxOutOfScopeAttempts = dependencies.maxOutOfScopeAttempts ?? DEFAULT_MAX_OUT_OF_SCOPE_ATTEMPTS;
    this.scopeEmotionAnalyzer = dependencies.scopeEmotionAnalyzer ?? defaultScopeEmotionAnalyzer;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  /** Processes one caller message and returns the updated state, safe reply, and audit trail. */
  async handleMessage(state: SessionState, message: string): Promise<SendMessageResponse> {
    const next = cloneState(state);
    const events: AuditEvent[] = [this.event("message_received", next, { length: message.length })];
    const proposal = await this.dependencies.proposals.propose(next, message);
    const candidates = mergeIdentityCandidates(this.identityCandidates.get(next.sessionId) ?? [], proposal.signals.identityCandidates);
    this.identityCandidates.set(next.sessionId, candidates);
    const effectiveProposal: LlmTurnProposal = {
      ...proposal,
      signals: { ...proposal.signals, identityCandidates: candidates },
    };
    const analysis = this.scopeEmotionAnalyzer.analyze(next, message);
    // Broad or ambiguous questions remain eligible for LLM intent resolution.
    // The local scope guard owns rejection of explicitly unrelated topics.
    const isOutOfScope = analysis.isOutOfScope;
    next.emotionalState = analysis.emotionalState;
    events.push(this.event("scope_classified", next, { isOutOfScope }));
    events.push(this.event("emotion_detected", next, { emotionalState: analysis.emotionalState }));
    mergeHints(next, effectiveProposal.signals);

    // A model suggestion cannot bypass local transfer rules. Explicit human
    // requests are detected by the scope analyzer; refusal and other guarded
    // paths must still follow their configured attempt thresholds.
    if (analysis.requestsHuman) {
      this.escalate(next, "caller_requested_human", events);
      return this.finish(next, "I can connect you with a human representative.", events);
    }

    if (isOutOfScope) {
      next.irrelevantAttempts += 1;
      if (next.irrelevantAttempts >= this.maxOutOfScopeAttempts) {
        this.escalate(next, "repeated_out_of_scope", events);
        return this.finish(next, "This service is limited to insurance claims support. I can connect you with a human representative.", events);
      }
      return this.finish(next, "I can help with insurance claims, identity verification, documents, status, or next steps. What would you like to do?", events);
    }

    if (next.phase === "VERIFY_ID" && analysis.identityRefusal) {
      next.verificationAttempts += 1;
      events.push(this.event("identity_attempted", next, { attempt: next.verificationAttempts, refusal: true }));
      if (next.verificationAttempts >= this.maxVerificationAttempts) {
        this.escalate(next, "identity_refusal", events);
        return this.finish(next, "I’m unable to complete verification here, so I’ll connect you with a human representative.", events);
      }
      return this.finish(next, analysis.guidance || "I understand. I need to verify your identity to protect your claim information. Please provide at least three accepted identity details.", events);
    }

    if (!next.verified && isProtectedAction(effectiveProposal.proposedAction.kind)) {
      events.push(this.event("protected_data_blocked", next, { action: effectiveProposal.proposedAction.kind }));
      return this.finish(next, "I can help with that, but I need to verify your identity before discussing claim details.", events);
    }

    switch (next.phase) {
      case "VERIFY_ID":
        return this.handleVerification(next, effectiveProposal, events);
      case "RESOLVE_INTENT":
        return this.handleIntentResolution(next, effectiveProposal.proposedAction, message, events);
      case "PROCESS_CASE":
        return this.handleCase(next, effectiveProposal.proposedAction, message, events);
      case "POST_PROCESS":
        return this.handlePostProcess(next, effectiveProposal.proposedAction, message, events);
    }
  }

  /** Handles identity collection and advances only after three or more fields match. */
  private handleVerification(state: SessionState, proposal: LlmTurnProposal, events: AuditEvent[]): SendMessageResponse {
    const action = proposal.proposedAction.kind;
    const empathy = state.emotionalState && state.emotionalState !== "neutral" ? `${empathyGuidance(state.emotionalState)} ` : "";
    if (action !== "verify_identity" && action !== "ask_for_identity") {
      if (isProtectedAction(action)) {
        events.push(this.event("protected_data_blocked", state, { action }));
        return this.finish(state, `${empathy}Please complete identity verification first. I can then help with your claim.`, events);
      }
      return this.finish(state, `${empathy}Before I access claim information, please provide at least three identity details, such as your name, date of birth, policy number, phone, email, or ID last four.`, events);
    }

    if (action === "ask_for_identity") {
      const request = proposal.proposedAction.responseText ?? "Please provide at least three identity details so I can verify you.";
      return this.finish(state, `${empathy}${request}`, events);
    }

    state.verificationAttempts += 1;
    events.push(this.event("identity_attempted", state, { attempt: state.verificationAttempts }));
    const candidates = proposal.signals.identityCandidates;
    const policyholder = findPolicyholder(this.dependencies.policyholders, candidates);
    const result = this.dependencies.identity.verifyIdentity(candidates, policyholder ?? undefined);
    state.verifiedFields = [...result.matchedFields];

    if (result.verified && result.matchedFields.length >= 3) {
      state.verified = true;
      if (policyholder) state.partyId = policyholder.party_id;
      events.push(this.event("identity_verified", state, { matchedFields: result.matchedFields.length }));
      this.changePhase(state, "RESOLVE_INTENT", events);
      return this.finish(state, "Thank you—your identity is verified. What would you like help with regarding your claim?", events);
    }

    if (state.verificationAttempts >= this.maxVerificationAttempts) {
      this.escalate(state, "identity_attempts_exhausted", events);
      return this.finish(state, "I’m unable to complete verification here, so I’ll connect you with a human representative.", events);
    }
    const remaining = Math.max(1, 3 - result.matchedFields.length);
    const matching = result.matchedFields.length === 1 ? "I have 1 matching identity detail" : `I have ${result.matchedFields.length} matching identity details`;
    const more = remaining === 1 ? "1 more matching detail" : `${remaining} more matching details`;
    const missingFields = (Object.keys(identityFieldLabels) as IdentityField[]).filter((field) => !result.matchedFields.includes(field));
    const examples = missingFields.slice(0, remaining).map((field) => identityFieldLabels[field]).join(", ");
    return this.finish(state, `${empathy}${matching}. Please provide ${more}${examples ? `, such as ${examples}` : ""}.`, events);
  }

  /** Records the approved intent and moves the verified session to claim processing. */
  private handleIntentResolution(state: SessionState, action: ProposedAction, message: string, events: AuditEvent[]): SendMessageResponse {
    if (action.kind !== "resolve_intent" || !action.intent) {
      return this.finish(state, action.responseText ?? "Could you clarify whether you want the claim status, a summary, the denial reason, required documents, submission instructions, processing time, or next steps?", events);
    }
    state.intent = action.intent;
    const explicitClaimId = extractExplicitClaimId(message);
    if (explicitClaimId) state.selectedClaimId = explicitClaimId;
    if (this.dependencies.claimProcessor && state.partyId) {
      const answer = this.dependencies.claimProcessor.answer({ partyId: state.partyId, intent: action.intent, hints: state.rememberedHints, message, ...(state.selectedClaimId ? { claimId: state.selectedClaimId } : {}) });
      if (answer.claimId) state.selectedClaimId = answer.claimId;
      if (answer.ok && (answer.claimId || answer.claimCount !== undefined)) {
        this.changePhase(state, "PROCESS_CASE", events);
        events.push(this.event("claim_data_accessed", state, { ...(answer.claimId ? { claimId: answer.claimId } : {}), ...(answer.claimCount !== undefined ? { claimCount: answer.claimCount } : {}), intent: action.intent }));
        this.changePhase(state, "POST_PROCESS", events);
        return this.finish(state, `${answer.text} Would you like an email summary?`, events);
      }
      if (answer.requiresHuman) {
        this.changePhase(state, "PROCESS_CASE", events);
        this.escalate(state, "unsupported_claim_question", events);
      }
      return this.finish(state, answer.text, events);
    }
    this.changePhase(state, "PROCESS_CASE", events);
    return this.finish(state, "I understand. I’ll review the approved claim-support information for that request.", events);
  }

  /** Executes only approved, already-verified claim actions and then offers post-processing. */
  private handleCase(state: SessionState, action: ProposedAction, message: string, events: AuditEvent[]): SendMessageResponse {
    if (action.kind === "answer_claim_question") {
      const explicitClaimId = extractExplicitClaimId(message);
      if (explicitClaimId) state.selectedClaimId = explicitClaimId;
      events.push(this.event("claim_data_accessed", state, {
        ...(state.selectedClaimId ? { claimId: state.selectedClaimId } : {}),
        intent: state.intent ?? "general_claim_question",
      }));
      this.changePhase(state, "POST_PROCESS", events);
      return this.finish(state, action.responseText ?? "I’ve provided the available information for your claim. Would you like an email summary?", events);
    }
    if (action.kind === "offer_email_summary") {
      this.changePhase(state, "POST_PROCESS", events);
      return this.finish(state, action.responseText ?? "Would you like an email summary of what we discussed?", events);
    }
    return this.finish(state, "I can only take an approved claim-support action here. I can also connect you with a human representative.", events);
  }

  /** Records explicit email-summary consent without claiming that an unapproved email was sent. */
  private handlePostProcess(state: SessionState, action: ProposedAction, message: string, events: AuditEvent[]): SendMessageResponse {
    if (action.kind === "resolve_intent" && action.intent && this.dependencies.claimProcessor && state.partyId) {
      state.intent = action.intent;
      const explicitClaimId = extractExplicitClaimId(message);
      if (explicitClaimId) state.selectedClaimId = explicitClaimId;
      else delete state.selectedClaimId;
      const answer = this.dependencies.claimProcessor.answer({ partyId: state.partyId, intent: action.intent, hints: state.rememberedHints, message, ...(explicitClaimId ? { claimId: explicitClaimId } : {}) });
      if (answer.claimId) state.selectedClaimId = answer.claimId;
      if (answer.ok) {
        events.push(this.event("claim_data_accessed", state, {
          ...(answer.claimId ? { claimId: answer.claimId } : {}),
          intent: action.intent,
        }));
        return this.finish(state, `${answer.text}${answer.claimId ? " Would you like an email summary?" : ""}`, events);
      }
      if (answer.requiresHuman) this.escalate(state, "unsupported_claim_question", events);
      return this.finish(state, answer.text, events);
    }
    if (action.kind === "record_email_consent" && action.consentStatus) {
      state.emailConsent = action.consentStatus;
      events.push(this.event("email_consent_recorded", state, { status: action.consentStatus }));
      return this.finish(state, action.consentStatus === "approved" ? "Your summary request has been approved." : "Understood. No summary email will be sent.", events);
    }
    return this.finish(state, "Your claim-support interaction is complete. I can connect you with a human representative if you need further help.", events);
  }

  /** Enforces the four-phase order and records every successful transition. */
  private changePhase(state: SessionState, phase: Phase, events: AuditEvent[]): void {
    if (!canTransition(state.phase, phase)) throw new Error(`Illegal phase transition: ${state.phase} -> ${phase}`);
    const from = state.phase;
    state.phase = phase;
    events.push(this.event("phase_changed", state, { from, to: phase }));
  }

  /** Marks the session for human handling and records the deterministic escalation reason. */
  private escalate(state: SessionState, reason: NonNullable<SessionState["escalationReason"]>, events: AuditEvent[]): void {
    state.escalationRequired = true;
    state.escalationReason = reason;
    events.push(this.event("escalation_required", state, { reason }));
  }

  /** Builds a response without exposing internal proposal or fixture data automatically. */
  private finish(state: SessionState, content: string, events: AuditEvent[]): SendMessageResponse {
    return {
      state,
      reply: { id: randomUUID(), role: "assistant", content, createdAt: this.now() },
      events,
    };
  }

  /** Creates a timestamped audit event for the current workflow state. */
  private event(type: AuditEvent["type"], state: SessionState, details?: Record<string, string | number | boolean>): AuditEvent {
    return {
      type,
      at: this.now(),
      phase: state.phase,
      ...(details ? { details } : {}),
    };
  }
}

/** Finds a policyholder using identity candidates that can act as direct lookup identifiers. */
function findPolicyholder(service: PolicyholderService, candidates: IdentityCandidate[]) {
  for (const candidate of candidates) {
    const record = service.findByIdentityCandidates([candidate]);
    if (record) return record;
  }
  for (const candidate of candidates) {
    const record = service.getPolicyholder(candidate.value);
    if (record) return record;
  }
  return null;
}

/** Merges newly extracted hints without changing the current workflow phase. */
function mergeHints(state: SessionState, signals: ExtractedMessageSignals): void {
  state.rememberedHints = mergeRememberedHints(state.rememberedHints, signals.rememberedHints);
}

/** Retains identity fields across turns while allowing a corrected value to replace an earlier one. */
function mergeIdentityCandidates(current: IdentityCandidate[], incoming: IdentityCandidate[]): IdentityCandidate[] {
  const byField = new Map(current.map((candidate) => [candidate.field, candidate]));
  for (const candidate of incoming) byField.set(candidate.field, candidate);
  return [...byField.values()];
}

/** Accepts a claim ID only when the caller explicitly supplied it in the message. */
function extractExplicitClaimId(message: string): string | undefined {
  return message.match(/\bCL-\d{3,}\b/i)?.[0].toUpperCase();
}

/** Clones mutable session fields so a workflow turn does not mutate the caller's state object. */
function cloneState(state: SessionState): SessionState {
  return { ...state, verifiedFields: [...state.verifiedFields], rememberedHints: { ...state.rememberedHints } };
}
