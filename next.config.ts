import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Origenes que pueden usar HMR en dev desde otra IP (movil en la misma WiFi). */
  allowedDevOrigins: ["192.168.1.37"],
};

export default nextConfig;
