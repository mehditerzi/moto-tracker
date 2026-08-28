# Fleet operations

Everything an operator does to a fleet customer *after* the product is written:
turning a signed contract into a working organization, raising a ceiling when an
invoice is paid, dissolving an org when a customer leaves, and keeping the demo
account that both sales calls and App Review depend on.

`docs/operations.md` covers the app; this covers the customers.

Three facts shape all of it:

- **Fleet has no self-serve path, on purpose.** There is no fleet sign-up, no
  pricing page, no contact-sales button — see `docs/fleet-design.md` §1 for why
  (App Review Guideline 3.1.1, plus the e-fatura problem). The consequence for
  you: **`scripts/fleet-admin.mjs` is the only way an organization exists.** If
  it is not in this runbook, it does not happen.
- **The CLI writes straight to SQLite.** There is deliberately no privileged
  HTTP route that creates organizations, because such a route is something an
  attacker can find. Provisioning is a shell on the box, and it works on both a
  local checkout and the production container.
- **`data/` is still the whole state.** Every command here is one `UPDATE` away
  from being a bad day. Take a backup before anything destructive:
  `./scripts/backup.sh` takes about a second.

---

## The CLI

```bash
pnpm fleet help                     # or: node scripts/fleet-admin.mjs help
```

| Command | What it does |
|---|---|
| `org:create --name <n> --mode rental\|fleet [--max-vehicles N]` | Brings an organization into existence. Ceiling defaults to 1 |
| `org:list [--json]` | Every org, with active members, vehicles-against-ceiling and live invites |
| `org:show --org <id\|name>` | One org plus its member list |
| `org:ceiling --org <id\|name> --max-vehicles N` | Raise (or lower) the vehicle ceiling — **this is the "invoice paid" command** |
| `member:add --org <id\|name> --email <e> --role <r>` | Adds an existing account, promotes an existing member, or issues an invite |
| `member:list --org <id\|name>` | Roles, status, and who is currently holding a vehicle |
| `member:remove --org <id\|name> --email <e> --yes` | Revokes access now; keeps history |
| `invite:list --org <id\|name>` | Pending / accepted / expired invites (never the tokens) |
| `invite:revoke --org <id\|name> --email <e>` | Kills a pending invite link |
| `org:delete --org <id\|name> --confirm "<exact name>"` | **Destructive.** Dissolves the org and deletes its uploads |

Global flags: `--db <path>`, `--uploads <dir>`, `--migrate`, `--json`.

Defaults: `--db` is `$DATABASE_PATH` if set, else `<repo>/data/app.db`;
`--uploads` is `$UPLOADS_DIR`, else `<repo>/data/uploads`. Inside the container
both environment variables are already set by the image, so you never pass them
there.

Every failure exits non-zero. Nothing prints a password or an existing invite
token — a token is a capability, so it is shown exactly once, at the moment it
is created, and `invite:list` will not show it again.

### Running against production

The runtime image ships no `scripts/` directory and runs as the unprivileged
`node` user, so copy the scripts in first. This is a plain file copy: it does not
restart anything and does not touch `/data`.

```bash
cd /srv/mototracker
docker cp scripts mototracker-api:/app/scripts
docker exec -u node mototracker-api node /app/scripts/fleet-admin.mjs org:list
```

Notes that will save you fifteen minutes:

- **`-u node` is not optional.** Without it the command runs as root, and any
  file it creates in `/data` (WAL, SHM, uploads) becomes root-owned — after
  which the api, which runs as `node`, cannot write its own database.
- `/app/scripts` lives in the container's writable layer, so it disappears the
  next time the container is recreated (`docker compose up -d --build`). Re-copy
  it; don't be surprised.
- Tidy up afterwards if you like: `docker exec -u root mototracker-api rm -rf /app/scripts`.
- **The deployed image must be new enough.** The organization tables arrive in
  migrations `021`–`023`. Against an older image the CLI stops with
  *"This database has no `organization` table"* — that is not a CLI problem, it
  means the box is running a build from before fleet. Deploy first
  (`git pull && docker compose up -d --build`), which applies the migrations at
  boot, then provision.

---

## Provisioning a new fleet customer

The whole path, contract to first login. Roughly five minutes.

### 1. Create the organization

