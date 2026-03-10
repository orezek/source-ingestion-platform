import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ['192.168.1.9', '127.0.0.1', '::1'],
};

export default nextConfig;
