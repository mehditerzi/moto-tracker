import type { VehicleType } from "@mototracker/shared";
import { vehicleTint, type VehicleTint } from "@/lib/vehicleType";

/**
 * STUDIO ILLUSTRATIONS for vehicles without a photo.
 *
 * Per-model photography is not available on legitimate terms (see the note in
 * lib/vehicleType.ts), and a lucide glyph on a tint read as a placeholder. So
 * every vehicle gets a side-profile illustration that is drawn here, by us:
 * the body style is inferred from make/model (an MT-09 is a naked bike, a
 * Tiguan an SUV, a Doblo a van), and it is painted in the colour on the
 * vehicle's ruhsat. Eleven shapes, one SVG string each, no assets, no network.
 *
 * The same string feeds the DOM (VehicleArt) and the share-card canvas.
 * Coordinates are a 320×160 box, ground at y≈152, vehicle facing right.
 */

export const MOTO_STYLES = ["sport", "naked", "adventure", "cruiser", "scooter"] as const;
export const CAR_STYLES = ["sedan", "hatchback", "suv", "pickup", "van", "coupe"] as const;
export type BodyStyle = (typeof MOTO_STYLES)[number] | (typeof CAR_STYLES)[number];

// ─── body-style inference ────────────────────────────────────────────────────

const norm = (s: string) =>
  s
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    // "PCX125" → "PCX 125", "MT09" → "MT 09": model tokens glued to digits.
    .replace(/([A-Z])(?=\d)|(\d)(?=[A-Z])/g, "$1$2 ")
    .trim();

/** Ordered: the first matching rule wins, so specific beats generic. */
const MOTO_RULES: Array<[RegExp, BodyStyle]> = [
  [/\b(VESPA|KYMCO|SYM|PEUGEOT|PIAGGIO|APRILIA SR|ARORA|MONDIAL|KUBA|RKS|YUKI|BAJAJ CHETAK|SILENCE|NIU)\b/, "scooter"],
  [/\b(NMAX|XMAX|TMAX|PCX|FORZA|SH ?\d{2,3}|ADV ?\d{3}|BURGMAN|AN ?\d{3}|DIO|ACTIV|LEAD|VISION|AGILITY|PEOPLE|DOWNTOWN|XCITING|AK ?550|CITYCOM|JOYMAX|MAXSYM|LIBERTY|MEDLEY|BEVERLY|X ?ADV|NEO S|CRUISYM|JET ?\d|FIDDLE|SYMPHONY|ORBIT|GTS|PRIMAVERA|SPRINT|ELYSEO|DJANGO|TWEET|KISBEE|SCOOPY|ZOOMER|AEROX|D ?ELIGHT|CYGNUS|ADDRESS|AVENIS|LETS|BELUGA|SCOOTER)\b/, "scooter"],
  [/\b(HARLEY|INDIAN|ROYAL ENFIELD (?:METEOR|SUPER METEOR|SHOTGUN)|REBEL|SHADOW|VULCAN|BOLT|INTRUDER|BOULEVARD|DRAG ?STAR|VIRAGO|BOBBER|SCOUT|CHIEF|SPORTSTER|SOFTAIL|FAT ?BOY|STREET ?GLIDE|ROAD ?KING|IRON ?883|NIGHTSTER|ELIMINATOR|DIAVEL|XDIAVEL|R ?18|ROCKET|SPEEDMASTER|BONNEVILLE BOBBER|MIRAGE|CRUISER|CHOPPER|KEEWAY V302)\b/, "cruiser"],
  [/\b(GS|GSA|ADVENTURE|ADV|TENERE|AFRICA TWIN|CRF ?1[01]00|NC ?750 ?X|MULTISTRADA|DESERT ?X|V ?STROM|TIGER|VERSYS|TRACER|TRANSALP|NORDEN|ELEFANT|STELVIO|TUAREG|KLR|DR ?650|DR ?Z|XT|CB ?500 ?X|CB ?650 ?X|HIMALAYAN|SCRAM|G ?310 ?GS|F ?[789]\d0 ?GS|R ?1[23]\d0 ?GS|ENDURO|EXC|KTM \d+ ADVENTURE|CRF ?\d{3}|WR ?\d{3}|DUAL|RALLY|MT ?09 ?TRACER|PAN ?AMERICA|NT ?1100|FJR|PAN ?EUROPEAN|GOLD ?WING|K ?1600|RT\b|R ?1250 ?RT)\b/, "adventure"],
  [/\b(CBR|YZF ?R|R ?[1-7]\b|R ?25|R ?125|R ?15|NINJA|ZX ?\d+R?|GSX ?R|GSXR|PANIGALE|SUPERSPORT|RSV ?4|RS ?660|RS ?457|RC ?\d{3}|S ?1000 ?RR|M ?1000 ?RR|HP ?4|DAYTONA|F ?3|BRUTALE RR|HAYABUSA|BUSA|SV ?650 ?S|CBR ?\d+|VFR|ST ?\d|FIREBLADE|1199|1299|959|899|SUPERLEGGERA|TUONO V4 FACTORY|YAMAHA R)\b/, "sport"],
];

