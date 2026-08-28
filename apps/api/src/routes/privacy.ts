import { Router } from "express";

export const privacyRouter: Router = Router();

// Last revision of the policy text below. Bump when the content changes.
const LAST_UPDATED = "2026-08-17";
const CONTACT_EMAIL = "mehditerzi32@hotmail.com";

// Self-contained HTML so the page renders with no JS and no app bundle — App
// Review must be able to open the Privacy Policy URL without logging in.
//
// On the fleet sections: docs/fleet-design.md keeps fleet invisible to
// consumers and forbids any in-app path to acquiring it. A privacy disclosure
// is not that path — it names no price, no sales contact and no way to sign up,
// and it is written for someone who has ALREADY been added to an organization
// by their employer. Under KVKK/GDPR we cannot silently omit that a fleet
// manager can read an employee's GPS routes, so it is disclosed here in full.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="all" />
<title>Garajım — Privacy Policy</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 2.5rem 1.25rem;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a; background: #fafafa;
  }
  main { max-width: 44rem; margin: 0 auto; }
  h1 { font-size: 1.7rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 .5rem; }
  .updated { color: #6b7280; font-size: .9rem; margin: 0 0 1.5rem; }
  ul { padding-left: 1.25rem; }
  li { margin: .35rem 0; }
  a { color: #4d7c0f; }
  strong { font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    body { color: #e5e5e5; background: #0a0a0a; }
    .updated { color: #9ca3af; }
    a { color: #a3e635; }
  }
</style>
</head>
<body>
<main>
  <h1>Garajım — Privacy Policy</h1>
  <p class="updated">Last updated: ${LAST_UPDATED}</p>

  <p>Garajım (&ldquo;the app&rdquo;) helps you track your vehicle documents and
  their expiry dates, record the trips you ride, and ride together with friends on a
  live map. This policy explains what data the app collects, why, and how it is
  handled. The service is operated by the app&rsquo;s owner on self-hosted
  infrastructure.</p>

  <p>Most people use Garaj&#305;m on their own. Some use it as a member of a
  company&rsquo;s <strong>organization</strong> &mdash; a business that runs a fleet or
  rents vehicles out. If that is you, everything below still applies, and
  <a href="#organizations">Organizations and company vehicles</a> explains what is
  different, including what your employer can see.</p>

  <h2>What we collect</h2>
  <ul>
    <li><strong>Account information:</strong> your email address (and name, if
    provided) to create and secure your account.</li>
    <li><strong>Vehicle information you enter or scan:</strong> plate, make, model,
    year, chassis number, engine number, cylinder capacity, and document expiry
    dates (insurance / kasko / inspection / maintenance).</li>
    <li><strong>Document photos:</strong> images you capture or upload of your
    vehicle documents. They are processed to read the dates and vehicle details,
    then stored so you can review them.</li>
    <li><strong>Location data:</strong> if you grant location permission, the app
    records your trips (distance, start/end time, and the route you rode) and shares
    your live position with the friends in a group ride you join. See
    <a href="#location">Location data</a> below for the full detail.</li>
    <li><strong>Purchase records:</strong> if you buy a vehicle pack, we store the
    App Store transaction identifiers, the product you bought, and the purchase and
    expiry dates, so we can grant and renew what you paid for.</li>
    <li><strong>Usage events:</strong> a small first-party log of in-app actions
    (for example &ldquo;a trip was logged&rdquo;, &ldquo;a scan failed&rdquo;) used
    to find bugs and improve the app.</li>
    <li><strong>Notification token:</strong> if you enable reminders, a push
    token/subscription for your device so we can send expiry reminders.</li>
    <li><strong>Organization membership:</strong> if a company adds you to its
    organization, we store which organization you belong to, your role in it, and
    which of its vehicles is assigned to you &mdash; see
    <a href="#organizations">Organizations and company vehicles</a>.</li>
  </ul>
  <p>We do <strong>not</strong> collect advertising identifiers, contacts, or
  browsing activity, and we do not use third-party analytics or advertising SDKs.</p>

  <h2 id="location">Location data</h2>
  <p>Location is <strong>optional</strong>. The app asks for it only when you use a
  feature that needs it, and it works without it &mdash; you can still track
  documents, expiry dates, and maintenance. You can revoke the permission at any
  time in iOS Settings.</p>
  <ul>
    <li><strong>Trip tracking.</strong> With your permission the app reads your
    device&rsquo;s GPS position while you ride, including
    <strong>in the background</strong> so a drive is still measured when the app is
    not on screen. When a trip ends, we store its distance, start and end time, the
    number of samples, and a simplified version of the route you rode (an encoded
    polyline) against the vehicle you assigned it to. Positions are processed on
    your device during the ride; only the finished trip is sent to the server.</li>
    <li><strong>Live group rides.</strong> While you are in a group ride, your
    position is sent to the server and relayed to the other members of that ride so
    you can see each other on the map. These live positions are held
    <strong>in memory only and are never written to disk</strong>. They disappear the
    moment you leave the ride, and a server restart drops them entirely. We keep no
    location trail from a group ride beyond the trip you recorded yourself.</li>
    <li><strong>Route planning.</strong> When you plan a route on the map, the start
    and destination are sent to Apple Maps to compute directions (see
    <a href="#third-party">Third-party services</a>). We do not store planned
    routes.</li>
    <li><strong>Trips on a company vehicle.</strong> If you record a trip on a
    vehicle that belongs to an organization you are a member of, that trip &mdash;
    <strong>including the route you drove</strong> &mdash; is visible to that
    organization&rsquo;s management. This is monitoring in a working relationship and
    we set it out in full under
    <a href="#organizations">Organizations and company vehicles</a>. Trips on your
    own vehicles are never visible to an organization.</li>
  </ul>
  <p>Your location is used only for these features. It is never used for
  advertising and never sold. It is not shared with anyone other than the ride
  members you deliberately ride with and &mdash; for a trip recorded on a company
  vehicle &mdash; the organization that vehicle belongs to.</p>

  <h2 id="organizations">Organizations and company vehicles</h2>
  <p>An <strong>organization</strong> is a company account: a fleet operator whose
  vehicles are driven by its people, or a rental business whose vehicles go out to
  customers. Organizations are set up for a company by the operator of this service.
  You are in one only because somebody at that company added you &mdash; it cannot
  happen by accident, and nothing in the app puts you in one.</p>

  <p>Membership changes exactly one thing: <strong>the company&rsquo;s vehicles are
  shared</strong>. Your own garage is untouched. Your personal vehicles, their
  documents, and the trips you record on them stay yours and are never visible to any
  organization, even one you are a member of.</p>

  <p><strong>What the organization can see.</strong> For each vehicle that belongs to
  it, the organization&rsquo;s owner, managers and office staff can see everything
  recorded against that vehicle, whoever recorded it:</p>
  <ul>
    <li>its documents and their images, expiry dates, maintenance history, fuel
    purchases and odometer readings;</li>
    <li><strong>the trips recorded on it &mdash; including the route, the start and
    end time, and the distance &mdash; and which member recorded each one</strong>;</li>
    <li>who currently holds the vehicle, and the history of who held it before.</li>
  </ul>

  <p><strong>This means your employer can see where a company vehicle went, when, and
  who was driving it.</strong> We are not going to dress that up. It is there because
  a fleet has to account for its vehicles&rsquo; mileage, costs and compliance &mdash;
  but it is monitoring of employees, so it has limits, and these are they:</p>
  <ul>
    <li>It covers <strong>company vehicles only</strong>. A trip on your own vehicle
    is invisible to the organization, and so is the rest of your account.</li>
    <li>It is <strong>a record of the vehicle, not a live track of you</strong>.
    Managers get no real-time position feed, and your live position in a group ride is
    never shared with an organization.</li>
    <li>Trip recording still depends on the location permission you grant on your own
    device, and the app works without it. You can decline or revoke it at any time in
    iOS Settings; what your job requires of you is between you and your employer.</li>
    <li>A <strong>driver sees only the vehicle currently assigned to them</strong> and
    loses that access the moment it is handed back. Drivers cannot see the rest of the
    fleet, other drivers, or anyone else&rsquo;s trips.</li>
    <li>Reminders about a company vehicle&rsquo;s expiring documents go to the
    organization&rsquo;s owner, managers and staff as well as to the driver currently
    holding it, so the person accountable for it actually hears about it.</li>
  </ul>

  <p><strong>Who is responsible for it.</strong> The organization decides that it wants
  these records and what it does with them, so for everything on its vehicles the
  organization is the <em>data controller</em> (KVKK: <em>veri sorumlusu</em>) and we
  are its <em>processor</em> (<em>veri i&#351;leyen</em>) &mdash; we host the data and
  act on the organization&rsquo;s instructions, and we do not use it for any purpose of
  our own. Your employer is responsible for telling you that company vehicles are
  tracked, for having a lawful basis for doing so, and for how long it keeps the
  records. If you cannot get an answer from them, write to us at the address below and
  we will help.</p>

  <h2 id="org-customers">Information an organization holds about other people</h2>
  <p>A rental business using Garaj&#305;m records the people it rents vehicles to: name,
  phone number, email address, whatever it chooses to write in the notes field, and the
  rental contracts themselves &mdash; dates, handover and return odometer, and the
  agreed rate. Those people are usually not users of this app, and we have no
  relationship with them.</p>
  <p>That information is the organization&rsquo;s, in the sense that matters legally: it
  decides which customers to record, what to record about them, and how long to keep
  them. The organization is the <em>data controller</em>; we host the data as its
  <em>processor</em> and use it for nothing else &mdash; never for marketing, never for
  analytics, and never shared with anyone.</p>
  <p><strong>How it is deleted.</strong> The organization can delete a customer from
  inside the app; doing so erases that customer&rsquo;s record and every rental contract
  attached to it. Deleting the organization erases all of its customers at once. If you
  have rented a vehicle from a business that uses Garaj&#305;m and you want your details
  removed, ask that business &mdash; they can do it themselves, immediately. You can also
  write to us at the address below and we will pass the request on and act on it as far
  as we are permitted to.</p>

  <h2>How your document images are processed</h2>
  <p>Date and field extraction (OCR) runs on the operator&rsquo;s own server
  infrastructure. Document images are <strong>not</strong> sent to third-party
  AI/advertising services for this purpose.</p>

  <h2>Usage analytics</h2>
  <p>The app sends a small batch of usage events to <em>our own</em> server &mdash;
  no third-party analytics product is involved and nothing leaves our
  infrastructure. An event is a short name plus a few aggregate numbers (for
  example the rounded distance of a logged trip) and an app-session identifier. We
  do <strong>not</strong> put coordinates, routes, plate numbers, or document
  contents in these events, and we do not use them to build an advertising or
  cross-site profile.</p>

  <h2>How we use your data</h2>
  <ul>
    <li>To provide the core features: reading, storing, and reminding you about your
    document expiry dates; recording your trips; and showing group rides on a map.</li>
    <li>To send the reminder notifications you opt into.</li>
    <li>To authenticate you and keep your account secure.</li>
    <li>To validate purchases and grant the vehicle allowance you paid for.</li>
    <li>To fix bugs and improve the app, using the first-party usage events above.</li>
    <li>To run a company&rsquo;s fleet on its behalf, where you are a member of an
    organization: showing that organization the records kept on <em>its</em> vehicles,
    as described in
    <a href="#organizations">Organizations and company vehicles</a>.</li>
  </ul>
  <p>We do <strong>not</strong> sell your data or share it with third parties for
  marketing.</p>

  <h2 id="third-party">Third-party services</h2>
  <ul>
    <li><strong>Email delivery</strong> (e.g. for sign-in links / password resets)
    may be sent via a transactional email provider. Only your email address and the
    message are shared, solely to deliver the email.</li>
    <li><strong>Apple Maps (MapKit).</strong> Maps, tiles, and route directions are
    provided by Apple. Displaying a map or planning a route sends the relevant
    coordinates to Apple, subject to Apple&rsquo;s own privacy policy.</li>
    <li><strong>Apple App Store &amp; push notifications.</strong> Purchases are
    processed by Apple &mdash; we never see your payment details, only the
    transaction records described above. Notifications are delivered through
    Apple&rsquo;s Push Notification service.</li>
  </ul>

  <h2>Data retention &amp; deletion</h2>
  <p>Your data is retained while your account is active. In the app you can delete
  individual vehicles, documents, dated records, and trips &mdash; deleting a trip
  removes its route from the server. Live group-ride positions are never stored, so
  there is nothing to delete.</p>
  <p>You can <strong>delete your entire account from inside the app</strong>:
  <em>Settings &rarr; Delete account</em>. This permanently removes your account and
  everything attached to it &mdash; vehicles, documents and their uploaded images,
  dated and maintenance records, trips and their routes, fuel logs, ride
  memberships, notification tokens, purchase records, and usage events. It cannot be
  undone. If you would rather not do it yourself, email us at the address below and
  we will remove it for you.</p>
  <p>If you are a member of an organization, deleting your account removes
  <strong>you</strong>: your account, your personal vehicles and everything on them,
  your memberships, and your vehicle assignments. The company&rsquo;s own records
  &mdash; its vehicles, their documents, their service history, and the trips recorded
  on them &mdash; stay with the organization, because they are the company&rsquo;s and
  not yours; wherever such a record still carried your name, it is handed to another
  member of the organization, so your identifier does not survive in it. If you were
  the last remaining member, the organization and everything in it is deleted along
  with you.</p>
  <p>Records an organization holds about its own customers are deleted by that
  organization &mdash; see
  <a href="#org-customers">Information an organization holds about other people</a>.</p>

  <h2>Security</h2>
  <p>Data is transmitted over HTTPS and stored on access-controlled infrastructure.
  Sessions use secure, signed cookies.</p>

  <h2>Children</h2>
  <p>The app is not directed at children under 13 and does not knowingly collect
  their data.</p>

  <h2>Changes</h2>
  <p>We may update this policy; the &ldquo;last updated&rdquo; date above reflects
  the latest revision.</p>

  <h2>Contact</h2>
  <p>Questions or deletion requests:
  <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
</main>
</body>
</html>`;

privacyRouter.get("/", (_req, res) => {
  res.type("html").send(PAGE);
});
