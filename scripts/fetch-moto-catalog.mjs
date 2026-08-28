#!/usr/bin/env node
/**
 * Build the bundled vehicle (motorcycle + car) make/model catalog.
 *
 *   node scripts/fetch-moto-catalog.mjs                  # vPIC makes + TR overlay (fast, no key)
 *   node scripts/fetch-moto-catalog.mjs --offline        # overlay ONLY, no network at all
 *   API_NINJAS_KEY=… node scripts/fetch-moto-catalog.mjs # + API-Ninjas top-up for thin makes
 *   … --vpic-models                                      # also harvest vPIC models (slow, noisy)
 *   … --fresh                                            # discard the previous build's harvest
 *   … --audit                                            # only report; don't write
 *
 * Output: apps/api/src/db/seed/vehicleCatalog.generated.ts
 *
 * ── SOURCES, AND WHY THEY ARE WEIGHTED THE WAY THEY ARE ─────────────────────
 *
 * 1. NHTSA vPIC (free, no key) — GetMakesForVehicleType/{motorcycle,car}.
 *    Good for MAKE BREADTH only. Its model lists are US-registration data:
 *    Renault, Dacia, Peugeot, Citroën, Opel, Škoda, Seat, Lada and Togg have
 *    sold no cars in the United States for decades (or ever), so vPIC knows
 *    nothing about the nine brands that actually fill Turkish roads. Even for
 *    brands it does know it returns US nameplates — Fiat "Tipo", never "Egea",
 *    which is the name printed on a Turkish ruhsat. Model harvest therefore
 *    stays OFF by default (--vpic-models opts in).
 *
 * 2. API-Ninjas /v1/{motorcycles,cars}?make=… — real model names, but the free
 *    tier returns at most 30 rows per make with NO offset, so it can never
 *    enumerate a large brand, and its car corpus is EPA fuel-economy data:
 *    US-market again, and full of near-duplicate trim rows ("Corolla iM",
 *    "Yaris iA") that add bytes and actively hurt OCR fuzzy matching. It is
 *    used only to TOP UP makes the overlay leaves thin (< NINJAS_FILL_BELOW
 *    models) — never to overwrite or pad a curated list.
 *
 * 3. The curated Turkish-market overlay below — the primary source for cars.
 *    Both free feeds are structurally unable to describe the Turkish parc, so
 *    the overlay carries it: the brands and nameplates actually registered
 *    here, current and historic (a 1998 Şahin still needs its muayene tracked),
 *    in rough prevalence order.
 *
 * ── ORDER IS DATA ───────────────────────────────────────────────────────────
 * Overlay makes are listed most-common-in-Turkey first, and each make's models
 * likewise. That order is emitted as a `rank` (0–1000) and seeded into
 * vehicle_make.pop_car / pop_moto and vehicle_model.popularity, so opening the
 * make dropdown offers Fiat/Renault/Volkswagen rather than Alfa Romeo, and
 * Renault's model list opens on Clio rather than Austral. Ranks are per vehicle
 * type, so Honda leading the motorcycle list does not drag it to the top of the
 * car list.
 *
 * ── REGENERATION IS NON-DESTRUCTIVE ─────────────────────────────────────────
 * The previous build is read back and its models are carried forward (at rank
 * 0, so curated entries still sort first). Without this, anyone running the
 * script without an API_NINJAS_KEY would silently DELETE every model a
 * key-holding run had harvested — which is most of the motorcycle catalog.
 * `--fresh` opts out and rebuilds from the live sources alone.
 *
 * Makes are merged by normalized name across types (Honda is one make carrying
 * both motorcycle and car models). Models are tagged with their vehicle type.
 *
 * The generated file is a plain TS module so `tsc` compiles it straight into
 * dist — no Docker copy step, no runtime fetch, works offline.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
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
const OFFLINE = process.argv.includes("--offline");
const AUDIT_ONLY = process.argv.includes("--audit");
const FRESH = process.argv.includes("--fresh");

/** Only top up from API-Ninjas when the overlay left a make thinner than this. */
const NINJAS_FILL_BELOW = 8;

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
//   Turkish ruhsats print the LOCAL ASSEMBLER, not the global brand — "TOFAŞ
//   FIAT", "OYAK-RENAULT", "FORD OTOSAN", "HYUNDAI ASSAN" — so those strings
//   are aliases, not curiosities.
// `models` are the commercial names printed in field D.3, most common first.
const MOTO_OVERLAY = [
  { name: "Honda", aliases: ["HONDA MOTOR"], models: ["PCX125", "CB125F", "CB125R", "Activa", "CB150R", "CB250R", "CB300R", "CB500F", "CB500X", "CB650R", "CBR250R", "CBR500R", "CBR650R", "CBF150", "PCX150", "SH150i", "Forza 125", "Forza 250", "Forza 750", "ADV150", "ADV350", "NC750X", "CRF250L", "CRF300L", "Africa Twin", "CB650F", "Dio", "Spacy", "Wave", "Innova", "Super Cub"] },
  { name: "Yamaha", aliases: ["YAMAHA MOTOR"], models: ["NMAX 125", "YBR125", "MT-07", "MT-03", "XMAX 250", "NMAX 155", "MT-09", "YS125", "MT-10", "MT-15", "MT-25", "YZF-R1", "YZF-R3", "YZF-R6", "YZF-R7", "YZF-R125", "YZF-R25", "XSR125", "XSR700", "XSR900", "Tracer 7", "Tracer 9", "Tenere 700", "XMAX 125", "XMAX 300", "TMAX", "Aerox 155", "Crypton", "Fazer", "FZ", "Delight", "Ray ZR"] },
  { name: "Suzuki", aliases: [], models: ["GSX-R125", "GSX-S125", "V-Strom 650", "Burgman 125", "GSX-R600", "GSX-R750", "GSX-R1000", "GSX-S750", "GSX-S1000", "GSX-8S", "GSX-8R", "V-Strom 250", "V-Strom 800", "V-Strom 1050", "Burgman 200", "Burgman 400", "Address", "Hayabusa", "SV650", "Gixxer", "Intruder", "Access"] },
  { name: "Kawasaki", aliases: [], models: ["Ninja 400", "Z900", "Versys 650", "Ninja 650", "Z650", "Ninja 125", "Ninja 250", "Ninja 300", "Ninja 1000", "Ninja H2", "Ninja ZX-6R", "Ninja ZX-10R", "Z125", "Z250", "Z400", "Z1000", "Z H2", "Versys 300", "Versys 1000", "Vulcan S", "W175", "W800", "Eliminator"] },
  { name: "BMW", aliases: ["BMW MOTORRAD"], models: ["R1250GS", "F750GS", "G310R", "G310GS", "F850GS", "F900R", "F900XR", "R1300GS", "R1250RT", "R nineT", "S1000RR", "S1000R", "S1000XR", "C400X", "C400GT", "CE 04", "K1600GT", "M1000RR"] },
  { name: "KTM", aliases: [], models: ["390 Duke", "250 Duke", "125 Duke", "200 Duke", "RC390", "790 Duke", "890 Duke", "1290 Super Duke", "RC125", "RC200", "250 Adventure", "390 Adventure", "890 Adventure", "1290 Super Adventure", "300 EXC", "350 EXC-F", "450 SX-F"] },
  { name: "Ducati", aliases: [], models: ["Monster", "Scrambler", "Panigale V2", "Panigale V4", "Multistrada V4", "Streetfighter V2", "Streetfighter V4", "Multistrada V2", "Diavel", "Hypermotard", "SuperSport", "DesertX"] },
  { name: "Triumph", aliases: [], models: ["Street Triple", "Trident 660", "Bonneville", "Speed Triple", "Tiger 660", "Tiger 850", "Tiger 900", "Tiger 1200", "Street Twin", "Speed Twin", "Scrambler 400", "Speed 400", "Rocket 3", "Daytona 660"] },
  { name: "Harley-Davidson", aliases: ["HARLEY", "HARLEY DAVIDSON"], models: ["Iron 883", "Forty-Eight", "Street Bob", "Fat Bob", "Fat Boy", "Heritage", "Road King", "Street Glide", "Road Glide", "Sportster S", "Nightster", "Pan America"] },
  { name: "Vespa", aliases: [], models: ["Primavera 125", "Sprint 125", "GTS 300", "Primavera 150", "Sprint 150", "GTS 125", "GTV 300", "LX 125", "Elettrica", "946"] },
  { name: "Piaggio", aliases: [], models: ["Liberty 125", "Medley 125", "Beverly 300", "Liberty 150", "Medley 150", "Beverly 400", "MP3", "Zip", "Fly"] },
  { name: "Aprilia", aliases: [], models: ["SR GT", "RS 660", "Tuono 660", "RS 125", "RS 457", "RSV4", "Tuono 125", "Tuono V4", "SX 125", "RX 125", "Tuareg 660"] },
  { name: "Benelli", aliases: [], models: ["TRK 502", "TRK 251", "Leoncino 250", "Leoncino 500", "TNT 125", "TNT 25", "TNT 600", "Leoncino 800", "TRK 702", "302S", "502C", "Imperiale 400"] },
  { name: "CFMoto", aliases: ["CF MOTO"], models: ["250NK", "300NK", "650MT", "150NK", "400NK", "650NK", "300SR", "450SR", "700MT", "800MT", "700CL-X", "450MT", "Papio"] },
  { name: "Zontes", aliases: [], models: ["310R", "125 G1", "310T", "310X", "125 U", "310V", "350R", "350T", "350X", "350GK", "703F"] },
  { name: "Voge", aliases: [], models: ["300R", "500DS", "300AC", "500R", "525DSX", "525ACX", "650DS", "900DS", "SR4"] },
  { name: "QJ Motor", aliases: ["QJMOTOR", "QJ"], models: ["SRK 250", "SRK 400", "SRV 550", "SRK 600", "SRK 700", "SRT 550", "SRT 750", "SVT 650"] },
  { name: "Keeway", aliases: [], models: ["RKF 125", "RKF 150", "Vieste 125", "RKV 200", "Vieste 300", "Superlight 125", "K-Light 202", "Cityblade"] },
  { name: "Royal Enfield", aliases: ["ROYALENFIELD", "ENFIELD"], models: ["Classic 350", "Hunter 350", "Meteor 350", "Himalayan", "Bullet 350", "Interceptor 650", "Continental GT 650", "Scram 411", "Super Meteor 650"] },
  { name: "Bajaj", aliases: [], models: ["Pulsar 200", "Pulsar NS200", "Dominar 400", "Pulsar 125", "Pulsar 150", "Pulsar 180", "Pulsar RS200", "Pulsar N250", "Dominar 250", "Avenger", "Boxer", "CT100"] },
  { name: "TVS", aliases: [], models: ["Apache RTR 200", "Apache RTR 160", "Ntorq 125", "Apache RTR 180", "Apache RR 310", "Raider 125", "Jupiter", "Star City", "Sport", "Ronin"] },
  { name: "Hero", aliases: ["HERO MOTOCORP", "HERO HONDA"], models: ["Splendor", "Passion", "Glamour", "Xtreme 125R", "Xtreme 160R", "Xpulse 200", "Karizma XMR", "Destini", "Maestro"] },
  { name: "SYM", aliases: [], models: ["Jet 14", "Symphony", "Fiddle", "Jet X", "Cruisym 150", "Cruisym 300", "Joymax 300", "Maxsym 400", "NH-T 125", "ADXTG"] },
  { name: "Kymco", aliases: [], models: ["Agility 125", "Like 125", "Agility 150", "Like 150", "People S", "Downtown 350", "AK 550", "X-Town 300", "Super 8"] },
  { name: "Mondial", aliases: [], models: ["150 Drift", "200 Drift", "Tarmac 125", "250 GD", "Tarmac 250", "SMX 125", "X-Treme 125", "HPS 125", "HPS 300", "Flat Track 125", "P'mela 50"] },
  { name: "Kuba", aliases: [], models: ["CG 125", "GY6", "Master", "Falcon", "Comfort", "Pesaro", "Maxon"] },
  { name: "RKS", aliases: [], models: ["Titanic", "Maxtra", "Smart", "Caprice", "Skyline", "Defient", "Bitturbo", "Mariposa"] },
  { name: "Arora", aliases: [], models: ["AR 125", "AR 50", "AR 100", "Cappadocia", "Tiger", "Ranger", "Storm"] },
  { name: "Kanuni", aliases: [], models: ["Mondial 125", "Sınırsız 125", "Pony", "Sport", "Cruiser"] },
  { name: "Ramzey", aliases: [], models: ["RM 125", "RM 50", "RM 100", "Cross", "Atv"] },
  { name: "Falcon", aliases: [], models: ["Serenade", "Smartmax", "Crossmax", "Speedmax", "Cruise"] },
  { name: "Yuki", aliases: [], models: ["YK 125", "YK 50", "YK 100", "Reggae", "Power", "Style"] },
  { name: "Bisan", aliases: [], models: ["Spider", "Cobra", "Eko", "Star"] },
  { name: "Daelim", aliases: [], models: ["Daystar", "Roadwin", "S-Five", "Besbi", "History"] },
  { name: "Husqvarna", aliases: [], models: ["Svartpilen 401", "Vitpilen 401", "Svartpilen 125", "Svartpilen 250", "Norden 901", "FE 350", "TE 300", "701 Enduro"] },
  { name: "Moto Guzzi", aliases: ["MOTOGUZZI"], models: ["V7", "V85 TT", "V9", "V100 Mandello", "Stelvio"] },
  { name: "MV Agusta", aliases: ["MVAGUSTA"], models: ["Brutale 800", "Dragster 800", "F3", "Turismo Veloce", "Superveloce", "Rush"] },
  { name: "Indian", aliases: ["INDIAN MOTORCYCLE"], models: ["Scout", "Chief", "FTR", "Chieftain", "Roadmaster", "Springfield"] },
  { name: "Zero", aliases: ["ZERO MOTORCYCLES"], models: ["SR", "S", "DS", "DSR", "FX", "SR/F", "SR/S"] },
  { name: "Volta", aliases: [], models: ["VS1", "VSX", "VM4", "RX", "EV1"] },
  { name: "Lifan", aliases: [], models: ["KP150", "KP200", "KPR 200", "KPT", "SS3"] },
  { name: "Loncin", aliases: [], models: ["GP150", "CR1", "CR9"] },
  { name: "Zongshen", aliases: [], models: ["RX3", "RX1", "RX4", "Cyclone"] },
  { name: "Jincheng", aliases: [], models: ["JC 125", "Knight", "Hummer"] },
  { name: "Regal Raptor", aliases: ["REGALRAPTOR"], models: ["Spider 350", "Daytona 350", "Bobber"] },
  { name: "Asya", aliases: [], models: ["AS 125", "AS 50", "AS 100"] },
  { name: "Motoran", aliases: [], models: ["Buffalo", "Mustang", "Roadtrip"] },
  { name: "Senke", aliases: [], models: ["SK 125", "SK 150"] },
  { name: "GasGas", aliases: ["GAS GAS"], models: ["EC 250", "EC 300", "MC 250", "ES 700", "SM 700"] },
  { name: "Energica", aliases: [], models: ["Ego", "Eva", "Experia"] },
  { name: "Can-Am", aliases: ["CANAM", "BRP"], models: ["Ryker", "Spyder F3", "Spyder RT", "Origin", "Pulse"] },
];

