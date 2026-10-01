import type {
  IdentityCandidate,
  IdentityService,
  IdentityVerificationResult,
  PolicyholderRecord,
} from "../shared/index.js";
import { normalizeDigits, normalizePhone, normalizeText } from "./fixture-loader.js";

const identityFields: IdentityCandidate["field"][] = [
  "full_name",
  "date_of_birth",
  "phone_number",
  "email_address",
  "policy_number",
  "id_last4",
];

/** Normalizes supported date formats into YYYY-MM-DD when possible. */
function normalizeDate(value: string): string {
  const trimmed = normalizeText(value).replace(/[/.]/g, "-");
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  const [, year, month, day] = match ?? [];
  if (year && month && day) return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const numeric = /^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/.exec(trimmed);
  if (numeric) {
    const [, numericMonth, numericDay, numericYear] = numeric;
    if (numericMonth && numericDay && numericYear) {
      const fullYear = numericYear.length === 2 ? (Number(numericYear) >= 30 ? `19${numericYear}` : `20${numericYear}`) : numericYear;
      return `${fullYear}-${numericMonth.padStart(2, "0")}-${numericDay.padStart(2, "0")}`;
    }
  }
  const written = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(trimmed);
  if (!written) return trimmed;
  const [, monthName, writtenDay, writtenYear] = written;
  if (!monthName || !writtenDay || !writtenYear) return trimmed;
  const monthNumber = new Date(`${monthName} 1, 2000`).getMonth() + 1;
  return `${writtenYear}-${String(monthNumber).padStart(2, "0")}-${writtenDay.padStart(2, "0")}`;
}

/** Normalizes one identity value into a comparison-safe representation. */
export function normalizeIdentityValue(field: IdentityCandidate["field"], value: string): string {
  switch (field) {
    case "phone_number": return normalizePhone(value);
    case "id_last4": return normalizeDigits(value).slice(-4);
    case "date_of_birth": return normalizeDate(value);
    case "policy_number": return normalizeText(value).replace(/[\s-]/g, "");
    default: return normalizeText(value);
  }
}

/** Adds one non-empty identity candidate without duplicating its field. */
function addCandidate(candidates: IdentityCandidate[], field: IdentityCandidate["field"], value?: string): void {
  if (!value?.trim() || candidates.some((candidate) => candidate.field === field)) return;
  candidates.push({ field, value: value.trim().replace(/[.,;]+$/, "") });
}

/** Extracts all plausible names so a later full name beats an earlier first-name fragment. */
function extractBestName(message: string): string | undefined {
  const boundary = /(?=\s*(?:[,.;]|$)|\s+(?:this\s+is|you\s+can\s+call\s+me|i\s+was\s+born|my\s+birthday|the\s+policy|policy|date\s+of\s+birth|dob|phone|email|ssn|born|and\s+(?:my\s+)?policy)\b)/i;
  const patterns = [
    { expression: new RegExp(`\\b(?:my\\s+name\\s+is|name\\s+is|i\\s+am|i['’]m|call\\s+me)\\s+([A-Za-z]+(?:\\s+[A-Za-z][A-Za-z'-]*){0,2}?)${boundary.source}`, "gi"), priority: 2 },
    { expression: new RegExp(`\\bthis\\s+is\\s+([A-Za-z]+(?:\\s+[A-Za-z][A-Za-z'-]*){0,2}?)${boundary.source}`, "gi"), priority: 1 },
    { expression: new RegExp(`(?:^|\\s)['’]m\\s+([A-Za-z]+(?:\\s+[A-Za-z][A-Za-z'-]*){0,2}?)${boundary.source}`, "gi"), priority: 2 },
  ];
  const matches: Array<{ value: string; score: number }> = [];
  for (const { expression, priority } of patterns) {
    for (const match of message.matchAll(expression)) {
      const value = match[1]?.trim();
      if (value) matches.push({ value, score: priority * 10 + value.split(/\s+/).length });
    }
  }
  return matches.sort((left, right) => right.score - left.score)[0]?.value;
}

/**
 * Extracts explicitly labeled identity answers from natural language. It may
 * return partial candidates; the verification service decides whether they
 * are sufficient and matching.
 */
