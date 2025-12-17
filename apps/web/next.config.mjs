/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@workspace/ui"],
  async rewrites() {
    const apiBase = process.env.API_URL ?? "http://localhost:8080"
    return [
      {
        source: "/opportunities/:path*",
        destination: `${apiBase}/opportunities/:path*`,
      },
      {
        source: "/health/:path*",
        destination: `${apiBase}/health/:path*`,
      },
    ]
  },
}

export default nextConfig
