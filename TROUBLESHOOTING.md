# 문제 해결 가이드

## 1. "Missing Required HTML Tag" 오류

### 문제 설명
Next.js 15 버전에서 루트 레이아웃에 `<html>`, `<body>` 태그가 누락되었다는 오류가 발생합니다.

### 해결 방법
`src/app/layout.tsx` 파일을 다음과 같이 수정합니다:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "반품 관리 시스템",
  description: "반품 관리 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className={`antialiased ${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
```

주요 변경사항:
- `<head>` 태그를 명시적으로 추가
- 필수 메타 태그 포함
- `<html>` 태그에서 className을 제거하고 `<body>` 태그에 폰트 변수 적용

## 2. Turbopack 관련 경고

### 문제 설명
"Webpack is configured while Turbopack is not, which may cause problems." 경고가 발생합니다.

### 해결 방법
`next.config.js` 파일에 Turbopack 설정을 추가합니다:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    turbo: {
      // Turbopack 설정
      resolveAlias: {
        // 필요한 경우 별칭 설정
      }
    }
  }
};

module.exports = nextConfig;
```

## 3. 포트 충돌 문제

### 문제 설명
"Error: listen EADDRINUSE: address already in use :::4000" 오류가 발생합니다.

### 해결 방법
실행 중인 Node.js 프로세스를 종료합니다:

```powershell
taskkill /F /IM node.exe
```

## 4. 캐시 관련 문제

### 문제 설명
변경사항이 적용되지 않거나 이전 오류가 계속 발생합니다.

### 해결 방법
Next.js 캐시를 삭제합니다:

```powershell
Remove-Item -Recurse -Force .next
```

npm 캐시를 정리합니다:

```powershell
npm cache clean --force
```

의존성을 다시 설치합니다:

```powershell
npm install
```

## 5. PowerShell에서 && 연산자 사용 문제

### 문제 설명
PowerShell에서 `&&` 연산자를 사용하면 오류가 발생합니다.

### 해결 방법
PowerShell에서는 `;` 또는 파이프라인을 사용하여 명령을 연결합니다:

```powershell
cd ../new-project; npm run dev
```

또는 별도의 명령으로 실행합니다:

```powershell
cd ../new-project
npm run dev
```

## 6. "Failed to fetch" 오류

### 문제 설명
콘솔에 "Error: Failed to fetch" 오류가 발생하고 Call Stack에 "reader.onload" 및 "./src/app/page.tsx"가 표시됩니다.

### 해결 방법
이 오류는 주로 파일 업로드 또는 API 요청 중에 발생합니다. 다음 단계로 해결해 보세요:

1. **API 엔드포인트 확인**:
   ```tsx
   // API 요청 시 오류 처리 추가
   try {
     const response = await fetch('/api/endpoint');
     if (!response.ok) {
       throw new Error(`HTTP error! status: ${response.status}`);
     }
     const data = await response.json();
   } catch (error) {
     console.error('API 요청 오류:', error);
     // 사용자에게 오류 표시
   }
   ```

2. **파일 업로드 코드 수정**:
   ```tsx
   // 파일 업로드 시 오류 처리 추가
   const reader = new FileReader();
   reader.onload = async (e) => {
     try {
       const data = e.target?.result;
       // 데이터 처리
     } catch (error) {
       console.error('파일 처리 오류:', error);
       // 사용자에게 오류 표시
     }
   };
   reader.onerror = (error) => {
     console.error('파일 읽기 오류:', error);
   };
   ```

3. **CORS 문제 해결**:
   `next.config.js` 파일에 CORS 설정 추가:
   ```js
   /** @type {import('next').NextConfig} */
   const nextConfig = {
     async headers() {
       return [
         {
           source: '/api/:path*',
           headers: [
             { key: 'Access-Control-Allow-Credentials', value: 'true' },
             { key: 'Access-Control-Allow-Origin', value: '*' },
             { key: 'Access-Control-Allow-Methods', value: 'GET,DELETE,PATCH,POST,PUT' },
             { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version' },
           ],
         },
       ];
     },
     // 기존 설정...
   };
   ```

4. **네트워크 연결 확인**:
   - 브라우저 개발자 도구의 네트워크 탭에서 실패한 요청 확인
   - 서버가 실행 중인지 확인
   - 방화벽 설정 확인 