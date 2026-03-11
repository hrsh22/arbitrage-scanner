/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  transpilePackages: ["@workspace/ui"],
};

export default nextConfig;
