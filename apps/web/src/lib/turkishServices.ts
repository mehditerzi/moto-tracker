export interface OfficialService {
  id: string;
  url: string;
  /** i18n key under `services.*` */
  labelKey: string;
}

/**
 * Deep links to the official Turkish vehicle platforms. These are the only
 * realistic "integration" for an independent app — TÜVTÜRK and e-Devlet expose
 * no consumer API, so instead of reading data we send the user straight to the
 * right service (booking, inspection status, insurance, fines). e-Devlet pages
 * require the user's own login; we just open them in the system browser.
 */
export const OFFICIAL_SERVICES: OfficialService[] = [
  {
    id: "inspectionBooking",
    url: "https://reservation.tuvturk.com.tr/",
    labelKey: "services.inspectionBooking",
  },
  {
    id: "inspectionStatus",
    url: "https://www.turkiye.gov.tr/muayene-durum-sorgulama",
    labelKey: "services.inspectionStatus",
  },
  {
    id: "insurancePolicy",
    url: "https://www.turkiye.gov.tr/sbm-trafik-police-sorgulama",
    labelKey: "services.insurancePolicy",
  },
  {
    id: "trafficFines",
    url: "https://www.turkiye.gov.tr/emniyet-arac-plakasina-yazilan-ceza-sorgulama",
    labelKey: "services.trafficFines",
  },
];
