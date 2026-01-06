export function normalizePhone(raw: string): string | null {
  if (!raw) return null;

  // Remove everything except digits and +
  let cleaned = raw.replace(/[^\d+]/g, "");

  // Already E.164
  if (cleaned.startsWith("+")) return cleaned;

  // North America assumption
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }

  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return `+${cleaned}`;
  }

  // Fallback (let Twilio reject if invalid)
  return `+${cleaned}`;
}
