import type {
  ClaimIntent,
  ClaimRecord,
  ClaimService,
  ConsentResult,
  ConsentService,
  DocumentGuidanceService,
  Guidance,
  RememberedHints,
} from "../shared/index.js";

export interface ClaimAnswerRequest {
  partyId: string;
  intent: ClaimIntent;
  hints?: RememberedHints;
  claimId?: string;
  message?: string;
}

export interface ClaimAnswer {
  ok: boolean;
  claimId?: string;
  claimCount?: number;
  text: string;
  facts?: ClaimFact[];
  guidance?: Guidance;
  unsupported?: boolean;
  requiresHuman?: boolean;
}

export interface ClaimFact {
  key: string;
  value: string;
}

export interface SummaryRequest {
  claim: ClaimRecord;
  intent: ClaimIntent;
  answer: string;
  recipient: string;
  consent?: "pending" | "approved" | "declined" | "timeout";
}

export interface SummaryResult {
  summary: string;
  consent: ConsentResult;
}

/**
 * Deterministic claim-support answers. The LLM may choose an intent, but this
 * service is the only place that turns an intent into claim facts or guidance.
 */
export class ClaimProcessingService {
  constructor(
    private readonly claims: ClaimService,
    private readonly documents: DocumentGuidanceService,
    private readonly consent: ConsentService,
  ) {}

  answer(request: ClaimAnswerRequest): ClaimAnswer {
    if (request.intent === "general_claim_question" && /\b(?:what|which)\s+(?:(?:are|is)\s+)?(?:all\s+)?(?:the\s+)?(?:my\s+)?(?:current\s+)?(?:claims?|cases?)(?:\s+(?:do\s+i\s+have|i\s+have))?\b(?!\s+about)|\b(?:what|which)\s+(?:do|can)\s+i\s+have\b|\b(?:list|show|explain)\s+(?:all\s+)?(?:the\s+)?(?:my\s+)?(?:current\s+)?(?:claims?|cases?)\b|\b(?:talk\s+about|explain|summari[sz]e)\s+(?:all\s+of\s+them|every(?:thing|\s+(?:claim|case))|each\s+(?:claim|case)|all\s+(?:of\s+)?(?:them|my\s+claims?|my\s+cases?))\b|\b(?:case|claim)\b.*\b(about|summarize|summary)\b/i.test(request.message ?? "")) {
      return this.claimOverview(request.partyId);
    }
    if (request.intent === "general_claim_question" && /^\s*(?:my|the)\s+case\s*[?!.]?\s*$/i.test(request.message ?? "")) {
      return {
        ok: false,
        text: "Which claim would you like to review? You can provide the claim ID, claim type, or approximate date.",
        unsupported: true,
      };
    }
    const claim = request.claimId
      ? this.claims.getClaimDetails(request.claimId)
      : this.claims.findRelevantClaim(request.partyId, request.hints ?? {});

    if (!claim || claim.party_id !== request.partyId) {
      return {
        ok: false,
        text: "I could not identify a matching claim from the available records. I can connect you with a human claims representative to review it.",
        requiresHuman: true,
      };
    }

    let answer: ClaimAnswer;
    switch (request.intent) {
      case "claim_status":
        answer = { ok: true, claimId: claim.case_id, text: `Claim ${claim.case_id} is ${claim.status}. ${claim.summary}` };
        break;
      case "denial_reason":
        answer = this.denialAnswer(claim); break;
      case "required_documents":
        answer = this.documentsAnswer(claim); break;
      case "document_alternatives":
        answer = this.alternativesAnswer(claim, request.message ?? ""); break;
      case "submission_method":
        answer = this.submissionAnswer(claim); break;
      case "processing_time":
        answer = this.processingTimeAnswer(claim); break;
      case "appeal_next_steps":
        answer = this.nextStepsAnswer(claim); break;
      case "general_claim_question":
        answer = { ok: true, claimId: claim.case_id, text: `Claim ${claim.case_id}: ${claim.summary}. The claim is currently ${claim.status}.` }; break;
      case "human_representative":
        answer = { ok: false, claimId: claim.case_id, text: "I can connect you with a human claims representative.", requiresHuman: true }; break;
    }
    return { ...answer, facts: answer.facts ?? this.claimFacts(claim) };
  }

  private claimOverview(partyId: string): ClaimAnswer {
    const claims = this.claims.getClaimsForParty(partyId);
    if (claims.length === 0) return { ok: true, text: "I could not find any claims in the available records." };
    const summary = claims.map((claim) => `${claim.case_id} (${claim.case_type}, ${claim.status}, ${claim.created_at})`).join("; ");
    return { ok: true, claimCount: claims.length, text: `You have ${claims.length} claims in the available records: ${summary}. Which claim would you like to review?`, facts: [{ key: "claim_count", value: String(claims.length) }, ...claims.flatMap((claim) => this.claimFacts(claim))] };
  }

