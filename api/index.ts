import type { IncomingMessage, ServerResponse } from "node:http";

/** Vercel serverless entrypoint for the shared HTTP request handler. */
export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const { handleRequest } = await import("../src/server.js");
    await handleRequest(request, response);
  } catch (error) {
    console.error("Insurance claims function failed to initialize", error);
    response.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
    response.end(JSON.stringify({ error: "Insurance claims service failed to initialize" }));
  }
}
