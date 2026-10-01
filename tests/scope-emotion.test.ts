import { describe, expect, it } from "vitest";
import {
  DeterministicScopeEmotionAnalyzer,
  detectEmotionalState,
  empathyGuidance,
  isOutOfScopeMessage,
  requestsHumanRepresentative,
} from "../src/services/index.js";
import { createInitialState } from "../src/workflow/index.js";

describe("deterministic scope and emotion analysis", () => {
  const analyzer = new DeterministicScopeEmotionAnalyzer();

  it("keeps insurance questions in scope", () => {
    expect(isOutOfScopeMessage("Why was my claim denied?")) .toBe(false);
    expect(isOutOfScopeMessage("What was the case about?")) .toBe(false);
    expect(isOutOfScopeMessage("What is my cases?")) .toBe(false);
    expect(isOutOfScopeMessage("Can you tell me what I have?")) .toBe(false);
    expect(isOutOfScopeMessage("Talk about all of them?")) .toBe(false);
    expect(isOutOfScopeMessage("What can you do?")) .toBe(false);
    expect(isOutOfScopeMessage("What documents do I need?")) .toBe(false);
    expect(analyzer.analyze(createInitialState("scope-1"), "What documents do I need for my claim?")).toMatchObject({
      isOutOfScope: false,
      emotionalState: "neutral",
      requestsHuman: false,
      identityRefusal: false,
    });
  });

  it("classifies unrelated questions as out of scope", () => {
    expect(isOutOfScopeMessage("What is RL?")) .toBe(true);
    expect(analyzer.analyze(createInitialState("scope-2"), "Can you give me a recipe?")).toMatchObject({
      isOutOfScope: true,
    });
  });

  it("detects explicit human-transfer requests", () => {
    expect(requestsHumanRepresentative("Please connect me with a real person.")).toBe(true);
    expect(analyzer.analyze(createInitialState("scope-3"), "I want a human representative now.")).toMatchObject({
      requestsHuman: true,
      isOutOfScope: false,
    });
  });

  it("detects emotional states with refusal taking precedence", () => {
    expect(detectEmotionalState("This is ridiculous and I am furious!")).toBe("angry");
    expect(detectEmotionalState("I am worried about what happens next.")).toBe("anxious");
    expect(detectEmotionalState("I do not understand this denial.")).toBe("confused");
    expect(detectEmotionalState("I won't provide any more information to verify my identity.")).toBe("refusal");
  });

  it("returns guidance without exposing claim facts", () => {
    const result = analyzer.analyze(createInitialState("scope-4"), "I already told you who I am. This is ridiculous.");
    expect(result.emotionalState).toBe("angry");
    expect(result.guidance).toContain("verification");
    expect(result.guidance).not.toMatch(/CL-\d+|denial reason|payment amount/i);
    expect(empathyGuidance("frustrated")).toContain("frustrating");
  });
});
