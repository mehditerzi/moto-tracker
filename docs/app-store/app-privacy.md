# Garajım — App Privacy Questionnaire (App Store Connect)

Click-by-click answers for **App Store Connect → your app → App Privacy → Edit**.
This is app-level (not per-version) and **must be completed before you can submit**.

Based on what the app actually collects (verified against the code):
- **Email + Name** — better-auth sign-up (`signUp.email({ email, password, name })`)
- **Document photos** — uploaded and stored per-user on the server (`UPLOADS_DIR`) for OCR
- **Vehicle data** — plate, make/model, dates, costs, notes (user content)
- **Push token** — device token POSTed to `/api/push/device-token` for reminders

The app does **NOT**: track users, run ads/analytics SDKs, collect location, or
share data with third parties.

---

## Step 1 — "Do you or your third-party partners collect data from this app?"
→ **Yes, we collect data from this app**

## Step 2 — Select every data type you collect

Check exactly these boxes (leave all others unchecked):

| Category | Data type | Check? |
|---|---|---|
| Contact Info | **Email Address** | ✅ |
| Contact Info | **Name** | ✅ |
| User Content | **Photos or Videos** | ✅ (the scanned documents) |
| User Content | **Other User Content** | ✅ (vehicle info, dates, costs, notes) |
| Identifiers | **Device ID** | ✅ (the APNs push token) |
| *(everything else: Location, Financial Info, Health, Contacts, Usage Data, Diagnostics, Browsing History, Search History, Purchases, Sensitive Info, User ID, Advertising Data)* | | ❌ leave unchecked |

> Note on the insurance **cost** field: it's user-entered notes about their own
> expense, not payment data we collect — declare it under **Other User Content**,
> NOT "Financial Info."

## Step 3 — Answer the 3 follow-up questions for EACH checked data type

App Store Connect asks the same three questions per data type. Give the **same
answers for all five**:

1. **How is this data used?** → check **App Functionality** only
   (also acceptable to add **Account Management** for Email/Name — but App
   Functionality alone is fine and simplest).
2. **Is this data linked to the user's identity?** → **Yes** (it's tied to their account)
3. **Is this data used for tracking?** → **No**

Repeat for: Email Address, Name, Photos or Videos, Other User Content, Device ID.

## Step 4 — Publish
Click **Publish** on the App Privacy page. The resulting "privacy label" will read:

> **Data Linked to You** — used for app functionality, not for tracking:
> Contact Info (Email, Name), User Content (Photos, Other), Identifiers (Device ID)
> **Data Not Linked to You** — none · **Data Used to Track You** — none

This matches the privacy policy served at
`https://mototracker.mehditerzi.com/privacy`.
