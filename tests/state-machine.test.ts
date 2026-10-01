import { describe, expect, it } from "vitest";
import type { ExtractedMessageSignals, IdentityService, PolicyholderService } from "../src/shared/index.js";
import type { IdentityVerificationResult, PolicyholderRecord, SessionState } from "../src/shared/types.js";
import { SopWorkflowEngine, createInitialState, type WorkflowProposalResolver } from "../src/workflow/index.js";

const policyholder: PolicyholderRecord = {
  party_id: "P9",
  name: "Margaret Chen",
  policy_number: "POL-9921",
  dob: "1985-03-15",
  id_type: "ssn_last4",
  id_last4: "4472",
  phone: "5551234567",
  email: "margaret@example.com",
};

const policyholders: PolicyholderService = {
  getPolicyholder(identifier) {
    return identifier === policyholder.policy_number ? policyholder : null;
  },
  findByIdentityCandidates() {
    return policyholder;
  },
};

const identity: IdentityService = {
  verifyIdentity(candidates): IdentityVerificationResult {
    const matchedFields = candidates.slice(0, 3).map((candidate) => candidate.field);
    return {
      verified: matchedFields.length >= 3,
      matchedFields,
      mismatchedFields: [],
      missingFields: [],
      attempts: 1,
    };
  },
};

/** Builds the minimum model-signal fixture used by state-machine tests. */
function signals(overrides: Partial<ExtractedMessageSignals> = {}): ExtractedMessageSignals {
  return {
    identityCandidates: [],
    rememberedHints: {},
    requestsHuman: false,
    isOutOfScope: false,
    ...overrides,
  };
}

/** Wraps a fixed proposal in the resolver interface expected by the engine. */
function resolverFor(proposal: ReturnType<typeof makeProposal>): WorkflowProposalResolver {
  return { propose: async () => proposal };
}

/** Creates a compact proposal fixture with optional action fields. */
function makeProposal(
  kind: "answer_claim_question" | "verify_identity" | "resolve_intent" | "ask_for_identity" | "escalate_to_human" | "record_email_consent",
  proposalSignals = signals(),
  extra: Record<string, string> = {},
) {
  return { signals: proposalSignals, proposedAction: { kind, ...extra } };
}

/** Creates a workflow engine wired to deterministic test dependencies. */
function engine(proposal: ReturnType<typeof makeProposal>) {
  return new SopWorkflowEngine({ proposals: resolverFor(proposal), identity, policyholders, now: () => "2026-01-01T00:00:00.000Z" });
}

describe("SOP state machine", () => {
  it("blocks claim data before verification and records an audit event", async () => {
    const proposal = makeProposal("answer_claim_question", signals(), { responseText: "The claim was denied because..." });
    const result = await engine(proposal).handleMessage(createInitialState("s-1"), "Why was my claim denied?");

    expect(result.state.phase).toBe("VERIFY_ID");
    expect(result.state.verified).toBe(false);
    expect(result.reply.content).not.toContain("denied because");
    expect(result.events.some((event) => event.type === "protected_data_blocked")).toBe(true);
  });

  it("requires three matched fields before changing phase", async () => {
    const proposal = makeProposal("verify_identity", signals({
      identityCandidates: [
        { field: "policy_number", value: "POL-9921" },
        { field: "date_of_birth", value: "1985-03-15" },
      ],
    }));
    const result = await engine(proposal).handleMessage(createInitialState("s-2"), "My policy is POL-9921 and DOB is 1985-03-15.");

    expect(result.state.phase).toBe("VERIFY_ID");
    expect(result.state.verified).toBe(false);
    expect(result.state.verificationAttempts).toBe(1);
  });

  it("moves through the approved phase order after verification", async () => {
    const verifyProposal = makeProposal("verify_identity", signals({
      identityCandidates: [
        { field: "full_name", value: "Margaret Chen" },
        { field: "policy_number", value: "POL-9921" },
        { field: "id_last4", value: "4472" },
      ],
    }));
    const verifyResult = await engine(verifyProposal).handleMessage(createInitialState("s-3"), "I am Margaret Chen, POL-9921, last four 4472.");
    expect(verifyResult.state.phase).toBe("RESOLVE_INTENT");
    expect(verifyResult.events.map((event) => event.type)).toContain("phase_changed");

    const resolveProposal = makeProposal("resolve_intent", signals(), { intent: "denial_reason", claimId: "CL-9999" });
    const resolveResult = await engine(resolveProposal).handleMessage(verifyResult.state, "Tell me the denial reason for claim CL-2048.");
    expect(resolveResult.state.phase).toBe("PROCESS_CASE");
    expect(resolveResult.state.selectedClaimId).toBe("CL-2048");
  });

  it("does not trust a provider-supplied claim ID that the caller did not name", async () => {
    const verifyProposal = makeProposal("verify_identity", signals({
      identityCandidates: [
        { field: "full_name", value: "Margaret Chen" },
        { field: "policy_number", value: "POL-9921" },
        { field: "id_last4", value: "4472" },
      ],
    }));
    const verifyResult = await engine(verifyProposal).handleMessage(createInitialState("s-claim-boundary"), "I am Margaret Chen, POL-9921, last four 4472.");
    const resolveProposal = makeProposal("resolve_intent", signals(), { intent: "denial_reason", claimId: "CL-9999" });
    const resolveResult = await engine(resolveProposal).handleMessage(verifyResult.state, "Why was my claim denied?");

    expect(resolveResult.state.selectedClaimId).toBeUndefined();
  });

  it("escalates after repeated out-of-scope requests", async () => {
    const proposal = { ...makeProposal("ask_for_identity"), signals: signals({ isOutOfScope: true }) };
    const workflow = engine(proposal);
    let state: SessionState = createInitialState("s-4");
    state = (await workflow.handleMessage(state, "What is RL?")).state;
    state = (await workflow.handleMessage(state, "What is RL?")).state;
    const result = await workflow.handleMessage(state, "What is RL?");

    expect(result.state.escalationRequired).toBe(true);
    expect(result.state.escalationReason).toBe("repeated_out_of_scope");
    expect(result.events.some((event) => event.type === "escalation_required")).toBe(true);
  });
});