const CAR_RULES: Array<[RegExp, BodyStyle]> = [
  [/\b(HILUX|RANGER|AMAROK|NAVARA|L ?200|D ?MAX|TRITON|FULLBACK|X ?CLASS|RAPTOR|F ?150|TACOMA|TUNDRA|RAM|COLORADO|SILVERADO|SIERRA|GLADIATOR|MUSSO|ACTYON SPORTS|KB|BT ?50|PICK ?UP|PICKUP)\b/, "pickup"],
  [/\b(DOBLO|FIORINO|QUBO|CADDY|TRANSPORTER|CARAVELLE|MULTIVAN|CRAFTER|TRANSIT|TOURNEO|CONNECT|COURIER|KANGOO|TRAFIC|MASTER|EXPRESS|PARTNER|RIFTER|BERLINGO|COMBO|PROACE|VITO|V ?CLASS|SPRINTER|CITAN|DUCATO|SCUDO|JUMPY|JUMPER|BOXER|EXPERT|STARIA|H ?1|H ?100|STAREX|NV ?200|NV ?300|PRIMASTAR|LIVINA|VAN|MINIBUS|PANELVAN|DAILY|HIACE|TOWNACE|CARNIVAL|SHARAN|ALHAMBRA|TOURAN|ZAFIRA|SCENIC|ESPACE|GALAXY|S ?MAX|C ?MAX|ID ?BUZZ|SPACETOURER|TRAVELLER)\b/, "van"],
  [/\b(911|CAYMAN|BOXSTER|MUSTANG|CAMARO|CORVETTE|SUPRA|GR ?86|GT ?86|BRZ|TT|R ?8|Z ?4|M ?2|M ?4|M ?8|SLK|SLC|AMG GT|CLA ?SHOOTING|RC ?F|LC ?500|3[57]0 ?Z|400 ?Z|MX ?5|MIATA|F ?TYPE|GT ?R|CALIFORNIA|ROMA|PORTOFINO|HURACAN|URUS ?\b|COUPE|CABRIO|ROADSTER|SCIROCCO|CORRADO|SPIDER|124 SPIDER|ALFA 4C|BRERA|GIULIA GTA)\b/, "coupe"],
  [/\b(TIGUAN|TOUAREG|T ?ROC|T ?CROSS|TAIGO|ID ?[45]|ID ?7|QASHQAI|JUKE|X ?TRAIL|KICKS|DUSTER|BIGSTER|SANDERO STEPWAY|JOGGER|CAPTUR|KADJAR|KOLEOS|AUSTRAL|ARKANA|RAFALE|SYMBIOZ|3008|2008|5008|408|C ?3 AIRCROSS|C ?5 AIRCROSS|C ?5 X|C ?4 X|C ?4|DS ?[357]|X ?[1-7]|IX ?[13]?|Q ?[2-8]|Q ?E ?TRON|E ?TRON|GL[ABCES]|ML|G ?CLASS|EQ[ABCES] SUV|SPORTAGE|SORENTO|STONIC|NIRO|XCEED|EV ?[39]|TUCSON|SANTA ?FE|KONA|BAYON|IONIQ ?[59]|VENUE|CRETA|RAV ?4|C ?HR|COROLLA CROSS|YARIS CROSS|LAND ?CRUISER|PRADO|HIGHLANDER|BZ ?4 ?X|URBAN CRUISER|CR ?V|HR ?V|ZR ?V|PILOT|KUGA|PUMA|ECOSPORT|EXPLORER|BRONCO|EDGE|EXPEDITION|MACH ?E|KAROQ|KODIAQ|KAMIQ|ENYAQ|ATECA|ARONA|TARRACO|FORMENTOR|TERRAMAR|RENEGADE|COMPASS|CHEROKEE|WRANGLER|AVENGER|XC ?\d0|EX ?\d0|EVOQUE|VELAR|DISCOVERY|DEFENDER|RANGE ?ROVER|SPORT ?HATCH|MOKKA|GRANDLAND|CROSSLAND|FRONTERA|VITARA|S ?CROSS|JIMNY|SX ?4|CX ?\d+|MX ?30|OUTLANDER|ECLIPSE CROSS|ASX|FORESTER|OUTBACK|XV|CROSSTREK|SOLTERRA|TOGG|T ?10 ?[XF]|CHERY|TIGGO|OMODA|JAECOO|BYD (?:ATTO|SEAL U|TANG|SONG)|ATTO|MG ?ZS|EHS|HS|MARVEL|TONALE|STELVIO|GRECALE|LEVANTE|CAYENNE|MACAN|BENTAYGA|CULLINAN|DBX|PUROSANGUE|MODEL ?[XY]|KONA|SUV|4X4|CROSS|EGEA CROSS|600|500X|FASTBACK|AIRCROSS)\b/, "suv"],
  [/\b(CLIO|POLO|GOLF|CORSA|FIESTA|I ?10|I ?20|I ?30|YARIS|AURIS|208|308|108|C ?1|C ?3|DS ?3|JAZZ|FABIA|SCALA|IBIZA|LEON|SWIFT|BALENO|CELERIO|MICRA|NOTE|LEAF|ASTRA|ADAM|KARL|FOCUS|UP|ID ?3|LUPO|A ?1|A ?3 ?SPORTBACK|A ?3|1 ?SERIES|116|118|120|MINI|COOPER|ONE|A ?CLASS|A ?180|A ?200|B ?CLASS|PICANTO|RIO|CEED|PRO ?CEED|SANDERO|ZOE|TWINGO|MEGANE HB|MEGANE E|500|PANDA|PUNTO|TIPO HB|EGEA HB|BRAVO|MITO|GIULIETTA|MAZDA ?2|MAZDA ?3 HB|COLT|SPACE STAR|I ?MIEV|IMPREZA|ACCENT ERA|GETZ|MATIZ|SPARK|AVEO|KALOS|CIVIC HB|CITY HB|E ?208|E ?CORSA|BYD DOLPHIN|DOLPHIN|MG ?4|ZS EV|HB|HATCHBACK|5 ?KAPI)\b/, "hatchback"],
];

