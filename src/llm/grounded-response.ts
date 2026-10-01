import type { ClaimAnswer } from "../services/claim-processing-service.js";
import type { ResponseSource } from "../shared/index.js";
import type { LlmCompletionClient } from "./types.js";

export interface GroundedFact {
  key: string;
  value: string;
}

export interface GroundedResponseRequest {
  /** The deterministic answer shown as the source of truth for this turn. */
  answer: ClaimAnswer;
  /** Facts returned by approved services; no fixture data is fetched by the model. */
  facts: GroundedFact[];
  /** The original caller wording, used only to improve tone and structure. */
  userMessage?: string;
  /** Safe fallback used when mock mode is enabled or generation fails upstream. */
  fallbackText?: string;
}

export interface GroundedResponse {
  text: string;
  groundedFacts: string[];
  needsClarification: boolean;
  source: ResponseSource;
}

export const GROUNDED_RESPONSE_SYSTEM_PROMPT = `You are the response-writing layer for an insurance claims support workflow.

Write a natural, empathetic answer using only the supplied deterministic answer and facts. You may reorganize, summarize, clarify, and soften the wording, but you must not add claim IDs, dates, amounts, statuses, documents, deadlines, causes, or other factual details that are not supplied. Return exactly one JSON object matching the schema. groundedFacts must contain only keys from the supplied facts and must identify the facts used in the response.

Privacy, identity verification, claim lookup, supported actions, escalation, and consent are enforced by the backend. Do not claim that an email was sent or that a tool was called.`;

export const GROUNDED_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "groundedFacts", "needsClarification"],
  properties: {
    text: { type: "string" },
    groundedFacts: { type: "array", items: { type: "string" } },
    needsClarification: { type: "boolean" },
  },
} as const;

/** Generates flexible wording while constraining the model to deterministic claim facts. */
export class GroundedResponseAdapter {
  constructor(
    private readonly client: LlmCompletionClient,
    private readonly mockMode = false,
  ) {}

  /** Requests a grounded response and safely falls back when generation or validation fails. */
  async generate(request: GroundedResponseRequest): Promise<GroundedResponse> {
    if (this.mockMode) {
      return {
        text: request.fallbackText ?? request.answer.text,
        groundedFacts: request.facts.map((fact) => fact.key),
        needsClarification: !request.answer.ok,
        source: "deterministic-fallback",
      };
    }

    try {
      const userContent = JSON.stringify({
        callerMessage: request.userMessage ?? "",
        deterministicAnswer: request.answer,
        facts: request.facts,
      });
      const raw = await this.client.complete([
        { role: "system", content: GROUNDED_RESPONSE_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ], GROUNDED_RESPONSE_SCHEMA);
      return { ...validateGroundedResponse(raw, request.facts), source: "llm-grounded" };
    } catch {
      return {
        text: request.fallbackText ?? request.answer.text,
        groundedFacts: request.facts.map((fact) => fact.key),
        needsClarification: !request.answer.ok,
        source: "deterministic-fallback",
      };
    }
  }
}

/** Validates the structured model result against the exact fact keys returned by services. */
export function validateGroundedResponse(value: unknown, facts: GroundedFact[]): GroundedResponse {
  if (!value || typeof value !== "object") throw new Error("Grounded response must be an object");
  const response = value as Record<string, unknown>;
  if (typeof response.text !== "string" || !response.text.trim()) throw new Error("Grounded response text is required");
  if (!Array.isArray(response.groundedFacts) || !response.groundedFacts.every((fact) => typeof fact === "string")) throw new Error("Grounded response citations are invalid");
  const allowed = new Set(facts.map((fact) => fact.key));
  const groundedFacts = response.groundedFacts as string[];
  if (groundedFacts.some((fact) => !allowed.has(fact))) throw new Error("Grounded response cited a fact that was not returned by services");
  rejectUnsupportedLiterals(response.text, facts);
  return {
    text: response.text,
    groundedFacts: [...new Set(groundedFacts)],
    needsClarification: response.needsClarification === true,
    source: "llm-grounded",
  };
}

/** Rejects common claim literals in wording unless the same literal was supplied by services. */
function rejectUnsupportedLiterals(text: string, facts: GroundedFact[]): void {
  const supplied = facts.map((fact) => fact.value.toLocaleLowerCase());
  const literals = [
    ...(text.match(/\b[A-Z]{2,5}-\d{3,}\b/g) ?? []),
    ...(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []),
    ...(text.match(/\$\s?\d[\d,]*(?:\.\d{2})?/g) ?? []),
    ...(text.match(/\b(?:denied|approved|pending|closed|open|paid|cancelled)\b/gi) ?? []),
    ...(text.match(/\b(?:passport|driver['’]?s?\s+licen[cs]e|medical\s+record|pathology\s+report|office\s+note|visit\s+summary|diagnosis\s+report|claim\s+form|receipt|invoice)\b/gi) ?? []),
  ];
  const unsupported = literals.find((literal) => !supplied.some((fact) => fact.includes(literal.toLocaleLowerCase())));
  if (unsupported) throw new Error(`Grounded response contained unsupported fact: ${unsupported}`);
}
