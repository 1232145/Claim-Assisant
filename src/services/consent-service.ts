import type { ConsentResult, ConsentService, EmailConsent } from "../shared/index.js";
import { loadFixture } from "./fixture-loader.js";

interface ConsentFixture {
  [scenario: string]: { status_sequence: EmailConsent[] };
}

export class FixtureConsentService implements ConsentService {
  private readonly scenarios: ConsentFixture;
  private readonly positions = new Map<string, number>();

  /** Loads deterministic email-consent status sequences from fixtures. */
  constructor(fixtureDirectory?: string) {
    this.scenarios = loadFixture<ConsentFixture>("consent_scenarios.json", fixtureDirectory);
  }

  /** Returns a copy of the configured status sequence for a consent scenario. */
  getScenarioStatuses(scenario = "default"): EmailConsent[] {
    return [...(this.scenarios[scenario]?.status_sequence ?? this.scenarios.default?.status_sequence ?? ["pending"])] as EmailConsent[];
  }

  /** Advances a scenario and reports whether the current status permits sending. */
  sendSummaryEmail(summary: string, recipient: string, scenario = "default"): ConsentResult {
    void summary;
    void recipient;
    const statuses = this.getScenarioStatuses(scenario);
    const position = this.positions.get(scenario) ?? 0;
    const status = statuses[Math.min(position, statuses.length - 1)] ?? "pending";
    this.positions.set(scenario, position + 1);
    return { status, sent: status === "approved" };
  }
}