/**
 * The body style for a vehicle. Never null: when nothing matches, a
 * motorcycle is a naked bike and a car is a sedan — the most common shapes in
 * the Turkish market, and neutral enough not to look wrong.
 */
export function inferBodyStyle(v: {
  vehicleType?: VehicleType | null;
  make?: string | null;
  model?: string | null;
  nickname?: string | null;
  cylinderCc?: number | null;
}): BodyStyle {
  const text = ` ${norm(`${v.make ?? ""} ${v.model ?? ""}`)} `;
  if (v.vehicleType === "car") {
    // "Egea Cross", "Clio Sport Tourer": the model's own qualifier decides.
    if (/\b(SEDAN|SALOON|LIMOUSINE)\b/.test(text)) return "sedan";
    for (const [re, style] of CAR_RULES) if (re.test(text)) return style;
    return "sedan";
  }
  for (const [re, style] of MOTO_RULES) if (re.test(text)) return style;
  // A small-displacement bike with no recognisable model name is, in Turkey,
  // overwhelmingly a scooter or a commuter — the scooter reads right for both.
  if (v.cylinderCc && v.cylinderCc <= 160) return "scooter";
  return "naked";
}

// ─── paint ───────────────────────────────────────────────────────────────────

export interface Paint {
  /** Body colour, lit side. */
  hi: string;
  /** Body colour, shadow side. */
  lo: string;
  /** Edge line; dark on light paint, light on dark paint. */
  edge: string;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function paintFor(tint: VehicleTint): Paint {
  const light = luminance(tint.from) > 0.6;
  return { hi: tint.from, lo: tint.to, edge: light ? "rgba(20,22,28,0.35)" : luminance(tint.from) < 0.25 ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.25)" };
}

// ─── drawing ─────────────────────────────────────────────────────────────────

let uid = 0;

/** A wheel: tyre, rim, spokes, hub. `spokes` 0 = car alloy (5 twin spokes). */
function wheel(id: string, cx: number, cy: number, r: number, moto: boolean): string {
  const rim = r * (moto ? 0.8 : 0.66);
  const spokes = Array.from({ length: moto ? 6 : 5 }, (_, i) => {
    const a = (i / (moto ? 6 : 5)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * rim * 0.92;
    const y = cy + Math.sin(a) * rim * 0.92;
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="url(#${id}-metal)" stroke-width="${moto ? 2.2 : r * 0.16}" stroke-linecap="round"/>`;
  }).join("");
  return `<g>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="#121317"/>
<circle cx="${cx}" cy="${cy}" r="${r - 1.2}" fill="none" stroke="#2a2c33" stroke-width="1.4"/>
<circle cx="${cx}" cy="${cy}" r="${rim}" fill="${moto ? "#1b1c21" : "#24262c"}"/>
${moto ? `<circle cx="${cx}" cy="${cy}" r="${rim}" fill="none" stroke="url(#${id}-metal)" stroke-width="2.4"/>` : `<circle cx="${cx}" cy="${cy}" r="${rim}" fill="none" stroke="url(#${id}-metal)" stroke-width="1.6"/>`}
${spokes}
${moto ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="none" stroke="#7d828c" stroke-width="1.2" opacity=".6"/>` : ""}
<circle cx="${cx}" cy="${cy}" r="${r * 0.14}" fill="url(#${id}-metal)"/>
</g>`;
}

const defs = (id: string, p: Paint) => `<defs>
<linearGradient id="${id}-paint" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${p.hi}"/><stop offset="0.55" stop-color="${p.hi}"/><stop offset="1" stop-color="${p.lo}"/>
</linearGradient>
<linearGradient id="${id}-sheen" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".22"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/>
</linearGradient>
<linearGradient id="${id}-glass" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#4a5562"/><stop offset=".5" stop-color="#1d232b"/><stop offset="1" stop-color="#0f1318"/>
</linearGradient>
<linearGradient id="${id}-metal" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#e3e6ea"/><stop offset=".5" stop-color="#8c929b"/><stop offset="1" stop-color="#c9cdd3"/>
</linearGradient>
<linearGradient id="${id}-dark" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#2b2e35"/><stop offset="1" stop-color="#121418"/>
</linearGradient>
<radialGradient id="${id}-shadow" cx=".5" cy=".5" r=".5">
  <stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
</radialGradient>
</defs>`;

const shadow = (id: string, x1: number, x2: number) =>
  `<ellipse cx="${(x1 + x2) / 2}" cy="153" rx="${(x2 - x1) / 2 + 14}" ry="7" fill="url(#${id}-shadow)"/>`;

type Draw = (id: string, p: Paint) => string;

// Cars — wheels r=23 at y=129.
const CAR_WHEEL_Y = 129;

const car = (body: string, glass: string, extras: string, w1: number, w2: number, r = 23): Draw => (id, p) =>
  `${shadow(id, w1 - 40, w2 + 40)}
${well(w1)}${well(w2)}
<path d="${body}" fill="url(#${id}-paint)" stroke="${p.edge}" stroke-width="1"/>
<path d="${body}" fill="url(#${id}-sheen)"/>
<path d="${glass}" fill="url(#${id}-glass)"/>
${extras}
${wheel(id, w1, CAR_WHEEL_Y, r, false)}${wheel(id, w2, CAR_WHEEL_Y, r, false)}`;

/** The dark wheel well seen through the arch cut-out. */
const well = (x: number, r = 27) => `<path d="M ${x - r} 128 A ${r} ${r} 0 0 1 ${x + r} 128 Z" fill="#0c0d10"/>`;
const arch = (x: number, r = 27) => `L ${x + r} 128 A ${r} ${r} 0 0 0 ${x - r} 128`;

const DRAW: Record<BodyStyle, Draw> = {
  sedan: car(
    `M 20 124 L 20 104 Q 21 92 36 89 L 92 84 Q 120 58 154 54 L 198 54 Q 214 55 228 68 L 244 82 Q 288 86 298 94 Q 304 102 303 116 L 300 128 ${arch(250)} L 108 128 ${arch(80)} L 28 128 Q 20 128 20 124 Z`,
    `M 102 83 Q 126 62 156 59 L 166 59 L 166 83 Z M 171 59 L 198 59 Q 210 60 220 70 L 230 82 L 171 83 Z`,
    `<path d="M 26 98 L 36 96 L 36 104 L 24 106 Z" fill="#b3261e"/>
<path d="M 284 90 Q 296 92 299 99 L 284 99 Z" fill="#f1f3f5" opacity=".9"/>
<path d="M 30 108 L 296 108" stroke="rgba(0,0,0,.18)" stroke-width="1.2"/>
<path d="M 168 84 L 168 126 M 108 86 L 108 124" stroke="rgba(0,0,0,.2)" stroke-width="1"/>
<path d="M 226 80 l 8 -3 l 2 6 l -9 1 Z" fill="url(#${0}-dark)"/>`,
    80,
    250,
  ),
  hatchback: car(
    `M 48 124 L 46 100 Q 46 86 56 76 Q 72 60 104 56 L 182 54 Q 198 55 212 68 L 230 82 Q 276 86 288 94 Q 294 102 293 116 L 290 128 ${arch(244)} L 124 128 ${arch(98)} L 56 128 Q 48 128 48 124 Z`,
    `M 64 78 Q 76 64 102 61 L 120 60 L 120 83 L 60 85 Z M 125 60 L 160 59 L 160 83 L 125 83 Z M 165 59 L 182 59 Q 196 60 206 70 L 216 82 L 165 83 Z`,
    `<path d="M 47 90 L 55 88 L 55 100 L 46 101 Z" fill="#b3261e"/>
<path d="M 274 90 Q 286 92 289 99 L 274 99 Z" fill="#f1f3f5" opacity=".9"/>
<path d="M 52 106 L 286 106" stroke="rgba(0,0,0,.18)" stroke-width="1.2"/>
<path d="M 162 84 L 162 126 M 122 84 L 122 124" stroke="rgba(0,0,0,.2)" stroke-width="1"/>`,
    98,
    244,
  ),
  suv: car(
    `M 22 122 L 22 92 Q 22 78 32 66 Q 44 50 74 46 L 186 44 Q 204 45 216 58 L 234 76 Q 284 80 296 88 Q 304 96 303 112 L 300 126 ${arch(250, 29)} L 110 126 ${arch(78, 29)} L 30 126 Q 22 126 22 122 Z`,
    `M 40 70 Q 50 54 74 51 L 108 50 L 108 76 L 36 78 Z M 113 50 L 160 49 L 160 76 L 113 76 Z M 165 49 L 186 49 Q 200 50 210 60 L 222 75 L 165 76 Z`,
    `<path d="M 22 82 L 32 80 L 32 94 L 22 95 Z" fill="#b3261e"/>
<path d="M 282 84 Q 296 86 300 94 L 282 94 Z" fill="#f1f3f5" opacity=".9"/>
<path d="M 30 100 L 298 100" stroke="rgba(0,0,0,.18)" stroke-width="1.2"/>
<path d="M 24 116 L 300 116 L 300 126 L 24 126 Z" fill="#1d2025" opacity=".75"/>
<path d="M 60 44 L 190 42" stroke="#2a2d33" stroke-width="3" stroke-linecap="round"/>
<path d="M 162 77 L 162 120 M 110 77 L 110 118" stroke="rgba(0,0,0,.2)" stroke-width="1"/>`,
    78,
    250,
    25,
  ),
  pickup: car(
    `M 14 122 L 14 82 L 128 82 L 132 62 Q 136 48 152 46 L 206 46 Q 220 47 230 60 L 244 78 Q 290 82 302 90 Q 308 98 307 112 L 304 126 ${arch(256, 29)} L 108 126 ${arch(74, 29)} L 22 126 Q 14 126 14 122 Z`,
    `M 140 76 L 142 60 Q 145 52 156 51 L 180 51 L 180 76 Z M 185 51 L 206 51 Q 216 52 224 62 L 234 76 L 185 76 Z`,
    `<path d="M 14 84 L 22 84 L 22 98 L 14 98 Z" fill="#b3261e"/>
<path d="M 288 86 Q 300 88 304 96 L 288 96 Z" fill="#f1f3f5" opacity=".9"/>
<path d="M 20 82 L 126 82" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
<path d="M 14 116 L 306 116 L 306 126 L 14 126 Z" fill="#1d2025" opacity=".75"/>
<path d="M 182 77 L 182 118 M 132 82 L 132 118" stroke="rgba(0,0,0,.2)" stroke-width="1"/>`,
    74,
    256,
    25,
  ),
  van: car(
    `M 18 124 L 18 52 Q 18 38 32 36 L 214 34 Q 230 35 240 50 L 262 78 Q 292 82 300 92 Q 305 100 304 114 L 301 128 ${arch(254)} L 102 128 ${arch(72)} L 26 128 Q 18 128 18 124 Z`,
    `M 32 46 L 92 44 L 92 72 L 32 74 Z M 98 44 L 168 42 L 168 72 L 98 72 Z M 174 42 L 212 41 Q 224 42 232 54 L 246 74 L 174 74 Z`,
    `<path d="M 18 82 L 26 82 L 26 100 L 18 100 Z" fill="#b3261e"/>
<path d="M 286 88 Q 298 90 301 98 L 286 98 Z" fill="#f1f3f5" opacity=".9"/>
<path d="M 24 102 L 298 102" stroke="rgba(0,0,0,.18)" stroke-width="1.2"/>
<path d="M 170 76 L 170 126 M 96 74 L 96 124" stroke="rgba(0,0,0,.2)" stroke-width="1"/>
<path d="M 100 92 L 166 92" stroke="rgba(0,0,0,.25)" stroke-width="1.2"/>`,
    72,
    254,
  ),
  coupe: car(
    `M 18 124 L 18 106 Q 19 96 34 92 L 104 86 Q 134 60 166 58 L 190 58 Q 210 60 230 74 L 246 84 Q 292 88 302 96 Q 307 104 305 116 L 302 128 ${arch(252)} L 108 128 ${arch(78)} L 26 128 Q 18 128 18 124 Z`,
    `M 116 85 Q 138 66 166 63 L 190 63 Q 204 64 216 72 L 226 84 Z`,
    `<path d="M 22 100 L 36 98 L 36 104 L 21 106 Z" fill="#b3261e"/>
<path d="M 286 92 Q 300 94 303 100 L 286 100 Z" fill="#f1f3f5" opacity=".9"/>
<path d="M 28 110 L 298 110" stroke="rgba(0,0,0,.18)" stroke-width="1.2"/>
<path d="M 18 96 L 40 92 L 40 95 L 18 99 Z" fill="#202329"/>
<path d="M 176 86 L 176 126" stroke="rgba(0,0,0,.2)" stroke-width="1"/>`,
    78,
    252,
  ),

  // Motorcycles — 320×160, wheels at y=124.
  sport: (id, p) => `${shadow(id, 50, 274)}
<path d="M 82 124 L 168 108" stroke="url(#${id}-dark)" stroke-width="9" stroke-linecap="round"/>
<path d="M 92 84 L 150 90 L 152 106 L 118 104 Q 100 96 92 84 Z" fill="url(#${id}-dark)"/>
<path d="M 58 104 Q 80 84 104 100" stroke="#1d1f24" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M 232 66 L 248 124" stroke="url(#${id}-metal)" stroke-width="6" stroke-linecap="round"/>
<path d="M 150 92 L 200 92 L 206 116 Q 190 124 160 120 Q 146 108 150 92 Z" fill="url(#${id}-dark)"/>
<path d="M 100 108 L 146 112 L 144 120 L 100 116 Z" fill="url(#${id}-metal)"/>
<path d="M 62 60 L 120 72 L 142 74 L 136 86 L 98 84 Q 80 78 62 60 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>
<path d="M 104 74 L 144 76 L 140 82 L 104 80 Z" fill="#1a1c21"/>
<path d="M 138 74 Q 160 60 196 62 L 206 82 Q 176 92 140 88 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>
<path d="M 196 62 L 232 44 Q 262 48 274 72 Q 280 92 264 106 L 226 114 Q 200 116 186 104 L 182 90 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>
<path d="M 214 54 L 234 44 Q 248 46 254 52 L 226 62 Z" fill="url(#${id}-glass)"/>
<path d="M 252 74 Q 266 72 272 80 L 254 84 Z" fill="#f1f3f5" opacity=".9"/>
<path d="M 196 90 Q 228 82 262 92" stroke="rgba(255,255,255,.25)" stroke-width="2" fill="none"/>
<path d="M 138 74 Q 160 60 196 62 L 232 44 Q 262 48 274 72" stroke="rgba(255,255,255,.3)" stroke-width="1.5" fill="none"/>
${wheel(id, 80, 124, 29, true)}${wheel(id, 248, 124, 29, true)}
<path d="M 222 112 Q 248 86 274 112" stroke="url(#${id}-paint)" stroke-width="5" fill="none"/>`,

  naked: (id, p) => `${shadow(id, 50, 274)}
<path d="M 82 124 L 164 108" stroke="url(#${id}-dark)" stroke-width="8" stroke-linecap="round"/>
<path d="M 92 84 L 150 90 L 152 106 L 118 104 Q 100 96 92 84 Z" fill="url(#${id}-dark)"/>
<path d="M 58 104 Q 80 84 104 100" stroke="#1d1f24" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M 222 56 L 248 124" stroke="url(#${id}-metal)" stroke-width="6" stroke-linecap="round"/>
<path d="M 146 84 L 200 86 L 208 114 Q 190 124 160 120 Q 140 104 146 84 Z" fill="url(#${id}-dark)"/>
<path d="M 160 92 L 196 94 M 158 102 L 200 104" stroke="#3a3e46" stroke-width="2"/>
<path d="M 186 110 Q 160 128 112 118 L 110 112 Q 150 116 180 104 Z" fill="url(#${id}-metal)"/>
<path d="M 70 66 L 116 74 L 142 76 L 138 86 L 100 84 Q 82 78 70 66 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>
<path d="M 104 74 L 146 76 L 142 82 L 104 80 Z" fill="#1a1c21"/>
<path d="M 136 76 Q 150 56 186 56 Q 208 58 214 74 L 206 88 Q 176 94 138 88 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>
<path d="M 150 64 Q 176 58 204 64" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none"/>
<path d="M 200 50 L 222 46 L 230 50" stroke="#24262c" stroke-width="4" stroke-linecap="round" fill="none"/>
<circle cx="236" cy="70" r="10" fill="url(#${id}-dark)"/><circle cx="238" cy="70" r="7" fill="#f1f3f5" opacity=".9"/>
${wheel(id, 80, 124, 29, true)}${wheel(id, 248, 124, 29, true)}
<path d="M 226 104 Q 248 92 268 102" stroke="url(#${id}-paint)" stroke-width="5" fill="none"/>`,

  adventure: (id, p) => `${shadow(id, 46, 278)}
<path d="M 80 122 L 164 104" stroke="url(#${id}-dark)" stroke-width="9" stroke-linecap="round"/>
<path d="M 92 84 L 150 90 L 152 106 L 118 104 Q 100 96 92 84 Z" fill="url(#${id}-dark)"/>
<path d="M 58 104 Q 80 84 104 100" stroke="#1d1f24" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M 224 50 L 250 122" stroke="url(#${id}-metal)" stroke-width="7" stroke-linecap="round"/>
<path d="M 144 82 L 204 84 L 210 112 Q 190 122 158 118 Q 140 102 144 82 Z" fill="url(#${id}-dark)"/>
<path d="M 46 70 L 96 70 L 96 104 L 46 104 Q 40 104 40 98 L 40 76 Q 40 70 46 70 Z" fill="#2b2e35"/>
<path d="M 46 76 L 90 76" stroke="url(#${id}-metal)" stroke-width="2"/>
<path d="M 66 60 L 120 64 L 146 66 L 140 80 L 98 78 Q 80 72 66 60 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>
<path d="M 100 62 L 150 64 L 146 72 L 100 70 Z" fill="#1a1c21"/>
<path d="M 140 66 Q 158 46 192 46 Q 214 48 222 62 L 214 86 Q 180 92 142 84 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>
<path d="M 210 58 L 236 30 L 246 34 L 230 62 Z" fill="url(#${id}-glass)"/>
<path d="M 218 62 L 250 60 Q 262 70 258 82 L 232 84 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>
<path d="M 246 66 L 258 68 L 256 76 L 244 76 Z" fill="#f1f3f5" opacity=".9"/>
<path d="M 156 54 Q 180 48 208 56" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none"/>
${wheel(id, 78, 122, 31, true)}${wheel(id, 250, 122, 32, true)}
<path d="M 236 82 Q 250 74 266 84" stroke="url(#${id}-paint)" stroke-width="5" fill="none"/>`,

  cruiser: (id, p) => `${shadow(id, 40, 290)}
<path d="M 72 126 L 150 112" stroke="url(#${id}-dark)" stroke-width="7" stroke-linecap="round"/>
<path d="M 210 56 L 258 126" stroke="url(#${id}-metal)" stroke-width="6" stroke-linecap="round"/>
<path d="M 138 104 Q 136 94 146 92 L 196 92 Q 206 94 204 106 L 198 122 L 144 122 Z" fill="url(#${id}-dark)"/>
<g fill="url(#${id}-metal)" stroke="#5d626b" stroke-width=".8">
  <rect x="-9" y="-16" width="18" height="30" rx="5" transform="translate(156 92) rotate(-24)"/>
  <rect x="-9" y="-16" width="18" height="30" rx="5" transform="translate(186 92) rotate(24)"/>
</g>
<path d="M 148 84 L 164 84 M 176 84 L 194 84" stroke="#5d626b" stroke-width="1.2"/>
<path d="M 172 118 Q 130 134 60 128 L 60 121 Q 124 126 166 110 Z" fill="url(#${id}-metal)"/>
<path d="M 40 112 Q 50 88 86 90 Q 106 92 112 108 L 104 112 Q 96 98 76 98 Q 56 100 48 114 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>
<path d="M 80 92 Q 100 84 132 86 L 134 98 L 88 100 Z" fill="#1a1c21"/>
<path d="M 128 88 Q 136 64 172 62 Q 202 62 210 76 Q 196 88 160 90 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>
<path d="M 142 70 Q 170 62 200 68" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none"/>
<path d="M 192 50 Q 208 42 222 52" stroke="url(#${id}-metal)" stroke-width="4" stroke-linecap="round" fill="none"/>
<circle cx="230" cy="78" r="11" fill="url(#${id}-metal)"/><circle cx="232" cy="78" r="8" fill="#f1f3f5" opacity=".9"/>
${wheel(id, 72, 126, 27, true)}${wheel(id, 258, 126, 27, true)}
<path d="M 232 112 Q 258 90 284 112 L 280 114 Q 258 98 236 114 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>`,

  scooter: (id, p) => `${shadow(id, 66, 260)}
<path d="M 98 134 L 150 122" stroke="url(#${id}-dark)" stroke-width="10" stroke-linecap="round"/>
<path d="M 214 72 L 234 132" stroke="url(#${id}-metal)" stroke-width="5" stroke-linecap="round"/>
<path d="M 140 116 L 204 116 L 208 126 L 136 126 Z" fill="#24262c"/>
<path d="M 58 100 Q 62 76 98 72 L 150 70 Q 168 72 170 90 L 164 114 Q 158 126 140 126 L 104 126 Q 70 124 58 100 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>
<path d="M 82 72 Q 104 58 158 62 Q 170 64 168 74 L 86 78 Z" fill="#1a1c21"/>
<path d="M 72 90 Q 110 80 160 86" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none"/>
<path d="M 192 122 Q 188 90 198 66 Q 206 50 220 50 L 228 60 Q 216 86 218 112 Q 214 126 202 126 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>
<path d="M 208 54 L 216 28 L 226 30 L 224 52 Z" fill="url(#${id}-glass)"/>
<path d="M 200 48 L 230 44" stroke="#24262c" stroke-width="4" stroke-linecap="round"/>
<path d="M 224 62 L 234 64 L 232 74 L 222 72 Z" fill="#f1f3f5" opacity=".9"/>
<path d="M 58 92 L 66 90 L 66 100 L 59 101 Z" fill="#b3261e"/>
${wheel(id, 98, 134, 19, false)}${wheel(id, 234, 134, 19, false)}
<path d="M 214 126 Q 234 106 254 126 L 250 127 Q 234 112 218 127 Z" fill="url(#${id}-paint)" stroke="${p.edge}"/>`,
};

/** The full SVG for a vehicle — a standalone document, usable as an <img> src. */
export function vehicleArtSvg(style: BodyStyle, paint: Paint): string {
  const id = `va${(uid = (uid + 1) % 1e6)}`;
  // The sedan's mirror references the dark gradient by a placeholder id.
  const body = DRAW[style](id, paint).replace(/url\(#0-dark\)/g, `url(#${id}-dark)`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160">${defs(id, paint)}${body}</svg>`;
}

export function vehicleArtFor(v: {
  id?: string | null;
  vehicleType?: VehicleType | null;
  make?: string | null;
  model?: string | null;
  nickname?: string | null;
  color?: string | null;
  cylinderCc?: number | null;
}): { style: BodyStyle; svg: string } {
  const style = inferBodyStyle(v);
  // No recorded colour: silver, the most common one on the road — the neutral
  // identity tints are too dark to read as paint on a dark backdrop.
  const paint = v.color?.trim() ? paintFor(vehicleTint(v)) : { hi: "#C9CED5", lo: "#868D97", edge: "rgba(20,22,28,0.35)" };
  return { style, svg: vehicleArtSvg(style, paint) };
}
