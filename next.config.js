/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 정적 내보내기 설정 (배포용)
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  eslint: {
    // 빌드 시 ESLint 경고 무시 (배포용)
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig; 