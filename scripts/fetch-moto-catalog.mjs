#!/usr/bin/env node
/**
 * Build the bundled vehicle (motorcycle + car) make/model catalog.
 *
 *   node scripts/fetch-moto-catalog.mjs                  # vPIC makes + TR overlay (fast)
 *   API_NINJAS_KEY=… node scripts/fetch-moto-catalog.mjs # + API-Ninjas models per overlay make
 *   … --vpic-models                                      # also harvest vPIC models (slow)
 *
 * Output: apps/api/src/db/seed/vehicleCatalog.generated.ts
 *
 * Sources, merged (overlay wins on canonical naming):
 *   • NHTSA vPIC (free, no key)                  — make breadth (motorcycle + car)
 *   • curated Turkish-market overlay             — brands + popular models + aliases
 *   • API-Ninjas /v1/motorcycles|cars?make=…     — up to 30 real model names per make
 *     (free tier: 30 rows, no offset — so big brands rely on the overlay)
 *
 * Makes are merged by normalized name across types (Honda is one make carrying
 * both motorcycle and car models). Models are tagged with their vehicle type.
 *
 * The generated file is a plain TS module so `tsc` compiles it straight into
 * dist — no Docker copy step, no runtime fetch, works offline.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles";
const NINJAS = "https://api.api-ninjas.com/v1";
const NINJAS_KEY = process.env.API_NINJAS_KEY || "";
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../apps/api/src/db/seed/vehicleCatalog.generated.ts",
);
const VPIC_MODELS = process.argv.includes("--vpic-models");

/** Turkish-aware normalization. MUST stay byte-identical to norm() in catalog.ts. */
function norm(s) {
  if (!s) return "";
  return String(s)
    .replace(/İ/g, "I").replace(/ı/g, "I")
    .replace(/Ş/g, "S").replace(/ş/g, "S")
    .replace(/Ğ/g, "G").replace(/ğ/g, "G")
    .replace(/Ü/g, "U").replace(/ü/g, "U")
    .replace(/Ö/g, "O").replace(/ö/g, "O")
    .replace(/Ç/g, "C").replace(/ç/g, "C")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

// ── Curated Turkish-market + global overlays ──────────────────────────────────
// `aliases` are alternate spellings OCR/users produce; they resolve to the make.
// `models` are popular commercial names (D.3 on the ruhsat).
const MOTO_OVERLAY = [
  { name: "Honda", aliases: ["HONDA MOTOR"], models: ["CB125F", "CB125R", "CB150R", "CB250R", "CB300R", "CB500F", "CB500X", "CB650R", "CBR250R", "CBR500R", "CBR650R", "CBF150", "PCX125", "PCX150", "SH150i", "Forza 125", "Forza 250", "Forza 750", "ADV150", "ADV350", "NC750X", "CRF250L", "CRF300L", "Africa Twin", "CB650F", "Activa", "Dio", "Spacy", "Wave", "Innova", "Super Cub" ] },
  { name: "Yamaha", aliases: ["YAMAHA MOTOR"], models: ["YBR125", "YS125", "MT-03", "MT-07", "MT-09", "MT-10", "MT-15", "MT-25", "YZF-R1", "YZF-R3", "YZF-R6", "YZF-R7", "YZF-R125", "YZF-R25", "XSR125", "XSR700", "XSR900", "Tracer 7", "Tracer 9", "Tenere 700", "NMAX 125", "NMAX 155", "XMAX 125", "XMAX 250", "XMAX 300", "TMAX", "Aerox 155", "Crypton", "Fazer", "FZ", "Delight", "Ray ZR" ] },
  { name: "Suzuki", aliases: [], models: ["GSX-R125", "GSX-R600", "GSX-R750", "GSX-R1000", "GSX-S125", "GSX-S750", "GSX-S1000", "GSX-8S", "GSX-8R", "V-Strom 250", "V-Strom 650", "V-Strom 800", "V-Strom 1050", "Burgman 125", "Burgman 200", "Burgman 400", "Address", "Hayabusa", "SV650", "Gixxer", "Intruder", "Access" ] },
  { name: "Kawasaki", aliases: [], models: ["Ninja 125", "Ninja 250", "Ninja 300", "Ninja 400", "Ninja 650", "Ninja 1000", "Ninja H2", "Ninja ZX-6R", "Ninja ZX-10R", "Z125", "Z250", "Z400", "Z650", "Z900", "Z1000", "Z H2", "Versys 300", "Versys 650", "Versys 1000", "Vulcan S", "W175", "W800", "Eliminator" ] },
  { name: "BMW", aliases: ["BMW MOTORRAD"], models: ["G310R", "G310GS", "F750GS", "F850GS", "F900R", "F900XR", "R1250GS", "R1300GS", "R1250RT", "R nineT", "S1000RR", "S1000R", "S1000XR", "C400X", "C400GT", "CE 04", "K1600GT", "M1000RR" ] },
  { name: "KTM", aliases: [], models: ["125 Duke", "200 Duke", "250 Duke", "390 Duke", "790 Duke", "890 Duke", "1290 Super Duke", "RC125", "RC200", "RC390", "250 Adventure", "390 Adventure", "890 Adventure", "1290 Super Adventure", "300 EXC", "350 EXC-F", "450 SX-F" ] },
  { name: "Ducati", aliases: [], models: ["Monster", "Panigale V2", "Panigale V4", "Streetfighter V2", "Streetfighter V4", "Multistrada V2", "Multistrada V4", "Diavel", "Scrambler", "Hypermotard", "SuperSport", "DesertX" ] },
  { name: "Triumph", aliases: [], models: ["Street Triple", "Speed Triple", "Trident 660", "Tiger 660", "Tiger 850", "Tiger 900", "Tiger 1200", "Bonneville", "Street Twin", "Speed Twin", "Scrambler 400", "Speed 400", "Rocket 3", "Daytona 660" ] },
  { name: "Harley-Davidson", aliases: ["HARLEY", "HARLEY DAVIDSON"], models: ["Iron 883", "Forty-Eight", "Street Bob", "Fat Bob", "Fat Boy", "Heritage", "Road King", "Street Glide", "Road Glide", "Sportster S", "Nightster", "Pan America" ] },
  { name: "Vespa", aliases: [], models: ["Primavera 125", "Primavera 150", "Sprint 125", "Sprint 150", "GTS 125", "GTS 300", "GTV 300", "LX 125", "Elettrica", "946" ] },
  { name: "Piaggio", aliases: [], models: ["Liberty 125", "Liberty 150", "Medley 125", "Medley 150", "Beverly 300", "Beverly 400", "MP3", "Zip", "Fly" ] },
  { name: "Aprilia", aliases: [], models: ["RS 125", "RS 457", "RS 660", "RSV4", "Tuono 125", "Tuono 660", "Tuono V4", "SR GT", "SX 125", "RX 125", "Tuareg 660" ] },
  { name: "Benelli", aliases: [], models: ["TNT 125", "TNT 25", "TNT 600", "Leoncino 250", "Leoncino 500", "Leoncino 800", "TRK 251", "TRK 502", "TRK 702", "302S", "502C", "Imperiale 400" ] },
  { name: "CFMoto", aliases: ["CF MOTO"], models: ["150NK", "250NK", "300NK", "400NK", "650NK", "300SR", "450SR", "650MT", "700MT", "800MT", "700CL-X", "450MT", "Papio" ] },
  { name: "Zontes", aliases: [], models: ["125 G1", "125 U", "310R", "310T", "310V", "310X", "350R", "350T", "350X", "350GK", "703F" ] },
  { name: "Voge", aliases: [], models: ["300R", "300AC", "500R", "500DS", "525DSX", "525ACX", "650DS", "900DS", "SR4" ] },
  { name: "QJ Motor", aliases: ["QJMOTOR", "QJ"], models: ["SRK 250", "SRK 400", "SRK 600", "SRK 700", "SRV 550", "SRT 550", "SRT 750", "SVT 650" ] },
  { name: "Keeway", aliases: [], models: ["RKF 125", "RKF 150", "RKV 200", "Vieste 125", "Vieste 300", "Superlight 125", "K-Light 202", "Cityblade" ] },
  { name: "Royal Enfield", aliases: ["ROYALENFIELD", "ENFIELD"], models: ["Classic 350", "Hunter 350", "Meteor 350", "Bullet 350", "Himalayan", "Interceptor 650", "Continental GT 650", "Scram 411", "Super Meteor 650" ] },
  { name: "Bajaj", aliases: [], models: ["Pulsar 125", "Pulsar 150", "Pulsar 180", "Pulsar 200", "Pulsar NS200", "Pulsar RS200", "Pulsar N250", "Dominar 250", "Dominar 400", "Avenger", "Boxer", "CT100" ] },
  { name: "TVS", aliases: [], models: ["Apache RTR 160", "Apache RTR 180", "Apache RTR 200", "Apache RR 310", "Raider 125", "Ntorq 125", "Jupiter", "Star City", "Sport", "Ronin" ] },
  { name: "Hero", aliases: ["HERO MOTOCORP", "HERO HONDA"], models: ["Splendor", "Passion", "Glamour", "Xtreme 125R", "Xtreme 160R", "Xpulse 200", "Karizma XMR", "Destini", "Maestro" ] },
  { name: "SYM", aliases: [], models: ["Jet 14", "Jet X", "Symphony", "Fiddle", "Cruisym 150", "Cruisym 300", "Joymax 300", "Maxsym 400", "NH-T 125", "ADXTG" ] },
  { name: "Kymco", aliases: [], models: ["Agility 125", "Agility 150", "Like 125", "Like 150", "People S", "Downtown 350", "AK 550", "X-Town 300", "Super 8" ] },
  { name: "Mondial", aliases: [], models: ["150 Drift", "200 Drift", "250 GD", "Tarmac 125", "Tarmac 250", "SMX 125", "X-Treme 125", "HPS 125", "HPS 300", "Flat Track 125", "P'mela 50" ] },
  { name: "Kuba", aliases: [], models: ["GY6", "Master", "Falcon", "CG 125", "Comfort", "Pesaro", "Maxon" ] },
  { name: "RKS", aliases: [], models: ["Titanic", "Maxtra", "Smart", "Caprice", "Skyline", "Defient", "Bitturbo", "Mariposa" ] },
  { name: "Arora", aliases: [], models: ["AR 50", "AR 100", "AR 125", "Cappadocia", "Tiger", "Ranger", "Storm" ] },
  { name: "Kanuni", aliases: [], models: ["Mondial 125", "Sınırsız 125", "Pony", "Sport", "Cruiser" ] },
  { name: "Ramzey", aliases: [], models: ["RM 50", "RM 100", "RM 125", "Cross", "Atv" ] },
  { name: "Falcon", aliases: [], models: ["Serenade", "Smartmax", "Crossmax", "Speedmax", "Cruise" ] },
  { name: "Yuki", aliases: [], models: ["YK 50", "YK 100", "YK 125", "Reggae", "Power", "Style" ] },
  { name: "Bisan", aliases: [], models: ["Spider", "Cobra", "Eko", "Star" ] },
  { name: "Mondial", aliases: [], models: [] },
  { name: "Daelim", aliases: [], models: ["Daystar", "Roadwin", "S-Five", "Besbi", "History" ] },
  { name: "Husqvarna", aliases: [], models: ["Svartpilen 125", "Svartpilen 250", "Svartpilen 401", "Vitpilen 401", "Norden 901", "FE 350", "TE 300", "701 Enduro" ] },
  { name: "Moto Guzzi", aliases: ["MOTOGUZZI"], models: ["V7", "V9", "V85 TT", "V100 Mandello", "Stelvio" ] },
  { name: "MV Agusta", aliases: ["MVAGUSTA"], models: ["Brutale 800", "Dragster 800", "F3", "Turismo Veloce", "Superveloce", "Rush" ] },
  { name: "Indian", aliases: ["INDIAN MOTORCYCLE"], models: ["Scout", "Chief", "FTR", "Chieftain", "Roadmaster", "Springfield" ] },
  { name: "Zero", aliases: ["ZERO MOTORCYCLES"], models: ["S", "SR", "DS", "DSR", "FX", "SR/F", "SR/S" ] },
  { name: "Volta", aliases: [], models: ["VS1", "VSX", "VM4", "RX", "EV1" ] },
  { name: "Lifan", aliases: [], models: ["KP150", "KP200", "KPR 200", "KPT", "SS3" ] },
  { name: "Loncin", aliases: [], models: ["GP150", "Voge", "CR1", "CR9" ] },
  { name: "Zongshen", aliases: [], models: ["RX1", "RX3", "RX4", "Cyclone" ] },
  { name: "Jincheng", aliases: [], models: ["JC 125", "Knight", "Hummer" ] },
  { name: "Regal Raptor", aliases: ["REGALRAPTOR"], models: ["Spider 350", "Daytona 350", "Bobber" ] },
  { name: "Asya", aliases: [], models: ["AS 50", "AS 100", "AS 125" ] },
  { name: "Mondi", aliases: [], models: [] },
  { name: "Sym", aliases: [], models: [] },
  { name: "Motoran", aliases: [], models: ["Buffalo", "Mustang", "Roadtrip" ] },
  { name: "Senke", aliases: [], models: ["SK 125", "SK 150" ] },
  { name: "Apennine", aliases: [], models: [] },
  { name: "GasGas", aliases: ["GAS GAS"], models: ["EC 250", "EC 300", "MC 250", "ES 700", "SM 700"] },
  { name: "Energica", aliases: [], models: ["Ego", "Eva", "Experia"] },
  { name: "Can-Am", aliases: ["CANAM", "BRP"], models: ["Ryker", "Spyder F3", "Spyder RT", "Origin", "Pulse"] },
];

// Turkish-market + global car brands. Popular models per brand; API-Ninjas fills
// the rest where available.
const CAR_OVERLAY = [
  { name: "Fiat", aliases: [], models: ["Egea", "Egea Cross", "Panda", "500", "500X", "500L", "Doblo", "Fiorino", "Linea", "Punto", "Tipo", "Albea", "Palio", "Tofaş Şahin", "Tofaş Doğan"] },
  { name: "Renault", aliases: [], models: ["Clio", "Megane", "Symbol", "Taliant", "Captur", "Kadjar", "Austral", "Talisman", "Fluence", "Latitude", "Kangoo", "Trafic", "Master", "Zoe", "Twingo", "Laguna", "Toros", "R12", "R9", "R19", "Broadway"] },
  { name: "Ford", aliases: [], models: ["Focus", "Fiesta", "Puma", "Kuga", "Mondeo", "Ecosport", "Courier", "Transit", "Transit Custom", "Tourneo Custom", "Tourneo Connect", "Ranger", "Mustang", "Escort", "Taurus"] },
  { name: "Volkswagen", aliases: ["VW"], models: ["Polo", "Golf", "Passat", "Jetta", "Bora", "Tiguan", "T-Roc", "T-Cross", "Touareg", "Caddy", "Transporter", "Amarok", "Arteon", "ID.3", "ID.4", "Scirocco", "Beetle"] },
  { name: "Opel", aliases: [], models: ["Corsa", "Astra", "Insignia", "Mokka", "Crossland", "Grandland", "Combo", "Vivaro", "Vectra", "Zafira", "Meriva"] },
  { name: "Toyota", aliases: [], models: ["Corolla", "Yaris", "C-HR", "RAV4", "Camry", "Auris", "Avensis", "Hilux", "Land Cruiser", "Proace", "Aygo", "Verso", "Corolla Cross"] },
  { name: "Hyundai", aliases: [], models: ["i10", "i20", "i30", "Accent", "Elantra", "Bayon", "Kona", "Tucson", "Santa Fe", "ix35", "Getz", "Accent Blue", "Ioniq", "Ioniq 5"] },
  { name: "Peugeot", aliases: [], models: ["208", "308", "301", "2008", "3008", "5008", "508", "Partner", "Rifter", "Expert", "Boxer", "206", "207", "407"] },
  { name: "Citroën", aliases: ["CITROEN"], models: ["C3", "C4", "C5 Aircross", "C-Elysée", "Berlingo", "Jumpy", "Jumper", "C1", "C3 Aircross", "Xsara", "Picasso"] },
  { name: "Dacia", aliases: [], models: ["Sandero", "Duster", "Logan", "Lodgy", "Dokker", "Jogger", "Spring"] },
  { name: "Mercedes-Benz", aliases: ["MERCEDES", "MERCEDESBENZ"], models: ["A-Class", "B-Class", "C-Class", "E-Class", "S-Class", "CLA", "CLS", "GLA", "GLB", "GLC", "GLE", "GLS", "Vito", "Sprinter", "V-Class", "A180", "C200", "E250"] },
  { name: "BMW", aliases: ["BMW MOTORRAD"], models: ["1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "6 Series", "7 Series", "X1", "X2", "X3", "X4", "X5", "X6", "X7", "320i", "520i", "116i", "118i", "i3", "i4", "iX"] },
  { name: "Audi", aliases: [], models: ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q2", "Q3", "Q5", "Q7", "Q8", "TT", "e-tron"] },
  { name: "Nissan", aliases: [], models: ["Micra", "Qashqai", "Juke", "X-Trail", "Note", "Navara", "Primera", "Almera", "Pulsar", "Leaf"] },
  { name: "Skoda", aliases: ["ŠKODA"], models: ["Fabia", "Octavia", "Superb", "Scala", "Kamiq", "Karoq", "Kodiaq", "Rapid", "Roomster", "Yeti", "Enyaq"] },
  { name: "Seat", aliases: [], models: ["Ibiza", "Leon", "Arona", "Ateca", "Tarraco", "Toledo", "Cordoba", "Alhambra"] },
  { name: "Kia", aliases: [], models: ["Picanto", "Rio", "Ceed", "Cerato", "Sportage", "Sorento", "Stonic", "Niro", "Soul", "Venga", "EV6"] },
  { name: "Volvo", aliases: [], models: ["S60", "S90", "V40", "V60", "V90", "XC40", "XC60", "XC90", "C40"] },
  { name: "Honda", aliases: [], models: ["Civic", "City", "Accord", "Jazz", "CR-V", "HR-V", "Fit"] },
  { name: "Mazda", aliases: [], models: ["2", "3", "6", "CX-3", "CX-30", "CX-5", "MX-5"] },
  { name: "Suzuki", aliases: [], models: ["Swift", "Vitara", "SX4", "S-Cross", "Baleno", "Jimny", "Ignis"] },
  { name: "Mitsubishi", aliases: [], models: ["Lancer", "ASX", "Outlander", "L200", "Eclipse Cross", "Colt", "Space Star"] },
  { name: "Tesla", aliases: [], models: ["Model 3", "Model Y", "Model S", "Model X"] },
  { name: "Togg", aliases: [], models: ["T10X", "T10F"] },
  { name: "Chery", aliases: [], models: ["Tiggo 7 Pro", "Tiggo 8 Pro", "Omoda 5", "Tiggo 4 Pro"] },
  { name: "MG", aliases: [], models: ["MG3", "MG4", "MG5", "ZS", "HS", "Marvel R"] },
  { name: "Cupra", aliases: [], models: ["Formentor", "Leon", "Born", "Ateca"] },
  { name: "Jeep", aliases: [], models: ["Renegade", "Compass", "Wrangler", "Cherokee", "Grand Cherokee", "Avenger"] },
  { name: "Land Rover", aliases: ["LANDROVER"], models: ["Range Rover", "Range Rover Evoque", "Range Rover Sport", "Range Rover Velar", "Discovery", "Discovery Sport", "Defender"] },
  { name: "Mini", aliases: [], models: ["Cooper", "Countryman", "Clubman", "Cooper S"] },
  { name: "Porsche", aliases: [], models: ["911", "Cayenne", "Macan", "Panamera", "Taycan", "Boxster", "Cayman"] },
  { name: "Alfa Romeo", aliases: ["ALFAROMEO"], models: ["Giulia", "Giulietta", "Stelvio", "Tonale", "Mito"] },
  { name: "Lada", aliases: [], models: ["Vega", "Samara", "Niva", "Kalina", "Granta"] },
];

async function getJson(url, tries = 3, headers = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

// One config per vehicle type. ninjas = the /v1/<path> endpoint for that type.
const SOURCES = [
  { type: "motorcycle", vpicType: "motorcycle", ninjasPath: "motorcycles", overlay: MOTO_OVERLAY },
  { type: "car", vpicType: "car", ninjasPath: "cars", overlay: CAR_OVERLAY },
];

async function main() {
  // norm -> { name, source, types:Set, aliases:Set, models: Map<norm,{name,type}> }
  const makes = new Map();

  function ensureMake(name, source) {
    const k = norm(name);
    if (!k) return null;
    let m = makes.get(k);
    if (!m) {
      m = { name, source, types: new Set(), aliases: new Set(), models: new Map() };
      makes.set(k, m);
    } else if (source === "overlay" && m.source !== "overlay") {
      // Overlay wins on canonical naming + source label.
      m.name = name;
      m.source = "overlay";
    }
    return m;
  }

  function addModel(m, name, type) {
    const nk = norm(name);
    if (!nk) return;
    if (!m.models.has(nk)) m.models.set(nk, { name: String(name).trim(), type });
  }

  for (const src of SOURCES) {
    // 1) Overlay first so its canonical names take precedence.
    for (const o of src.overlay) {
      const m = ensureMake(o.name, "overlay");
      if (!m) continue;
      m.types.add(src.type);
      for (const a of o.aliases ?? []) if (norm(a)) m.aliases.add(norm(a));
      for (const md of o.models ?? []) addModel(m, md, src.type);
    }

    // 2) vPIC makes for breadth.
    console.error(`[catalog] fetching vPIC ${src.type} makes…`);
    const makesResp = await getJson(`${VPIC}/GetMakesForVehicleType/${src.vpicType}?format=json`);
    const vpicMakes = (makesResp?.Results ?? []).filter((r) => r?.MakeName);
    console.error(`[catalog] vPIC returned ${vpicMakes.length} ${src.type} makes`);
    for (const r of vpicMakes) {
      const m = ensureMake(titleCase(r.MakeName), "vpic");
      if (m) {
        m.types.add(src.type);
        (m._makeIds ??= {})[src.type] = r.MakeId;
      }
    }

    // 3a) Harvest real model names from API-Ninjas for the overlay makes.
    //     Free tier caps at 30 rows/make with no offset, so this enriches the
    //     long tail of smaller brands; big brands lean on the curated overlay.
    if (NINJAS_KEY) {
      const targets = src.overlay.map((o) => makes.get(norm(o.name))).filter(Boolean);
      console.error(`[catalog] fetching API-Ninjas ${src.type} models for ${targets.length} makes…`);
      let enriched = 0;
      for (const m of targets) {
        try {
          const rows = await getJson(
            `${NINJAS}/${src.ninjasPath}?make=${encodeURIComponent(m.name)}`,
            3,
            { "X-Api-Key": NINJAS_KEY },
          );
          if (Array.isArray(rows)) {
            for (const r of rows) if (r?.model) addModel(m, r.model, src.type);
            if (rows.length) enriched++;
          }
        } catch (e) {
          console.error(`[catalog]   ninjas ${src.type} models for ${m.name} failed: ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      console.error(`[catalog] API-Ninjas enriched ${enriched} ${src.type} makes`);
    } else {
      console.error("[catalog] API_NINJAS_KEY not set — skipping API-Ninjas model harvest");
    }

    // 3b) Optionally harvest vPIC models too (slower, noisier).
    if (VPIC_MODELS) {
      const targets = src.overlay.map((o) => makes.get(norm(o.name))).filter((m) => m?._makeIds?.[src.type]);
      console.error(`[catalog] fetching vPIC ${src.type} models for ${targets.length} makes…`);
      for (const m of targets) {
        try {
          const resp = await getJson(`${VPIC}/GetModelsForMakeId/${m._makeIds[src.type]}?format=json`);
          for (const r of resp?.Results ?? []) if (r?.Model_Name) addModel(m, titleCase(r.Model_Name), src.type);
        } catch (e) {
          console.error(`[catalog]   vpic ${src.type} models for ${m.name} failed: ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, 120));
      }
    }
  }

  // 4) Emit sorted, stable output.
  const out = [...makes.values()]
    .map((m) => ({
      name: m.name,
      norm: norm(m.name),
      source: m.source,
      types: [...m.types].sort(),
      aliases: [...m.aliases].sort(),
      models: [...m.models.values()]
        .map((md) => ({ name: md.name, norm: norm(md.name), type: md.type }))
        .sort((a, b) => a.norm.localeCompare(b.norm)),
    }))
    .sort((a, b) => a.norm.localeCompare(b.norm));

  const makeCount = out.length;
  const modelCount = out.reduce((s, m) => s + m.models.length, 0);
  const header = `// AUTO-GENERATED by scripts/fetch-moto-catalog.mjs — do not edit by hand.
// Source: NHTSA vPIC + curated Turkish-market overlay + API-Ninjas.
// Makes: ${makeCount}, Models: ${modelCount}.
export type VehicleType = "motorcycle" | "car";
export interface CatalogModel { name: string; norm: string; type: VehicleType; }
export interface CatalogMake { name: string; norm: string; source: "overlay" | "vpic"; types: VehicleType[]; aliases: string[]; models: CatalogModel[]; }
export const VEHICLE_CATALOG: CatalogMake[] = ${JSON.stringify(out, null, 0)};
`;
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, header, "utf8");
  console.error(`[catalog] wrote ${OUT}`);
  console.error(`[catalog] makes=${makeCount} models=${modelCount} (ninjas=${!!NINJAS_KEY} vpic-models=${VPIC_MODELS})`);
}

function titleCase(s) {
  // vPIC returns SHOUTING CASE; make it presentable while keeping short tokens.
  return String(s)
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/\b(\d*[a-z]?[a-z]\d+[a-z\d]*)\b/gi, (t) => t.toUpperCase());
}

main().catch((e) => {
  console.error("[catalog] FAILED:", e);
  process.exit(1);
});