Pick the mode now — it is effectively permanent, because it decides which half
of the product they see (`docs/fleet-design.md` §4):

- **`rental`** — they rent vehicles out. Customers, contracts, handover/return
  km. *Filo kiralama, oto kiralama, turizm.*
- **`fleet`** — they operate their own vehicles and hand them to employee
  drivers. Assignments. *Kurye, servis, saha ekibi.*

```bash
pnpm fleet org:create --name "Akdeniz Filo Kiralama" --mode rental --max-vehicles 25
```

```text
✓ Created organization "Akdeniz Filo Kiralama" (rental), ceiling 25 vehicles.
  org id: 01M08PBT583YJYXCSBCPA1CPW7
```

Write the org id down — every other command takes it (the exact name also works
when it is unambiguous).

Set `--max-vehicles` to **what they bought**, not what they own. The ceiling is
the commercial artefact: it is the only thing standing between a 25-vehicle
contract and a 60-vehicle fleet.

### 2. Invite the owner

```bash
pnpm fleet member:add --org 01M08PBT583YJYXCSBCPA1CPW7 \
  --email patron@akdenizfilo.com.tr --role owner
```

Two outcomes, and the command picks the right one:

- **The email already has a Garajım account** (common — they trialled the
  consumer app): they are added, or promoted, immediately. `member:add` is an
  upsert, so the same command promotes an existing manager to owner and
  reinstates someone previously removed.
- **The email has no account**: an **invite** is created and the link is printed
  once.

  ```text
  ✓ No account for patron@akdenizfilo.com.tr yet — created a owner invite.
    invite link: https://app.example.com/invite/RT7bM9v9…
    expires 2026-08-31T20:24:46.604Z · single use · anyone holding this link can join
  ```

  **Why an invite and not an account.** Creating the account here would mean we
  choose — and therefore know — the customer's password. That is a credential we
  should never possess, and a support liability the first time they dispute
  something. The invite hands the capability to whoever owns the mailbox
  instead. Treat the link like a password: send it directly to that person, not
  into a shared WhatsApp group. Re-running `member:add` issues a fresh link and
  invalidates the previous one, so a leaked link is one command away from dead
  (`invite:revoke` kills it outright).

### 3. The rest of the team

The customer can add their own people from `/fleet/people` once they are in, and
usually should. Do it yourself only for the first manager, or when they ask:

```bash
pnpm fleet member:add --org <id> --email mudur@… --role manager
pnpm fleet member:add --org <id> --email ofis@…  --role staff
pnpm fleet member:add --org <id> --email sofor@… --role driver
```

Role reference (enforced server-side in `lib/orgAccess.ts`; the UI only mirrors
it):

| Role | Sees | Notably cannot |
|---|---|---|
| `owner` | Whole fleet | — |
| `manager` | Whole fleet | Delete the organization |
| `staff` | Whole fleet | Delete a vehicle, manage members |
| `driver` | **Only the vehicle currently assigned to them** | See any other vehicle, edit the vehicle record |

A driver gets no fleet UI at all — they see the ordinary consumer dashboard for
the one vehicle in their hands. That is deliberate (§3): a courier needs no
training, and the "consumers never notice fleet" property stays true.

### 4. They log in

They sign in to the normal app at the normal URL. The fleet nav appears because
they are an org member — there is nothing to enable, no flag to flip, and
nothing for them to buy in-app.

Confirm from your side:

```bash
pnpm fleet org:show --org <id>
```

### 5. Getting their fleet in

Point them at `/fleet/import` (CSV). It accepts the messy real thing — Turkish
headers, `;` delimiters from Turkish Excel, UTF-8 BOM, `dd.mm.yyyy` dates,
plates spaced however they type them — and validates the whole file before
committing any of it. This is the answer to *"we already have 40 vehicles in a
spreadsheet"*, so lead with it.

---

## Raising a ceiling (the invoice-paid command)

```bash
pnpm fleet org:ceiling --org "Akdeniz Filo Kiralama" --max-vehicles 40
```

```text
✓ "Akdeniz Filo Kiralama" ceiling 25 → 40 vehicles.
```

This is the same write the app itself uses (`setOrgMaxVehicles` in
`lib/entitlement.ts`) — `apps/api/tests/fleetAdmin.test.ts` asserts the two
produce identical rows, so the CLI can never put the org in a state the API
disagrees with.

