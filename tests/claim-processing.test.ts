import { describe, expect, it } from "vitest";
import {
  ClaimProcessingService,
  FixtureClaimService,
  FixtureConsentService,
  FixtureDocumentGuidanceService,
} from "../src/services/index.js";

describe("claim processing and post-processing", () => {
  const service = new ClaimProcessingService(
    new FixtureClaimService(),
    new FixtureDocumentGuidanceService(),
    new FixtureConsentService(),
  );

  it("answers denial questions from the selected fixture claim", () => {
    const result = service.answer({ partyId: "P9", intent: "denial_reason", claimId: "CL-2048" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("pathology report and the treating provider office note");
    expect(result.text).toContain("specimen details");
  });

  it("selects the claim from remembered hints and lists required documents", () => {
    const result = service.answer({
      partyId: "P9",
      intent: "required_documents",
      hints: { claimType: "healthcare", status: "denied", dateReference: "January" },
    });
    expect(result.claimId).toBe("CL-2048");
    expect(result.text).toContain("pathology report");
    expect(result.text).toContain("office note");
  });

  it("answers document alternatives and follow-up questions", () => {
    const alternative = service.answer({ partyId: "P9", intent: "document_alternatives", claimId: "CL-2048", message: "I cannot get the office note" });
    expect(alternative.text).toContain("visit summary");

    const processing = service.answer({ partyId: "P9", intent: "processing_time", claimId: "CL-2048" });
    expect(processing.text).toContain("less than a week");
  });

  it("lists all claims when the caller asks for an overview", () => {
    const result = service.answer({ partyId: "P9", intent: "general_claim_question", message: "What claims do I have?" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("You have 4 claims");
    expect(result.text).toContain("CL-2048");
    expect(result.text).toContain("CL-2102");
    expect(result.claimId).toBeUndefined();
  });

  it("does not answer a claim belonging to another party", () => {
    const result = service.answer({ partyId: "P9", intent: "claim_status", claimId: "CL-3001" });
    expect(result.ok).toBe(false);
    expect(result.requiresHuman).toBe(true);
    expect(result.text).not.toContain("denied");
  });

  it("creates a grounded summary and honors approval, decline, and timeout states", () => {
    const claim = new FixtureClaimService().getClaimDetails("CL-2048");
    expect(claim).toBeTruthy();
    if (!claim) return;

    const pending = service.sendSummary({ claim, intent: "denial_reason", answer: "The denial was due to missing records.", recipient: "margaret@example.com", consent: "pending" });
    expect(pending.consent).toEqual({ status: "pending", sent: false });

    const approved = service.sendSummary({ claim, intent: "denial_reason", answer: "The denial was due to missing records.", recipient: "margaret@example.com", consent: "approved" });
    expect(approved.summary).toContain("CL-2048");
    expect(approved.consent).toEqual({ status: "approved", sent: true });

    const declined = service.sendSummary({ claim, intent: "denial_reason", answer: "The denial was due to missing records.", recipient: "margaret@example.com", consent: "declined" }, "missing");
    expect(declined.consent).toEqual({ status: "declined", sent: false });

    const timeout = service.sendSummary({ claim, intent: "denial_reason", answer: "The denial was due to missing records.", recipient: "margaret@example.com", consent: "timeout" }, "timeout");
    expect(timeout.consent.status).toBe("timeout");
    expect(timeout.consent.sent).toBe(false);
  });
});
