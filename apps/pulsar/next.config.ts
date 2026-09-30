import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// The test-only fault seam (`lib/evidence/fault-seam.ts`) never reaches a
// Vercel build: the code already ignores it there, and this refuses the build.
if (process.env.VERCEL && process.env.PULSAR_FAULT_SEAM) {
  throw new Error("PULSAR_FAULT_SEAM is set on Vercel: the fault seam is test-only; unset it");
}

const nextConfig: NextConfig = {
  // The dev badge defaults to bottom-left, over the desktop rail's face toggle.
  devIndicators: { position: "bottom-right" },
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
