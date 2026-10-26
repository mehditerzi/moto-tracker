import { describe, expect, it } from "vitest";
import { inferBodyStyle, vehicleArtFor } from "./vehicleArt";

describe("inferBodyStyle", () => {
  const moto = (make: string, model: string, cylinderCc?: number) => inferBodyStyle({ vehicleType: "motorcycle", make, model, cylinderCc });
  const car = (make: string, model: string) => inferBodyStyle({ vehicleType: "car", make, model });

  it("reads motorcycles", () => {
    expect(moto("Honda", "PCX125")).toBe("scooter");
    expect(moto("Yamaha", "NMAX 155")).toBe("scooter");
    expect(moto("Yamaha", "MT-09")).toBe("naked");
    expect(moto("Yamaha", "YZF-R1")).toBe("sport");
    expect(moto("Kawasaki", "Ninja ZX-6R")).toBe("sport");
    expect(moto("BMW", "R 1250 GS")).toBe("adventure");
    expect(moto("Honda", "Africa Twin")).toBe("adventure");
    expect(moto("Harley-Davidson", "Fat Boy")).toBe("cruiser");
    expect(moto("Honda", "CMX500 Rebel")).toBe("cruiser");
    expect(moto("Ducati", "Monster")).toBe("naked");
    expect(moto("Bilinmeyen", "XYZ", 125)).toBe("scooter");
  });

  it("reads cars", () => {
    expect(car("Fiat", "Egea")).toBe("sedan");
    expect(car("Fiat", "Egea Cross")).toBe("suv");
    expect(car("Fiat", "Doblo")).toBe("van");
    expect(car("Renault", "Clio")).toBe("hatchback");
    expect(car("Volkswagen", "Tiguan")).toBe("suv");
    expect(car("Toyota", "Hilux")).toBe("pickup");
    expect(car("Porsche", "911")).toBe("coupe");
    expect(car("Togg", "T10X")).toBe("suv");
    expect(car("Toyota", "Corolla")).toBe("sedan");
  });

  it("draws a complete SVG in the vehicle's colour", () => {
    const { svg } = vehicleArtFor({ vehicleType: "car", make: "Fiat", model: "Egea", color: "Kırmızı" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("#BE3B2E");
    expect(svg).not.toContain("url(#0-");
  });
});
