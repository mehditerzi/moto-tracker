/**
 * Submit the prepared App Store version for review.
 *
 * WHY THIS EXISTS.
 *
 * `docs/ios-release.md` used to say that everything except the final submit
 * could be scripted. That was the one manual step in the pipeline, and on
 * 2026-09-05 it was where the release actually died: version 1.3 had been
 * sitting in PREPARE_FOR_SUBMISSION since 2026-08-30 with build 10 attached,
 * complete metadata, complete screenshots and ten APPROVED subscriptions —
 * every fix from the 2026-08-28 batch built and ready — while users were still
 * on 1.1 from 2026-07-20, hitting the Sign in with Apple bug that 1.1 shipped
 * with (no `allowNavigation`, so Apple's page opened in Safari and set the
 * session cookie in Safari's cookie jar).
 *
 * Nothing was broken. Nobody had pressed submit. A pipeline whose last step is
 * a human clicking a button in a web UI will eventually stall on that button,
 * and the failure is invisible — the dashboard looks "ready", not "stuck".
 *
 * So the submit is scripted, and the runbook no longer claims it cannot be.
 *
 * WHAT IT DOES.
 *
 *   1. POST /v1/reviewSubmissions       create a submission for the app
 *   2. POST /v1/reviewSubmissionItems   add the app store version to it
 *   3. PATCH /v1/reviewSubmissions/{id} set submitted=true
 *
 * Step 3 is the irreversible one: it puts the build in front of Apple review
 * and, when `releaseType` is AFTER_APPROVAL, an approval releases it to users
 * with no further prompt. Hence a dry run by default — `--apply` is required
 * to write anything.
 *
 * Preflight refuses to submit something that would be rejected or that would
 * double-submit. It checks, and reports rather than guesses:
 *
 *   - exactly one version is in a submittable state
 *   - a build is attached, and it is VALID (not still PROCESSING)
 *   - `usesNonExemptEncryption` is answered — null silently blocks submission
 *     and the ASC UI only raises it at the final step, so it is easy to miss
 *   - every localization has a description and at least one screenshot set
 *   - no other submission is already in flight
 *
 * Usage:
 *   ASC_ISSUER_ID=<uuid> node scripts/asc-submit-version.mjs            # dry run
 *   ASC_ISSUER_ID=<uuid> node scripts/asc-submit-version.mjs --apply    # submit
 *   ASC_ISSUER_ID=<uuid> node scripts/asc-submit-version.mjs --version 1.4
 * Env:
 *   ASC_ISSUER_ID  (required) Users and Access → Integrations → App Store Connect API
 *   ASC_KEY_ID     (default K5U84RN5N3)
 *   ASC_KEY_PATH   (default secrets/asc/AuthKey_<keyid>.p8)
 *   ASC_BUNDLE_ID  (default com.mehditerzi.mototracker)
 */
import crypto from "node:crypto";
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const versionFlagIndex = process.argv.indexOf("--version");
const WANT_VERSION = versionFlagIndex === -1 ? null : process.argv[versionFlagIndex + 1];

const BUNDLE_ID = process.env.ASC_BUNDLE_ID ?? "com.mehditerzi.mototracker";
const ISSUER = process.env.ASC_ISSUER_ID;
const KEY_ID = process.env.ASC_KEY_ID ?? "K5U84RN5N3";
const KEY_PATH = process.env.ASC_KEY_PATH ?? `secrets/asc/AuthKey_${KEY_ID}.p8`;

