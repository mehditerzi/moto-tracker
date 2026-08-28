# Garajım — Privacy Policy

_Last updated: 2026-08-17_

Garajım ("the app") helps you track your vehicle documents and their expiry
dates, record the trips you ride, and ride together with friends on a live map.
This policy explains what data the app collects, why, and how it is handled. The
service is operated by the app's owner on self-hosted infrastructure.

Most people use Garajım on their own. Some use it as a member of a company's
**organization** — a business that runs a fleet or rents vehicles out. If that is
you, everything below still applies, and
[Organizations and company vehicles](#organizations-and-company-vehicles)
explains what is different, including what your employer can see.

> **Hosting note:** this document is served live (no login required) at
> `https://mototracker.mehditerzi.com/privacy` by the API
> (`apps/api/src/routes/privacy.ts`). Enter that URL in App Store Connect →
> App Information → Privacy Policy URL. Keep this Markdown source and the HTML in
> `privacy.ts` in sync when the policy changes.

## What we collect

- **Account information:** your email address (and name, if provided) to create
  and secure your account.
- **Vehicle information you enter or scan:** plate, make, model, year, chassis
  number, engine number, cylinder capacity, and document expiry dates
  (insurance / kasko / inspection / maintenance).
- **Document photos:** images you capture or upload of your vehicle documents.
  They are processed to read the dates and vehicle details, then stored so you
  can review them.
- **Location data:** if you grant location permission, the app records your trips
  (distance, start/end time, and the route you rode) and shares your live
  position with the friends in a group ride you join. See
  [Location data](#location-data) below for the full detail.
- **Purchase records:** if you buy a vehicle pack, we store the App Store
  transaction identifiers, the product you bought, and the purchase and expiry
  dates, so we can grant and renew what you paid for.
- **Usage events:** a small first-party log of in-app actions (for example "a
  trip was logged", "a scan failed") used to find bugs and improve the app.
- **Notification token:** if you enable reminders, a push token/subscription for
  your device so we can send expiry reminders.
- **Organization membership:** if a company adds you to its organization, we
  store which organization you belong to, your role in it, and which of its
  vehicles is assigned to you — see
  [Organizations and company vehicles](#organizations-and-company-vehicles).

We do **not** collect advertising identifiers, contacts, or browsing activity,
and we do not use third-party analytics or advertising SDKs.

## Location data

Location is **optional**. The app asks for it only when you use a feature that
needs it, and it works without it — you can still track documents, expiry dates,
and maintenance. You can revoke the permission at any time in iOS Settings.

- **Trip tracking.** With your permission the app reads your device's GPS
  position while you ride, including **in the background** so a drive is still
  measured when the app is not on screen. When a trip ends, we store its
  distance, start and end time, the number of samples, and a simplified version
  of the route you rode (an encoded polyline) against the vehicle you assigned it
  to. Positions are processed on your device during the ride; only the finished
  trip is sent to the server.
- **Live group rides.** While you are in a group ride, your position is sent to
  the server and relayed to the other members of that ride so you can see each
  other on the map. The same applies to the route and the rally point the ride
  leader shares with the group. All of it is held **in memory only and is never
  written to disk**. It disappears the moment the ride ends, and a server
  restart drops it entirely. We keep no location trail from a group ride beyond
  the trip you recorded yourself.
- **Route planning.** When you plan a route on the map, the start, destination
  and any stops are sent to Apple Maps to compute directions and to look up place
  names (see [Third-party services](#third-party-services)). Your planned route
  and your recently used places are saved **on your device only** so they survive
  closing the app; they are never sent to us. Clearing the app's data removes
  them. We do not store planned routes on our servers.
- **Trips on a company vehicle.** If you record a trip on a vehicle that belongs
  to an organization you are a member of, that trip — **including the route you
  drove** — is visible to that organization's management. This is monitoring in a
  working relationship and we set it out in full under
  [Organizations and company vehicles](#organizations-and-company-vehicles).
  Trips on your own vehicles are never visible to an organization.

Your location is used only for these features. It is never used for advertising
and never sold. It is not shared with anyone other than the ride members you
deliberately ride with and — for a trip recorded on a company vehicle — the
organization that vehicle belongs to.

## Organizations and company vehicles

An **organization** is a company account: a fleet operator whose vehicles are
driven by its people, or a rental business whose vehicles go out to customers.
Organizations are set up for a company by the operator of this service. You are
in one only because somebody at that company added you — it cannot happen by
accident, and nothing in the app puts you in one.

Membership changes exactly one thing: **the company's vehicles are shared**. Your
own garage is untouched. Your personal vehicles, their documents, and the trips
you record on them stay yours and are never visible to any organization, even one
you are a member of.

**What the organization can see.** For each vehicle that belongs to it, the
organization's owner, managers and office staff can see everything recorded
against that vehicle, whoever recorded it:

- its documents and their images, expiry dates, maintenance history, fuel
  purchases and odometer readings;
- **the trips recorded on it — including the route, the start and end time, and
  the distance — and which member recorded each one**;
- who currently holds the vehicle, and the history of who held it before.

**This means your employer can see where a company vehicle went, when, and who
was driving it.** We are not going to dress that up. It is there because a fleet
has to account for its vehicles' mileage, costs and compliance — but it is
monitoring of employees, so it has limits, and these are they:

- It covers **company vehicles only**. A trip on your own vehicle is invisible to
  the organization, and so is the rest of your account.
- It is **a record of the vehicle, not a live track of you**. Managers get no
  real-time position feed, and your live position in a group ride is never shared
  with an organization.
- Trip recording still depends on the location permission you grant on your own
  device, and the app works without it. You can decline or revoke it at any time
  in iOS Settings; what your job requires of you is between you and your employer.
- A **driver sees only the vehicle currently assigned to them** and loses that
  access the moment it is handed back. Drivers cannot see the rest of the fleet,
  other drivers, or anyone else's trips.
- Reminders about a company vehicle's expiring documents go to the organization's
  owner, managers and staff as well as to the driver currently holding it, so the
  person accountable for it actually hears about it.

**Who is responsible for it.** The organization decides that it wants these
records and what it does with them, so for everything on its vehicles the
organization is the _data controller_ (KVKK: _veri sorumlusu_) and we are its
_processor_ (_veri işleyen_) — we host the data and act on the organization's
instructions, and we do not use it for any purpose of our own. Your employer is
responsible for telling you that company vehicles are tracked, for having a
lawful basis for doing so, and for how long it keeps the records. If you cannot
get an answer from them, write to us at the address below and we will help.

## Information an organization holds about other people

A rental business using Garajım records the people it rents vehicles to: name,
phone number, email address, whatever it chooses to write in the notes field, and
the rental contracts themselves — dates, handover and return odometer, and the
agreed rate. Those people are usually not users of this app, and we have no
relationship with them.

That information is the organization's, in the sense that matters legally: it
decides which customers to record, what to record about them, and how long to
keep them. The organization is the _data controller_; we host the data as its
_processor_ and use it for nothing else — never for marketing, never for
analytics, and never shared with anyone.

**How it is deleted.** The organization can delete a customer from inside the
app; doing so erases that customer's record and every rental contract attached to
it. Deleting the organization erases all of its customers at once. If you have
rented a vehicle from a business that uses Garajım and you want your details
removed, ask that business — they can do it themselves, immediately. You can also
write to us at the address below and we will pass the request on and act on it as
far as we are permitted to.

## How your document images are processed

Date and field extraction (OCR) runs on the operator's own server
infrastructure. Document images are **not** sent to third-party AI/advertising
services for this purpose.

## Usage analytics

The app sends a small batch of usage events to _our own_ server — no third-party
analytics product is involved and nothing leaves our infrastructure. An event is
a short name plus a few aggregate numbers (for example the rounded distance of a
logged trip) and an app-session identifier. We do **not** put coordinates,
routes, plate numbers, or document contents in these events, and we do not use
them to build an advertising or cross-site profile.

## How we use your data

- To provide the core features: reading, storing, and reminding you about your
  document expiry dates; recording your trips; and showing group rides on a map.
- To send the reminder notifications you opt into.
- To authenticate you and keep your account secure.
- To validate purchases and grant the vehicle allowance you paid for.
- To fix bugs and improve the app, using the first-party usage events above.
- To run a company's fleet on its behalf, where you are a member of an
  organization: showing that organization the records kept on _its_ vehicles, as
  described in
  [Organizations and company vehicles](#organizations-and-company-vehicles).

We do **not** sell your data or share it with third parties for marketing.

## Third-party services

- **Email delivery** (e.g. for sign-in links / password resets) may be sent via
  a transactional email provider. Only your email address and the message are
  shared, solely to deliver the email.
- **Apple Maps (MapKit).** Maps, tiles, and route directions are provided by
  Apple. Displaying a map or planning a route sends the relevant coordinates to
  Apple, subject to Apple's own privacy policy.
- **Apple App Store & push notifications.** Purchases are processed by Apple —
  we never see your payment details, only the transaction records described
  above. Notifications are delivered through Apple's Push Notification service.

## Data retention & deletion

Your data is retained while your account is active. In the app you can delete
individual vehicles, documents, dated records, and trips — deleting a trip
removes its route from the server. Live group-ride positions are never stored, so
there is nothing to delete.

You can **delete your entire account from inside the app**: _Settings → Delete
account_. This permanently removes your account and everything attached to it —
vehicles, documents and their uploaded images, dated and maintenance records,
trips and their routes, fuel logs, ride memberships, notification tokens,
purchase records, and usage events. It cannot be undone. If you would rather not
do it yourself, email us at the address below and we will remove it for you.

If you are a member of an organization, deleting your account removes **you**:
your account, your personal vehicles and everything on them, your memberships,
and your vehicle assignments. The company's own records — its vehicles, their
documents, their service history, and the trips recorded on them — stay with the
organization, because they are the company's and not yours; wherever such a
record still carried your name, it is handed to another member of the
organization, so your identifier does not survive in it. If you were the last
remaining member, the organization and everything in it is deleted along with you.

Records an organization holds about its own customers are deleted by that
organization — see
[Information an organization holds about other people](#information-an-organization-holds-about-other-people).

## Security

Data is transmitted over HTTPS and stored on access-controlled infrastructure.
Sessions use secure, signed cookies.

## Children

The app is not directed at children under 13 and does not knowingly collect
their data.

## Changes

We may update this policy; the "last updated" date above reflects the latest
revision.

## Contact

Questions or deletion requests: **mehditerzi32@hotmail.com**
