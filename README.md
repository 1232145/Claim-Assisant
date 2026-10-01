# Insurance Claims SOP Agent

Live demo: [https://claim-assisant.vercel.app/](https://claim-assisant.vercel.app/)

This project is a conversational insurance-claims support demo. The language model handles natural interpretation and phrasing, while the application enforces the business workflow, privacy gates, allowed actions, claim-data grounding, consent, and escalation rules.

## Workflow and requirements

Every conversation follows these phases in order:

1. `VERIFY_ID` — collect and validate at least three accepted identity fields. No claim details are disclosed before verification.
2. `RESOLVE_INTENT` — interpret natural language such as claim status, denial reason, documents, processing time, next steps, or a request to discuss all claims.
3. `PROCESS_CASE` — retrieve only authorized fixture-backed claim data and answer from grounded facts.
4. `POST_PROCESS` — offer an email summary containing the discussion, outcome/status, and follow-up items. The caller can approve or decline it.

The workflow also:

- Remembers useful claim hints mentioned before verification, such as “my denied healthcare claim from January,” without changing the current phase.
- Handles broad conversational messages and multi-claim requests without requiring exact keywords or claim IDs.
- Keeps explicit unrelated topics out of scope, responds politely, and escalates after repeated irrelevant attempts.
- Detects frustration, anger, anxiety, confusion, and refusal; responds with empathy while preserving required SOP gates.
- Offers alternate identity fields and human transfer when verification cannot be completed.
- Prevents the LLM from inventing claim facts or bypassing identity, phase, consent, or escalation controls.

## Demo scenario

The fixture data includes synthetic demo records for Margaret Chen. Try:

```text
My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.
I have a denied healthcare claim from January.
Can you tell me what I have?
Talk about all of them?
Why was my denied healthcare claim denied?
```

The expected behavior is identity verification first, retention of the denied-healthcare-January hint, a grounded overview of all authorized claims, and natural answers based only on the fixture records. Before verification, questions such as “Why was my claim denied?” must receive a verification request rather than protected claim details. Try unrelated questions such as “What is RL?” to verify polite scope handling.

## Run locally

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). The browser UI provides the text-chat demo, workflow phase/debug view, claim interaction, and post-case email-summary choice.

The default local mode is a deterministic mock model, which makes the demo runnable without credentials. To use a compatible chat-completions API, create a local `.env` file based on `.env.example`:

```text
INSURANCE_CLAIMS_LLM_MODE=api
INSURANCE_CLAIMS_API_TOKEN=your-token
INSURANCE_CLAIMS_API_URL=https://openrouter.ai/api/v1/chat/completions
INSURANCE_CLAIMS_MODEL=openai/gpt-4o-mini
```

The API token is server-side only. Never place it in `public/`, commit it, or expose it in browser code.

## Validate

```bash
npm run typecheck
npm run build
npm test
```

The tests cover identity verification, memory across phases, scope and emotion handling, claim grounding, LLM proposal safety, workflow transitions, consent, fixtures, and adversarial conversations.

## Deploy to Vercel

The repository includes `api/index.ts`, `vercel.json`, and the static `public/` UI for Vercel deployment.

1. Import `https://github.com/1232145/Claim-Assisant` into Vercel.
2. Use the repository root as the project root and keep the build command as `npm run build`.
3. Add these server-side environment variables in Vercel Project Settings:

```text
INSURANCE_CLAIMS_LLM_MODE=api
INSURANCE_CLAIMS_API_TOKEN=your-token
INSURANCE_CLAIMS_API_URL=https://openrouter.ai/api/v1/chat/completions
INSURANCE_CLAIMS_MODEL=openai/gpt-4o-mini
```

4. Deploy or redeploy the `main` branch.

The hosted demo is available at [https://claim-assisant.vercel.app/](https://claim-assisant.vercel.app/).
