import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppServer } from "../src/server.js";

let baseUrl = "";
const server = createAppServer();

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function createSession(): Promise<{ sessionId: string }> {
  const response = await fetch(`${baseUrl}/api/sessions`, { method: "POST" });
  const payload = await response.json() as { state: { sessionId: string } };
  return { sessionId: payload.state.sessionId };
}

async function send(sessionId: string, message: string) {
  const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  return response.json() as Promise<{ state: Record<string, unknown>; reply: { content: string }; debug?: { responseSource?: string } }>;
}

async function consent(sessionId: string, value: "approved" | "declined") {
  const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/consent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consent: value }),
  });
  return response.json() as Promise<{ state: { emailConsent: string }; reply: { content: string } }>;
}

async function completedSession(): Promise<string> {
  const { sessionId } = await createSession();
  await send(sessionId, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
  await send(sessionId, "Tell me my claim status.");
  await send(sessionId, "What is the status?");
  return sessionId;
}

async function verifiedSession(): Promise<string> {
  const { sessionId } = await createSession();
  await send(sessionId, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
  return sessionId;
}

describe("HTTP workflow integration", () => {
  it("blocks protected claim details before verification", async () => {
    const { sessionId } = await createSession();
    const result = await send(sessionId, "Why was my claim denied?");

    expect(result.state.phase).toBe("VERIFY_ID");
    expect(result.state.verified).toBe(false);
    expect(result.reply.content).not.toMatch(/CL-2048|pathology|denial reason/i);
  });

  it("answers capability questions without exposing claim details", async () => {
    const { sessionId } = await createSession();
    const result = await send(sessionId, "What can you do?");

    expect(result.state.phase).toBe("VERIFY_ID");
    expect(result.reply.content).toContain("claim status");
    expect(result.reply.content).toContain("verify your identity");
    expect(result.reply.content).not.toContain("CL-2048");
  });

  it("keeps case questions in scope before verification", async () => {
    const { sessionId } = await createSession();
    const result = await send(sessionId, "What is my cases?");

    expect(result.state.phase).toBe("VERIFY_ID");
    expect(result.reply.content).toContain("identity details");
    expect(result.reply.content).not.toContain("What would you like to do?");
  });

  it("reports how many identity details are still needed", async () => {
    const { sessionId } = await createSession();
    const result = await send(sessionId, "My name is Margaret Chen.");

    expect(result.state.phase).toBe("VERIFY_ID");
    expect(result.reply.content).toContain("I have 1 matching identity detail");
    expect(result.reply.content).toContain("2 more matching details");
    expect(result.reply.content).not.toContain("your name");
  });

  it("accepts a natural call-me identity phrase", async () => {
    const { sessionId } = await createSession();
    const result = await send(sessionId, "You can call me Margaret Chen.");

    expect(result.state.phase).toBe("VERIFY_ID");
    expect(result.reply.content).toContain("I have 1 matching identity detail");
    expect(result.reply.content).toContain("2 more matching details");
  });

  it("lists the caller's claims instead of defaulting to the first claim", async () => {
    const { sessionId } = await createSession();
    await send(sessionId, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
    const result = await send(sessionId, "What claims do I have?");

    expect(result.reply.content).toContain("You have 4 claims");
    expect(result.reply.content).toContain("CL-2048");
    expect(result.reply.content).toContain("CL-2102");
    expect(result.debug?.responseSource).toBe("deterministic-fallback");
  });

  it("understands cases as claims when listing all records", async () => {
    const { sessionId } = await createSession();
    await send(sessionId, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
    const result = await send(sessionId, "List all my cases");

    expect(result.reply.content).toContain("You have 4 claims");
    expect(result.reply.content).toContain("CL-2048");
    expect(result.reply.content).toContain("CL-2102");
    expect(result.reply.content).not.toContain("could not identify a matching claim");
  });

  it("handles the singular claim question without escalating", async () => {
    const { sessionId } = await createSession();
    await send(sessionId, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
    const result = await send(sessionId, "What is my claim");

    expect(result.reply.content).toContain("You have 4 claims");
    expect(result.reply.content).toContain("CL-2048");
    expect(result.state.escalationRequired).toBe(false);
  });

  it("understands current cases as a request for the available case list", async () => {
    const { sessionId } = await createSession();
    await send(sessionId, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
    const result = await send(sessionId, "What are my current cases?");

    expect(result.reply.content).toContain("You have 4 claims");
    expect(result.reply.content).toContain("CL-2048");
    expect(result.reply.content).toContain("CL-2102");
    expect(result.state.escalationRequired).toBe(false);
  });

  it("verifies identity across separate natural-language turns", async () => {
    const { sessionId } = await createSession();
    const name = await send(sessionId, "I am Margaret Chen");
    expect(name.state.phase).toBe("VERIFY_ID");
    const date = await send(sessionId, "I was born March 15th, 1985");
    expect(date.state.phase).toBe("VERIFY_ID");
    const policy = await send(sessionId, "The policy is POL-9921");

    expect(policy.state.verified).toBe(true);
    expect(policy.state.phase).toBe("RESOLVE_INTENT");
    expect(policy.state.escalationRequired).toBe(false);
  });

  it("verifies the pasted multi-line identity message", async () => {
    const { sessionId } = await createSession();
    const result = await send(sessionId, [
      "I’m Margaret Chen",
      "This is Margaret",
      "You can call me Margaret Chen",
      "I was born March 15th, 1985",
      "My birthday is 03/15/85",
      "The policy is POL-9921",
    ].join("\n"));

    expect(result.state.verified).toBe(true);
    expect(result.state.phase).toBe("RESOLVE_INTENT");
    expect(result.state.escalationRequired).toBe(false);
  });

  it("handles the exact claims-I-have wording as an overview", async () => {
    const { sessionId } = await createSession();
    await send(sessionId, "I am Margaret Chen, policy POL-9921, DOB 03/15/85.");
    const result = await send(sessionId, "What are the claims I have");

    expect(result.reply.content).toContain("You have 4 claims");
    expect(result.reply.content).toContain("CL-2048");
    expect(result.state.escalationRequired).toBe(false);
  });

  it("clarifies an ambiguous singular case request instead of escalating", async () => {
    const { sessionId } = await createSession();
    await send(sessionId, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
    const result = await send(sessionId, "My case");

    expect(result.state.phase).toBe("RESOLVE_INTENT");
    expect(result.state.escalationRequired).toBe(false);
    expect(result.reply.content).toContain("Which claim would you like to review?");
    expect(result.reply.content).not.toContain("could not identify a matching claim");
  });

  it("runs the verified denial flow against fixture data", async () => {
    const { sessionId } = await createSession();
    const verified = await send(sessionId, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15. I have a denied healthcare claim from January.");
    expect(verified.state.phase).toBe("RESOLVE_INTENT");
    expect(verified.state.partyId).toBe("P9");

    const intent = await send(sessionId, "Please explain why it was denied.");
    expect(intent.state.phase).toBe("POST_PROCESS");
    expect(intent.reply.content).toContain("CL-2048");
    expect(intent.reply.content).toContain("pathology report");
  });

  it("runs every supported claim operation through the HTTP workflow", async () => {
    const cases = [
      ["What is the status of claim CL-2048?", "denied"],
      ["Why was claim CL-2048 denied?", "pathology report"],
      ["What documents do I need?", "pathology report"],
      ["I cannot get the office note", "visit summary"],
      ["How do I submit the documents?", "member portal"],
      ["How long will review take?", "less than a week"],
      ["What should I do next?", "next step"],
    ] as const;

    for (const [message, expected] of cases) {
      const result = await send(await verifiedSession(), message);
      expect(result.state.phase, message).toBe("POST_PROCESS");
      expect(result.reply.content.toLocaleLowerCase(), message).toContain(expected);
      expect(result.state.escalationRequired, message).toBe(false);
    }
  });

  it("remembers early claim hints through verification", async () => {
    const { sessionId } = await createSession();
    const early = await send(sessionId, "I need help with my denied healthcare claim from January.");
    expect(early.state.phase).toBe("VERIFY_ID");
    expect(early.reply.content).not.toContain("CL-2048");

    const verified = await send(sessionId, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
    expect(verified.state.phase).toBe("RESOLVE_INTENT");
    const answer = await send(sessionId, "Why was it denied?");
    expect(answer.reply.content).toContain("CL-2048");
    expect(answer.reply.content).toContain("pathology report");
  });

  it("escalates refusal and explicit human requests through HTTP", async () => {
    const refusal = await createSession();
    await send(refusal.sessionId, "I refuse to provide identity details.");
    await send(refusal.sessionId, "I refuse to provide identity details.");
    const refusalResult = await send(refusal.sessionId, "I refuse to provide identity details.");
    expect(refusalResult.state.escalationRequired).toBe(true);
    expect(refusalResult.state.escalationReason).toBe("identity_refusal");

    const human = await createSession();
    const humanResult = await send(human.sessionId, "Please connect me with a human representative.");
    expect(humanResult.state.escalationRequired).toBe(true);
    expect(humanResult.state.escalationReason).toBe("caller_requested_human");
  });

  it("acknowledges frustration without disclosing claim details", async () => {
    const { sessionId } = await createSession();
    const result = await send(sessionId, "This is ridiculous and I am frustrated. Just tell me why my claim was denied.");

    expect(result.state.phase).toBe("VERIFY_ID");
    expect(result.reply.content).toMatch(/frustrat/i);
    expect(result.reply.content).not.toContain("CL-2048");
    expect(result.reply.content).not.toContain("pathology");
  });

  it("accepts natural case questions after verification", async () => {
    const { sessionId } = await createSession();
    const verified = await send(sessionId, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
    expect(verified.state.phase).toBe("RESOLVE_INTENT");

    const answer = await send(sessionId, "What was the case about?");
    expect(answer.state.phase).toBe("POST_PROCESS");
    expect(answer.reply.content).toContain("CL-2048");
  });

  it("retains correct identity fields when a caller corrects a prior answer", async () => {
    const { sessionId } = await createSession();
    const first = await send(sessionId, "My name is Margaret Chen and my policy is POL-0000.");
    expect(first.state.phase).toBe("VERIFY_ID");

    const corrected = await send(sessionId, "Correction: my policy is POL-9921 and my DOB is 1985-03-15.");
    expect(corrected.state.phase).toBe("RESOLVE_INTENT");
    expect(corrected.state.verified).toBe(true);
  });

  it("honors explicit email consent choices", async () => {
    const sessionId = await completedSession();

    const result = await consent(sessionId, "approved");
    expect(result.state.emailConsent).toBe("approved");
    expect(result.reply.content).toContain("sent");
  });

  it("answers clear summaries immediately and asks for clarification when ambiguous", async () => {
    const { sessionId } = await createSession();
    await send(sessionId, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
    const summary = await send(sessionId, "What is my case about?");
    expect(summary.state.phase).toBe("POST_PROCESS");
    expect(summary.reply.content).toContain("Healthcare claim denied");
    expect(summary.reply.content).toContain("email summary");

    const other = await createSession();
    await send(other.sessionId, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.");
    const clarification = await send(other.sessionId, "Help me");
    expect(clarification.state.phase).toBe("RESOLVE_INTENT");
    expect(clarification.reply.content).toContain("clarify");
  });

  it("does not send declined or timed-out summaries", async () => {
    const declined = await consent(await completedSession(), "declined");
    expect(declined.state.emailConsent).toBe("declined");
    expect(declined.reply.content).toContain("No summary email");

    const timeoutSession = await completedSession();
    const timeoutResponse = await fetch(`${baseUrl}/api/sessions/${timeoutSession}/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consent: "timeout" }),
    });
    const timeout = await timeoutResponse.json() as { state: { emailConsent: string }; reply: { content: string } };
    expect(timeout.state.emailConsent).toBe("timeout");
    expect(timeout.reply.content).toContain("pending");
  });

  it("escalates repeated out-of-scope requests", async () => {
    const { sessionId } = await createSession();
    await send(sessionId, "What is RL?");
    await send(sessionId, "What is RL?");
    const result = await send(sessionId, "What is RL?");

    expect(result.state.escalationRequired).toBe(true);
    expect(result.state.escalationReason).toBe("repeated_out_of_scope");
  });
});
