/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 정적 내보내기 설정 (배포용)
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true
  },
};

module.exports = nextConfig; 