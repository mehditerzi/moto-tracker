# Fleet — product & UX specification

Garajım serves two audiences from one codebase:

- **Consumers** — one person, one or a few personal vehicles. Sold through the
  App Store (IAP). This is the app as it has always been.
- **Fleet businesses** — rental companies (*filo kiralama*) and own-fleet
  operators (couriers, service companies). Sold directly, off-App-Store.

This document is the contract the fleet implementation builds to.

---

## 1. Commercial & App Store posture

Fleet is **invisible to consumers**. There is no fleet sign-up, no fleet
pricing, no "upgrade to fleet" CTA, no mention in App Store metadata. A
consumer user cannot discover from inside the app that fleet exists.

Fleet organizations are **provisioned by the operator only** (see
`scripts/fleet-admin.mjs`). A fleet customer signs a contract, is invoiced
directly, and their org is created by hand. They then sign in through the
normal app and the fleet UI appears because they are an org member.

**Why this shape.** App Review Guideline 3.1.1 forbids "buttons, external
links, or other calls to action that direct customers to purchasing mechanisms
other than in-app purchase" — in the app *and its metadata* — outside the US
storefront. By having no in-app fleet acquisition path at all, fleet reads as
*accessing an already-purchased subscription* rather than *unlocking features
outside IAP*. Consumer sales continue to use IAP, as 3.1.3(c) requires.

Practical consequence for Turkey: fleet customers need an e-fatura with KDV
from us. Apple as merchant-of-record cannot produce that, which is an
independent reason fleet billing must stay off-App-Store.

**Two hard rules for anyone touching fleet UI:**

1. Never render fleet chrome, copy, or navigation for a user with no org
   membership. Gate on membership, not on a feature flag.
2. Never add a link, price, or contact-sales affordance for acquiring fleet.

App Review must be given the demo fleet account (Guideline 2.1(a) requires demo
credentials for any app with a login).

---

## 2. Roles

Four roles, defined in `apps/api/src/lib/orgAccess.ts`. Permissions are
enforced server-side; the UI mirrors them but is never the enforcement point.

| Role | Sees | Can do |
|---|---|---|
| **owner** | Whole fleet | Everything, incl. billing-adjacent settings and deleting the org |
| **manager** | Whole fleet | Vehicles, contracts, assignments, members. Not org deletion |
| **staff** | Whole fleet | Day-to-day records: dated items, maintenance, fuel, documents. No vehicle deletion, no member management |
| **driver** | **Only their currently-assigned vehicle** | Log fuel/km, upload documents, see their own trips |

The driver boundary is the security-critical one: a driver must not be able to
enumerate the rest of the fleet through any route.


### Personal garage groups are NOT fleet

An `organization` can also be a **personal garage group** (`mode: 'personal'`) —
a household or a rider and their mechanic sharing a vehicle. It reuses these same
tables, roles and `orgAccess.ts` on purpose: one permission model, not two. It is
emphatically **not** the fleet product, and two guards keep them apart:

- **Server:** `requireOrgRole` refuses a personal group with 404, so every route
  under `/api/orgs` — triage, inventory, costs, import, members, contracts, and
  the settings PATCH that writes `mode` — is unreachable from one. The mirror
  guard `requirePersonalGroupRole` refuses a business org on the sharing routes.
  `orgSettingsUpdateSchema` cannot express `'personal'`, so neither direction is
  a conversion path.
- **Client:** `useFleetAccess().fleetOrgs` filters `mode !== "personal"`, and its
  `FleetOrgMembership` type makes that narrowing something the compiler checks
  rather than something a reviewer has to notice.

Unlike a fleet, a personal group **is** user-creatable (`POST
/api/vehicle-shares/groups`). That is consistent with §1 rather than an exception
to it: it costs nothing, unlocks nothing, and its vehicles are billed to their
custodians' ordinary consumer entitlement — there is no purchasing mechanism
anywhere near it.

---

## 3. The driver experience is the consumer app

**Drivers get no fleet UI at all.** A driver signing in sees the existing
consumer dashboard, scoped to the vehicle currently assigned to them.

This is deliberate, and it does three things at once: it is nearly zero new UI,
it means a courier needs no training, and it keeps the "consumers never notice
fleet" property true even for users who are technically inside an org.

Fleet chrome (the nav entry, the fleet board) renders **only** for
owner / manager / staff.

---

## 4. Modes

A mode is chosen per organization and changes only which relationship a vehicle
carries. Everything else — compliance, costs, documents — is identical.

- **`fleet` mode** — vehicle → `vehicle_assignment` → a driver (an org member).
  For couriers and service companies. Answers *who is driving this today*.
- **`rental` mode** — vehicle → `rental_contract` → a `fleet_customer`.
  For rental companies. Adds handover/return odometer, contract dates, daily
  rate. Answers *who has this rented and when is it due back*.

Do not build two parallel UIs. Build one vehicle row whose "current holder"
cell renders an assignment or a contract depending on `organization.mode`.

---

## 5. Information architecture

