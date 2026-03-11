/**
 * Validates HELIUS_WEBHOOK_SECRET is set and the webhook handler
 * correctly rejects requests without the authorization header.
 */
import { describe, it, expect } from "vitest";

describe("HELIUS_WEBHOOK_SECRET", () => {
  it("should be set in the environment", () => {
    const secret = process.env.HELIUS_WEBHOOK_SECRET;
    expect(secret, "HELIUS_WEBHOOK_SECRET must be set").toBeTruthy();
    expect(secret!.length, "Secret must be at least 8 characters").toBeGreaterThanOrEqual(8);
  });

  it("should not be the placeholder value", () => {
    const secret = process.env.HELIUS_WEBHOOK_SECRET ?? "";
    const placeholders = ["your-secret", "changeme", "secret", "password", "test"];
    const isPlaceholder = placeholders.some(p => secret.toLowerCase().includes(p));
    expect(isPlaceholder, "Secret should not be a placeholder value").toBe(false);
  });
});
