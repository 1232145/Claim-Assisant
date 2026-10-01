export const PHASES = [
  "VERIFY_ID",
  "RESOLVE_INTENT",
  "PROCESS_CASE",
  "POST_PROCESS",
] as const;

export type Phase = (typeof PHASES)[number];

export type IdentityField =
  | "full_name"
  | "date_of_birth"
  | "phone_number"
  | "email_address"
  | "policy_number"
  | "id_last4";

export type ClaimIntent =
  | "claim_status"
  | "denial_reason"
  | "required_documents"
  | "document_alternatives"
  | "submission_method"
  | "processing_time"
  | "appeal_next_steps"
  | "claim_overview"
  | "general_claim_question"
  | "human_representative";

export type EmotionalState =
  | "neutral"
  | "frustrated"
  | "angry"
  | "anxious"
  | "confused"
  | "refusal";

export type EmailConsent = "pending" | "approved" | "declined" | "timeout";

export type ResponseSource = "llm-grounded" | "deterministic-fallback";

export type EscalationReason =
  | "identity_refusal"
  | "identity_attempts_exhausted"
  | "repeated_out_of_scope"
  | "caller_requested_human"
  | "unsupported_claim_question"
  | "document_alternatives_exhausted";

export interface RememberedHints {
  claimType?: string;
  status?: string;
  dateReference?: string;
  rawText?: string;
}

export interface SessionState {
  sessionId: string;
  phase: Phase;
  verified: boolean;
  partyId?: string;
  verifiedFields: IdentityField[];
  verificationAttempts: number;
  rememberedHints: RememberedHints;
  intent?: ClaimIntent;
  selectedClaimId?: string;
  irrelevantAttempts: number;
  emotionalState?: EmotionalState;
  escalationRequired: boolean;
  escalationReason?: EscalationReason;
  emailConsent?: EmailConsent;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface AuditEvent {
  type:
    | "session_created"
  | "message_received"
    | "scope_classified"
    | "emotion_detected"
    | "identity_attempted"
    | "identity_verified"
    | "phase_changed"
    | "protected_data_blocked"
    | "claim_data_accessed"
    | "escalation_required"
    | "email_consent_recorded";
  at: string;
  phase: Phase;
  details?: Record<string, string | number | boolean>;
}

export interface IdentityCandidate {
  field: IdentityField;
  value: string;
}

export interface IdentityVerificationResult {
  verified: boolean;
  matchedFields: IdentityField[];
  mismatchedFields: IdentityField[];
  missingFields: IdentityField[];
  attempts: number;
}

export interface ClaimRecord {
  case_id: string;
  party_id: string;
  case_type: string;
  created_at: string;
  status: string;
  summary: string;
  denial_reason?: string;
  documents_needed?: string[];
  appeal_deadline?: string;
  expected_reimbursement_amount: string;
  allowed_max_amount: string;
  net_pay: string;
  net_fee: string;
}

export interface PolicyholderRecord {
  party_id: string;
  name: string;
  name_aliases?: string[];
  policy_number: string;
  dob: string;
  id_type: "ssn_last4" | "national_id_last4";
  id_last4: string;
  phone: string;
  phone_aliases?: string[];
  email: string;
  email_aliases?: string[];
}

export interface Guidance {
  documentName?: string;
  caseType?: string;
  text: string;
  source: "fixture";
}

export interface ConsentResult {
  status: EmailConsent;
  sent: boolean;
}
