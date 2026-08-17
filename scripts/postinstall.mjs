import { execSync } from "node:child_process";

// The full desktop Chromium download (~300MB) is only needed for the CLI
// and local dev server (scripts/serve.mjs), both of which use the full
// "playwright" package. Vercel's serverless function (api/scan.js) uses a
// separate, serverless-sized Chromium build instead, so downloading the
// desktop one during Vercel's build wastes build time for nothing. Vercel
// sets the VERCEL env var in every one of its build environments.
if (process.env.VERCEL) {
  console.log("Skipping `playwright install chromium` on Vercel -- api/scan.js uses @sparticuz/chromium instead.");
} else {
  execSync("npx playwright install chromium", { stdio: "inherit" });
}
