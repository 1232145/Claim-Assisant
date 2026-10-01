import type {
  AuditEvent,
  ClaimIntent,
  ConsentResult,
  ConversationMessage,
  Guidance,
  EmotionalState,
  IdentityCandidate,
  IdentityVerificationResult,
  PolicyholderRecord,
  ClaimRecord,
  RememberedHints,
  SessionState,
} from "./types.js";

export interface StartSessionRequest {
  sessionId?: string;
}

export interface StartSessionResponse {
  state: SessionState;
  messages: ConversationMessage[];
}

export interface SendMessageRequest {
  sessionId: string;
  message: string;
}

export interface SendMessageResponse {
  state: SessionState;
  reply: ConversationMessage;
  events: AuditEvent[];
}

export interface RestartSessionRequest {
  sessionId: string;
}

export interface RestartSessionResponse extends StartSessionResponse {}

export interface ExtractedMessageSignals {
  identityCandidates: IdentityCandidate[];
  rememberedHints: RememberedHints;
  intent?: ClaimIntent;
  emotionalState?: SessionState["emotionalState"];
  requestsHuman: boolean;
  isOutOfScope: boolean;
}

/** Deterministic classification used by the workflow before any phase-specific action. */
export interface ScopeEmotionAnalysis {
  isOutOfScope: boolean;
  emotionalState: EmotionalState;
  requestsHuman: boolean;
  identityRefusal: boolean;
  guidance: string;
}

export interface ScopeEmotionAnalyzer {
  analyze(state: SessionState, message: string): ScopeEmotionAnalysis;
}

export interface ProposedAction {
  kind:
    | "ask_for_identity"
    | "verify_identity"
    | "resolve_intent"
    | "answer_claim_question"
    | "offer_email_summary"
    | "record_email_consent"
    | "escalate_to_human"
    | "redirect_in_scope";
  intent?: ClaimIntent;
  claimId?: string;
  responseText?: string;
  consentStatus?: SessionState["emailConsent"];
}

export interface LlmTurnProposal {
  signals: ExtractedMessageSignals;
  proposedAction: ProposedAction;
}

/** A model may resolve language, but only this application boundary may propose workflow actions. */
export interface LlmProposalResolver {
  propose(state: SessionState, message: string): Promise<LlmTurnProposal>;
}

export interface PolicyholderService {
  getPolicyholder(identifier: string): PolicyholderRecord | null;
  findByIdentityCandidates(candidates: IdentityCandidate[]): PolicyholderRecord | null;
}

export interface ClaimService {
  getClaimsForParty(partyId: string): ClaimRecord[];
  getClaimDetails(claimId: string): ClaimRecord | null;
  findRelevantClaim(partyId: string, hints: RememberedHints): ClaimRecord | null;
}

export interface IdentityService {
  verifyIdentity(
    candidates: IdentityCandidate[],
    policyholder?: PolicyholderRecord,
  ): IdentityVerificationResult;
}

export interface DocumentGuidanceService {
  getDocumentGuidance(claimId: string, documentName?: string): Guidance | null;
}

export interface ConsentService {
  sendSummaryEmail(summary: string, recipient: string, scenario?: string): ConsentResult;
}

export interface FixtureServices {
  policyholders: PolicyholderService;
  claims: ClaimService;
  identity: IdentityService;
  documents: DocumentGuidanceService;
  consent: ConsentService;
}

export interface SessionStore {
  create(sessionId?: string): SessionState;
  get(sessionId: string): SessionState | null;
  save(state: SessionState): void;
  clear(sessionId: string): void;
}

export interface WorkflowEngine {
  handleMessage(
    state: SessionState,
    message: string,
  ): Promise<SendMessageResponse>;
}
