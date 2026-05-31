/** @type {import('next').NextConfig} */
const nextConfig = {
  // ESLint config resolution under ESLint v9 + eslint-config-next can fail in
  // CI/deploy ("Definition for rule … was not found") because inline
  // eslint-disable comments reference @typescript-eslint rules the build's lint
  // pass can't resolve. Linting is a dev/CI concern (`npm run lint`), not a
  // production-build blocker — so we skip it here. TYPE-CHECKING still runs and
  // will fail the build on real type errors.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
