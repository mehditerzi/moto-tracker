import { Router } from "express";

export const privacyRouter: Router = Router();

// Last revision of the policy text below. Bump when the content changes.
const LAST_UPDATED = "2026-08-28";
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

  <p>Most people use Garaj&#305;m on their own. You can also <strong>share a
  vehicle, or a whole garage, with other people</strong> &mdash; a partner, your
  family, or your mechanic. If you do, <a href="#sharing">Sharing a vehicle with
  other people</a> explains exactly what they can and cannot see.</p>

  <p>Separately, some people use Garaj&#305;m as a member of a company&rsquo;s
  <strong>organization</strong> &mdash; a business that runs a fleet or rents
  vehicles out. If that is you, everything below still applies, and
  <a href="#organizations">Organizations and company vehicles</a> explains what is
  different, including what your employer can see.</p>

  <h2>What we collect</h2>
  <ul>
    <li><strong>Account information:</strong> your email address (and name, if
    provided) to create and secure your account.</li>
    <li><strong>Vehicle information you enter or scan:</strong> plate, make, model,
    year, chassis number, engine number, cylinder capacity, and document expiry
    dates (insurance / kasko / inspection / maintenance). The chassis and engine
    numbers are also used to recognise when two records describe the same real
    vehicle &mdash; see <a href="#sharing">Sharing a vehicle with other
    people</a>.</li>
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
    token/subscription for your device so we can send expiry reminders and the
    sharing notifications described under
    <a href="#sharing-notifications">Notifications about sharing</a>.</li>
    <li><strong>Shared garages:</strong> if you share a vehicle or accept
    somebody&rsquo;s invitation, we store who is in that shared garage, at what
    level, and which vehicles are in it.</li>
    <li><strong>Email addresses you invite:</strong> when you invite somebody to
    a shared garage you give us <strong>their</strong> email address, and we
    store it and send an email to it. That happens whether or not the address
    belongs to somebody who already uses Garaj&#305;m &mdash; including, if you
    mistype it, an address belonging to somebody who has nothing to do with this
    app. See <a href="#sharing-notifications">Notifications about sharing</a> for
    what that email does and does not say, and how long we keep the record.</li>
    <li><strong>Access and ownership requests:</strong> if you ask about a vehicle
    that is already tracked, we store your request, the identifier you supplied,
    the note you wrote and what was decided &mdash; and, once a vehicle changes
    hands, a record of the handover.</li>
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
    you can see each other on the map. The same applies to the route and the rally
    point the ride leader shares with the group. All of it is held
    <strong>in memory only and is never written to disk</strong>. It disappears the
    moment the ride ends, and a server restart drops it entirely. We keep no
    location trail from a group ride beyond the trip you recorded yourself.</li>
    <li><strong>Route planning.</strong> When you plan a route on the map, the start,
    destination and any stops are sent to Apple Maps to compute directions and to
    look up place names (see <a href="#third-party">Third-party services</a>). Your
    planned route and your recently used places are saved
    <strong>on your device only</strong> so they survive closing the app; they are
    never sent to us. Clearing the app's data removes them. We do not store planned
    routes on our servers.</li>
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

  <h2 id="sharing">Sharing a vehicle with other people</h2>
  <p>You can share a vehicle &mdash; or a <strong>shared garage</strong> holding
  several vehicles &mdash; with other people. Nothing is shared unless you
  deliberately do it: you send an invitation to a specific email address, we
  email the invitation to that address, and the other person has to accept it.
  You can remove them, or stop sharing the vehicle, at any time. See
  <a href="#sharing-notifications">Notifications about sharing</a> for what that
  email contains.</p>

  <p>There are two levels, and the difference between them is the whole point.</p>

  <p><strong>Guest</strong> &mdash; for a mechanic, a service, or a friend
  borrowing the vehicle. They can see and update <strong>the vehicle&rsquo;s own
  facts</strong>:</p>
  <ul>
    <li>its make, model, year, plate, chassis number and engine number;</li>
    <li>its renewal dates (inspection / insurance / kasko / MTV);</li>
    <li>its service and maintenance history;</li>
    <li>its odometer reading.</li>
  </ul>
  <p>A guest <strong>cannot</strong> see your trips or the routes you drove, your
  fuel purchases, or any document you scanned against that vehicle. They cannot
  rename the vehicle, change its plate, delete it, or share it onward. They see
  only the vehicles in the garage you shared with them &mdash; never the rest of
  your account.</p>

  <p><strong>Member</strong> &mdash; for a partner or family, when you are
  genuinely sharing a garage. Everything a guest sees, <strong>plus the trips
  recorded on those vehicles (including routes), the fuel purchases logged against
  them, and the documents scanned against them</strong>. Please read that sentence
  before you invite somebody as a member: it means they can see where those
  vehicles were driven and what was spent on them. A member still cannot delete a
  vehicle or manage who else is in the garage.</p>

  <p>Neither level ever exposes your other vehicles, and neither ever exposes
  anything in your account outside the shared garage.</p>

  <p><strong>What the other person contributes.</strong> A vehicle that you put
  into a shared garage still belongs to you &mdash; you remain the person it is
  billed to, and you can take it back out at any time, which immediately ends
  everyone else&rsquo;s access to it. If somebody leaves a shared garage, any
  vehicle of their own goes with them.</p>

  <p><strong>Duplicate vehicles.</strong> The same real vehicle cannot be recorded
  twice: we match on the chassis (VIN) and engine numbers. If you add a vehicle
  that somebody else is already keeping records for, we tell you that the vehicle
  is already tracked and let you either ask for access or say that you bought it
  &mdash; and we tell you <strong>nothing else</strong>. Not who holds it, not
  their name or email address, not the vehicle&rsquo;s nickname, plate, or anything
  else about it. We deliberately do <strong>not</strong> match on plate numbers,
  both because Turkish plates are reassigned to different vehicles over time and
  because a plate is something a stranger can read off a bumper. If you send such a
  request, the current holder sees your name, your email address and the short note
  you wrote, so that they can decide. They are never told anything about you
  otherwise, and you are never told anything about them &mdash; including in the
  notifications either of you receives about it, which are described under
  <a href="#sharing-notifications">Notifications about sharing</a>.</p>

  <h2 id="sharing-notifications">Notifications about sharing</h2>
  <p>Sharing activity sends notifications, because all of it is somebody waiting
  on somebody else. Specifically:</p>
  <ul>
    <li><strong>If you keep records for a vehicle</strong> and somebody asks for
    access to it, or says they bought it, we notify you on your devices. These
    two are always delivered: they start a <strong>three-week window</strong> in
    which you can answer, and it would not be fair to run that clock against
    somebody who was never told. They are the only sharing notifications you
    cannot switch off.</li>
    <li><strong>If you sent such a request</strong>, we notify you when it is
    approved or declined.</li>
    <li><strong>If somebody invites you to a shared garage</strong>, we send an
    email to the address they gave. This one goes to an address rather than to
    an account &mdash; usually somebody who does not use Garaj&#305;m yet &mdash;
    so there is no setting of yours for it to consult. Ignoring it is how you
    decline, and it expires by itself.</li>
    <li>The answers to requests you sent can be turned off in
    <em>Settings &rarr; Sharing</em>. The two above cannot.</li>
  </ul>

  <p><strong>These notifications say as little as the rest of the feature
  does.</strong> A request shown to you names your own vehicle but not the
  person asking &mdash; their name, address and note are on the decision screen
  inside the app, behind your passcode, rather than on your lock screen. An
  answer sent back to you repeats only the chassis or engine number
  <em>you</em> typed: nothing about the vehicle, and nothing about the person
  who answered, whether they said yes or no.</p>

  <p><strong>An invitation email is deliberately almost empty.</strong> It says
  that somebody has invited you to a shared garage, and it carries the link. It
  does <strong>not</strong> name the garage, the vehicles in it, or the person
  inviting you &mdash; because until the link is opened and signed into, all we
  know about that address is that somebody typed it. The name of the garage, how
  many vehicles are in it and exactly what you would be able to see are shown
  after you sign in with that address, which is where the decision to join
  actually gets made. If an invitation reaches you by mistake, ignoring it is
  enough: nothing has been shared with you and no account has been created.</p>

  <p><strong>How long we keep it.</strong> We keep a record that a notification
  was sent &mdash; who it went to, which event it was about and when &mdash; so
  that a retry cannot deliver the same message twice and so that invitation
  emails can be rate-limited. Those records are deleted after 90 days. For an
  invited address that never became an account, that deletion is the only thing
  that removes it, so it is not optional: we do not keep invited addresses
  indefinitely.</p>

  <h2 id="handover">Ownership handover: what happens when a vehicle changes hands</h2>
  <p>If a vehicle is sold, its record can move to the new owner &mdash; either
  because the current holder hands it over, or because they approve a request from
  the buyer. It only ever happens when the <strong>current holder agrees</strong>.
  There is no automatic transfer: if nobody answers a request, nothing happens to
  the vehicle, and the person who asked can start a separate record of their own
  instead.</p>

  <p>A handover moves the facts about the <strong>vehicle</strong>, and nothing
  about the <strong>person</strong>.</p>

  <p><strong>Transfers to the new owner:</strong></p>
  <ul>
    <li>the vehicle&rsquo;s identity &mdash; make, model, year, chassis number,
    engine number;</li>
    <li>its renewal dates (inspection / insurance / kasko / MTV);</li>
    <li>its service and maintenance history;</li>
    <li>its odometer reading.</li>
  </ul>

  <p><strong>Stays with the previous owner, and is never shown to the new
  owner:</strong></p>
  <ul>
    <li>the GPS trips they recorded and the routes they drove;</li>
    <li>their fuel purchases and what they spent;</li>
    <li>every document they scanned, and the images of those documents;</li>
    <li>the photos they took of the vehicle.</li>
  </ul>
  <p>Those records move to an archived copy of the vehicle in the previous
  owner&rsquo;s own garage, so they keep them and can still read them; the new
  owner cannot see them and is never given any reference to them.</p>

  <p><strong>Why the split is drawn there.</strong> A scanned Turkish
  <em>ruhsat</em> carries the previous owner&rsquo;s <strong>T.C. kimlik number,
  name and home address</strong>. A trip log is everywhere they drove. A fuel log
  is what they spent, and where. None of that is information about the car, and
  handing it to whoever bought the car would be a disclosure of personal data with
  no lawful basis under KVKK/GDPR. The service history is different: it is a fact
  about the vehicle, and it is the reason this feature exists. There is no setting
  that changes this.</p>

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
    <li>To send the reminder notifications you opt into, and the sharing
    notifications described under
    <a href="#sharing-notifications">Notifications about sharing</a>.</li>
    <li>To deliver an invitation to the email address you give us when you
    invite somebody into a shared garage, and to limit how many such emails one
    account can cause so that this cannot be used to send unwanted mail.</li>
    <li>To authenticate you and keep your account secure.</li>
    <li>To validate purchases and grant the vehicle allowance you paid for.</li>
    <li>To fix bugs and improve the app, using the first-party usage events above.</li>
    <li>To show a vehicle you have shared to the people you shared it with, at the
    level you chose, as described in
    <a href="#sharing">Sharing a vehicle with other people</a>.</li>
    <li>To recognise when two records describe the same real vehicle, so that one
    vehicle is not tracked twice and its history survives a change of owner. We
    store the chassis and engine numbers you enter or scan for this purpose.</li>
    <li>To run a company&rsquo;s fleet on its behalf, where you are a member of an
    organization: showing that organization the records kept on <em>its</em> vehicles,
    as described in
    <a href="#organizations">Organizations and company vehicles</a>.</li>
  </ul>
  <p>We do <strong>not</strong> sell your data or share it with third parties for
  marketing.</p>

  <h2 id="third-party">Third-party services</h2>
  <ul>
    <li><strong>Email delivery</strong> (sign-in links, password resets, and
    invitations to a shared garage) may be sent via a transactional email
    provider. Only the recipient&rsquo;s email address and the message are
    shared, solely to deliver the email. For an invitation the recipient is the
    person you invited, so it is <em>their</em> address that is passed to the
    provider.</li>
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
  <p>If you have shared vehicles, deleting your account removes them along with
  everything else of yours, and the people you shared with lose access to them at
  the same moment. If a vehicle of yours was <strong>handed over</strong> to
  somebody else before that, it is theirs and stays with them &mdash; but only ever
  with the facts listed under <a href="#handover">Ownership handover</a>; your
  trips, fuel logs and documents were never given to them and are deleted with your
  account.</p>
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
