# Publish Athira's Creative Haven to the Google Play Store

This guide walks through everything from signing the app to uploading it to Google Play.
The native Android project is already set up (Capacitor). Your app loads the **live web app**
set in `capacitor.config.ts` → `server.url`.

---

## 0. Before you start — the 3 things only you can do

### A. Create your release keystore (SECURITY CRITICAL — do this FIRST)
The keystore signs your app. If you lose it or the password, **you can never update the app on the Play Store again**. Back it up to 2 places (USB + password manager) and never commit it.

Run this once, in your project folder, and choose a **strong password you invent and remember**:

```bash
# PowerShell (in the project root)
keytool -genkeypair -v -keystore keystore\ach-release.keystore -alias ach `
  -keyalg RSA -keysize 2048 -validity 10000 `
  -dname "CN=Athira's Creative Haven, OU=Craft Store, O=Athira, L=Kochi, ST=Kerala, C=IN"
```

It will ask for:
- A **keystore password** and **key password** (use the same one, and WRITE IT DOWN).
- Your name/org details (the `-dname` above pre-fills them; press Enter to keep).

Then create `keystore.properties` in the project root (this file is git-ignored):

```
storeFile=keystore/ach-release.keystore
storePassword=YOUR_PASSWORD_HERE
keyAlias=ach
keyPassword=YOUR_PASSWORD_HERE
```

### B. Buy your own domain (recommended before going live)
Update `capacitor.config.ts` → `server.url` from the `*.lovable.app` URL to your own domain
(e.g. `https://creativehaven.in`), then rebuild. A `*.lovable.app` URL works but looks
less professional and ties your app to that host.

### C. Set your real UPI ID
In `src/routes/_authenticated/checkout.tsx`, set `MERCHANT_VPA` to your real UPI ID
(e.g. `yourname@oksbi`). Until you do, UPI payment is disabled for online orders.

---

## 1. Build the release AAB

```bash
npm install
npm run build                    # builds the web app into .output/public
npx cap sync android             # copies latest web build into the Android project

cd android
# Windows:
.\gradlew.bat assembleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

> If you want the release build to be **signed automatically**, skip manual signing and instead
> edit `android/app/build.gradle` to add the `signingConfigs` block pointing at `keystore.properties`.
> Otherwise upload the AAB to Play Console and Google will handle signing via **App Signing by Google Play**,
> which is the safest option (your upload key ≠ your app signing key).

---

## 2. Sideload-test the app on your phone (optional but recommended)

Build a debug APK you can install directly:

```bash
cd android
.\gradlew.bat assembleDebug
```

Install: `android/app/build/outputs/apk/debug/app-debug.apk`
Copy it to your Android phone (USB or WhatsApp/Drive) and tap to install (allow "install unknown apps").

You should see the **Creative Haven** launcher icon (peach/ivory) and the app loading your live store.

---

## 3. Create the Google Play Developer account

1. Go to https://play.google.com/console/
2. **Sign in with a Google account** (use one you'll keep — it becomes the store owner).
3. Pay the **one-time $25 registration fee** (₹~2100). No recurring cost.
4. Complete **identity verification** — Google asks for:
   - Your name & address
   - A government ID / phone verification
   - Sometimes a short video confirmation
   - This takes 1–2 days to review.
5. Accept the developer agreement.

---

## 4. Create the app in Play Console

1. **Create app** → Name: `Athira's Creative Haven` → app type: App → free.
2. Fill in the **Store listing** — copy everything from `STORE_LISTING.md`:
   - Short + full description
   - App icon (1024×1024, from `public/icons/icon-512.png`)
   - Feature graphic 1024×500 (optional)
   - Screenshots (see STORE_LISTING.md list)
   - Category: Shopping
   - **Data safety form** (template in STORE_LISTING.md)
   - **Privacy Policy**: paste the contents of `PRIVACY_POLICY.md`, and host it at a URL
     (e.g. `https://creativehaven.in/privacy` or any free hosting) — Google **requires a URL**.

3. **App content** tab:
   - Content rating questionnaire → "Everyone" (answers in STORE_LISTING.md)
   - Ads: No
   - Target audience: All regions/ages 13+
   - News/email sign-up: No
   - **Data safety**: as in STORE_LISTING.md

4. **Production → Create new release:**
   - Upload the `app-release.aab` from step 1.
   - **App signing by Google Play** → "Let Google manage and protect your app signing key" (recommended).

---

## 5. Review checklist before you press "Send for review"

- [ ] UPI payment works end-to-end on a real phone (test with a small ₹1 order, then cancel/refund).
- [ ] COD checkout works.
- [ ] Login/signup works; order tracking shows the full pipeline.
- [ ] Home screen shows real products, images load.
- [ ] App icon + splash show correctly (peach/ivory theme).
- [ ] Privacy Policy URL is live and matches `PRIVACY_POLICY.md`.
- [ ] `server.url` points to your domain (not the lovable subdomain), or you accept the lovable URL.
- [ ] Testers (yourself + 2 friends) installed `app-debug.apk` and the store loads.
- [ ] Keystore + password backed up in 2 places. ✅

---

## 6. Common rejection reasons (and how to avoid them)

| Rejection | Why | Fix |
|---|---|---|
| "Poor user experience" | App loads a blank page / fails | Test the installed APK; ensure the live URL is reachable from mobile |
| "No privacy policy" | Missing URL | Host `PRIVACY_POLICY.md` at a public URL |
| "Declared data doesn't match" | Data safety form inconsistent | Match the template in `STORE_LISTING.md` exactly |
| "Login broken" | Testers can't create accounts | Test signup on a fresh phone |
| "In-app purchases not declared" | Payments that should be IAP | UPI/COD payments are for physical goods → NOT in-app purchases; declare "digital purchases" as No |

---

## 7. After approval

- Release goes live (can take a few hours).
- To update the app later: bump `versionCode`/`versionName` in `android/app/build.gradle`, rebuild the AAB, upload as a new release. Google Play App Signing keeps your signing key safe even if you lose the upload key.

---

## Cost summary

| Item | Cost |
|---|---|
| Google Play Developer account | **$25 one-time** |
| Own domain (recommended) | ~₹700–₹1,200/yr |
| UPI payments (GPay/PhonePe/Paytm) | Free (small per-transaction bank fee only) |
| App hosting | Already covered by your web host |
| Everything else (keystore, icons, policy) | Free |
