import { describe, expect, it } from "vitest";
import {
  FixtureClaimService,
  FixtureConsentService,
  FixtureDocumentGuidanceService,
  FixturePolicyholderService,
} from "../src/services/index.js";

describe("fixture data services", () => {
  it("looks up policyholders by policy and supports aliases", () => {
    const service = new FixturePolicyholderService();
    expect(service.getPolicyholder("POL-9921")?.party_id).toBe("P9");
    expect(service.findByIdentityCandidates([
      { field: "full_name", value: "Yaven Li" },
      { field: "email_address", value: "yawen.li@example.com" },
    ])?.party_id).toBe("P13");
  });

  it("returns only claims belonging to a party and finds the hinted claim", () => {
    const service = new FixtureClaimService();
    expect(service.getClaimsForParty("P9")).toHaveLength(4);
    expect(service.getClaimDetails("missing")).toBeNull();
    expect(service.findRelevantClaim("P9", {
      claimType: "healthcare",
      status: "denied",
      dateReference: "January",
    })?.case_id).toBe("CL-2048");
  });

  it("uses document-specific guidance before case-type fallback", () => {
    const service = new FixtureDocumentGuidanceService();
    expect(service.getDocumentGuidance("CL-2048", "pathology report")?.text).toContain("specimen details");
    expect(service.getDocumentGuidance("CL-2048")?.text).toContain("medical claims");
    expect(service.getDocumentAlternativeGuidance("office note")?.text).toContain("visit summary");
    expect(service.getDocumentGuidance("missing")).toBeNull();
  });

  it("models approved and timeout consent scenarios deterministically", () => {
    const service = new FixtureConsentService();
    expect(service.sendSummaryEmail("summary", "margaret@email.com")).toEqual({ status: "pending", sent: false });
    expect(service.sendSummaryEmail("summary", "margaret@email.com")).toEqual({ status: "approved", sent: true });

    const timeout = new FixtureConsentService();
    for (let index = 0; index < 3; index += 1) {
      expect(timeout.sendSummaryEmail("summary", "margaret@email.com", "timeout")).toEqual({ status: "pending", sent: false });
    }
  });
});