/**
 * Turkish-market car brands, most common first, each with the nameplates that
 * actually appear on Turkish registrations — current models AND the ones still
 * on the road in numbers (an R19, a Şahin, a Vectra B all still need a muayene
 * reminder). Nothing here comes from a US registration feed; see the source
 * note at the top of the file for why neither free API can supply this list.
 */
const CAR_OVERLAY = [
  { name: "Fiat", aliases: ["TOFAS FIAT", "TOFAS-FIAT", "FIAT AUTO"], models: ["Egea", "Egea Cross", "Doblo", "Fiorino", "Linea", "Panda", "Punto", "Grande Punto", "Albea", "Palio", "500", "500X", "500L", "500e", "Tipo", "Siena", "Marea", "Brava", "Bravo", "Uno", "Tempra", "Ducato", "Scudo", "Talento", "Qubo", "Sedici", "Idea", "Freemont", "Croma", "Multipla", "Ulysse", "Fullback", "124 Spider", "Toro", "600", "Grande Panda", "Egea Cross Wagon", "Doblo Combi"] },
  { name: "Renault", aliases: ["OYAK RENAULT", "OYAKRENAULT", "RENAULT MAIS"], models: ["Clio", "Megane", "Symbol", "Taliant", "Captur", "Fluence", "Kadjar", "Austral", "Talisman", "Laguna", "Latitude", "Scenic", "Grand Scenic", "Kangoo", "Trafic", "Master", "Twingo", "Modus", "Koleos", "Espace", "Zoe", "Arkana", "Rafale", "Express", "Safrane", "Vel Satis", "Thalia", "Broadway", "Toros", "R9", "R11", "R12", "R19", "R21", "Clio Sport Tourer", "Megane Sedan", "Symbioz"] },
  { name: "Volkswagen", aliases: ["VW"], models: ["Passat", "Golf", "Polo", "Jetta", "Tiguan", "Caddy", "Transporter", "T-Roc", "T-Cross", "Bora", "Touareg", "Touran", "Sharan", "Amarok", "Arteon", "Crafter", "Scirocco", "Beetle", "New Beetle", "Up!", "Fox", "Lupo", "Eos", "CC", "Phaeton", "Vento", "Corrado", "Multivan", "California", "Taigo", "Tayron", "Teramont", "ID.3", "ID.4", "ID.5", "ID.7", "ID. Buzz", "Golf Variant", "Passat Variant", "Polo Sedan"] },
  { name: "Ford", aliases: ["FORD OTOSAN", "FORDOTOSAN"], models: ["Focus", "Fiesta", "Transit", "Transit Custom", "Courier", "Transit Courier", "Tourneo Custom", "Tourneo Connect", "Tourneo Courier", "Transit Connect", "Kuga", "Puma", "Mondeo", "EcoSport", "Ranger", "Escort", "Sierra", "Taunus", "Fusion", "Ka", "C-Max", "Grand C-Max", "S-Max", "Galaxy", "B-Max", "Explorer", "Edge", "Mustang", "Mustang Mach-E", "Maverick"] },
  { name: "Opel", aliases: [], models: ["Astra", "Corsa", "Vectra", "Insignia", "Zafira", "Meriva", "Mokka", "Crossland", "Grandland", "Combo", "Vivaro", "Movano", "Antara", "Agila", "Tigra", "Omega", "Kadett", "Ascona", "Frontera", "Signum", "Adam", "Karl", "Astra Sports Tourer", "Corsa-e", "Mokka-e", "Grandland X", "Crossland X"] },
  { name: "Toyota", aliases: ["TOYOTA SA", "TOYOTASA"], models: ["Corolla", "Corolla Cross", "C-HR", "Yaris", "Yaris Cross", "RAV4", "Auris", "Avensis", "Camry", "Hilux", "Land Cruiser", "Land Cruiser Prado", "Proace", "Proace City", "Aygo", "Aygo X", "Verso", "Prius", "Corolla Verso", "Starlet", "Carina", "Corona", "Celica", "Hiace", "Highlander", "Supra", "bZ4X", "Urban Cruiser"] },
  { name: "Hyundai", aliases: ["HYUNDAI ASSAN", "HYUNDAIASSAN"], models: ["i20", "i10", "Accent", "Accent Blue", "Accent Era", "Elantra", "i30", "Bayon", "Tucson", "Kona", "ix35", "ix20", "Getz", "Matrix", "Santa Fe", "Sonata", "i40", "Venue", "Creta", "Staria", "H-1", "H100", "Starex", "Terracan", "Ioniq", "Ioniq 5", "Ioniq 6", "Excel", "Coupe", "i20 Active"] },
  { name: "Peugeot", aliases: [], models: ["301", "208", "308", "2008", "3008", "206", "207", "307", "5008", "508", "408", "405", "406", "407", "106", "107", "108", "205", "306", "309", "605", "607", "807", "1007", "4007", "4008", "Partner", "Rifter", "Expert", "Boxer", "Bipper", "Traveller", "RCZ", "e-208", "e-2008", "308 SW", "508 SW"] },
  { name: "Citroën", aliases: ["CITROEN"], models: ["C-Elysée", "C3", "C4", "Berlingo", "C5 Aircross", "C3 Aircross", "C4 Cactus", "C5", "C1", "C2", "Xsara", "Xsara Picasso", "C4 Picasso", "Grand C4 Picasso", "C3 Picasso", "Saxo", "ZX", "BX", "AX", "C8", "C6", "C5 X", "C4 X", "ë-C4", "Nemo", "Jumpy", "Jumper", "Spacetourer", "C-Crosser"] },
  { name: "Dacia", aliases: [], models: ["Sandero", "Sandero Stepway", "Duster", "Logan", "Logan MCV", "Lodgy", "Dokker", "Jogger", "Spring", "Bigster", "Solenza", "Nova", "1310", "Pick-Up"] },
  { name: "Mercedes-Benz", aliases: ["MERCEDES", "MERCEDESBENZ", "MERCEDES BENZ TURK", "MERCEDESBENZTURK"], models: ["C-Class", "E-Class", "A-Class", "Vito", "Sprinter", "B-Class", "S-Class", "CLA", "GLA", "GLC", "GLB", "GLE", "GLS", "CLS", "CLK", "SLK", "GLK", "ML", "G-Class", "V-Class", "Viano", "Citan", "C180", "C200", "C220", "E200", "E220", "E250", "E350", "A180", "A200", "S320", "S350", "190", "200 D", "230 E", "240 D", "EQA", "EQB", "EQC", "EQE", "EQS"] },
  { name: "BMW", aliases: ["BMW MOTORRAD"], models: ["3 Series", "5 Series", "1 Series", "320i", "320d", "520d", "520i", "116i", "118i", "318i", "316i", "2 Series", "4 Series", "X1", "X3", "X5", "6 Series", "7 Series", "8 Series", "X2", "X4", "X6", "X7", "Z3", "Z4", "530i", "525d", "518d", "120i", "330i", "i3", "i4", "i5", "i7", "iX", "iX1", "iX3", "M2", "M3", "M4", "M5"] },
  { name: "Audi", aliases: [], models: ["A3", "A4", "A6", "A1", "A5", "Q3", "Q5", "A7", "A8", "Q2", "Q7", "Q8", "TT", "A2", "80", "100", "S3", "S4", "RS3", "RS6", "R8", "e-tron", "e-tron GT", "Q4 e-tron", "Q8 e-tron", "A3 Sportback", "A4 Avant", "A6 Avant"] },
  { name: "Skoda", aliases: ["ŠKODA", "SKODA AUTO"], models: ["Octavia", "Superb", "Fabia", "Rapid", "Scala", "Kamiq", "Karoq", "Kodiaq", "Yeti", "Roomster", "Rapid Spaceback", "Octavia Combi", "Superb Combi", "Fabia Combi", "Citigo", "Felicia", "Praktik", "Enyaq", "Elroq"] },
  { name: "Nissan", aliases: ["NISSAN MOTOR"], models: ["Qashqai", "Micra", "Juke", "X-Trail", "Note", "Primera", "Almera", "Navara", "Pulsar", "Sunny", "Terrano", "Tiida", "Patrol", "Pathfinder", "Murano", "Leaf", "Ariya", "Kicks", "NV200", "Townstar", "Interstar"] },
  { name: "Honda", aliases: [], models: ["Civic", "CR-V", "Jazz", "City", "Accord", "HR-V", "ZR-V", "Civic Type R", "Insight", "Legend", "Prelude", "Integra", "FR-V", "Stream", "e:Ny1"] },
  { name: "Kia", aliases: [], models: ["Sportage", "Rio", "Ceed", "Cerato", "Picanto", "Sorento", "Stonic", "Niro", "Soul", "Venga", "Carens", "Carnival", "Optima", "Stinger", "XCeed", "Proceed", "K5", "Sephia", "Shuma", "Pride", "EV3", "EV6", "EV9"] },
  { name: "Seat", aliases: [], models: ["Ibiza", "Leon", "Cordoba", "Toledo", "Arona", "Ateca", "Tarraco", "Altea", "Alhambra", "Exeo", "Mii", "Inca", "Marbella"] },
  { name: "Chery", aliases: ["CHERY AUTOMOBILE"], models: ["Tiggo 8 Pro", "Tiggo 7 Pro", "Tiggo 4 Pro", "Tiggo 2 Pro", "Omoda 5", "Tiggo 8 Pro Max", "Omoda 7", "Jaecoo 7", "Tiggo 9", "Arrizo 5", "E5"] },
  { name: "Volvo", aliases: ["VOLVO CAR"], models: ["S60", "XC60", "XC40", "S80", "V40", "XC90", "S90", "V60", "V90", "S40", "V50", "XC70", "C30", "C40", "EX30", "EX40", "EX90", "240", "850", "940", "960", "S70"] },
  { name: "Suzuki", aliases: [], models: ["Swift", "Vitara", "Grand Vitara", "SX4", "SX4 S-Cross", "S-Cross", "Baleno", "Jimny", "Ignis", "Alto", "Celerio", "Splash", "Liana", "Wagon R", "Samurai", "Across", "Swace"] },
  { name: "Mitsubishi", aliases: ["MITSUBISHI MOTORS", "TEMSA MITSUBISHI"], models: ["L200", "Lancer", "ASX", "Outlander", "Colt", "Space Star", "Pajero", "Pajero Sport", "Eclipse Cross", "Galant", "Carisma", "Grandis", "Attrage", "Canter"] },
  { name: "Togg", aliases: [], models: ["T10X", "T10F"] },
  { name: "MG", aliases: ["MG MOTOR", "MORRIS GARAGES"], models: ["ZS", "HS", "MG4", "MG3", "MG5", "EHS", "ZS EV", "MG6", "MG7", "Marvel R", "Cyberster"] },
  { name: "Cupra", aliases: ["SEAT CUPRA"], models: ["Formentor", "Leon", "Born", "Ateca", "Terramar", "Tavascan"] },
  { name: "Mazda", aliases: [], models: ["3", "6", "2", "Mazda3", "Mazda6", "Mazda2", "CX-3", "CX-30", "CX-5", "CX-60", "MX-5", "MX-30", "323", "626", "Premacy", "Tribute", "BT-50", "RX-8", "CX-9"] },
  { name: "Tofaş", aliases: ["TOFAS TURK", "TOFAS OTO"], models: ["Şahin", "Doğan", "Kartal", "Serçe", "Murat 131", "Murat 124", "Doğan SLX", "Şahin S", "Kartal SLX", "Kartal Station"] },
  { name: "Chevrolet", aliases: [], models: ["Aveo", "Cruze", "Lacetti", "Kalos", "Captiva", "Spark", "Epica", "Trax", "Orlando", "Camaro", "Corvette", "Tahoe", "Silverado"] },
  { name: "Jeep", aliases: [], models: ["Renegade", "Compass", "Grand Cherokee", "Cherokee", "Wrangler", "Avenger", "Gladiator", "Commander"] },
  { name: "Land Rover", aliases: ["LANDROVER"], models: ["Range Rover Evoque", "Discovery Sport", "Range Rover Sport", "Range Rover", "Range Rover Velar", "Discovery", "Defender", "Freelander"] },
  { name: "Mini", aliases: ["MINI COOPER"], models: ["Cooper", "Cooper S", "Countryman", "Clubman", "One", "Cooper SE", "Paceman", "Cabrio", "John Cooper Works"] },
  { name: "Alfa Romeo", aliases: ["ALFAROMEO", "ALFA"], models: ["Giulietta", "Giulia", "Stelvio", "Tonale", "Mito", "156", "147", "159", "166", "Brera", "GT", "Junior", "33"] },
  { name: "Tesla", aliases: [], models: ["Model Y", "Model 3", "Model S", "Model X", "Cybertruck"] },
  { name: "BYD", aliases: ["BYD AUTO"], models: ["Seal U", "Seal", "Atto 3", "Dolphin", "Sealion 7", "Song Plus", "Han", "Tang", "Seagull"] },
  { name: "Porsche", aliases: [], models: ["Cayenne", "Macan", "911", "Panamera", "Taycan", "718 Cayman", "718 Boxster", "Cayenne Coupe"] },
  { name: "Lexus", aliases: [], models: ["NX", "RX", "ES", "UX", "IS", "LS", "GS", "CT", "LX", "RC", "LC", "LM", "RZ"] },
  { name: "Isuzu", aliases: ["ANADOLU ISUZU", "ANADOLUISUZU"], models: ["D-Max", "NPR", "NLR", "NQR", "Novo", "Turkuaz", "Citiport", "Grand Toro", "Visigo", "Roybus"] },
  { name: "Iveco", aliases: ["IVECO OTOYOL", "OTOYOL"], models: ["Daily", "Eurocargo", "Stralis", "S-Way", "Massif"] },
  { name: "KGM", aliases: ["SSANGYONG", "SSANG YONG", "KG MOBILITY"], models: ["Korando", "Rexton", "Tivoli", "Musso", "Actyon", "Kyron", "Rodius", "Torres"] },
  { name: "Daihatsu", aliases: [], models: ["Terios", "Sirion", "Cuore", "Charade", "Materia", "Move", "Hijet", "Gran Max"] },
  { name: "Subaru", aliases: [], models: ["Impreza", "Forester", "XV", "Outback", "Legacy", "Levorg", "BRZ", "Crosstrek"] },
  { name: "Lada", aliases: [], models: ["Samara", "Niva", "Vega", "Kalina", "Granta", "Priora", "Riva", "2107", "110", "111", "112"] },
  { name: "Anadol", aliases: ["OTOSAN ANADOL"], models: ["A1", "A2", "SV1600", "STC-16", "Böcek", "Pick-Up"] },
  { name: "Karsan", aliases: ["KARSAN OTOMOTIV"], models: ["Jest", "Atak", "Star", "e-Jest", "e-Atak", "J10", "Bozankaya"] },
  { name: "Otokar", aliases: ["OTOKAR OTOMOTIV"], models: ["Sultan", "Navigo", "Vectio", "Doruk", "Centro", "Atlas", "Kent", "e-Kent"] },
  { name: "Temsa", aliases: ["TEMSA GLOBAL"], models: ["Safir", "Maraton", "Prestij", "Tourmalin", "Avenue", "MD9", "LD"] },
  { name: "BMC", aliases: [], models: ["Levend", "Pro", "Tugra", "Megastar", "Belde", "Fatih", "Profesyonel"] },
  { name: "Jaguar", aliases: [], models: ["XF", "XE", "F-Pace", "E-Pace", "XJ", "I-Pace", "F-Type", "X-Type", "S-Type"] },
  { name: "Lancia", aliases: [], models: ["Ypsilon", "Delta", "Musa", "Lybra", "Thema"] },
  { name: "Rover", aliases: [], models: ["200", "400", "25", "45", "75"] },
  { name: "Smart", aliases: [], models: ["Fortwo", "Forfour", "#1", "#3"] },
  { name: "Geely", aliases: [], models: ["Emgrand", "Coolray", "EX5"] },
  { name: "Haval", aliases: ["GREAT WALL", "GREATWALL"], models: ["Jolion", "H6", "Wingle", "Poer"] },
  { name: "Leapmotor", aliases: [], models: ["C10", "T03", "B10"] },
  { name: "Skywell", aliases: [], models: ["ET5"] },
  { name: "Hongqi", aliases: [], models: ["E-HS9", "H9", "HS5"] },
  { name: "Maxus", aliases: [], models: ["T60", "T90", "Deliver 9", "eDeliver 3", "Euniq"] },
  { name: "DFSK", aliases: ["DONGFENG", "FENGON"], models: ["Glory 580", "Glory 500", "Fengon 5"] },
  { name: "Voyah", aliases: [], models: ["Free", "Courage", "Dream"] },
  { name: "Genesis", aliases: [], models: ["G70", "G80", "GV70", "GV80"] },
  { name: "Infiniti", aliases: [], models: ["Q30", "Q50", "QX30", "QX50", "FX35"] },
  { name: "Chrysler", aliases: [], models: ["300C", "Voyager", "Grand Voyager", "PT Cruiser"] },
  { name: "Dodge", aliases: [], models: ["Caliber", "Journey", "Nitro", "Charger"] },
  { name: "Saab", aliases: [], models: ["9-3", "9-5", "900"] },
  { name: "Proton", aliases: [], models: ["Gen-2", "Persona", "Savvy"] },
];

