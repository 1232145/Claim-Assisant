import { describe, expect, it, vi } from "vitest";
import { AllowlistedToolCallAdapter, EnvironmentLlmClient, LLM_RESPONSE_SCHEMA, LlmProposalAdapter, MockLlmClient } from "../src/llm/index.js";
import { createInitialState } from "../src/workflow/index.js";

describe("LLM adapter boundary", () => {
  it("uses deterministic mock mode to propose without changing workflow state", async () => {
    const adapter = new LlmProposalAdapter({ client: new MockLlmClient() });
    const state = createInitialState("mock-1");
    const proposal = await adapter.propose(state, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
    expect(proposal.proposedAction.kind).toBe("verify_identity");
    expect(proposal.signals.identityCandidates.length).toBeGreaterThanOrEqual(3);
    expect(state.phase).toBe("VERIFY_ID");
  });

  it("proposes each supported claim operation from natural wording", async () => {
    const adapter = new LlmProposalAdapter({ client: new MockLlmClient() });
    const state = { ...createInitialState("intent-matrix"), phase: "RESOLVE_INTENT" as const, verified: true, partyId: "P9" };
    const cases = [
      ["What documents do I need?", "required_documents"],
      ["I cannot get the office note", "document_alternatives"],
      ["How do I submit the documents?", "submission_method"],
      ["How long will review take?", "processing_time"],
      ["What should I do next?", "appeal_next_steps"],
    ] as const;

    for (const [message, intent] of cases) {
      const proposal = await adapter.propose(state, message);
      expect(proposal.proposedAction.intent).toBe(intent);
    }
  });

  it("supplements provider identity extraction when the model omits fields", async () => {
    const client = {
      complete: async () => ({
        signals: { identityCandidates: [], rememberedHints: {}, requestsHuman: false, isOutOfScope: false },
        proposedAction: { kind: "ask_for_identity", intent: "", claimId: "", responseText: "", consentStatus: "" },
      }),
    };
    const proposal = await new LlmProposalAdapter({ client }).propose(createInitialState("api-1"), "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
    expect(proposal.signals.identityCandidates.map((candidate) => candidate.field)).toEqual(["policy_number", "date_of_birth", "full_name"]);
  });

  it("accepts provider extraction from an unlabeled identity list", async () => {
    const client = {
      complete: async () => ({
        signals: {
          identityCandidates: [
            { field: "full_name", value: "Margaret Chen" },
            { field: "policy_number", value: "POL-9921" },
            { field: "date_of_birth", value: "1985-03-15" },
          ],
          rememberedHints: {},
          requestsHuman: false,
          isOutOfScope: false,
        },
        proposedAction: { kind: "verify_identity", intent: "", claimId: "", responseText: "", consentStatus: "" },
      }),
    };
    const proposal = await new LlmProposalAdapter({ client }).propose(createInitialState("unlabeled-ai-1"), "Margaret Chen, POL-9921, 1985-03-15");

    expect(proposal.signals.identityCandidates).toEqual([
      { field: "policy_number", value: "POL-9921" },
      { field: "date_of_birth", value: "1985-03-15" },
      { field: "full_name", value: "Margaret Chen" },
    ]);
  });

  it("falls back safely when a provider returns an unknown action", async () => {
    const client = { complete: async () => ({ signals: { identityCandidates: [], rememberedHints: {}, requestsHuman: false, isOutOfScope: false }, proposedAction: { kind: "change_phase" } }) };
    const proposal = await new LlmProposalAdapter({ client }).propose(createInitialState("bad-1"), "hello");
    expect(proposal.proposedAction.kind).toBe("ask_for_identity");
  });

  it("falls back safely when the provider request fails", async () => {
    const client = { complete: async () => { throw new Error("provider unavailable"); } };
    const proposal = await new LlmProposalAdapter({ client }).propose(createInitialState("failed-1"), "My name is Margaret Chen.");
    expect(proposal.proposedAction.kind).toBe("verify_identity");
    expect(proposal.signals.identityCandidates).toHaveLength(1);
  });

  it("normalizes a valid but wrong-phase redirect into an approved intent", async () => {
    const client = {
      complete: async () => ({
        signals: { identityCandidates: [], rememberedHints: {}, intent: "", requestsHuman: false, isOutOfScope: false },
        proposedAction: { kind: "redirect_in_scope", intent: "", claimId: "", responseText: "", consentStatus: "" },
      }),
    };
    const state = { ...createInitialState("phase-1"), phase: "RESOLVE_INTENT" as const, verified: true, partyId: "P9" };
    const proposal = await new LlmProposalAdapter({ client }).propose(state, "What are my current cases?");
    expect(proposal.proposedAction.kind).toBe("resolve_intent");
    expect(proposal.proposedAction.intent).toBe("general_claim_question");
  });

  it("keeps an overview request broad when the provider narrows it incorrectly", async () => {
    const client = {
      complete: async () => ({
        signals: { identityCandidates: [], rememberedHints: {}, intent: "claim_status", requestsHuman: false, isOutOfScope: false },
        proposedAction: { kind: "resolve_intent", intent: "claim_status", claimId: "CL-2048", responseText: "", consentStatus: "" },
      }),
    };
    const state = { ...createInitialState("overview-1"), phase: "RESOLVE_INTENT" as const, verified: true, partyId: "P9" };
    const proposal = await new LlmProposalAdapter({ client }).propose(state, "What are the claims I have?");

    expect(proposal.proposedAction.intent).toBe("general_claim_question");
    expect(proposal.proposedAction.claimId).toBe("CL-2048");
  });

  it("does not let a provider turn a capability question into a claim answer", async () => {
    const client = {
      complete: async () => ({
        signals: { identityCandidates: [], rememberedHints: {}, intent: "general_claim_question", requestsHuman: false, isOutOfScope: false },
        proposedAction: { kind: "resolve_intent", intent: "general_claim_question", claimId: "CL-2048", responseText: "", consentStatus: "" },
      }),
    };
    const state = { ...createInitialState("capability-1"), phase: "RESOLVE_INTENT" as const, verified: true, partyId: "P9" };
    const proposal = await new LlmProposalAdapter({ client }).propose(state, "How can you help with insurance claims?");

    expect(proposal.proposedAction.kind).toBe("resolve_intent");
    expect(proposal.proposedAction.intent).toBeUndefined();
    expect(proposal.proposedAction.responseText).toContain("claim status");
  });

  it("executes only explicitly allowlisted tools", async () => {
    const tools = new AllowlistedToolCallAdapter(new Map([["lookup", (args) => args.value]]));
    await expect(tools.execute({ name: "lookup", arguments: { value: "ok" } })).resolves.toBe("ok");
    await expect(tools.execute({ name: "set_phase", arguments: {} })).rejects.toThrow("not approved");
  });

  it("publishes a strict structured output schema", () => {
    expect(LLM_RESPONSE_SCHEMA.additionalProperties).toBe(false);
    expect(LLM_RESPONSE_SCHEMA.required).toEqual(["signals", "proposedAction"]);
    const signals = LLM_RESPONSE_SCHEMA.properties.signals;
    const action = LLM_RESPONSE_SCHEMA.properties.proposedAction;
    expect(signals.additionalProperties).toBe(false);
    expect(signals.required).toContain("intent");
    expect(signals.properties.rememberedHints.additionalProperties).toBe(false);
    expect(action.required).toEqual(["kind", "intent", "claimId", "responseText", "consentStatus"]);
    expect(action.properties.kind.enum).toContain("resolve_intent");
    expect(signals.properties.intent.enum).toContain("general_claim_question");
  });

  it("includes a safe provider error detail for structured-output failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "response schema is invalid" } }), { status: 400 })));
    try {
      const client = new EnvironmentLlmClient({ INSURANCE_CLAIMS_API_TOKEN: "test-token" });
      await expect(client.complete([], {})).rejects.toThrow("response schema is invalid");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
