import { describe, it, expect } from "vitest";

describe("VITE_TNK_ESCROW_ADDRESS env var", () => {
  it("should be set and start with 'trac' if provided", () => {
    const addr = process.env.VITE_TNK_ESCROW_ADDRESS ?? "";
    if (addr) {
      expect(addr.toLowerCase()).toMatch(/^trac/);
    } else {
      // Not set — this is acceptable; UI will fall back to empty string
      console.warn("VITE_TNK_ESCROW_ADDRESS is not set — will fall back to empty string in UI");
    }
  });
});
