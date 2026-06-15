import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type ProviderEmailEntry = {
  name: string;
  email?: string;
  fallback_email?: string;
};

type ProviderEmailMap = Record<string, ProviderEmailEntry>;

const DEFAULT_OUTREACH_EMAIL = process.env.DEFAULT_OUTREACH_EMAIL ?? "outreach@example.com";

const __dirname = dirname(fileURLToPath(import.meta.url));
const providerEmailPath = join(
  __dirname,
  "../static/grid-provider-emails.json",
);

let cachedProviderEmails: ProviderEmailMap | null = null;

function loadProviderEmails(): ProviderEmailMap {
  if (!cachedProviderEmails) {
    cachedProviderEmails = JSON.parse(
      readFileSync(providerEmailPath, "utf-8"),
    ) as ProviderEmailMap;
  }

  return cachedProviderEmails;
}

export function resolveGridOperatorOutreachEmail(
  mastrNummer: string,
): string {
  const entry = loadProviderEmails()[mastrNummer];
  return entry?.email ?? entry?.fallback_email ?? DEFAULT_OUTREACH_EMAIL;
}

export function getDefaultOutreachEmail(): string {
  return DEFAULT_OUTREACH_EMAIL;
}

