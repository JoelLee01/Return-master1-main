/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Serverless Function 최대 실행 시간 설정 (초 단위)
  serverRuntimeConfig: {
    maxDuration: 60 // 60초
  },
};

module.exports = nextConfig; 