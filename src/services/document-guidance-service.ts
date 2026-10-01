import type { ClaimRecord, DocumentGuidanceService, Guidance } from "../shared/index.js";
import { loadFixture, normalizeText } from "./fixture-loader.js";

interface GuidanceFixture {
  default_guidance?: { en?: string };
  case_type_guidance?: Record<string, { en?: string }>;
  document_guidance?: Record<string, { en?: string }>;
  document_alternative_guidance?: Record<string, { en?: string }>;
}

/** Converts common document wording into the fixture's canonical key. */
function documentKey(documentName: string): string {
  const name = normalizeText(documentName);
  if (name.includes("pathology")) return "original pathology report";
  if (name.includes("office note")) return "treating provider office note";
  return name;
}

export class FixtureDocumentGuidanceService implements DocumentGuidanceService {
  private readonly claims: ClaimRecord[];
  private readonly guidance: GuidanceFixture;

  /** Loads claims and document-guidance fixtures. */
  constructor(fixtureDirectory?: string) {
    this.claims = loadFixture<ClaimRecord[]>("claims.json", fixtureDirectory);
    this.guidance = loadFixture<GuidanceFixture>("required_document_guideline.json", fixtureDirectory);
  }

  /** Returns claim-specific, document-specific, or fallback guidance. */
  getDocumentGuidance(claimId: string, documentName?: string): Guidance | null {
    const claim = this.claims.find((item) => item.case_id === claimId);
    if (!claim) return null;

    const requested = documentName ? this.guidance.document_guidance?.[documentKey(documentName)] : undefined;
    const caseType = this.guidance.case_type_guidance?.[claim.case_type];
    const text = requested?.en ?? caseType?.en ?? this.guidance.default_guidance?.en;
    return text
      ? {
          ...(documentName ? { documentName } : {}),
          caseType: claim.case_type,
          text,
          source: "fixture",
        }
      : null;
  }

  /** Returns the approved fixture guidance for an alternative document. */
  getDocumentAlternativeGuidance(documentName: string): Guidance | null {
    const entry = this.guidance.document_alternative_guidance?.[documentKey(documentName)] ??
      this.guidance.document_alternative_guidance?.default;
    return entry?.en ? { documentName, text: entry.en, source: "fixture" } : null;
  }
}
