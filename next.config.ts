import type { NextConfig } from "next";

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH?.trim().replace(/\/+$/, "");

const nextConfig: NextConfig = {
  ...(appBasePath && appBasePath !== "/"
    ? {
        basePath: appBasePath.startsWith("/") ? appBasePath : `/${appBasePath}`,
      }
    : {}),
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