  private claimFacts(claim: ClaimRecord): ClaimFact[] {
    return [
      { key: "claim_id", value: claim.case_id },
      { key: "claim_type", value: claim.case_type },
      { key: "status", value: claim.status },
      { key: "created_date", value: claim.created_at },
      { key: "claim_summary", value: claim.summary },
      ...(claim.denial_reason ? [{ key: "denial_reason", value: claim.denial_reason }] : []),
      ...(claim.documents_needed?.length ? [{ key: "required_documents", value: claim.documents_needed.join(", ") }] : []),
      ...(claim.appeal_deadline ? [{ key: "appeal_deadline", value: claim.appeal_deadline }] : []),
    ];
  }

  /** Builds the summary and advances the deterministic consent scenario once. */
  sendSummary(request: SummaryRequest, scenario = "default"): SummaryResult {
    const summary = [
      `Claim ${request.claim.case_id}`,
      `Topic: ${request.intent.replaceAll("_", " ")}`,
      `Status: ${request.claim.status}`,
      `What we discussed: ${request.answer}`,
      request.claim.appeal_deadline ? `Appeal deadline: ${request.claim.appeal_deadline}` : undefined,
      request.claim.documents_needed?.length ? `Follow-up documents: ${request.claim.documents_needed.join(", ")}` : undefined,
    ].filter((part): part is string => Boolean(part)).join("\n");
    if (request.consent === "declined") return { summary, consent: { status: "declined", sent: false } };
    if (request.consent === "pending" || request.consent === "timeout") return { summary, consent: { status: request.consent, sent: false } };
    if (request.consent === "approved") return { summary, consent: { status: "approved", sent: true } };
    let consent = this.consent.sendSummaryEmail(summary, request.recipient, scenario);
    // An explicit caller approval authorizes sending; advance deterministic
    // pending/approved fixtures once when approval is awaiting confirmation.
    if (request.consent === "approved" && consent.status === "pending") {
      consent = this.consent.sendSummaryEmail(summary, request.recipient, scenario);
    }
    return { summary, consent };
  }

  private denialAnswer(claim: ClaimRecord): ClaimAnswer {
    const reason = claim.denial_reason ?? "The fixture does not include a denial reason for this claim.";
    const guidance = claim.documents_needed?.[0] ? this.documents.getDocumentGuidance(claim.case_id, claim.documents_needed[0]) : null;
    return {
      ok: true,
      claimId: claim.case_id,
      text: `Claim ${claim.case_id} was denied because ${reason}.`,
      ...(guidance ? { guidance, text: `Claim ${claim.case_id} was denied because ${reason} ${guidance.text}` } : {}),
    };
  }

  private documentsAnswer(claim: ClaimRecord): ClaimAnswer {
    const needed = claim.documents_needed;
    if (!needed?.length) return { ok: true, claimId: claim.case_id, text: `The available record does not list additional required documents for claim ${claim.case_id}.` };
    const guidance = this.documents.getDocumentGuidance(claim.case_id, needed[0]);
    return {
      ok: true,
      claimId: claim.case_id,
      text: `The required documents for claim ${claim.case_id} are: ${needed.join(", ")}.${guidance ? ` ${guidance.text}` : ""}`,
      ...(guidance ? { guidance } : {}),
    };
  }

  private alternativesAnswer(claim: ClaimRecord, message: string): ClaimAnswer {
    const requested = claim.documents_needed?.find((document) => message.toLocaleLowerCase().includes(document.toLocaleLowerCase())) ?? claim.documents_needed?.[0];
    if (!requested) return { ok: false, claimId: claim.case_id, text: "I do not see a missing document in the available claim record.", unsupported: true };
    const guidanceService = this.documents as DocumentGuidanceService & { getDocumentAlternativeGuidance?: (documentName: string) => Guidance | null };
    const guidance = guidanceService.getDocumentAlternativeGuidance?.(requested) ?? null;
    return {
      ok: true,
      claimId: claim.case_id,
      text: `For the missing ${requested}, ${guidance?.text ?? "please request a replacement from the provider or facility. If no reasonable substitute is available, a human representative should review the file."}`,
      ...(guidance ? { guidance } : {}),
    };
  }

  private submissionAnswer(claim: ClaimRecord): ClaimAnswer {
    const guidance = this.documents.getDocumentGuidance(claim.case_id);
    return { ok: true, claimId: claim.case_id, text: `For claim ${claim.case_id}, submit the requested files through the member portal or claim upload link when possible. If online upload is unavailable, support can help arrange fax or mail submission.${guidance ? ` ${guidance.text}` : ""}`, ...(guidance ? { guidance } : {}) };
  }

  private processingTimeAnswer(claim: ClaimRecord): ClaimAnswer {
    return { ok: true, claimId: claim.case_id, text: `Once the missing files for claim ${claim.case_id} are received and readable, review usually takes less than a week, although intake and another review cycle may be needed.` };
  }

  private nextStepsAnswer(claim: ClaimRecord): ClaimAnswer {
    const deadline = claim.appeal_deadline ? ` The appeal deadline listed is ${claim.appeal_deadline}.` : "";
    return { ok: true, claimId: claim.case_id, text: `The next step is to submit the missing documents through the member portal or claim upload link and request review.${deadline}` };
  }
}
