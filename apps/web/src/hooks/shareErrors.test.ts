import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import { asDuplicateVehicle, asOwnDuplicate } from "@/hooks/useVehicleShares";

/**
 * The two 409s that mean completely different things.
 *
 * Getting this discrimination wrong is not cosmetic: mistaking a stranger's
 * vehicle for your own would navigate the user into a record they cannot open,
 * and mistaking your own for a stranger's would send you knocking on your own
 * door with a request nobody can approve.
 */
const dup = (body: unknown) => new ApiError(409, "conflict", body);

describe("asDuplicateVehicle", () => {
  it("recognises the stranger's-vehicle 409 and carries the token", () => {
    const e = dup({ error: "vehicle_already_registered", matchedOn: "chassis", claimToken: "tok" });
    expect(asDuplicateVehicle(e)).toEqual({
      error: "vehicle_already_registered",
      matchedOn: "chassis",
      claimToken: "tok",
    });
  });

  it("distinguishes a chassis match from an engine match", () => {
    // The copy differs: a chassis match is proof, an engine match is evidence,
    // because engines get swapped.
    const e = dup({ error: "vehicle_already_registered", matchedOn: "engine", claimToken: "tok" });
    expect(asDuplicateVehicle(e)?.matchedOn).toBe("engine");
  });

  it("refuses a 409 with no token — there would be nothing to knock with", () => {
    expect(asDuplicateVehicle(dup({ error: "vehicle_already_registered" }))).toBeNull();
  });

  it("ignores every other error", () => {
    expect(asDuplicateVehicle(dup({ error: "vehicle_already_in_garage", bikeId: "b1" }))).toBeNull();
    expect(asDuplicateVehicle(new ApiError(403, "x", { error: "vehicle_limit_reached" }))).toBeNull();
    expect(asDuplicateVehicle(new Error("boom"))).toBeNull();
    expect(asDuplicateVehicle(undefined)).toBeNull();
  });
});

describe("asOwnDuplicate", () => {
  it("recognises the it-is-already-yours 409 and names the record", () => {
    expect(asOwnDuplicate(dup({ error: "vehicle_already_in_garage", bikeId: "b1" }))).toEqual({
      bikeId: "b1",
    });
  });

  it("never confuses itself with a stranger's vehicle", () => {
    const stranger = dup({
      error: "vehicle_already_registered",
      matchedOn: "chassis",
      claimToken: "tok",
    });
    expect(asOwnDuplicate(stranger)).toBeNull();
  });

  it("refuses a body with no vehicle to navigate to", () => {
    expect(asOwnDuplicate(dup({ error: "vehicle_already_in_garage" }))).toBeNull();
  });
});
