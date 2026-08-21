import { describe, it, expect } from "vitest";
import {
  getStoreInitials,
  getStoreColor,
  STORE_AVATAR_PALETTE,
} from "~/lib/storeAvatar.js";

describe("StoreAvatar — getStoreInitials", () => {
  it("extracts 3-letter initials for 3-word store names", () => {
    expect(getStoreInitials("Sense Theme Store", "sense-theme-store-wk9lnd86.myshopify.com")).toBe("STS");
    expect(getStoreInitials("Craft Theme Store", "craft-theme-store.myshopify.com")).toBe("CTS");
    expect(getStoreInitials("Horizon Theme Store", "horizon-theme-store-k27ioqsc.myshopify.com")).toBe("HTS");
  });

  it("extracts 2-letter initials for 2-word store names", () => {
    expect(
      getStoreInitials(
        "Test Store",
        "test-store-1100000000000000000000000000002187.myshopify.com",
      ),
    ).toBe("TS");
  });

  it("handles complex store names with suffixes and delimiters", () => {
    expect(
      getStoreInitials(
        "Test Store 1 -Saleswitch Dev Testing-",
        "test-store-1-saleswitch-dev-testing.myshopify.com",
      ),
    ).toBe("TS");
  });

  it("falls back to parsing myshopify domain when name is absent or matches domain", () => {
    expect(getStoreInitials(null, "craft-theme-store.myshopify.com")).toBe("CTS");
    expect(getStoreInitials("", "sense-theme-store-wk9lnd86.myshopify.com")).toBe("STS");
    expect(getStoreInitials(undefined, "horizon-theme-store-k27ioqsc.myshopify.com")).toBe("HTS");
    expect(
      getStoreInitials(
        "test-store-1100000000000000000000000000002187.myshopify.com",
        "test-store-1100000000000000000000000000002187.myshopify.com",
      ),
    ).toBe("TS");
  });

  it("handles single-word store names", () => {
    expect(getStoreInitials("Badgy", "badgy.myshopify.com")).toBe("BA");
    expect(getStoreInitials("A", "a.myshopify.com")).toBe("A");
  });

  it("falls back gracefully when input is empty or null", () => {
    expect(getStoreInitials(null, null)).toBe("ST");
    expect(getStoreInitials("", "")).toBe("ST");
  });
});

describe("StoreAvatar — getStoreColor", () => {
  it("returns deterministic color for the same store", () => {
    const color1 = getStoreColor("craft-theme-store.myshopify.com");
    const color2 = getStoreColor("craft-theme-store.myshopify.com");
    expect(color1).toEqual(color2);
    expect(color1.text).toBe("#ffffff");
  });

  it("returns a valid palette color for any store name", () => {
    for (const shop of [
      "sense-theme-store-wk9lnd86.myshopify.com",
      "craft-theme-store.myshopify.com",
      "horizon-theme-store-k27ioqsc.myshopify.com",
      "test-store-1100000000000000000000000000002187.myshopify.com",
      "test-store-1-saleswitch-dev-testing.myshopify.com",
    ]) {
      const color = getStoreColor(shop);
      expect(STORE_AVATAR_PALETTE).toContainEqual(color);
    }
  });
});