if (!ISSUER) {
  console.error("ASC_ISSUER_ID is required (UUID from the Integrations page).");
  console.error("  ASC_ISSUER_ID=<uuid> node scripts/asc-submit-version.mjs");
  process.exit(1);
}
if (!fs.existsSync(KEY_PATH)) {
  console.error(`Private key not found at ${KEY_PATH} (set ASC_KEY_PATH).`);
  process.exit(1);
}
const PRIVATE_KEY = fs.readFileSync(KEY_PATH, "utf8");
const BASE = "https://api.appstoreconnect.apple.com";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const payload = b64u(
    JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }),
  );
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: PRIVATE_KEY,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${b64u(sig)}`;
}
const TOKEN = jwt();

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* Apple occasionally answers with a non-JSON error body */
  }
  if (!res.ok) {
    console.error(`\n${method} ${path} -> ${res.status}`);
    for (const e of json.errors ?? []) console.error(`  ${e.code}: ${e.title} — ${e.detail}`);
    if (!json.errors) console.error(`  ${text.slice(0, 500)}`);
    process.exit(1);
  }
  return json;
}
const get = (path) => call("GET", path);

/* ---------------------------------------------------------------- resolve */

const apps = await get(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
const app = apps.data?.[0];
if (!app) {
  console.error(`No app found for bundle id ${BUNDLE_ID}.`);
  process.exit(1);
}
console.log(`App: ${app.attributes.name} (${app.id})`);

// States from which a version can still be sent to review. Anything already in
// review, or live, is not our business.
const SUBMITTABLE = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

const versions = await get(
  `/v1/apps/${app.id}/appStoreVersions?limit=20&fields[appStoreVersions]=versionString,appStoreState,releaseType,platform`,
);
const candidates = (versions.data ?? []).filter((v) =>
  WANT_VERSION
    ? v.attributes.versionString === WANT_VERSION
    : SUBMITTABLE.has(v.attributes.appStoreState),
);

if (!candidates.length) {
  console.log("\nNothing to submit — no version is in a submittable state.");
  for (const v of versions.data ?? []) {
    console.log(`  ${v.attributes.versionString.padEnd(6)} ${v.attributes.appStoreState}`);
  }
  process.exit(0);
}
if (candidates.length > 1) {
  console.error("\nMore than one version is submittable — pass --version to disambiguate:");
  for (const v of candidates) {
    console.error(`  ${v.attributes.versionString.padEnd(6)} ${v.attributes.appStoreState}`);
  }
  process.exit(1);
}

const version = candidates[0];
const versionId = version.id;
console.log(
  `Version: ${version.attributes.versionString} (${version.attributes.appStoreState}), ` +
    `release ${version.attributes.releaseType}`,
);
if (!SUBMITTABLE.has(version.attributes.appStoreState)) {
  console.error(
    `\nVersion ${version.attributes.versionString} is ${version.attributes.appStoreState} — not submittable.`,
  );
  process.exit(1);
}

/* -------------------------------------------------------------- preflight */

console.log("\nPreflight:");
const problems = [];

const buildRes = await fetch(`${BASE}/v1/appStoreVersions/${versionId}/build`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
const build = buildRes.ok ? (await buildRes.json()).data : null;
if (!build) {
  problems.push("no build is attached to the version");
  console.log("  build ................ MISSING");
} else {
  const full = await get(`/v1/builds/${build.id}`);
  const a = full.data.attributes;
  console.log(
    `  build ................ ${a.version} (${a.processingState}, encryption=${a.usesNonExemptEncryption})`,
  );
  if (a.processingState !== "VALID") {
    problems.push(`build ${a.version} is ${a.processingState}, not VALID`);
  }
  if (a.usesNonExemptEncryption === null) {
    // Blocks submission, and the UI only asks at the very last step.
    problems.push(
      `build ${a.version} has usesNonExemptEncryption=null — set ITSAppUsesNonExemptEncryption in Info.plist`,
    );
  }
  if (a.expired) problems.push(`build ${a.version} has expired`);
}

const locs = await get(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`);
for (const l of locs.data ?? []) {
  const sets = await get(`/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets`);
  const shotCount = (sets.data ?? []).length;
  const hasDescription = Boolean(l.attributes.description);
  console.log(
    `  ${l.attributes.locale.padEnd(20, ".")} description=${hasDescription ? "ok" : "MISSING"} screenshotSets=${shotCount}`,
  );
  if (!hasDescription) problems.push(`${l.attributes.locale} has no description`);
  if (!shotCount) problems.push(`${l.attributes.locale} has no screenshots`);
}

// A submission already in flight means a second one would be rejected, and
// creating it would leave a stray draft behind.
const existing = await get(`/v1/reviewSubmissions?filter[app]=${app.id}&limit=20`);
const inFlight = (existing.data ?? []).filter(
  (s) => !["COMPLETE", "CANCELING"].includes(s.attributes.state),
);
console.log(`  submissions in flight  ${inFlight.length}`);
for (const s of inFlight) console.log(`    ${s.id} ${s.attributes.state}`);

if (problems.length) {
  console.error("\nNot submitting — fix these first:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
if (inFlight.length) {
  console.log("\nA submission is already in flight; nothing to do.");
  process.exit(0);
}
console.log("\nAll checks passed.");

if (!APPLY) {
  console.log(
    `\nDRY RUN — nothing was written.\n` +
      `Re-run with --apply to submit ${version.attributes.versionString} for review.` +
      (version.attributes.releaseType === "AFTER_APPROVAL"
        ? "\nNote: releaseType is AFTER_APPROVAL — approval releases it to users automatically."
        : ""),
  );
  process.exit(0);
}

/* ----------------------------------------------------------------- submit */

console.log("\n1/3 creating reviewSubmission…");
const created = await call("POST", "/v1/reviewSubmissions", {
  data: {
    type: "reviewSubmissions",
    attributes: { platform: version.attributes.platform ?? "IOS" },
    relationships: { app: { data: { type: "apps", id: app.id } } },
  },
});
const submissionId = created.data.id;
console.log(`    id=${submissionId} state=${created.data.attributes.state}`);

console.log("2/3 adding the version as a submission item…");
const item = await call("POST", "/v1/reviewSubmissionItems", {
  data: {
    type: "reviewSubmissionItems",
    relationships: {
      reviewSubmission: { data: { type: "reviewSubmissions", id: submissionId } },
      appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
    },
  },
});
console.log(`    id=${item.data.id}`);

console.log("3/3 submitting for review…");
const done = await call("PATCH", `/v1/reviewSubmissions/${submissionId}`, {
  data: { type: "reviewSubmissions", id: submissionId, attributes: { submitted: true } },
});
console.log(`    state=${done.data.attributes.state} submitted=${done.data.attributes.submittedDate}`);

console.log(
  `\nVersion ${version.attributes.versionString} is with Apple review.\n` +
    `Track it:  ASC_ISSUER_ID=… node scripts/asc-list-iap.mjs   (or the Versions tab)`,
);