```
/fleet                    Triage board — the default landing for fleet users
/fleet/vehicles           Full inventory, filterable, sortable
/fleet/vehicles/:id       One vehicle: compliance, costs, documents, history
/fleet/costs              Cost per vehicle / per month
/fleet/people             Members & invites (owner/manager only)
/fleet/customers          Customers & contracts (rental mode only)
/fleet/import             CSV bulk import (owner/manager only)
```

Consumer routes are untouched. A fleet user can still switch to their personal
garage — org vehicles and personal vehicles never mix in one list.

---

## 6. Design language

The consumer app's visual system is an **instrument cluster**: warm near-blacks,
a lime accent used sparingly as an LED, Geist + Geist Mono, wide-tracked
micro-labels, and status encoded as `ok / soon / danger / expired`. Fleet
extends that metaphor to **a dispatch board** — a wall of gauges rather than one.

Reuse, do not reinvent:

- **Status semantics.** The same four states and the same colors as
  `components/StatusChip.tsx`. A manager who also uses the consumer app must
  read a fleet row instantly. Keep the `animate-danger-glow` treatment reserved
  for genuinely overdue items so it stays meaningful.
- **Tabular numerals.** Fleet is numbers-heavy — km, ₺, days remaining. Use the
  existing `num` / Geist Mono treatment so figures align down a column. Column
  comparability is the entire point of a fleet view.
- **Scarce accent.** Lime (`accent`) is the ignition color for the primary CTA
  only. Never use it for data encoding, or it stops meaning "act here".

Two deliberate departures from the consumer app:

- **Density.** Fleet managers work at a desk. The fleet board must be genuinely
  good at ≥1024px — a real table with sortable columns — not a phone layout
  stretched wide. The consumer app's `max-w-3xl` does not apply to `/fleet`.
- **Mobile degrades to cards.** Below `sm`, rows become cards. A fleet user on
  a phone is triaging, not doing data entry.

---

## 7. Screens

### 7.1 Triage board (`/fleet`) — the one that sells the product

**Exception-first, not inventory-first.** A manager with 40 vehicles does not
want to see 40 vehicles; they want the 3 that need action today. This screen is
the answer to "what does this do that my spreadsheet doesn't."

Order on the page:

1. **Overdue** — anything already expired. Red, unmissable, count in the header.
2. **Next 30 days** — sorted soonest-first.
3. **Fleet summary strip** — total vehicles, on-rent/assigned, idle, in service,
   documents pending OCR.

Each row: plate (mono), vehicle, what is expiring, days remaining (mono, signed),
current holder. Tapping a row goes to that vehicle.

An empty triage board is a **success state**, not an empty state — say so
("Tüm araçlar güncel" / "All vehicles current"), don't show a sad illustration.

### 7.2 Inventory (`/fleet/vehicles`)

The full list. Sortable by plate, next expiry, km, status. Filterable by status
and by holder. Free-text search across plate/make/model — plate search must
tolerate the spacing users actually type (`34ABC123`, `34 ABC 123`).

### 7.3 Vehicle detail (`/fleet/vehicles/:id`)

Reuses the consumer dashboard's status chips and maintenance panel, plus a
fleet header (current holder, assignment/contract history) and the document
wallet for that vehicle.

### 7.4 Costs (`/fleet/costs`)

Fuel + maintenance rolled up per vehicle and per month, with ₺/km. This is what
a finance lead buys. Highlight outliers — a vehicle whose ₺/km is well above the
fleet median is the insight, so surface it rather than making them scan.

Derive from existing `fuel_log` and `maintenance_item` data. No new capture UI.

### 7.5 People (`/fleet/people`)

Members with roles, pending invites, and — in fleet mode — who is assigned to
what. Invite by email; the invitee accepts and joins the org.

### 7.6 Customers & contracts (`/fleet/customers`, rental mode only)

Customers, and per-vehicle rental contracts with handover/return km. `fleet_customer`
holds renter personal data and is subject to the same deletion guarantees as
everything else — see the privacy policy in `apps/api/src/routes/privacy.ts`.

### 7.7 Import (`/fleet/import`)

CSV upload for onboarding an existing fleet. This removes the biggest objection
in a sales call: *"we already have 40 vehicles in a spreadsheet."*

Must: accept the messy real thing (Turkish headers, `;` delimiters from Turkish
Excel, UTF-8 BOM, `dd.mm.yyyy` dates, plates with arbitrary spacing); preview
and let the user fix rows before committing; never partially import — validate
the whole file, then commit in one transaction; report per-row errors clearly.

---

## 8. Accessibility & i18n

Fleet is held to the same bar as the rest of the app, which was just brought up
to standard:

- Every form error wired with `aria-invalid` + `aria-describedby` (use the
  shared `components/ui/field.tsx`).
- Tables need real `<th scope>`, and sortable headers need `aria-sort`.
- Status must never be conveyed by color alone — pair it with text or an icon.
- Full tr/en parity. `locales/parity.test.ts` enforces structure; write real
  Turkish, not machine translation. Fleet users are Turkish businesses and the
  Turkish copy is the primary one.
