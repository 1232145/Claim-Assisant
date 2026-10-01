# Insurance Claims SOP Agent

## Purpose

Build a web-based insurance claims support demo that feels genuinely conversational while remaining controlled by a fixed business workflow.

Deterministic application code owns safety, privacy, workflow transitions, claim lookup, and permitted actions. The AI model owns natural-language interpretation, ambiguity resolution, empathy, and user-facing phrasing. The AI model must not bypass identity verification, reveal protected claim information, invent claim facts, or change workflow phase on its own.

The current repository contains starter fixture data in `insurance_claims/fixtures/`. It does not yet contain the completed web application.

## Expected Product

The completed project should provide:

- A browser-based chat interface.
- A backend session and workflow engine.
- AI-model integration using an API token supplied through environment configuration.
- Deterministic access to the fixture data.
- LLM-generated natural responses grounded in deterministic data.
- Identity verification and claim-data protection.
- Intent resolution, claim processing, emotional support, scope control, and escalation.
- A post-case email-summary consent flow.
- Automated tests for the critical workflows.
- Docker or clear local setup instructions.

## Core Workflow

The only normal phase order is:

```text
VERIFY_ID -> RESOLVE_INTENT -> PROCESS_CASE -> POST_PROCESS
```

### Phase 1: VERIFY_ID

Purpose: confirm the caller's identity before any claim details are disclosed.

Supported identity fields:

- Full name
- Date of birth
- Phone number
- Email address
- Policy number
- SSN or national-ID last four digits

Rules:

- At least three identity fields must match the policyholder record.
- Values must be normalized before comparison.
- Known aliases may match where fixture data provides aliases.
- Partial answers, corrections, questions, refusals, and natural conversational phrasing must be handled.
- The agent must remain in `VERIFY_ID` until the verification gate succeeds.
- The agent must not disclose claim status, denial reasons, claim IDs, payment values, required documents, or other protected claim details before verification.
- The agent may acknowledge that it can help with a claim, but must not confirm or reveal claim-specific information.
- If the caller is frustrated, acknowledge the frustration and explain that verification protects their claim information.
- Offer acceptable alternate identity fields when possible.
- Escalate to a human when the caller cannot or will not complete verification after reasonable attempts.

### Phase 2: RESOLVE_INTENT

Purpose: understand what the verified caller wants and select an approved case path.

Typical intents:

- Claim status
- Denial reason
- Required documents
- Document alternatives
- Submission method
- Processing time
- Appeal or next steps
- General claim question
- Human representative request

Rules:

- The LLM may interpret messy language and ask clarifying questions.
- Previously captured hints must be reused. Do not ask the caller to repeat information already available unless it is ambiguous or conflicting.
- The selected intent must map to a bounded, approved action.
- The state machine, not the LLM, approves phase transitions.

### Phase 3: PROCESS_CASE

Purpose: answer the caller's question or perform the permitted claim-support action.

Rules:

- Claim facts must come from deterministic fixture/tool data.
- The claim service should return structured facts and guidance, not normally the final user-facing prose.
- The LLM must phrase and explain grounded results naturally, but may not invent facts.
- Do not expose fields that are not needed for the caller's request.
- Follow claim-specific document guidance when it exists.
- If the data does not support an answer, say so and offer an approved next step or human review.
- The agent must not perform actions outside the supported action set.
- Follow-up questions remain subject to the same scope and grounding rules.

### Phase 4: POST_PROCESS

Purpose: close the interaction and offer a conversation summary.

Rules:

- Offer an email summary after the case is handled.
- The summary may include what was discussed, claim status or outcome, major follow-up items, and next steps.
- Ask for explicit consent before sending.
- The caller may accept, decline, or leave consent unresolved.
- Never claim that an email was sent when consent was declined or sending is unresolved.
- Support the provided consent scenarios, including pending/timeout behavior.

## Cross-Phase Memory

The agent must extract useful information from every user message, regardless of the current phase.

Example:

> I am calling about my denied healthcare claim from January.