Effective immediately; nobody needs to log out. Lowering the ceiling below the
number of vehicles they already have **deletes nothing** — it just stops them
adding more, and the command says so.

Org vehicles are billed to the org, never to a member's personal subscription
(`entitlement.ts`), so none of this interacts with anyone's App Store purchase.

---

## Removing a member

```bash
pnpm fleet member:remove --org <id> --email eski.calisan@… --yes
```

Access stops immediately: every check requires `status = 'active'`. The row is
kept as `removed` so history — who signed which contract, who was holding which
van in June — still resolves to a name. Any vehicle still open in their hands is
handed back in the same transaction.

The last owner cannot be removed; promote someone else first. That is a
guardrail, not a limitation: an org with no owner cannot be administered by
anyone, including us.

---

## Dissolving an organization

**Destructive and not undoable. Take a backup first.**

```bash
./scripts/backup.sh
pnpm fleet org:delete --org <id> --confirm "Akdeniz Filo Kiralama"
```

The confirmation must be the organization's exact name; there is no `--force`.
Without `--confirm` on a terminal it prompts; without a terminal it refuses
rather than guessing.

What goes: the org, its vehicles, all assignments and contracts, its
`fleet_customer` records (renter personal data — see the privacy policy), every
dated item, maintenance record, fuel log and document row, **and
`UPLOADS_DIR/org/<orgId>` on disk**.

That last one is the part worth understanding. Org scans are written to
`UPLOADS_DIR/org/<orgId>` rather than the uploader's directory, precisely so a
member closing their account cannot take the company's documents with them
(`routes/documents.ts`). Nothing else ever removes that directory, so the DB
cascade alone would leave ruhsat and poliçe photographs — TC kimlik numbers, home
addresses — on disk for a customer we no longer have any relationship with. The
CLI deletes the directory, and deletes the `document` rows first (their
`bike_id` is `ON DELETE SET NULL`, so the cascade would otherwise orphan them
onto individual members, pointing at files that no longer exist).

Member accounts survive: dissolving an org is not deleting the people in it.
They keep their personal vehicles and can carry on as consumer users.

---

## The demo fleets

`scripts/seed-demo-fleet.mjs` seeds **two** companies, because Garajım sells to
two shapes of business and a demo that can only show one of them is half a demo:

| | Mode | Where | Vehicles | What it demonstrates |
|---|---|---|---|---|
| **DEMO — Akdeniz Filo Kiralama** | `rental` | Antalya | 17 | Customers, contracts, handover/return km, and vehicles that are **late back** |
| **DEMO — Efes Kurye ve Dağıtım** | `fleet` | İzmir | 7 | Own-fleet courier: vehicles handed to employee drivers, open assignments, idle vehicles, assignment history |

They exist for two jobs:

1. **Live demos.** Both fleets look like a real Turkish company on a real
   Tuesday: a few things overdue, a few due this month, one van obviously
   bleeding money, and drivers whose routes the manager can see.
2. **App Review.** Guideline 2.1(a) requires demo credentials for any app with a
   login, and Garajım's fleet half is invisible without an org membership. Without
   this account a reviewer sees the consumer app and nothing else, and the fleet
   screens go unreviewed — which is exactly the kind of gap that turns into
   "we were unable to review the features described".

Everything it writes is marked: both orgs are `DEMO — …`, every id starts with
`demo-`, and every account is on `@garajim.example` (`.example` is
IANA-reserved — nobody can ever own it, so no demo mail can escape to a real
inbox). Reset works by deleting exactly those, which is why it can never touch a
real customer.

### Locally

```bash
pnpm fleet:demo --yes                       # against ./data/app.db
pnpm fleet:demo --yes --db /tmp/scratch.db --migrate
```

### In production

App Review signs into production, so the demo orgs have to exist there.

```bash
docker cp scripts mototracker-api:/app/scripts
docker exec -u node mototracker-api node /app/scripts/seed-demo-fleet.mjs \
  --yes --allow-nonempty --password 'ChooseSomethingElse2026!'
docker exec -u root mototracker-api rm -rf /app/scripts
```

### The guard

