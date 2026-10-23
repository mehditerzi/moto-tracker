import type { ReactNode } from "react";

/**
 * Dashboard warning lights — what each one means and what to do about it.
 *
 * Colour carries the urgency the way every manufacturer uses it:
 *   red    stop as soon as it is safe; driving on can cause damage or danger
 *   amber  have it checked soon; usually safe to continue carefully
 *   green / blue  information only — a system is on
 *
 * The symbols are drawn after the ISO 2575 originals, simplified so they stay
 * legible at 40px. Text lives here rather than in the locale files because it
 * is long-form reference content, not interface copy.
 */
export type LightColor = "red" | "amber" | "green" | "blue";

interface Copy {
  name: string;
  meaning: string;
  action: string;
}

export interface WarningLight {
  id: string;
  color: LightColor;
  /** Words people actually type when looking for it. */
  keywords: string;
  icon: ReactNode;
  tr: Copy;
  en: Copy;
}

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The brake / ABS family's shared frame: a circle in parentheses. */
function Bracketed({ children }: { children: ReactNode }) {
  return (
    <>
      <circle cx="12" cy="12" r="6.5" {...s} />
      <path d="M4.2 6.5a9 9 0 0 0 0 11M19.8 6.5a9 9 0 0 1 0 11" {...s} />
      {children}
    </>
  );
}

function Text({ children, size = 5.2 }: { children: string; size?: number }) {
  return (
    <text x="12" y="12" textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={700} fill="currentColor" fontFamily="system-ui, sans-serif">
      {children}
    </text>
  );
}