/**
 * The previous build, as plain data. The output is a TS module, so it cannot be
 * imported from a .mjs script — but everything after the `=` is ordinary JSON
 * that this same script emitted, so slicing it out is exact rather than a
 * heuristic. Missing/unreadable file → empty, never fatal.
 */
async function readPrevious() {
  try {
    const src = await readFile(OUT, "utf8");
    // Anchor on the assignment, not on the first "[" after the identifier —
    // the declaration itself contains one (`: CatalogMake[] = `).
    const at = src.indexOf("= [", src.indexOf("export const VEHICLE_CATALOG"));
    const start = at < 0 ? -1 : at + 2;
    const end = src.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    return JSON.parse(src.slice(start, end + 1));
  } catch (e) {
    console.error(`[catalog] no usable previous build (${e.message}) — building from sources only`);
    return [];
  }
}

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

/**
 * Curated list position → a 1–1000 popularity score. Scaled rather than raw so
 * a list can grow or shrink without renumbering, and so scores from the two
 * overlays are directly comparable.
 */
function rankOf(index, length) {
  return Math.max(1, Math.round((1000 * (length - index)) / length));
}

async function main() {
  // norm -> { name, source, types:Set, aliases:Set, models: Map<norm,{name,type,rank}>, rank:{} }
  const makes = new Map();

  function ensureMake(name, source) {
    const k = norm(name);
    if (!k) return null;
    let m = makes.get(k);
    if (!m) {
      m = { name, source, types: new Set(), aliases: new Set(), models: new Map(), rank: {} };
      makes.set(k, m);
    } else if (source === "overlay" && m.source !== "overlay") {
      // Overlay wins on canonical naming + source label.
      m.name = name;
      m.source = "overlay";
    }
    return m;
  }

  function addModel(m, name, type, rank = 0) {
    const nk = norm(name);
    if (!nk) return;
    const existing = m.models.get(nk);
    if (!existing) {
      m.models.set(nk, { name: String(name).trim(), type, rank });
      return;
    }
    // A curated entry always keeps its own spelling and rank; a later feed row
    // may only raise a rank that was never set.
    if (rank > existing.rank) existing.rank = rank;
  }

  for (const src of SOURCES) {
    // 1) Overlay first so its canonical names and ranks take precedence.
    src.overlay.forEach((o, i) => {
      const m = ensureMake(o.name, "overlay");
      if (!m) return;
      m.types.add(src.type);
      m.rank[src.type] = Math.max(m.rank[src.type] ?? 0, rankOf(i, src.overlay.length));
      for (const a of o.aliases ?? []) if (norm(a)) m.aliases.add(norm(a));
      const models = o.models ?? [];
      models.forEach((md, j) => addModel(m, md, src.type, rankOf(j, models.length)));
    });

    if (OFFLINE) continue;

    // 2) vPIC makes for breadth. Makes only — see the source note up top for
    //    why its model lists cannot describe the Turkish parc.
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

    // 3a) Top up thin makes from API-Ninjas. Deliberately NOT applied to makes
    //     the overlay already describes: the free tier returns at most 30 rows
    //     with no offset, and its car corpus is US trim data whose near-
    //     duplicates ("Corolla iM" next to "Corolla") cost bytes and make the
    //     OCR fuzzy matcher's job harder. Ninjas rows get rank 0, so a curated
    //     model always sorts above a harvested one.
    if (NINJAS_KEY) {
      const targets = src.overlay
        .map((o) => makes.get(norm(o.name)))
        .filter((m) => m && m.models.size < NINJAS_FILL_BELOW);
      console.error(
        `[catalog] API-Ninjas ${src.type}: topping up ${targets.length} thin makes (< ${NINJAS_FILL_BELOW} models)…`,
      );
      let enriched = 0;
      for (const m of targets) {
        try {
          const rows = await getJson(
            `${NINJAS}/${src.ninjasPath}?make=${encodeURIComponent(m.name)}`,
            3,
            { "X-Api-Key": NINJAS_KEY },
          );
          if (Array.isArray(rows)) {
            for (const r of rows) if (r?.model) addModel(m, r.model, src.type, 0);
            if (rows.length) enriched++;
          }
        } catch (e) {
          console.error(`[catalog]   ninjas ${src.type} models for ${m.name} failed: ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      console.error(`[catalog] API-Ninjas enriched ${enriched} ${src.type} makes`);
    } else {
      console.error("[catalog] API_NINJAS_KEY not set — overlay-only model lists (this is fine)");
    }

    // 3b) Optionally harvest vPIC models too. Off by default: US nameplates.
    if (VPIC_MODELS) {
      const targets = src.overlay.map((o) => makes.get(norm(o.name))).filter((m) => m?._makeIds?.[src.type]);
      console.error(`[catalog] fetching vPIC ${src.type} models for ${targets.length} makes…`);
      for (const m of targets) {
        try {
          const resp = await getJson(`${VPIC}/GetModelsForMakeId/${m._makeIds[src.type]}?format=json`);
          for (const r of resp?.Results ?? []) if (r?.Model_Name) addModel(m, titleCase(r.Model_Name), src.type, 0);
        } catch (e) {
          console.error(`[catalog]   vpic ${src.type} models for ${m.name} failed: ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, 120));
      }
    }
  }

  // 4) Carry forward the previous build's models. See the header: a run
  //    without a key must not delete what a run with one harvested.
  if (!FRESH) {
    const prev = await readPrevious();
    let carried = 0;
    for (const p of prev) {
      // Always "vpic" for a make no live source produced any more: `source`
      // is what ocr/catalog.ts uses to pick its trusted fuzzy candidates, and
      // a brand dropped from the curated overlay must lose that trust.
      const m = makes.get(p.norm) ?? ensureMake(p.name, "vpic");
      if (!m) continue;
      for (const t of p.types ?? []) m.types.add(t);
      for (const md of p.models ?? []) {
        if (m.models.has(md.norm)) continue;
        addModel(m, md.name, md.type, 0);
        carried++;
      }
    }
    console.error(`[catalog] carried forward ${carried} model(s) from the previous build`);
  }

  // 5) Emit sorted, stable output.
  const out = [...makes.values()]
    .map((m) => {
      const row = {
        name: m.name,
        norm: norm(m.name),
        source: m.source,
        types: [...m.types].sort(),
        aliases: [...m.aliases].sort(),
        models: [...m.models.values()]
          .map((md) => {
            const e = { name: md.name, norm: norm(md.name), type: md.type };
            if (md.rank > 0) e.rank = md.rank;
            return e;
          })
          .sort((a, b) => a.norm.localeCompare(b.norm)),
      };
      // Omitted entirely when empty — 1.7k vPIC makes would otherwise each carry
      // a dead `"rank":{}`.
      if (Object.keys(m.rank).length) row.rank = m.rank;
      return row;
    })
    .sort((a, b) => a.norm.localeCompare(b.norm));

  audit(out);

  const makeCount = out.length;
  const modelCount = out.reduce((s, m) => s + m.models.length, 0);
  const carModels = out.reduce((s, m) => s + m.models.filter((x) => x.type === "car").length, 0);
  const header = `// AUTO-GENERATED by scripts/fetch-moto-catalog.mjs — do not edit by hand.
// Sources: curated Turkish-market overlay (models) + NHTSA vPIC (make breadth)
// + optional API-Ninjas top-up for thin makes. Regenerate:
//   node scripts/fetch-moto-catalog.mjs            (network, no key needed)
//   node scripts/fetch-moto-catalog.mjs --offline  (overlay only, reproducible)
// Makes: ${makeCount}, Models: ${modelCount} (${carModels} car / ${modelCount - carModels} motorcycle).
export type VehicleType = "motorcycle" | "car";
/** \`rank\` is a curated 1–1000 popularity score in the Turkish market; absent = unranked. */
export interface CatalogModel { name: string; norm: string; type: VehicleType; rank?: number; }
export interface CatalogMake { name: string; norm: string; source: "overlay" | "vpic"; types: VehicleType[]; aliases: string[]; models: CatalogModel[]; rank?: Partial<Record<VehicleType, number>>; }
export const VEHICLE_CATALOG: CatalogMake[] = ${JSON.stringify(out, null, 0)};
`;
  if (AUDIT_ONLY) {
    console.error(`[catalog] --audit: not writing. makes=${makeCount} models=${modelCount} bytes=${Buffer.byteLength(header)}`);
    return;
  }
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, header, "utf8");
  console.error(`[catalog] wrote ${OUT} (${(Buffer.byteLength(header) / 1024).toFixed(1)} KB)`);
  console.error(
    `[catalog] makes=${makeCount} models=${modelCount} car=${carModels} (offline=${OFFLINE} ninjas=${!!NINJAS_KEY} vpic-models=${VPIC_MODELS})`,
  );
}

