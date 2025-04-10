/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Serverless Function 최대 실행 시간 설정 (초 단위)
  serverRuntimeConfig: {
    maxDuration: 60 // 60초
  },
  eslint: {
    // ESLint 설정 간소화
    ignoreDuringBuilds: false, // 빌드 중 ESLint 오류를 무시하지 않음
  },
};

module.exports = nextConfig; 