import type { NextConfig } from 'next';

const config: NextConfig = {
  // Compile the workspace TS packages (no prebuilt dist).
  transpilePackages: ['@decant/core', '@decant/db', '@decant/schemas'],
  // Prisma is server-only; keep it external to the server bundle.
  serverExternalPackages: ['@prisma/client'],
};

export default config;
