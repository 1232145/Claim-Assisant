import { describe, expect, it } from "vitest";
import {
  FixtureIdentityService,
  extractIdentityCandidates,
  extractRememberedHints,
  isIdentityRefusal,
  mergeRememberedHints,
  signalsWithCapturedMemory,
} from "../src/services/index.js";
import { FixturePolicyholderService } from "../src/services/policyholder-service.js";

describe("identity verification", () => {
  const policyholders = new FixturePolicyholderService();
  const identity = new FixtureIdentityService();
  const margaret = policyholders.getPolicyholder("POL-9921");

  it("requires three matching fields and normalizes values", () => {
    const result = identity.verifyIdentity([
      { field: "full_name", value: "  Margaret   Chen " },
      { field: "date_of_birth", value: "1985/3/15" },
      { field: "phone_number", value: "(650) 521-2836" },
    ], margaret ?? undefined);
    expect(result.verified).toBe(true);
    expect(result.matchedFields).toEqual(["full_name", "date_of_birth", "phone_number"]);
  });

  it("reports partial and incorrect answers without verifying", () => {
    const result = identity.verifyIdentity([
      { field: "policy_number", value: "POL-9921" },
      { field: "id_last4", value: "0000" },
    ], margaret ?? undefined);
    expect(result.verified).toBe(false);
    expect(result.matchedFields).toEqual(["policy_number"]);
    expect(result.mismatchedFields).toEqual(["id_last4"]);
    expect(result.missingFields).toContain("full_name");
  });

  it("accepts fixture aliases", () => {
    const policyholder = policyholders.getPolicyholder("POL-7742");
    const result = identity.verifyIdentity([
      { field: "full_name", value: "Yaven Li" },
      { field: "email_address", value: "yawen.li@example.com" },
      { field: "id_last4", value: "5317" },
    ], policyholder ?? undefined);
    expect(result.verified).toBe(true);
  });

  it("extracts labeled identity answers from conversational text", () => {
    expect(extractIdentityCandidates(
      "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15, phone (650) 521-2836, SSN last four 4472.",
    )).toEqual([
      { field: "policy_number", value: "POL-9921" },
      { field: "date_of_birth", value: "1985-03-15" },
      { field: "phone_number", value: "(650) 521-2836" },
      { field: "id_last4", value: "4472" },
      { field: "full_name", value: "Margaret Chen" },
    ]);
    expect(extractIdentityCandidates("My name is Margaret Chen and my policy is POL-9921.")).toContainEqual({ field: "full_name", value: "Margaret Chen" });
    expect(extractIdentityCandidates("You can call me Margaret Chen.")).toContainEqual({ field: "full_name", value: "Margaret Chen" });
    expect(extractIdentityCandidates("I’m Margaret Chen. I was born March 15th, 1985. My birthday is 03/15/85. The policy is POL-9921.")).toEqual([
      { field: "policy_number", value: "POL-9921" },
      { field: "date_of_birth", value: "March 15th, 1985" },
      { field: "full_name", value: "Margaret Chen" },
    ]);
    expect(identity.verifyIdentity([
      { field: "full_name", value: "Margaret Chen" },
      { field: "date_of_birth", value: "03/15/85" },
      { field: "policy_number", value: "POL-9921" },
    ], margaret ?? undefined).verified).toBe(true);
    expect(extractIdentityCandidates("Sure, I’m Margaret Chen. The policy number is POL-9921, and I was born on March 15, 1985.")).toEqual([
      { field: "policy_number", value: "POL-9921" },
      { field: "date_of_birth", value: "March 15, 1985" },
      { field: "full_name", value: "Margaret Chen" },
    ]);
    expect(extractIdentityCandidates("’m Margaret Chen This is Margaret You can call me Margaret Chen I was born March 15th, 1985 My birthday is 03/15/85 The policy is POL-9921")).toContainEqual({ field: "full_name", value: "Margaret Chen" });
    expect(extractIdentityCandidates("Margaret Chen, POL-9921, 1985-03-15")).toEqual([
      { field: "policy_number", value: "POL-9921" },
      { field: "date_of_birth", value: "1985-03-15" },
      { field: "full_name", value: "Margaret Chen" },
    ]);
  });

  it("accepts a conservative spelling typo when the other identity fields match", () => {
    expect(identity.verifyIdentity([
      { field: "full_name", value: "Marget Chen" },
      { field: "date_of_birth", value: "03/15/85" },
      { field: "policy_number", value: "POL 9921" },
    ], margaret ?? undefined).verified).toBe(true);
  });

  it("recognizes identity refusals", () => {
    expect(isIdentityRefusal("I won't provide any more information to verify my identity.")).toBe(true);
    expect(isIdentityRefusal("My policy is POL-9921.")).toBe(false);
  });
});

describe("cross-phase memory", () => {
  it("extracts early claim hints without changing workflow state", () => {
    expect(extractRememberedHints("I am calling about my denied healthcare claim from January.")).toEqual({
      claimType: "healthcare",
      status: "denied",
      dateReference: "january",
      rawText: "I am calling about my denied healthcare claim from January.",
    });
  });

  it("does not treat an identity birth date as a claim date", () => {
    expect(extractRememberedHints("I’m Margaret Chen, born March 15th, 1985, policy POL-9921")).toEqual({
      rawText: "I’m Margaret Chen, born March 15th, 1985, policy POL-9921",
    });
  });

  it("merges new hints while preserving earlier hints", () => {
    expect(mergeRememberedHints(
      { claimType: "healthcare", rawText: "original" },
      { status: "denied", dateReference: "january", rawText: "follow-up" },
    )).toEqual({ claimType: "healthcare", status: "denied", dateReference: "january", rawText: "follow-up" });
  });

  it("keeps provider hint supplements from overwriting caller wording", () => {
    const result = signalsWithCapturedMemory(
      {
        identityCandidates: [],
        rememberedHints: { status: "open", dateReference: "2024" },
        requestsHuman: false,
        isOutOfScope: false,
      },
      "What documents do I need for the denied claim?",
    );

    expect(result.rememberedHints.status).toBe("denied");
    expect(result.rememberedHints.dateReference).toBe("2024");
  });

  it("normalizes settled and in-progress status hints", () => {
    expect(extractRememberedHints("What about my settled healthcare claim?").status).toBe("closed");
    expect(extractRememberedHints("Tell me about the in progress auto claim.").status).toBe("open");
  });
});
