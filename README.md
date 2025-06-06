This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Firebase 설정 방법

이 프로젝트는 Firebase Firestore를 사용하여 데이터를 저장합니다. 다음 단계에 따라 Firebase를 설정하세요:

1. [Firebase 콘솔](https://console.firebase.google.com/)에 접속하여 새 프로젝트를 생성합니다.
2. 프로젝트에서 Firestore 데이터베이스를 생성합니다.
3. 프로젝트 설정에서 웹 앱을 추가합니다.
4. 제공된 Firebase 구성 정보를 복사합니다.
5. 프로젝트 루트에 `.env.local` 파일을 생성하고 다음 형식으로 Firebase 구성 정보를 추가합니다:

```
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
```

6. 필요한 패키지를 설치합니다:

```bash
npm install
```

7. 개발 서버를 실행합니다:

```bash
npm run dev
```

## 데이터 마이그레이션

기존 로컬 스토리지 데이터를 Firebase로 마이그레이션하려면:

1. 기존 데이터가 있는 상태에서 앱을 실행합니다.
2. 앱이 자동으로 로컬 데이터를 Firebase로 마이그레이션합니다.
3. 마이그레이션이 완료되면 모든 기기에서 동일한 데이터에 접근할 수 있습니다.
#   T r i g g e r   n e w   b u i l d  
 