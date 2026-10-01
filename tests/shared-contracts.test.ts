import { describe, expect, it } from "vitest";
import { PHASES, type SessionState } from "../src/shared/index.js";

describe("shared workflow contracts", () => {
  it("defines the required phase order", () => {
    expect(PHASES).toEqual([
      "VERIFY_ID",
      "RESOLVE_INTENT",
      "PROCESS_CASE",
      "POST_PROCESS",
    ]);
  });

  it("models an unverified session without protected claim data", () => {
    const state: SessionState = {
      sessionId: "session-1",
      phase: "VERIFY_ID",
      verified: false,
      verifiedFields: [],
      verificationAttempts: 0,
      rememberedHints: {
        claimType: "healthcare",
        status: "denied",
        dateReference: "January",
        rawText: "I am calling about my denied healthcare claim from January.",
      },
      irrelevantAttempts: 0,
      escalationRequired: false,
    };

    expect(state.verified).toBe(false);
    expect(state.phase).toBe("VERIFY_ID");
    expect(state.rememberedHints.status).toBe("denied");
    expect(state.selectedClaimId).toBeUndefined();
  });
});
