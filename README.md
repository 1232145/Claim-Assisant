# Insurance Claims SOP Agent

A small insurance-claims support demo with a deterministic workflow, fixture-backed claim answers, and an optional LLM interpretation layer.

## Run locally

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

Open [http://localhost:4173](http://localhost:4173).

The local demo uses the deterministic mock LLM by default. To use a compatible chat-completions API, put these variables in a local `.env` file (or export them before starting):

```bash
export INSURANCE_CLAIMS_LLM_MODE=api
export INSURANCE_CLAIMS_API_TOKEN=your-token
export INSURANCE_CLAIMS_MODEL=gpt-4o-mini
```

`INSURANCE_CLAIMS_API_URL` may override the default API endpoint.

For OpenRouter, set `INSURANCE_CLAIMS_API_URL=https://openrouter.ai/api/v1/chat/completions`. The server loads `.env` automatically when started with `npm run dev` or `npm start`; keep that file local and do not commit the token.

## Validate

```bash
npm test
npm run typecheck
npm run build
```

The API and static UI are served together by `npm run dev`. The workflow keeps claim details behind identity verification and obtains claim facts only from the fixture services.
