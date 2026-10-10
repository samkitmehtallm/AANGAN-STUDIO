import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Nothing in this app should be statically cached: every page reads leads.
  experimental: {},
}

export default nextConfig
