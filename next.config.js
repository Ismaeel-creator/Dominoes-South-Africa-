/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app is served through Arena's preview proxy during development.
  allowedDevOrigins: ['*.e2b.app', '*.e2b.dev'],
};

module.exports = nextConfig;
