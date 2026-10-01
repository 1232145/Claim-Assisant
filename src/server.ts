import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import { ClaimProcessingService } from "./services/claim-processing-service.js";
import { FixtureClaimService } from "./services/claim-service.js";
import { FixtureConsentService } from "./services/consent-service.js";
import { FixtureDocumentGuidanceService } from "./services/document-guidance-service.js";
import { FixtureIdentityService } from "./services/identity-service.js";
import { FixturePolicyholderService } from "./services/policyholder-service.js";
import { EnvironmentLlmClient, GroundedResponseAdapter, LlmProposalAdapter } from "./llm/index.js";
import { SopWorkflowEngine, InMemorySessionStore } from "./workflow/state-machine.js";
import type { ClaimIntent, EmailConsent, ResponseSource, SessionState } from "./shared/types.js";

const port = Number(process.env.PORT ?? 4173);
const publicDirectory = resolve(process.cwd(), "public");
const sessions = new InMemorySessionStore();
const answers = new Map<string, { claimId: string; intent: ClaimIntent; text: string }>();
const policyholders = new FixturePolicyholderService();
const claims = new FixtureClaimService();
const claimProcessing = new ClaimProcessingService(
  claims,
  new FixtureDocumentGuidanceService(),
  new FixtureConsentService(),
);
const llmEnvironment = { ...process.env, INSURANCE_CLAIMS_LLM_MODE: process.env.INSURANCE_CLAIMS_LLM_MODE ?? "mock" };
const groundedResponses = new GroundedResponseAdapter(
  new EnvironmentLlmClient(llmEnvironment),
  llmEnvironment.INSURANCE_CLAIMS_LLM_MODE === "mock",
);
const workflow = new SopWorkflowEngine({
  proposals: new LlmProposalAdapter({
    env: llmEnvironment,
  }),
  identity: new FixtureIdentityService(),
  policyholders,
  claimProcessor: claimProcessing,
});

const initialMessage = "Hi, I’m here to help with your insurance claim. To protect your information, please share at least three identity details—such as your full name, date of birth, policy number, phone, email, or ID last four.";

function serveStatic(pathname: string, response: ServerResponse): boolean {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  if (relativePath.includes("..")) return false;
  const filePath = resolve(publicDirectory, relativePath);
  if (!existsSync(filePath)) return false;
  const contentTypes: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  response.writeHead(200, { "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream" });
  response.end(readFileSync(filePath));
  return true;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  response.end(JSON.stringify(body));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sessionResponse(state: SessionState, reply?: string, responseSource?: ResponseSource) {
  return {
    state,
    ...(reply ? { reply: { role: "assistant", content: reply } } : {}),
    ...(responseSource ? { debug: { responseSource } } : {}),
  };
}

export async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const rewrittenPath = url.searchParams.get("_path");
    const pathname = rewrittenPath
      ? `/api${rewrittenPath.startsWith("/") ? rewrittenPath : `/${rewrittenPath}`}`
      : url.pathname;

    if (request.method === "OPTIONS") {
      response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" });
      response.end();
      return;
    }

    if (request.method === "GET" && serveStatic(pathname, response)) return;

    if (request.method === "POST" && pathname === "/api/sessions") {
      const state = sessions.create();
      return json(response, 201, { state, messages: [{ role: "assistant", content: initialMessage }] });
    }

    const messageMatch = /^\/api\/sessions\/([^/]+)\/messages$/.exec(pathname);
    if (request.method === "POST" && messageMatch) {
      const sessionId = messageMatch[1];
      if (!sessionId) return json(response, 400, { error: "Session id is required" });
      const state = sessions.get(sessionId);
      const message = (await body(request)).message;
      if (!state) return json(response, 404, { error: "Session not found" });
      if (typeof message !== "string" || !message.trim()) return json(response, 400, { error: "message is required" });

      const result = await workflow.handleMessage(state, message);
      sessions.save(result.state);
      let reply = result.reply.content;
      let responseSource: ResponseSource | undefined;
      const claimDataWasAccessed = result.events.some((event) => event.type === "claim_data_accessed");
      const overviewNeedsGrounding = result.state.phase === "RESOLVE_INTENT" && result.state.intent === "general_claim_question";
      if ((claimDataWasAccessed || overviewNeedsGrounding) && result.state.partyId && result.state.intent) {
        const request = { partyId: result.state.partyId, intent: result.state.intent, hints: result.state.rememberedHints, message, ...(result.state.selectedClaimId ? { claimId: result.state.selectedClaimId } : {}) };
        const answer = claimProcessing.answer(request);
        if (answer.claimId) answers.set(sessionId, { claimId: answer.claimId, intent: result.state.intent, text: answer.text });
        else answers.delete(sessionId);
        try {
            const phrased = await groundedResponses.generate({
            answer,
            facts: [...(answer.facts ?? []), ...(answer.guidance ? [{ key: "document_guidance", value: answer.guidance.text }] : [])],
            userMessage: message,
            fallbackText: answer.text,
          });
          reply = phrased.text + (answer.ok && answer.claimId ? " Would you like an email summary?" : "");
          responseSource = phrased.source;
        } catch {
          // Provider failures never replace the deterministic, grounded answer.
          reply = answer.text + (answer.ok && answer.claimId ? " Would you like an email summary?" : "");
          responseSource = "deterministic-fallback";
        }
      }
      return json(response, 200, { ...sessionResponse(result.state, reply, responseSource), events: result.events });
    }

    const consentMatch = /^\/api\/sessions\/([^/]+)\/consent$/.exec(pathname);
    if (request.method === "POST" && consentMatch) {
      const sessionId = consentMatch[1];
      if (!sessionId) return json(response, 400, { error: "Session id is required" });
      const state = sessions.get(sessionId);
      const previous = answers.get(sessionId);
      const consent = (await body(request)).consent as EmailConsent;
      if (!state || !previous || !state.partyId) return json(response, 404, { error: "No completed claim interaction found" });
      const policyholder = policyholders.getPolicyholder(state.partyId);
      if (!policyholder) return json(response, 404, { error: "Policyholder not found" });
      const claim = claims.getClaimDetails(previous.claimId);
      if (!claim) return json(response, 404, { error: "Claim not found" });
      const result = claimProcessing.sendSummary({
        claim,
        intent: previous.intent,
        answer: previous.text,
        recipient: policyholder.email,
        consent,
      });
      state.emailConsent = result.consent.status;
      sessions.save(state);
      return json(response, 200, sessionResponse(state, result.consent.sent ? "Your summary email was sent." : result.consent.status === "declined" ? "Understood. No summary email will be sent." : "Your email summary request is still pending."));
    }

    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, 500, { error: error instanceof Error ? error.message : "Internal server error" });
  }
}

// Also expose the request handler as the module default so Vercel can safely
// recognize this shared module if it traces it as a Node server entrypoint.
export default handleRequest;

export function createAppServer() {
  return createServer(handleRequest);
}

export function startServer(portNumber = port, host = "0.0.0.0") {
  const server = createAppServer();
  server.listen(portNumber, host, () => console.log(`Insurance claims API listening on http://${host}:${portNumber}`));
  return server;
}
