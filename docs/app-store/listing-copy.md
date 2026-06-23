# Garajım — App Store Connect Listing Copy

Paste-ready metadata for the App Store Connect version page. Turkish is the
**primary** language (Turkey market); add English (U.S.) as a secondary
localization so the listing also reads in English.

Field limits (Apple): Name ≤30, Subtitle ≤30, Promotional Text ≤170,
Keywords ≤100 (comma-separated, **spaces count** — omit them),
Description ≤4000.

---

## Name & Subtitle (both locales)

- **Name:** `Garajım: Araç Takvimi`
- **Subtitle:** `Dijital garajınız.`

(Home-screen icon label stays **Garajım** via `CFBundleDisplayName` — unchanged.)

---

## 🇹🇷 Turkish (Primary)

### Promotional Text (≤170)
```
Sigorta, kasko ve muayene tarihlerini bir daha kaçırmayın. Belgeyi çekin, tarih otomatik okunsun; zamanı gelince Garajım size hatırlatsın.
```

### Keywords (≤100, no spaces)
```
araç,sigorta,kasko,muayene,trafik,ruhsat,bakım,hatırlatıcı,araba,motosiklet,vize,oto,lastik
```

### Description
```
Garajım, aracınızın tüm resmi tarihlerini tek bir yerde toplayan dijital garajınızdır. Sigorta, kasko ve muayene ne zaman bitiyor? Bir daha asla aklınızda tutmak zorunda kalmayın.

BELGEYİ ÇEKİN, GERİSİNİ BIRAKIN
Sigorta poliçenizin, kasko veya muayene belgenizin fotoğrafını çekin. Garajım tarihleri otomatik olarak okur ve sizin yerinize takip eder. Elle tarih girmekle uğraşmayın.

ZAMANINDA HATIRLATMA
Her yenileme tarihi yaklaştığında bildirim alın. Kaç gün önceden hatırlatılmak istediğinizi siz seçin — 60, 30, 14, 7, 3 gün ya da aynı gün.

BAKIMLARINIZI DA TAKİP EDİN
Yağ değişimi, fren, lastik, akü, zincir ve daha fazlası. Kilometre ve süreye göre bakım aralıklarını tanımlayın, sıradaki bakımı şaşırmayın.

TÜM ARAÇLARINIZ TEK YERDE
İster motosiklet ister otomobil — birden fazla aracı tek garajda yönetin. Her araç için ayrı tarihler, ayrı bakımlar.

ÖZELLİKLER
• Belge tarama ile otomatik tarih okuma (sigorta / kasko / muayene)
• Yaklaşan yenilemeler için özelleştirilebilir bildirimler
• Yağ, fren, lastik, akü, zincir ve özel bakım takibi
• Birden fazla araç desteği (motosiklet ve otomobil)
• Türkçe ve İngilizce arayüz
• Sade, hızlı ve gösterişsiz tasarım

Garajım — dijital garajınız.
```

---

## 🇺🇸 English (U.S.)

### Promotional Text (≤170)
```
Never miss an insurance, inspection, or coverage renewal again. Snap the document, let Garajım read the date, and get reminded before it expires.
```

### Keywords (≤100, no spaces)
```
car,vehicle,insurance,inspection,maintenance,reminder,registration,motorcycle,garage,service,mot
```

### Description
```
Garajım is the digital garage that keeps all of your vehicle's important dates in one place. When does your insurance, coverage, or inspection expire? Stop trying to remember.

SNAP IT, FORGET IT
Take a photo of your insurance policy, coverage, or inspection document. Garajım reads the dates automatically and tracks them for you — no manual date entry.

REMINDERS ON TIME
Get notified as every renewal date approaches. You choose how far ahead — 60, 30, 14, 7, 3 days, or the same day.

TRACK MAINTENANCE TOO
Oil changes, brakes, tires, battery, chain and more. Set service intervals by distance or time and never miss the next one.

ALL YOUR VEHICLES IN ONE PLACE
Motorcycle or car — manage multiple vehicles in a single garage, each with its own dates and maintenance.

FEATURES
• Document scanning with automatic date reading (insurance / coverage / inspection)
• Customizable reminders for upcoming renewals
• Maintenance tracking: oil, brakes, tires, battery, chain, and custom items
• Multiple vehicles (motorcycles and cars)
• Turkish and English interface
• Clean, fast, no-clutter design

Garajım — your digital garage.
```

---

## App Review Notes (paste into "Notes" in App Review Information)

```
The app requires an account to use. A demo account is provided below; it is
pre-loaded with a sample vehicle and renewal dates so all screens are populated.

Demo account:
  Email:    demo@garajim.app          ← create this on production before submitting
  Password: <set a password and put it here>

Notes for the reviewer:
- Sign in with the demo account above to reach the dashboard.
- "Scan document" uses on-device camera + a self-hosted OCR service to read
  dates from insurance/inspection documents. You may also add dates manually.
- Push notifications are used only to remind the user before a renewal expires;
  they are optional and requested after sign-in.
- The app is a thin native (Capacitor) wrapper around a web app hosted at
  https://mototracker.mehditerzi.com.

Contact: mehditerzi32@hotmail.com
```

> ⚠️ **Before submitting:** actually create `demo@garajim.app` (or any address) on
> the **production** site, sign in once, and add a vehicle + a couple of renewal
> dates so the reviewer sees a populated app, not an empty state. Apps behind a
> login are routinely rejected when the supplied credentials don't work or the
> account is empty.

---

## Release Notes / "What's New" (v1.0)

For a **first** release Apple usually hides the "What's New" field (it's for
updates). If it appears, or for your first update, use:

🇹🇷 Turkish:
```
Garajım'ın ilk sürümü! Aracınızın sigorta, kasko ve muayene tarihlerini belge tarayarak takip edin, zamanı gelince hatırlatalım. Yağ, fren, lastik gibi bakımları da tek yerden yönetin.
```

🇺🇸 English:
```
The first release of Garajım! Track your vehicle's insurance, coverage, and inspection dates by scanning documents, and get reminded before they expire. Manage maintenance like oil, brakes, and tires — all in one place.
```

---

## Other required fields (quick reference)

- **Support URL:** `https://mototracker.mehditerzi.com`
- **Marketing URL (optional):** `https://mototracker.mehditerzi.com`
- **Privacy Policy URL:** `https://mototracker.mehditerzi.com/privacy`
- **Category:** Primary *Utilities* (alt: *Lifestyle*)
- **Screenshots (6.9"):** `docs/app-store/screenshots/6.9-inch/` (1290×2796, in order:
  dashboard → renewal detail → garage → reminders → onboarding)
- **App Privacy questionnaire:** declare Email Address (account), Photos/Documents
  (OCR input), and a device push token. Map each to "App Functionality";
  none used for tracking/advertising.