- **`--yes` is mandatory.** Nothing runs without it.
- **`--allow-nonempty` is additionally required** when the target database
  already contains non-demo users or organizations. A dev database needs one
  flag; production needs two, deliberately typed. The script prints what it
  found before it decides.
- **It only ever deletes its own markers.** Even with both flags, the reset
  step is `DELETE` on `demo-fleet-org`, `demo-courier-org` and
  `%@garajim.example` — it has no code path that removes anything else.
- `--wipe --yes` removes the demo data and seeds nothing. Use it before a
  production backup you intend to hand to someone.

### Re-running

Idempotent by reset-and-reseed, and **byte-identical**: the generator is seeded,
so a second run produces the same two fleets with the same numbers, not four
fleets and not different figures. `apps/api/tests/demoFleet.test.ts` pins that
by comparing row counts *and* summed money and distance across two runs.

Every date is computed from the day you run it, so the boards tell the same
story next year — but the *history* moves with them, so re-seed before a demo
rather than showing last year's fuel logs.

### What it seeds

| | Rental (Antalya) | Courier (İzmir) |
|---|---|---|
| Vehicles | 17 — 13 cars, 4 scooters, plates 07/34/35/48 | 7 — 3 vans, 4 scooters, plates 35 |
| Compliance | 62 items: 3 overdue on 3 vehicles, several due within 30 days | 25 items: 1 overdue, 3 due within 30 days |
| Costs | 920 fuel logs + 75 service records over 365 days | 559 fuel logs + 29 service records |
| People | owner, manager, staff, driver — all four roles | owner, manager, 3 drivers |
| Customers | 10 `fleet_customer` — 8 people, 2 companies | — |
| Contracts | 32: 10 open (**3 of them late back**), 22 returned, all with handover/return km | — |
| Assignments | 1 (the service van) | 3 open, 5 closed in the history |
| Trips | 9 (transfer + service runs) | 46 (the job itself) |
| Documents | 12 placeholder scans, 3 pending OCR | 4, 1 pending OCR |

Makes and models are all taken from the bundled catalog
(`apps/api/src/db/seed/vehicleCatalog.generated.ts`) so the UI resolves every
vehicle; plate province codes are real (07 Antalya, 34 İstanbul, 35 İzmir,
48 Muğla).

**Late returns are the rental headline.** A vehicle that has not come back is a
rental company's daily emergency, and it reaches the triage board through the
same path as an expired policy: `orgFleet.ts` turns an open contract's `ends_at`
into a `contract_due` deadline, so it is rendered `expired`, in red, with signed
days-overdue and the customer's name as the holder. The demo ships one 12 days
gone, one 3 days gone, and one that tipped over yesterday — the spread matters,
because a single row reads as an accident and three reads as a process problem.

**The outlier is the point of the costs screen.** `34 KLM 226`, a 2019 Ford
Transit Custom on long-term hire to a construction company, runs at ~₺11/km
against a rental-fleet median near ₺4.5/km — a clutch and flywheel, a turbo
rebuild, a gearbox rebuild, injectors, two sets of tyres, and 11.8 L/100 km. In
the courier fleet the same role is played by `35 GH 6604`, a 2020 Peugeot
Partner past 170.000 km at ~₺6.3/km against a ₺3.1/km median. Know both numbers
before the call.

**Trips, and what a manager can see.** 55 GPS trips carry real encoded
polylines along real corridors — the D400 west to Kemer and east to Belek and
the airport transfer road in Antalya; Konak→Çiğli, Konak→Kemalpaşa and
Konak→Torbalı in İzmir. Every trip is attributed to whoever was holding the
vehicle that day, which makes the KVKK disclosure concrete rather than abstract:
sign in as the manager, open a courier's vehicle, and their routes are there.
Renters are never tracked — a rental customer's phone is not ours to record
from, and no trip in the rental org belongs to a contract.

**The vehicle whose fuel nobody logs.** `35 DR 224` is the courier firm's pool
scooter: anyone can take it, its fuel goes on a company card, and the receipts
stopped being entered about two months ago. That gap is extremely common in real
fleets, and it is the only honest way to show what `/fleet/costs` does about it —
with no odometer trail for those months it falls back to GPS trip distance and
still reports a ₺/km, instead of a blank or a guess. The pool rounds that cover
the gap are generated daily so the fallback has real distance to work with.

