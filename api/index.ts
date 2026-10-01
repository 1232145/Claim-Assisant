import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRequest } from "../src/server.js";

/** Vercel serverless entrypoint for the shared HTTP request handler. */
export default function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  return handleRequest(request, response);
}