While still in `VERIFY_ID`, store structured hints such as:

```json
{
  "claim_type": "healthcare",
  "status_hint": "denied",
  "date_hint": "January",
  "raw_text": "I am calling about my denied healthcare claim from January."
}
```

Memory capture must not change the current phase or bypass verification. After successful verification, the hints should help select the relevant claim and intent.

## Safety and Scope Rules

The service is limited to insurance customer-service support.

In-scope topics include identity verification, policyholder claims, claim status, denial explanations, required documents, document submission, processing expectations, appeal/next steps, consent, and human support.

For out-of-scope questions:

1. Politely explain that the service is limited to insurance claims support.
2. Redirect the caller to an in-scope request.
3. Track repeated irrelevant attempts.
4. Offer human assistance after the configured retry threshold.

Example out-of-scope request: `What is RL?`

The agent must not answer it as a general-purpose chatbot.

## Emotional Support Rules

The agent should recognize frustration, anger, anxiety, confusion, and refusal.

Recommended response order:

1. Acknowledge the caller's emotion.
2. State the reason for the required step.
3. Offer valid alternatives.
4. Continue toward the workflow.
5. Escalate when persuasion is no longer productive or the caller requests a human.

Example:

> I already told you who I am. This is ridiculous. Just tell me why my claim was denied.

Expected behavior:

- Acknowledge the frustration.
- Explain that claim details are protected and require verification.
- Offer the remaining allowed identity fields.
- Do not reveal the denial reason.
- Escalate if the caller continues to refuse or becomes unable to proceed.

## Authority Model

The system must use this authority order:

1. Safety and privacy rules
2. Deterministic SOP state machine
3. Deterministic fixture/tool results
4. LLM interpretation and phrasing

The LLM proposes extraction, intent, emotion, and wording. The backend validates and executes only permitted decisions.

For claim answers, the LLM must receive structured facts from the claim services and generate the final natural-language response from those facts. The claim service must not normally provide the final user-facing prose.

The system must preserve a deterministic fallback response for model outages, invalid model output, or provider incompatibility. The fallback is a resilience mechanism, not the normal response path.

Every user-facing claim response should have an internal response source:

- `llm-grounded`: generated by the LLM from supplied facts and validated.
- `deterministic-fallback`: generated by application code because the LLM path failed.

The response source should be visible in debug/audit data, but does not need to be shown to the customer.

## LLM Response Requirements

The project is not intended to produce a mostly hard-coded chatbot. The required division of responsibility is:

### Deterministic responsibilities

- Identity matching and the three-field verification threshold.
- Phase order and protected-data gates.
- Policyholder and claim lookup.
- Claim facts, statuses, dates, amounts, denial reasons, and required documents.
- Allowed actions and escalation thresholds.
- Email consent and whether an email was sent.
- Validation that generated wording uses only supplied facts.

### LLM responsibilities

- Understand natural wording, typos, incomplete questions, and paraphrases.
- Resolve intent when the caller's language is messy.
- Ask a natural clarification question when intent is ambiguous.
- Phrase grounded claim facts in a natural, concise, empathetic way.
- Adapt tone to frustration, anxiety, confusion, anger, or refusal.
- Summarize the interaction naturally after the case is complete.

### Grounded response flow

```text
caller message
  -> LLM interprets intent and proposed action
  -> SOP validates the proposal
  -> deterministic service retrieves structured facts
  -> LLM phrases a response using only those facts
  -> validator checks the response grounding
  -> response is returned
```

Example structured facts:

```json
{
  "claim_count": 4,
  "claims": [
    {"id": "CL-2048", "type": "healthcare", "status": "denied", "date": "2026-01-12"},
    {"id": "CL-2011", "type": "healthcare", "status": "closed", "date": "2025-01-28"}
  ]
}
```

The LLM may turn those facts into a natural response such as:

> I found four claims associated with your policy. They include healthcare, dental, and auto claims, with one currently denied. Which claim would you like to review?

