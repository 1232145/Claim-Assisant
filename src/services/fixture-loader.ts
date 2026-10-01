import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectoryCandidates = [
  process.env.INSURANCE_CLAIMS_FIXTURE_DIR,
  resolve(process.cwd(), "insurance_claims/fixtures"),
  resolve(moduleDirectory, "../../insurance_claims/fixtures"),
  resolve(moduleDirectory, "../../../insurance_claims/fixtures"),
].filter((directory): directory is string => Boolean(directory));

const defaultFixtureDirectory = fixtureDirectoryCandidates.find((directory) => existsSync(directory)) ?? fixtureDirectoryCandidates[0] ?? "";

if (!defaultFixtureDirectory) {
  throw new Error("Insurance claims fixture directory is not configured");
}

/** Reads and parses a JSON fixture from the configured fixture directory. */
export function loadFixture<T>(fileName: string, fixtureDirectory = defaultFixtureDirectory): T {
  const path = `${fixtureDirectory.replace(/\/$/, "")}/${fileName}`;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Normalizes human-readable text for case- and whitespace-insensitive comparison. */
export function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** Removes all non-numeric characters from a value. */
export function normalizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Normalizes a phone number and removes an optional leading country code. */
export function normalizePhone(value: string): string {
  const digits = normalizeDigits(value);
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}
