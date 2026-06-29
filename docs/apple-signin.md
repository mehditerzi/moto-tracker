# Sign in with Apple

The backend is wired (better-auth `apple` provider, gated on env) and the web
sign-in screen shows an **Apple** button automatically once the two env vars are
set (`/api/public-config` reports it). What's left is the Apple Developer setup
— only you can do this with your account.

## 1. Apple Developer portal
1. **App ID** → enable the **Sign in with Apple** capability (your app
   `com.mehditerzi.mototracker`).
2. **Services ID** (Identifiers → Services IDs) → this is your `APPLE_CLIENT_ID`
   (e.g. `com.mehditerzi.mototracker.web`). Enable Sign in with Apple on it and
   configure:
   - **Domain:** `mototracker.mehditerzi.com`
   - **Return URL:** `https://mototracker.mehditerzi.com/api/auth/callback/apple`
3. **Key** (Keys → +) → enable Sign in with Apple, download the `.p8`. Note the
   **Key ID** and your **Team ID**.

## 2. Generate the client-secret JWT (`APPLE_CLIENT_SECRET`)
Apple's "client secret" is a short-lived ES256 JWT (max 6 months — set a
reminder to regenerate). Generate it from the `.p8`:

```js
import { SignJWT, importPKCS8 } from "jose";
const key = await importPKCS8(fs.readFileSync("AuthKey_XXXX.p8", "utf8"), "ES256");
const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: "<KEY_ID>" })
  .setIssuer("<TEAM_ID>")
  .setSubject("<SERVICE_ID>")          // = APPLE_CLIENT_ID
  .setAudience("https://appleid.apple.com")
  .setIssuedAt()
  .setExpirationTime("180d")
  .sign(key);
console.log(jwt);
```

## 3. Configure + deploy
```
APPLE_CLIENT_ID=<your Service ID>
APPLE_CLIENT_SECRET=<the JWT from step 2>
```
Redeploy the api. The Apple button appears on the sign-in screen.

## Native (optional, later)
The web OAuth flow runs inside the iOS WKWebView and works for the wrapper. For
the App Store-preferred **native** experience, add a Capacitor Sign in with Apple
plugin + the "Sign in with Apple" capability in Xcode, then pass the returned
identity token to `authClient.signIn.social({ provider: "apple", idToken })`.

## Note
This also satisfies **App Store Guideline 4.8** (offer Apple sign-in when you
offer other third-party logins).