The wording may vary, but the claim count, IDs, types, statuses, and dates must remain accurate. A hard-coded prose response is permitted only as a deterministic fallback.

## Suggested Session State

```ts
type Phase =
  | "VERIFY_ID"
  | "RESOLVE_INTENT"
  | "PROCESS_CASE"
  | "POST_PROCESS";

type SessionState = {
  phase: Phase;
  verified: boolean;
  verifiedFields: string[];
  verificationAttempts: number;
  rememberedHints: {
    claimType?: string;
    status?: string;
    dateReference?: string;
    rawText?: string;
  };
  intent?: string;
  selectedClaimId?: string;
  irrelevantAttempts: number;
  emotionalState?: string;
  escalationRequired: boolean;
  emailConsent?: "pending" | "approved" | "declined" | "timeout";
};
```

## Existing Fixture Data

The data layer must wrap, rather than bypass, these files:

- `insurance_claims/fixtures/policyholders.json`
- `insurance_claims/fixtures/claims.json`
- `insurance_claims/fixtures/representatives.json`
- `insurance_claims/fixtures/required_document_guideline.json`
- `insurance_claims/fixtures/consent_scenarios.json`
- `insurance_claims/fixtures/claim_schema.json`

The main demonstration caller is:

- Name: Margaret Chen
- Policy: `POL-9921`
- DOB: `1985-03-15`
- SSN last four: `4472`
- Party ID: `P9`
- Denied healthcare claim: `CL-2048`

## Recommended Tool Interfaces

Use deterministic service functions similar to:

```ts
verifyIdentity(input): VerificationResult;
getPolicyholder(identifier): Policyholder | null;
getClaimsForParty(partyId): Claim[];
findRelevantClaim(partyId, hints): Claim | null;
getClaimDetails(claimId): Claim | null;
getDocumentGuidance(claimId, documentName): Guidance;
sendSummaryEmail(summary, recipient): ConsentResult;
```

The LLM must not directly read or fabricate fixture values. It should request approved tools through a controlled adapter.

## Work Allocation for Smaller AI Agents

Each agent must stay within its assigned ownership area, add tests, and report changed files, commands run, assumptions, and integration needs.

### Agent 1: Architecture and Shared Contracts

Own:

- Product requirements
- Shared TypeScript types
- Session state
- API request/response contracts
- Initial directory structure

Must define the interfaces that other agents will implement.

Dependencies: none.

### Agent 2: Fixture and Data Services

Own:

- JSON fixture loaders
- Policyholder lookup
- Claim lookup
- Document guidance lookup
- Consent scenario lookup

Must add deterministic unit tests and must not put business rules in prompts.

Dependencies: shared types from Agent 1.

### Agent 3: SOP State Machine

Own:

- Phase transitions
- Verification gate
- Protected-data gate
- Allowed actions
- Escalation state
- Audit events

Must prove with tests that claim information cannot be disclosed before verification.

Dependencies: shared types from Agent 1.

### Agent 4: Identity Verification and Memory

Own:

- Identity-field extraction and normalization
- Three-field matching logic
- Alias handling
- Verification attempts
- Cross-phase memory extraction and merge behavior

Must test partial answers, incorrect answers, aliases, refusals, and early claim hints.

Dependencies: Agents 1 and 2.

### Agent 5: LLM Adapter, Grounded Verbalizer, and Prompting

Own:

- AI-model client
- Environment-based API-token loading
- System prompt
- Structured output schema
- Tool-call adapter
- Mock-model mode for tests
- Grounded-response verbalizer
- Grounded-fact validation
- Response-source reporting

Must ensure the LLM proposes decisions rather than directly changing workflow state. Must also ensure normal claim responses are naturally phrased from supplied facts rather than hard-coded prose.

Dependencies: shared types and tool interfaces.

### Agent 6: Scope, Emotion, and Escalation

Own:

- In-scope classification
- Repeated irrelevant-question tracking
- Emotional-state detection
- Empathy and de-escalation guidance
- Human-transfer decisions