export const WARNING_LIGHTS: WarningLight[] = [
  // ─── red ────────────────────────────────────────────────────────────────────
  {
    id: "oil-pressure",
    color: "red",
    keywords: "yağ basıncı yağdanlık oil pressure can",
    icon: (
      <>
        <path d="M3 10h4l2-2h6l5-2-3 6h-2v4H7v-4H3z" {...s} />
        <path d="M20.5 14.5c0 .9-.6 1.5-1.2 1.5s-1.2-.6-1.2-1.5.6-1.8 1.2-2.6c.6.8 1.2 1.7 1.2 2.6z" {...s} />
      </>
    ),
    tr: {
      name: "Motor yağ basıncı",
      meaning: "Motor yağ basıncı çok düştü. Yağ az olabilir ya da yağ pompası çalışmıyor olabilir; motor yağsız kalıyor.",
      action: "Hemen güvenli bir yerde dur ve motoru kapat. Yağ seviyesini kontrol et. Lamba yağ ekledikten sonra da sönmüyorsa aracı çalıştırma, çekici çağır.",
    },
    en: {
      name: "Oil pressure",
      meaning: "Engine oil pressure is critically low — the oil level may be low or the pump has failed, and the engine is running without lubrication.",
      action: "Stop safely and switch the engine off immediately. Check the oil level. If the light stays on after topping up, do not restart — call for a tow.",
    },
  },
  {
    id: "coolant-temp",
    color: "red",
    keywords: "hararet motor sıcaklığı termometre soğutma suyu coolant temperature overheating",
    icon: (
      <>
        <path d="M12 3v10" {...s} />
        <circle cx="12" cy="15" r="2.2" {...s} />
        <path d="M12 6h3M12 9h3" {...s} />
        <path d="M4 19c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0 2.7-1 4 0" {...s} />
      </>
    ),
    tr: {
      name: "Motor hararet (sıcaklık)",
      meaning: "Motor aşırı ısınıyor. Soğutma suyu eksik, fan veya termostat arızalı olabilir.",
      action: "Güvenli yerde dur, motoru kapat. Motor soğumadan radyatör kapağını ASLA açma — basınçlı sıcak su yakar. Soğuyunca suyu kontrol et; tekrar yanarsa servise götür.",
    },
    en: {
      name: "Engine temperature",
      meaning: "The engine is overheating — low coolant, or a failed fan or thermostat.",
      action: "Stop safely and switch off. NEVER open the radiator cap while hot — pressurised coolant burns. Once cool, check the coolant; if it comes back, get it to a garage.",
    },
  },
  {
    id: "battery",
    color: "red",
    keywords: "akü şarj alternatör battery charging alternator",
    icon: (
      <>
        <rect x="3" y="7" width="18" height="12" rx="1.5" {...s} />
        <path d="M6.5 7V5.5h3V7M14.5 7V5.5h3V7M6.5 13h3.5M14 13h3.5M15.75 11.25v3.5" {...s} />
      </>
    ),
    tr: {
      name: "Akü / şarj sistemi",
      meaning: "Akü şarj olmuyor. Genelde alternatör, kayış veya bağlantı sorunudur; araç yalnızca akünün kalan gücüyle gidiyor.",
      action: "Klima, radyo gibi elektrik tüketen her şeyi kapat ve en yakın servise git. Motoru kapatırsan tekrar çalışmayabilir.",
    },
    en: {
      name: "Battery / charging",
      meaning: "The battery isn't charging — usually the alternator, drive belt or a connection. The car is running on what's left in the battery.",
      action: "Switch off A/C, radio and other loads and drive straight to a garage. If you switch off, it may not restart.",
    },
  },
  {
    id: "brake",
    color: "red",
    keywords: "fren el freni brake handbrake fluid",
    icon: (
      <Bracketed>
        <Text size={8}>!</Text>
      </Bracketed>
    ),
    tr: {
      name: "Fren sistemi / el freni",
      meaning: "El freni çekili, fren hidroliği azalmış ya da fren sisteminde arıza var.",
      action: "Önce el frenini kontrol et. El freni inikken yanıyorsa dikkatle dur, fren hidroliğini kontrol et. Fren pedalı yumuşaksa aracı kullanma.",
    },
    en: {
      name: "Brake system / handbrake",
      meaning: "The handbrake is on, brake fluid is low, or there's a fault in the brake system.",
      action: "Check the handbrake first. If it's lit with the handbrake off, stop carefully and check the brake fluid. If the pedal feels soft, don't drive.",
    },
  },
  {
    id: "airbag",
    color: "red",
    keywords: "hava yastığı airbag srs",
    icon: (
      <>
        <circle cx="8" cy="5" r="1.8" {...s} />
        <path d="M8 8v5h4l2 6M6 9l-1 5h4" {...s} />
        <circle cx="16.5" cy="10" r="3.5" {...s} />
      </>
    ),
    tr: {
      name: "Hava yastığı (SRS)",
      meaning: "Hava yastığı sisteminde arıza var; bir kaza anında hava yastıkları açılmayabilir.",
      action: "Araç sürülebilir ama koruma eksik. En kısa sürede yetkili servise kontrol ettir.",
    },
    en: {
      name: "Airbag (SRS)",
      meaning: "There's a fault in the airbag system — the airbags may not deploy in a crash.",
      action: "The car is drivable but you're not fully protected. Have it checked at a dealer soon.",
    },
  },
  {
    id: "seatbelt",
    color: "red",
    keywords: "emniyet kemeri seat belt",
    icon: (
      <>
        <circle cx="12" cy="4.5" r="1.8" {...s} />
        <path d="M8 21v-7l1-5h6l1 5v7M9 9l7 8" {...s} />
      </>
    ),
    tr: {
      name: "Emniyet kemeri",
      meaning: "Sürücü veya bir yolcunun emniyet kemeri takılı değil.",
      action: "Herkesin kemerini taktığından emin ol. Arka koltukta kemer takmamak da ceza sebebidir.",
    },
    en: {
      name: "Seat belt",
      meaning: "The driver or a passenger isn't wearing a seat belt.",
      action: "Make sure everyone is buckled up — rear passengers included.",
    },
  },
  {
    id: "power-steering",
    color: "red",
    keywords: "direksiyon eps hidrolik power steering",
    icon: (
      <>
        <circle cx="12" cy="12" r="6" {...s} />
        <circle cx="12" cy="12" r="1.6" {...s} />
        <path d="M6.5 11h4M13.5 11h4M12 13.6V18" {...s} />
        <path d="M19.5 4.5l1 2M4.5 4.5l-1 2" {...s} />
      </>
    ),
    tr: {
      name: "Direksiyon (EPS) arızası",
      meaning: "Elektrikli/hidrolik direksiyon desteği devre dışı. Direksiyon çok ağırlaşabilir.",
      action: "Yavaşla ve dikkatle güvenli bir yere çek. Aracı yeniden çalıştırmak bazen düzeltir; düzelmezse servise git.",
    },
    en: {
      name: "Power steering",
      meaning: "Power steering assistance has failed — steering can become very heavy.",
      action: "Slow down and pull over carefully. Restarting sometimes clears it; if not, get it to a garage.",
    },
  },
  // ─── amber ──────────────────────────────────────────────────────────────────
  {
    id: "check-engine",
    color: "amber",
    keywords: "motor arıza lambası check engine mil emisyon",
    icon: <path d="M4 10h2V8h3V6h6v2h2l2 2h1v5h-1l-2 2H9l-2-2H6v-2H4z M20 11v3" {...s} />,
    tr: {
      name: "Motor arıza lambası",
      meaning: "Motor yönetim veya emisyon sisteminde bir hata kaydedildi. Gevşek yakıt kapağından ateşleme sorununa kadar pek çok sebebi olabilir.",
      action: "Sabit yanıyorsa birkaç gün içinde serviste arıza tespiti (OBD) yaptır. YANIP SÖNÜYORSA ciddi ateşleme hatası vardır: hızlanma, en kısa sürede dur.",
    },
    en: {
      name: "Check engine",
      meaning: "The engine management or emissions system logged a fault — anything from a loose fuel cap to a misfire.",
      action: "Steady: get the code read (OBD) within a few days. FLASHING means a serious misfire: don't accelerate hard and stop as soon as you can.",
    },
  },
  {
    id: "abs",
    color: "amber",
    keywords: "abs kilitlenme önleyici fren anti-lock",
    icon: (
      <Bracketed>
        <Text>ABS</Text>
      </Bracketed>
    ),
    tr: {
      name: "ABS arızası",
      meaning: "Kilitlenme önleyici fren sistemi devre dışı. Normal fren çalışır ama sert frende tekerlekler kilitlenebilir.",
      action: "Takip mesafesini artır, ani frenden kaçın ve servise kontrol ettir. Kırmızı fren lambası da yanıyorsa aracı kullanma.",
    },
    en: {
      name: "ABS fault",
      meaning: "Anti-lock braking is off. Normal brakes still work, but wheels can lock under hard braking.",
      action: "Leave more distance, avoid hard braking and have it checked. If the red brake light is on too, don't drive.",
    },
  },
  {
    id: "tpms",
    color: "amber",
    keywords: "lastik basıncı tpms hava tire pressure",
    icon: (
      <>
        <path d="M6 6.5C4.5 8 4 10 4 12s.5 4 2 5.5M18 6.5c1.5 1.5 2 3.5 2 5.5s-.5 4-2 5.5M6 17.5h12M6 6.5h12" {...s} />
        <path d="M12 9v3.5" {...s} />
        <circle cx="12" cy="14.7" r=".4" fill="currentColor" />
      </>
    ),
    tr: {
      name: "Lastik basıncı (TPMS)",
      meaning: "Bir veya daha fazla lastiğin havası düşük. Yanıp sönüyorsa sensör arızası olabilir.",
      action: "Yavaşla, ilk fırsatta lastikleri kontrol edip önerilen basınca şişir (kapı direğindeki etikette yazar). Lastik patlaksa yedek lastiğe geç.",
    },
    en: {
      name: "Tyre pressure (TPMS)",
      meaning: "One or more tyres are under-inflated. Flashing usually means a sensor fault.",
      action: "Slow down, check the tyres at the first chance and inflate to spec (door-pillar sticker). Fit the spare if one is flat.",
    },
  },
  {
    id: "esp",
    color: "amber",
    keywords: "esp esc traksiyon kayma denge stability traction control",
    icon: (
      <>
        <path d="M6 11l1.5-3.5h9L18 11v4H6z M6 15v1.5M18 15v1.5" {...s} />
        <path d="M5 20c1.5-1.2 2.5 1.2 4 0M11 20c1.5-1.2 2.5 1.2 4 0" {...s} />
      </>
    ),
    tr: {
      name: "ESP / çekiş kontrolü",
      meaning: "Yanıp sönüyorsa sistem şu an kaymayı önlemek için çalışıyor. Sabit yanıyorsa sistem kapalı ya da arızalı.",
      action: "Yanıp sönerken gazı azalt ve dikkatli sür. Sabit yanıyorsa ESP düğmesini kontrol et; kapanmıyorsa servise götür.",
    },
    en: {
      name: "ESP / traction control",
      meaning: "Flashing: the system is actively preventing a skid. Steady: it's switched off or faulty.",
      action: "When it flashes, ease off the throttle. If steady, check the ESP button; if it won't clear, have it checked.",
    },
  },
  {
    id: "glow-plug",
    color: "amber",
    keywords: "kızdırma bujisi ön ısıtma dizel glow plug diesel",
    icon: <path d="M4 10c1.5 0 1.5 4 3 4s1.5-4 3-4 1.5 4 3 4 1.5-4 3-4 1.5 4 3 4M4 8v8M20 8v8" {...s} />,
    tr: {
      name: "Kızdırma bujisi (dizel)",
      meaning: "Dizel motor soğukken ön ısıtma yapılıyor. Kontak açılınca kısa süre yanıp sönmesi normaldir.",
      action: "Lamba sönene kadar bekle, sonra çalıştır. Sürüş sırasında yanıyor ya da yanıp sönüyorsa motor elektroniğinde hata vardır; servise git.",
    },
    en: {
      name: "Glow plug (diesel)",
      meaning: "A cold diesel is pre-heating. Briefly lit at ignition is normal.",
      action: "Wait for it to go out, then start. If it lights or flashes while driving, there's an engine-electronics fault — see a garage.",
    },
  },
  {
    id: "dpf",
    color: "amber",
    keywords: "dpf partikül filtresi dizel particulate filter",
    icon: (
      <>
        <rect x="4" y="7" width="16" height="10" rx="2" {...s} />
        <path d="M7 10h.01M10 12h.01M13 10h.01M16 12h.01M8 14h.01M14 14h.01" {...s} strokeWidth={2.4} />
      </>
    ),
    tr: {
      name: "Dizel partikül filtresi (DPF)",
      meaning: "Partikül filtresi doldu, kendini temizleyemiyor. Genelde hep kısa mesafe şehir içi sürüşte olur.",
      action: "Uygun bir yolda 15-20 dakika 2.500 devir civarında, sabit hızla sür; filtre yanarak temizlenir. Sönmezse servise götür — tıkanırsa pahalıya patlar.",
    },
    en: {
      name: "Diesel particulate filter (DPF)",
      meaning: "The DPF is full and can't regenerate — typical of short city trips.",
      action: "Drive 15–20 minutes at a steady ~2,500 rpm on an open road so it burns clean. If it stays on, see a garage before it clogs.",
    },
  },
  {
    id: "fuel-low",
    color: "amber",
    keywords: "yakıt az benzin mazot düşük fuel low",
    icon: (
      <>
        <path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V20M4 20h11M5 10h9" {...s} />
        <path d="M14 8l3 2v6.5a1.5 1.5 0 0 0 3 0V9l-2-2" {...s} />
      </>
    ),
    tr: {
      name: "Yakıt azaldı",
      meaning: "Yakıt rezerv seviyesinde; çoğu araçta 40-80 km yol kalmıştır.",
      action: "En yakın istasyona git. Yakıtı sürekli dibine kadar bitirmek yakıt pompasına zarar verir.",
    },
    en: {
      name: "Low fuel",
      meaning: "You're on reserve — usually 40–80 km left.",
      action: "Head to the nearest station. Running the tank dry regularly can damage the fuel pump.",
    },
  },
  {
    id: "brake-pads",
    color: "amber",
    keywords: "fren balatası aşınma brake pad wear",
    icon: (
      <>
        <circle cx="12" cy="12" r="6" {...s} />
        <path d="M4.2 6.5a9 9 0 0 0 0 11M19.8 6.5a9 9 0 0 1 0 11" {...s} strokeDasharray="2 2" />
      </>
    ),
    tr: {
      name: "Fren balatası aşındı",
      meaning: "Balata aşınma sensörü değişim zamanının geldiğini bildiriyor.",
      action: "Birkaç hafta içinde balataları değiştir. Gecikirsen diskler de zarar görür ve masraf ikiye katlanır.",
    },
    en: {
      name: "Brake pad wear",
      meaning: "The wear sensor says the pads are due for replacement.",
      action: "Replace them within a few weeks — leave it and the discs go too, doubling the bill.",
    },
  },
  {
    id: "adblue",
    color: "amber",
    keywords: "adblue def üre dizel",
    icon: (
      <>
        <path d="M6 20V8l3-4h6l3 4v12z" {...s} />
        <path d="M12 10c1.5 2 2.2 3 2.2 4a2.2 2.2 0 0 1-4.4 0c0-1 .7-2 2.2-4z" {...s} />
      </>
    ),
    tr: {
      name: "AdBlue seviyesi",
      meaning: "AdBlue (dizel egzoz sıvısı) azaldı. Tamamen biterse araç yeniden çalışmayabilir.",
      action: "Akaryakıt istasyonundan AdBlue alıp depoya ekle. Göstergedeki kalan km'ye dikkat et.",
    },
    en: {
      name: "AdBlue level",
      meaning: "Diesel exhaust fluid is low. If it runs out, the engine may not restart.",
      action: "Buy AdBlue at a fuel station and top up. Watch the remaining-range warning.",
    },
  },
  {
    id: "washer",
    color: "amber",
    keywords: "cam suyu silecek washer fluid",
    icon: (
      <>
        <path d="M4 15a12 6 0 0 1 16 0" {...s} />
        <path d="M12 15l3-7M8 6l1 2M12 4v2M16 6l-1 2" {...s} />
      </>
    ),
    tr: {
      name: "Cam suyu azaldı",
      meaning: "Silecek suyu deposu boşalmak üzere.",
      action: "Cam suyunu tamamla. Kışın antifrizli cam suyu kullan, donmasın.",
    },
    en: {
      name: "Washer fluid low",
      meaning: "The screen-wash reservoir is nearly empty.",
      action: "Top it up — use a winter mix in cold weather so it doesn't freeze.",
    },
  },
  {
    id: "bulb",
    color: "amber",
    keywords: "ampul lamba far arızası bulb failure light",
    icon: (
      <>
        <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" {...s} />
        <path d="M12 6.5v4" {...s} />
        <circle cx="12" cy="12.6" r=".4" fill="currentColor" />
      </>
    ),
    tr: {
      name: "Ampul arızası",
      meaning: "Farlardan, stop veya sinyal lambalarından biri yanmıyor.",
      action: "Hangi lambanın yanmadığını kontrol edip değiştir. Yanmayan stop lambası hem tehlikeli hem cezalıdır.",
    },
    en: {
      name: "Bulb failure",
      meaning: "A headlight, brake light or indicator bulb is out.",
      action: "Find which one and replace it — a dead brake light is dangerous and fineable.",
    },
  },
  {
    id: "door",
    color: "red",
    keywords: "kapı açık bagaj kaput door open",
    icon: (
      <>
        <path d="M5 13l2.5-5.5h9L19 13v4H5z M5 17v1.5M19 17v1.5" {...s} />
        <path d="M19 9l2.5-2" {...s} />
      </>
    ),
    tr: {
      name: "Kapı / bagaj açık",
      meaning: "Kapılardan biri, bagaj veya kaput tam kapanmamış.",
      action: "Hareket etmeden önce bütün kapıları ve bagajı kontrol et.",
    },
    en: {
      name: "Door / boot open",
      meaning: "A door, the boot or the bonnet isn't fully closed.",
      action: "Check every door and the boot before moving off.",
    },
  },
  // ─── green / blue ───────────────────────────────────────────────────────────
  {
    id: "high-beam",
    color: "blue",
    keywords: "uzun far selektör high beam",
    icon: (
      <>
        <path d="M11 6C7 6 5 9 5 12s2 6 6 6c1.5 0 2-2.5 2-6s-.5-6-2-6z" {...s} />
        <path d="M15 8h5M15 11h5M15 14h5M15 17h5" {...s} />
      </>
    ),
    tr: {
      name: "Uzun far",
      meaning: "Uzun farlar açık.",
      action: "Karşıdan araç geldiğinde veya birini takip ederken kısa fara geç; karşı sürücüyü kör edebilir.",
    },
    en: {
      name: "High beam",
      meaning: "High beams are on.",
      action: "Dip them for oncoming traffic or when following another car.",
    },
  },
  {
    id: "low-beam",
    color: "green",
    keywords: "kısa far low beam headlight",
    icon: (
      <>
        <path d="M11 6C7 6 5 9 5 12s2 6 6 6c1.5 0 2-2.5 2-6s-.5-6-2-6z" {...s} />
        <path d="M15 9l5 1.5M15 12l5 1.5M15 15l5 1.5" {...s} />
      </>
    ),
    tr: { name: "Kısa far", meaning: "Kısa farlar açık.", action: "Bilgi amaçlıdır; bir şey yapman gerekmez." },
    en: { name: "Dipped beam", meaning: "Dipped headlights are on.", action: "Information only." },
  },
  {
    id: "fog",
    color: "amber",
    keywords: "sis farı arka sis fog light",
    icon: (
      <>
        <path d="M13 6c4 0 6 3 6 6s-2 6-6 6c-1.5 0-2-2.5-2-6s.5-6 2-6z" {...s} />
        <path d="M9 8H4M9 11H4M9 14H4M9 17H4M6.5 6.5v12" {...s} />
      </>
    ),
    tr: {
      name: "Arka sis lambası",
      meaning: "Arka sis lambası açık.",
      action: "Yalnızca görüş 50 metrenin altındayken kullan; açık havada arkadaki sürücüyü rahatsız eder ve cezası vardır.",
    },
    en: {
      name: "Rear fog light",
      meaning: "The rear fog light is on.",
      action: "Use it only when visibility is under 50 m — otherwise it dazzles the driver behind.",
    },
  },
  {
    id: "cruise",
    color: "green",
    keywords: "hız sabitleyici cruise control",
    icon: (
      <>
        <path d="M4.5 16a8 8 0 1 1 15 0" {...s} />
        <path d="M12 15l4-5" {...s} />
        <path d="M5 19h14" {...s} />
      </>
    ),
    tr: { name: "Hız sabitleyici", meaning: "Hız sabitleyici devrede.", action: "Fren pedalına basınca devreden çıkar." },
    en: { name: "Cruise control", meaning: "Cruise control is engaged.", action: "Pressing the brake disengages it." },
  },
];
