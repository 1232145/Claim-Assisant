import type {
  IdentityCandidate,
  PolicyholderRecord,
  PolicyholderService,
} from "../shared/index.js";
import { loadFixture, normalizeDigits, normalizeText } from "./fixture-loader.js";
import { identityCandidateMatches } from "./identity-service.js";

/** Keeps policyholder lookup aligned with the authoritative identity matcher. */
const matchesCandidate = identityCandidateMatches;

export class FixturePolicyholderService implements PolicyholderService {
  private readonly records: PolicyholderRecord[];

  /** Loads policyholder records from the configured fixture directory. */
  constructor(fixtureDirectory?: string) {
    this.records = loadFixture<PolicyholderRecord[]>("policyholders.json", fixtureDirectory);
  }

  /** Looks up a policyholder by party ID, policy number, or ID last four. */
  getPolicyholder(identifier: string): PolicyholderRecord | null {
    const normalized = normalizeText(identifier);
    const digits = normalizeDigits(identifier);
    return this.records.find((record) =>
      [record.party_id, record.policy_number].some((value) => normalizeText(value) === normalized) ||
      normalizeDigits(record.id_last4) === digits,
    ) ?? null;
  }

  /** Finds a policyholder whose every supplied identity candidate matches. */
  findByIdentityCandidates(candidates: IdentityCandidate[]): PolicyholderRecord | null {
    if (candidates.length === 0) return null;
    return this.records.find((record) => candidates.every((candidate) => matchesCandidate(candidate, record))) ?? null;
  }
}

export { matchesCandidate };
