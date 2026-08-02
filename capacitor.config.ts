import type { CapacitorConfig } from "@capacitor/cli";

// Athira's Creative Haven — native Android/iOS shell.
//
// The app itself is a server-rendered web app (TanStack Start + Supabase), so the
// native shell loads the deployed web app. Set LIVE_URL to your production URL
// before building a release.
//
// NOTE: appId must stay identical for the lifetime of the Play Store listing.
const LIVE_URL = "https://craft-unified-flow.lovable.app";

const config: CapacitorConfig = {
  appId: "com.athiras.creativehaven",
  appName: "Creative Haven",
  webDir: ".output/public",
  server: {
    androidScheme: "https",
    url: LIVE_URL,
    cleartext: false,
  },
  android: {
    backgroundColor: "#FFFDF9",
    allowMixedContent: false,
  },
};

export default config;
