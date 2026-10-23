import { describe, expect, it } from "vitest";
import { mapsHref, smsHref, telHref, whatsappNumber } from "./contact";

describe("contact links", () => {
  it("normalises Turkish numbers for WhatsApp", () => {
    expect(whatsappNumber("0532 123 45 67")).toBe("905321234567");
    expect(whatsappNumber("5321234567")).toBe("905321234567");
    expect(whatsappNumber("+90 (532) 123-4567")).toBe("905321234567");
    expect(whatsappNumber("0090 532 123 45 67")).toBe("905321234567");
    expect(whatsappNumber("444 0 123")).toBeNull();
  });

  it("strips formatting for tel:", () => {
    expect(telHref("+90 (212) 555-00 00")).toBe("tel:+902125550000");
  });

  it("builds map and sms links", () => {
    expect(mapsHref({ lat: 41, lng: 29, directions: true })).toBe("https://maps.apple.com/?daddr=41%2C29");
    expect(mapsHref({ query: "Oto Servis" })).toBe("https://maps.apple.com/?q=Oto+Servis");
    expect(smsHref(["0532 111", "+90 555"], "a b")).toBe("sms:0532111,+90555&body=a%20b");
  });
});
