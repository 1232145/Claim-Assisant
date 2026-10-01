import { describe, expect, it } from "vitest";
import { GroundedResponseAdapter, validateGroundedResponse } from "../src/llm/index.js";

describe("grounded response generation", () => {
  const facts = [
    { key: "claim_id", value: "CL-2048" },
    { key: "status", value: "denied" },
  ];

  it("accepts natural wording that cites supplied facts", () => {
    const result = validateGroundedResponse({ text: "I’m sorry this claim was denied.", groundedFacts: ["claim_id", "status"], needsClarification: false }, facts);
    expect(result.text).toContain("denied");
    expect(result.source).toBe("llm-grounded");
  });

  it("rejects citations for facts not returned by services", () => {
    expect(() => validateGroundedResponse({ text: "Your claim was denied yesterday.", groundedFacts: ["claim_id", "date"], needsClarification: false }, facts)).toThrow("not returned");
  });

  it("rejects unsupported claim literals even when citations look valid", () => {
    expect(() => validateGroundedResponse({ text: "Claim CL-9999 was denied.", groundedFacts: ["status"], needsClarification: false }, facts)).toThrow("unsupported fact");
  });

  it("rejects unsupported document claims", () => {
    const documentFacts = [...facts, { key: "required_documents", value: "pathology report, office note" }];
    expect(() => validateGroundedResponse({ text: "Please upload your passport.", groundedFacts: ["required_documents"], needsClarification: false }, documentFacts)).toThrow("unsupported fact");
  });

  it("uses the deterministic fallback in mock mode", async () => {
    const adapter = new GroundedResponseAdapter({ complete: async () => ({}) }, true);
    const result = await adapter.generate({ answer: { ok: true, text: "Claim CL-2048 is denied." }, facts, fallbackText: "Claim CL-2048 is denied." });
    expect(result.text).toBe("Claim CL-2048 is denied.");
    expect(result.groundedFacts).toEqual(["claim_id", "status"]);
    expect(result.source).toBe("deterministic-fallback");
  });

  it("falls back and reports the source when the provider fails", async () => {
    const adapter = new GroundedResponseAdapter({ complete: async () => { throw new Error("provider unavailable"); } });
    const result = await adapter.generate({ answer: { ok: true, text: "Claim CL-2048 is denied." }, facts, fallbackText: "Claim CL-2048 is denied." });
    expect(result).toMatchObject({ text: "Claim CL-2048 is denied.", source: "deterministic-fallback" });
  });

  it("allows wording to vary while retaining the same grounded facts", () => {
    const first = validateGroundedResponse({ text: "Your claim is denied.", groundedFacts: ["claim_id", "status"], needsClarification: false }, facts);
    const second = validateGroundedResponse({ text: "I’m sorry—CL-2048 is currently denied.", groundedFacts: ["claim_id", "status"], needsClarification: false }, facts);
    expect(first.groundedFacts).toEqual(second.groundedFacts);
    expect(first.text).not.toBe(second.text);
  });
});