/**
 * Guardrail against the failure mode that matters most here: adding thousands
 * of near-duplicate names makes `ocr/catalog.ts` WORSE, not better. Its fuzzy
 * model matcher accepts a candidate at similarity ≥ 0.84 with an identical
 * digit sequence, so two models inside one make that satisfy both are a coin
 * flip on a scanned ruhsat.
 *
 * A review prompt, not a gate. Exact matching runs before fuzzy, so a clean
 * scan of either member still lands on itself; the pairs that survive here are
 * ones where both members name the same vehicle family ("Crossland" /
 * "Crossland X"), so a mis-pick is still substantially the right answer. What
 * this catches is the other kind — two genuinely different vehicles one edit
 * apart — which must never be added.
 */
function audit(out) {
  const digits = (s) => s.replace(/\D/g, "");
  let collisions = 0;
  for (const m of out) {
    for (let i = 0; i < m.models.length; i++) {
      for (let j = i + 1; j < m.models.length; j++) {
        const a = m.models[i].norm;
        const b = m.models[j].norm;
        if (digits(a) !== digits(b)) continue;
        const longer = Math.max(a.length, b.length);
        if (!longer) continue;
        const sim = 1 - levenshtein(a, b) / longer;
        if (sim >= 0.84) {
          collisions++;
          console.error(`[catalog] ⚠ ambiguous for OCR: ${m.name} "${m.models[i].name}" ~ "${m.models[j].name}" (${sim.toFixed(2)})`);
        }
      }
    }
  }
  console.error(collisions ? `[catalog] ${collisions} fuzzy-ambiguous model pair(s)` : "[catalog] no fuzzy-ambiguous model pairs");
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  const curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
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
