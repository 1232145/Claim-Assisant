const PHASES = ["VERIFY_ID", "RESOLVE_INTENT", "PROCESS_CASE", "POST_PROCESS"];

const elements = {
  messages: document.querySelector("#message-list"),
  input: document.querySelector("#message-input"),
  composer: document.querySelector("#composer"),
  send: document.querySelector("#send-button"),
  restart: document.querySelector("#restart-button"),
  error: document.querySelector("#error-banner"),
  consent: document.querySelector("#consent-panel"),
  phaseRail: document.querySelector("#phase-rail"),
  sessionId: document.querySelector("#session-id"),
  verifiedFields: document.querySelector("#verified-fields"),
  intent: document.querySelector("#intent"),
  consentStatus: document.querySelector("#consent-status"),
  escalation: document.querySelector("#escalation-note"),
};

const state = { sessionId: "", phase: "VERIFY_ID", verified: false, verifiedFields: [], intent: undefined, emailConsent: undefined, escalationRequired: false, messages: [] };

async function ensureResponse(response) {
  if (response.ok) return response;
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
}

const api = {
  async startSession() {
    const response = await fetch("/api/sessions", { method: "POST" });
    await ensureResponse(response);
    return response.json();
  },
  async restartSession() { return this.startSession(); },
  async sendMessage(message) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(state.sessionId)}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
    await ensureResponse(response);
    return response.json();
  },
  async recordConsent(consent) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(state.sessionId)}/consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent }) });
    await ensureResponse(response);
    return response.json();
  },
};

function setBusy(busy) { elements.input.disabled = busy; elements.send.disabled = busy; elements.restart.disabled = busy; }
function showError(message) { elements.error.textContent = message; elements.error.hidden = !message; }
function addMessage(role, content) { state.messages.push({ role, content }); renderMessages(); }
function renderMessages() { elements.messages.innerHTML = state.messages.map((message) => `<div class="message ${message.role}">${message.role === "assistant" ? '<div class="avatar" aria-hidden="true">✓</div>' : ''}<div><div class="message-bubble">${renderMessageContent(message.content)}</div><div class="message-meta">${message.role === "assistant" ? "ClaimCare assistant" : "You"}</div></div></div>`).join(""); elements.messages.scrollTop = elements.messages.scrollHeight; }
function renderState() { elements.sessionId.textContent = state.sessionId; elements.verifiedFields.textContent = String(state.verifiedFields.length); elements.intent.textContent = state.intent ? state.intent.replaceAll("_", " ") : "Not selected"; elements.consentStatus.textContent = state.emailConsent || "Not requested"; elements.escalation.hidden = !state.escalationRequired; elements.phaseRail.innerHTML = PHASES.map((phase, index) => { const current = PHASES.indexOf(state.phase); const status = index < current ? "done" : index === current ? "active" : ""; return `<div class="phase ${status}"><span class="phase-marker"></span><span>${phase.replaceAll("_", " ")}</span></div>`; }).join(""); elements.consent.hidden = !(state.phase === "POST_PROCESS" && !state.emailConsent && state.selectedClaimId); }
function renderMessageContent(value) { return escapeHtml(value).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>"); }
function escapeHtml(value) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
async function startSession(restart = false) { setBusy(true); showError(""); try { const result = restart ? await api.restartSession() : await api.startSession(); Object.assign(state, { phase: "VERIFY_ID", verified: false, verifiedFields: [], intent: undefined, emailConsent: undefined, escalationRequired: false, messages: [] }, result.state); result.messages.forEach((message) => addMessage(message.role, message.content)); renderState(); } catch (error) { showError(error instanceof Error ? error.message : "We couldn’t start the session. Please try again."); } finally { setBusy(false); elements.input.focus(); } }
async function sendMessage(message) { if (!message.trim()) return; addMessage("user", message.trim()); elements.input.value = ""; setBusy(true); showError(""); try { const result = await api.sendMessage(message.trim()); Object.assign(state, result.state); addMessage("assistant", result.reply.content); renderState(); } catch (error) { showError(error instanceof Error ? error.message : "Your message could not be sent. Please try again."); } finally { setBusy(false); elements.input.focus(); } }

elements.composer.addEventListener("submit", (event) => { event.preventDefault(); void sendMessage(elements.input.value); });
elements.input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(elements.input.value); } });
elements.restart.addEventListener("click", () => { void startSession(true); });
document.querySelectorAll("[data-consent]").forEach((button) => button.addEventListener("click", async () => { setBusy(true); try { const result = await api.recordConsent(button.dataset.consent); Object.assign(state, result.state); addMessage("assistant", result.reply.content); renderState(); } catch (error) { showError(error instanceof Error ? error.message : "Your consent choice could not be recorded."); } finally { setBusy(false); } }));
void startSession();
