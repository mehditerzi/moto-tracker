import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isOnboarded, markOnboarded, clearOnboarded } from "./onboarding";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

describe("onboarding flag", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("defaults to not onboarded", () => {
    expect(isOnboarded()).toBe(false);
  });

  it("markOnboarded persists the flag", () => {
    markOnboarded();
    expect(isOnboarded()).toBe(true);
  });

  it("clearOnboarded resets the flag", () => {
    markOnboarded();
    clearOnboarded();
    expect(isOnboarded()).toBe(false);
  });

  it("never throws when storage is unavailable", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(() => markOnboarded()).not.toThrow();
    expect(isOnboarded()).toBe(false);
  });
});