export function extractIdentityCandidates(message: string): IdentityCandidate[] {
  const candidates: IdentityCandidate[] = [];
  addCandidate(candidates, "email_address", message.match(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i)?.[0]);
  addCandidate(candidates, "policy_number", message.match(/\b(?:policy(?:\s+number)?|policy\s*#)\s*(?:is|:)?\s*([A-Z]{2,5}[-\s]?\d{3,})\b/i)?.[1]);
  addCandidate(candidates, "date_of_birth", message.match(/\b(?:date\s+of\s+birth|dob|born|birthday)\s*(?:is|:|on)?\s*((?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2})|(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4})|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\b/i)?.[1]);
  addCandidate(candidates, "phone_number", message.match(/\b(?:phone|phone\s+number|telephone|mobile)\s*(?:is|:)?\s*((?:\+?\d|\(\d)[\d\s().-]{7,}\d)/i)?.[1]);
  addCandidate(candidates, "id_last4", message.match(/\b(?:ssn|social\s+security|national\s*id|id)\s*(?:last\s*four|last\s*4|#)?\s*(?:is|:)?\s*(\d{4})\b/i)?.[1]);
  addCandidate(candidates, "full_name", extractBestName(message));
  return candidates;
}

/**
 * Detects a caller who declines or refuses to provide verification details.
 * This is a signal for the workflow/emotion layer; it must not itself escalate
 * or change the session phase.
 */
export function isIdentityRefusal(message: string): boolean {
  return /\b(?:refuse|refused|won't|will not|can't|cannot|do not want|don't want|rather not)\b.*\b(?:verify|identity|information|details|provide|give)\b/i.test(message)
    || /\b(?:no|never)\b.*\b(?:information|details)\b/i.test(message);
}

/** Returns the policyholder values accepted for a particular identity field. */
function acceptedValues(field: IdentityCandidate["field"], policyholder: PolicyholderRecord): string[] {
  switch (field) {
    case "full_name": return [policyholder.name, ...(policyholder.name_aliases ?? [])];
    case "date_of_birth": return [policyholder.dob];
    case "phone_number": return [policyholder.phone, ...(policyholder.phone_aliases ?? [])];
    case "email_address": return [policyholder.email, ...(policyholder.email_aliases ?? [])];
    case "policy_number": return [policyholder.policy_number];
    case "id_last4": return [policyholder.id_last4];
  }
}

/** Compares one candidate with the policyholder, including configured aliases. */
export function identityCandidateMatches(candidate: IdentityCandidate, policyholder: PolicyholderRecord): boolean {
  const expected = acceptedValues(candidate.field, policyholder)
    .map((value) => normalizeIdentityValue(candidate.field, value));
  const actual = normalizeIdentityValue(candidate.field, candidate.value);
  return expected.includes(actual) || (candidate.field === "full_name" && expected.some((value) => fuzzyNameMatches(actual, value)));
}

/** Allows only small name typos while requiring every name token to remain present. */
function fuzzyNameMatches(actual: string, expected: string): boolean {
  const actualTokens = actual.split(/\s+/);
  const expectedTokens = expected.split(/\s+/);
  if (actualTokens.length !== expectedTokens.length) return false;
  return actualTokens.every((token, index) => {
    const expectedToken = expectedTokens[index] ?? "";
    const limit = expectedToken.length >= 6 ? 2 : expectedToken.length >= 4 ? 1 : 0;
    return editDistance(token, expectedToken) <= limit;
  });
}

/** Computes a small Levenshtein distance for conservative typo handling. */
function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column] ?? 0;
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      previous[column] = Math.min((previous[column - 1] ?? 0) + 1, above + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return previous[right.length] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Deterministically verifies supplied identity candidates against one
 * policyholder. Verification succeeds only when at least three distinct fields
 * match, including any aliases present in fixture data.
 */
export class FixtureIdentityService implements IdentityService {
  /** Compares candidates with a policyholder and requires three matches. */
  verifyIdentity(candidates: IdentityCandidate[], policyholder?: PolicyholderRecord): IdentityVerificationResult {
    const byField = new Map(candidates.map((candidate) => [candidate.field, candidate]));
    const matchedFields = identityFields.filter((field) => {
      const candidate = byField.get(field);
      return Boolean(candidate && policyholder && identityCandidateMatches(candidate, policyholder));
    });
    const mismatchedFields = identityFields.filter((field) => {
      const candidate = byField.get(field);
      return Boolean(candidate && (!policyholder || !identityCandidateMatches(candidate, policyholder)));
    });
    const missingFields = identityFields.filter((field) => !byField.has(field));
    return {
      verified: matchedFields.length >= 3,
      matchedFields,
      mismatchedFields,
      missingFields,
      attempts: 1,
    };
  }
}

export { identityFields };
