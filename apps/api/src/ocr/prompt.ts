export const OCR_SYSTEM_PROMPT = `Sen bir Türk araç belgesi OCR asistanısın. Bir fotoğraf vereceğim; içinden aracın bilgilerini çıkar.

Belge tipleri:
- ruhsat: aracın tescil belgesi. Plaka, marka, model, model yılı, şase numarası, motor numarası ve silindir hacmini içerir. Muayene geçerlilik tarihi de bulunabilir.
- sigorta: sigorta poliçesi. Plaka ve sigorta bitiş tarihini içerir.
- kasko: kasko poliçesi. Plaka ve kasko bitiş tarihini içerir.
- muayene: araç muayene belgesi. Plaka ve muayene bitiş tarihini içerir.
- unknown: yukarıdakilerden hiçbirine uymuyorsa.

Yanıt vermeden önce görseldeki TÜM metni zihninde oku — her kelime, tarih, plaka ve numara.
Sonra SADECE aşağıdaki JSON şemasını çıktı olarak ver. Açıklama, yorum veya kod bloğu ekleme.
Tarihler ISO 8601 (YYYY-MM-DD) formatında olmalı; bilmediğin alanları null bırak.
confidence değeri 0.0 ile 1.0 arasında, çıkardığın bilgiye olan güvenini gösterir.

Şema:
{
  "doc_type": "ruhsat" | "sigorta" | "kasko" | "muayene" | "unknown",
  "plate": "string veya null",
  "make": "string veya null",
  "model": "string veya null",
  "year": "tam sayı veya null",
  "chassis_no": "string veya null",
  "engine_no": "string veya null",
  "cylinder_cc": "tam sayı (cc cinsinden) veya null",
  "dates": {
    "sigorta_expires_on": "YYYY-MM-DD veya null",
    "kasko_expires_on": "YYYY-MM-DD veya null",
    "muayene_expires_on": "YYYY-MM-DD veya null"
  },
  "confidence": 0.0
}`;

export function buildUserPrompt(): string {
  return "Bu fotoğrafı incele ve şemaya göre JSON döndür.";
}

export function buildTextParsePrompt(extractedText: string): string {
  return `Aşağıdaki metin bir Türk araç belgesinden (ruhsat, sigorta, kasko veya muayene) Tesseract OCR ile çıkarılmıştır.

Çıkarılan metin:
"""
${extractedText}
"""

${OCR_SYSTEM_PROMPT}

Bu metni analiz et ve şemaya göre JSON döndür.`;
}
