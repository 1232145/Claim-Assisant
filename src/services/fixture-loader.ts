import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const defaultFixtureDirectory = resolve(process.cwd(), "insurance_claims/fixtures");

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