Must test out-of-scope questions, repeated retries, anger, confusion, refusal, and explicit human requests.

Dependencies: shared session state.

### Agent 7: Intent Resolution, Structured Claim Facts, and Post-Processing

Own:

- Approved intent routing
- Structured claim-fact handlers
- Denial and document guidance
- Claim follow-up answers
- Email-summary generation
- Consent and timeout behavior

Must return structured facts and guidance to the LLM verbalizer instead of making deterministic prose the normal response path. Must ground every claim answer in the data services.

Dependencies: Agents 2, 3, 4, and 5.

### Agent 8: Frontend

Own:

- Chat UI
- Message rendering
- Loading and error states
- Restart-session action
- Optional workflow debug panel
- Email-summary consent controls

The UI may initially use mocked API responses so it can proceed independently.

Dependencies: API contracts from Agent 1.

### Agent 9: Integration, Testing, and Delivery

Own:

- End-to-end tests
- Tests proving wording can vary while facts remain unchanged
- Tests rejecting unsupported model facts
- Tests proving deterministic fallback when the model fails
- Docker configuration
- Environment documentation
- README
- Demo validation
- Regression checks

Must run the full main scenario and all safety scenarios before delivery.

Dependencies: all functional agents.

## Main Acceptance Scenario

Input:

> I am the policyholder. My name is Margaret Chen, policy POL-9921. I am calling about my denied healthcare claim from January. DOB is 1985-03-15, SSN last four is 4472.

Expected result:

1. Extract identity fields and early claim hints.
2. Remain in `VERIFY_ID` while collecting fields.
3. Verify using at least three matching fields.
4. Never disclose claim details before verification succeeds.
5. Reuse the remembered denied-healthcare-January hint.
6. Resolve the relevant intent without unnecessarily asking the caller to repeat it.
7. Select the correct claim from grounded fixture data.
8. Explain the denial using the claim data and document guidance.
9. Answer follow-up questions naturally but only with grounded data.
10. Offer an email summary and honor the caller's consent choice.

## Required Test Scenarios

At minimum, test:

1. Successful Margaret Chen flow.
2. Claim question before verification.
3. Fewer than three matching identity fields.
4. Incorrect identity field.
5. Alias matching.
6. Identity refusal.
7. Early intent remembered across verification.
8. Out-of-scope question.
9. Repeated out-of-scope questions and human escalation.
10. Frustrated caller during verification.
11. Explicit human-transfer request.
12. Grounded denial explanation.
13. Missing-document alternatives.
14. Email consent approved.
15. Email consent declined.
16. Email consent timeout.
17. The same structured claim facts can produce different valid natural-language phrasings.
18. A response containing an unsupported claim ID, date, status, amount, or document is rejected.
19. A provider failure returns a safe deterministic fallback and records `deterministic-fallback` as the response source.

## Definition of Done

The project is ready when:

- A user can open the demo in a browser and chat with the agent.
- The four phases are visible in behavior and enforced in code.
- Claim details cannot leak before verification.
- At least three identity fields are required.
- Early intent hints survive phase transitions.
- Claim answers are grounded in fixture/tool data.
- Normal claim responses are generated by the LLM from structured facts rather than hard-coded prose.
- Generated wording is validated so it cannot add unsupported claim facts.
- Provider failure has a tested deterministic fallback.
- Debug/audit data identifies whether a response used `llm-grounded` or `deterministic-fallback`.
- Out-of-scope and emotional conversations are handled safely.
- Email-summary consent is explicit and correctly represented.
- The main scenario and safety tests pass.
- A new user can configure the API token and start the demo using the README.

## Rules for AI Contributors

- Read this file before changing the project.
- Do not invent insurance facts or alter fixture meaning without documenting it.
- Do not bypass the state machine.
- Do not expose protected claim data before verification.
- Keep business-critical rules deterministic and testable.
- Keep model-specific logic behind an adapter.
- Avoid changing files owned by another agent.
- Add tests for every new workflow rule.
- Report assumptions and unresolved integration issues in the handoff.
