export const LLM_SYSTEM_PROMPT = `You are the language-understanding layer for an insurance claims support workflow.

Return exactly one JSON object matching the supplied response schema. Extract identity candidates, claim-selection hints, intent, emotion, and whether the caller requests a human. Understand natural phrasing, spelling mistakes, line breaks, and unlabeled identity lists such as “Margaret Chen, POL-9921, 1985-03-15”. Use claim_overview only when the caller asks for a list or broad overview of multiple claims, including “Tell me about my cases”; use general_claim_question for one selected claim and for singular wording such as “What is my case about?”. Extract only values grounded in the caller message; if a value is ambiguous, leave it empty rather than inventing it. Propose one approved next action and concise wording when appropriate.

The backend owns identity verification, privacy, phase transitions, claim facts, escalation thresholds, and email sending. You only propose signals and wording; never claim that a protected fact was retrieved, never invent fixture facts, and never change workflow state. Use empty strings for unknown text fields. Do not call tools except through the controlled tool adapter provided by the application.`;

const claimIntents = ["claim_status", "denial_reason", "required_documents", "document_alternatives", "submission_method", "processing_time", "appeal_next_steps", "claim_overview", "general_claim_question", "human_representative"] as const;
const actionKinds = ["ask_for_identity", "verify_identity", "resolve_intent", "answer_claim_question", "offer_email_summary", "record_email_consent", "escalate_to_human", "redirect_in_scope"] as const;
const emotionalStates = ["neutral", "frustrated", "angry", "anxious", "confused", "refusal"] as const;

export const LLM_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["signals", "proposedAction"],
  properties: {
    signals: {
      type: "object",
      additionalProperties: false,
      required: ["identityCandidates", "rememberedHints", "intent", "emotionalState", "requestsHuman", "isOutOfScope"],
      properties: {
        identityCandidates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["field", "value"],
            properties: { field: { type: "string", enum: ["full_name", "date_of_birth", "phone_number", "email_address", "policy_number", "id_last4"] }, value: { type: "string" } },
          },
        },
        rememberedHints: {
          type: "object",
          additionalProperties: false,
          required: ["claimType", "status", "dateReference", "rawText"],
          properties: { claimType: { type: "string" }, status: { type: "string" }, dateReference: { type: "string" }, rawText: { type: "string" } },
        },
        intent: { type: "string", enum: [...claimIntents, ""] },
        emotionalState: { type: "string", enum: [...emotionalStates, ""] },
        requestsHuman: { type: "boolean" },
        isOutOfScope: { type: "boolean" },
      },
    },
    proposedAction: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "intent", "claimId", "responseText", "consentStatus"],
      properties: {
        kind: { type: "string", enum: actionKinds },
        intent: { type: "string", enum: [...claimIntents, ""] },
        claimId: { type: "string" },
        responseText: { type: "string" },
        consentStatus: { type: "string", enum: ["pending", "approved", "declined", "timeout", ""] },
      },
    },
  },
} as const;

/** Combines the read-only session context and caller message for model interpretation. */
export function buildUserPrompt(state: object, message: string): string {
  return `Current session state (for interpretation only):\n${JSON.stringify(state)}\n\nCaller message:\n${message}`;
}
