import type { NextConfig } from "next";
import path from "path";

const X402_PACKAGES = ["@x402/core", "@x402/evm", "@x402/extensions", "@x402/express", "@x402/fetch", "@x402/svm"];

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  reactStrictMode: true,
  devIndicators: false,
  // Always defined, so an unset flag is inlined as "" and the burner wallet code is dropped from the bundle
  // (services/web3/wagmiConnectors.tsx); an undefined NEXT_PUBLIC_ variable would stay a runtime lookup.
  env: {
    NEXT_PUBLIC_ENABLE_BURNER_WALLET: process.env.NEXT_PUBLIC_ENABLE_BURNER_WALLET ?? "",
  },
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  webpack: (config, { dev }) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // RainbowKit's Base Account connector pulls in @coinbase/cdp-sdk. An npm scaffold has no
    // lockfile and gets the current cdp-sdk (1.56.0 on 2026-09-24), which imports optional
    // @x402/* packages that are not installed, so `next build` fails with "Module not found".
    // The app never calls x402, so those imports resolve to empty modules. yarn.lock pins
    // cdp-sdk 1.44.1, which has no such imports.
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(X402_PACKAGES.map(name => [name, false])),
    };
    if (dev) {
      config.watchOptions = {
        followSymlinks: true,
      };
      config.snapshot = { ...(config.snapshot as object), managedPaths: [] };
    }
    return config;
  },
};

module.exports = nextConfig;