**About the documents.** We cannot ship real ruhsat or poliçe scans — they are
identity documents belonging to real people. Each demo document is therefore a
*generated* image that says so on its face ("DEMO DATA — PLACEHOLDER / NOT A
REAL SCAN") and prints the same fields the database row claims. Where a document
carries an extraction, that extraction is exactly the text drawn on the image —
nothing is inferred from anything — and `ocr_model` is recorded as `demo-seed`
rather than a model name, so no row in the database claims OCR ran when it did
not. Four documents are left `pending` on purpose, so the triage board's
"documents pending OCR" counter has something to show.

**No vehicle photos, deliberately.** `bike.photo_url` is NULL on all 24
vehicles. We have no licensed photographs and will not ship fake ones — and it
costs the demo nothing, because the fleet API carries no photo field at all
(`FleetInventoryRow`): the fleet screens identify a vehicle by plate, nickname
and the vehicle-type glyph (`web/src/lib/vehicleType.ts`). A clean grid of car
and motorcycle icons demos better than 24 identical grey placeholder plates.

**Why a driver in a rental company.** Rental firms have staff who move cars
between branches and take them to service; the Fiat Doblo (`07 JR 806`) is that
van. It is also what makes the restricted driver view demonstrable — signing in
as `demo.sofor@` shows that vehicle and nothing else in a 17-vehicle company,
and every fleet-wide endpoint answers 403/404. That is worth showing to a
prospect who is nervous about what their drivers can see.

### Fuel prices go stale — nothing else does

Every date in the seed is computed from the day you run it. Pump prices cannot
be, so they are the one thing that ages: `FUEL_PRICE` and `FUEL_PRICES_SET_ON`
at the top of `scripts/seed-demo-fleet.mjs`. The run warns you when they are
more than 180 days old. Update both — it is a two-line edit, and a Turkish
prospect who buys diesel every week will spot a stale ₺/L instantly.

### The demo run tells you what it built

The seeder finishes by reading both fleets back out of the database the way the
screens will, so you never have to take its word for it:

```text
» DEMO — Akdeniz Filo Kiralama — triage board (rental)
  6 overdue · 12 due within 30 days
    -24d  07 TK 443    muayene       Vespa Primavera 125
    -17d  34 KLM 226   mtv           Ford Transit Custom
    -12d  07 GS 118    contract_due  Peugeot 301      Merve Aydın   ← ARAÇ İADE EDİLMEDİ
     -5d  07 CH 4180   sigorta       Renault Symbol
     -3d  07 HN 5521   contract_due  Dacia Duster     Fatma Şahin   ← ARAÇ İADE EDİLMEDİ
     -1d  07 SB 990    contract_due  Yamaha NMAX 125  Burak Öztürk  ← ARAÇ İADE EDİLMEDİ
     …

» DEMO — Akdeniz Filo Kiralama — cost per vehicle (365 days) — median ₺4.5/km
   ₺ 11.03/km  34 KLM 226   Ford Transit Custom  yakıt ₺269.757  servis ₺198.630  ← outlier

» DEMO — Akdeniz Filo Kiralama — fleet summary strip
  vehicles 17 · in use 10 · idle 6 · on rent 10 · customers 10 · trips 9 · pending OCR 3

» DEMO — Efes Kurye ve Dağıtım — triage board (fleet)
  1 overdue · 3 due within 30 days
     -8d  35 EN 1180   muayene  Fiat Fiorino
     …

» DEMO — Efes Kurye ve Dağıtım — cost per vehicle (365 days) — median ₺3.11/km
   ₺  6.33/km  35 GH 6604  Peugeot Partner      servis ₺71.090  ← outlier
   ₺  3.11/km  35 DR 224   Kuba Superlight 125  8.209 km  (mesafenin bir kısmı GPS'ten)

» DEMO — Efes Kurye ve Dağıtım — fleet summary strip
  vehicles 7 · in use 3 · idle 4 · assigned 3 · past assignments 5 · trips 46 · pending OCR 1
```

### A note on the board's `contract_due` rows

The triage board surfaces **every** open rental whose `ends_at` falls inside the
horizon, not only the ones already overdue. In this demo that is 7 routine
"due back next week" rows sitting among the compliance items, and in a busy
40-car rental company it would be most of the fleet — which buries the expiries
the board exists to surface. The data here is honest (a 10-day rental started
four days ago genuinely ends in six), so this is a product question rather than
a seeding one: `contract_due` probably wants to appear only when it is overdue
or within a day or two, or to live in its own section. Raised, not papered over.

---

## App Store Connect — App Review Information

Paste the block below into **App Store Connect → your app → the version →
App Review Information → Sign-In Information**, with `Sign-in required` ticked.

> **Rotate the password first.** The seeded default (`GarajimDemo2026!`) is
> published in this repository. Re-seed production with
> `--password '<something else>'`, then paste *that* password. It is a demo
> account with no real personal data behind it, but a credential in a public git
> history is still a credential.

```text
Username: demo@garajim.example
Password: <the password you passed to --password>
```

**Notes** (paste into the *Notes* field — this is the field that decides whether
the fleet screens get reviewed at all):

```text
This account belongs to two demonstration business organizations, so the
reviewer can see the full feature set without making any purchase. No in-app
purchase is required to evaluate anything in this account.

  1. "Akdeniz Filo Kiralama" — a car and scooter rental company with 17
     vehicles, rental customers and contracts.
  2. "Efes Kurye ve Dağıtım" — a courier company with 7 vehicles that are
     assigned to employee drivers rather than rented out.

Both appear after signing in; switch between them from the organization
selector at the top of the "Filo" (Fleet) section.

After signing in, the fleet dashboard is at "Filo" in the main navigation:
  • Triage board — vehicles with expired or expiring insurance (sigorta/kasko),
    roadworthiness inspection (muayene) and vehicle tax (MTV), and rental
    vehicles that are overdue for return.
  • Vehicles — the full inventory, filterable and sortable.
  • Costs — fuel and maintenance per vehicle, with cost per kilometre.
  • Customers — rental customers and their contracts (rental company only).
  • People — members and their roles.

A second account demonstrates the restricted driver view, which can see only the
one vehicle currently assigned to it and has no access to any fleet-wide screen:
  Username: demo.sofor@garajim.example
  Password: <the same password>

Business-customer organizations like this one are provisioned by us directly
after an offline contract, are billed offline (Turkish law requires us to issue
an e-fatura with KDV, which cannot be done through the App Store), and are not
purchasable or discoverable from inside the app. Consumer subscriptions are sold
exclusively through in-app purchase.

All data in these organizations is fictional, including the customer names,
phone numbers and vehicle registration plates. The document images are generated
placeholders labelled "DEMO DATA — PLACEHOLDER / NOT A REAL SCAN"; no real
identity documents are included. The GPS routes shown under "Seferler" (Trips)
are synthesized, not recorded from a real person.
```

That last paragraph matters. Reviewers who find a business tier sometimes read it
as a purchase route outside IAP (Guideline 3.1.1). Saying plainly that it is not
purchasable in-app, and why, is cheaper than an appeal.

Re-check the credentials before **every** submission: a re-seed (or a `--wipe`
during a demo) recreates the accounts, and if the password changed and App Store
Connect was not updated, the reviewer hits a login failure — which is rejected as
2.1, not as a typo.

---

## Troubleshooting

**"This database has no `organization` table."**
The deployed build predates fleet. `git pull && docker compose up -d --build`;
migrations run at boot. Do not run the CLI with `--migrate` against production to
force it — let the app apply its own schema, so a failed migration surfaces in
the api's logs where you already look for it.

**"Could not resolve better-sqlite3."**
The script was run from somewhere with no `node_modules` above it. In a checkout,
`pnpm install`. In the container, run it from `/app/scripts/…` — pnpm does not
hoist, so the scripts find the api's dependencies by looking for
`apps/api/package.json` (checkout) or `/app/package.json` (image), and neither is
above a copy you left in `/tmp`.

**The customer says the fleet nav is missing.**
They are signed in as a different account from the one you added, or as a
`driver` (drivers get no fleet UI by design). `pnpm fleet member:list --org <id>`
shows exactly which email holds which role.

**"database is locked".**
Two writers. The api is running and something else is writing `data/app.db` —
usually a stray host-side `pnpm dev:api` pointed at the same file. The CLI waits
5 s and then fails rather than corrupting anything; `docs/operations.md` has the
full checklist.
