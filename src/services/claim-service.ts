import type { ClaimRecord, ClaimService, RememberedHints } from "../shared/index.js";
import { loadFixture, normalizeText } from "./fixture-loader.js";

/** Checks whether a claim date matches a month, year, or exact date reference. */
function monthMatches(date: string, reference: string): boolean {
  const normalized = normalizeText(reference);
  const dateValue = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(dateValue.getTime())) return false;
  const month = dateValue.toLocaleString("en-US", { month: "long", timeZone: "UTC" }).toLocaleLowerCase();
  const year = date.slice(0, 4);
  return normalized.includes(month) || normalized.includes(year) || normalized === date;
}

export class FixtureClaimService implements ClaimService {
  private readonly records: ClaimRecord[];

  /** Loads claim records from the configured fixture directory. */
  constructor(fixtureDirectory?: string) {
    this.records = loadFixture<ClaimRecord[]>("claims.json", fixtureDirectory);
  }

  /** Returns all claims owned by the specified policyholder party. */
  getClaimsForParty(partyId: string): ClaimRecord[] {
    return this.records.filter((claim) => claim.party_id === partyId);
  }

  /** Returns one claim by case ID, or null when it is not present. */
  getClaimDetails(claimId: string): ClaimRecord | null {
    return this.records.find((claim) => claim.case_id === claimId) ?? null;
  }

  /** Finds the first claim matching the caller's remembered selection hints. */
  findRelevantClaim(partyId: string, hints: RememberedHints): ClaimRecord | null {
    const claims = this.getClaimsForParty(partyId);
    const candidates = claims.filter((claim) => {
      const typeMatches = !hints.claimType || normalizeText(claim.case_type) === normalizeText(hints.claimType);
      const statusMatches = !hints.status || normalizeText(claim.status) === normalizeText(hints.status);
      const dateMatches = !hints.dateReference || monthMatches(claim.created_at, hints.dateReference);
      return typeMatches && statusMatches && dateMatches;
    });
    return candidates[0] ?? null;
  }
}

export { monthMatches };
