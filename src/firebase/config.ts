// Firebase 설정 파일
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";

// 환경 변수 값 검증 및 로깅
const firebaseEnvKeys = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

// 모든 환경 변수 로깅 (개발용, 프로덕션에서는 제거 필요)
console.log('=========== FIREBASE 환경 변수 로깅 시작 ===========');
firebaseEnvKeys.forEach(key => {
  console.log(`${key}: ${process.env[key] ? '설정됨' : '설정되지 않음'}`);
  if (key === 'NEXT_PUBLIC_FIREBASE_PROJECT_ID') {
    console.log(`  실제 값: ${process.env[key]}`); // 프로젝트 ID는 공개해도 비교적 안전
  }
});
console.log('=========== FIREBASE 환경 변수 로깅 완료 ===========');

const missingKeys = firebaseEnvKeys.filter(
  key => !process.env[key] || process.env[key] === 'undefined'
);

if (missingKeys.length > 0) {
  console.error(`Firebase 환경 변수가 없습니다: ${missingKeys.join(', ')}`);
  console.error('Firebase 연결에 실패할 수 있습니다.');
}

// Firebase 구성 정보
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

console.log('Firebase 구성 정보 상세:', {
  apiKeyValid: !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_API_KEY.startsWith('AIza'),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  appIdValid: !!process.env.NEXT_PUBLIC_FIREBASE_APP_ID && process.env.NEXT_PUBLIC_FIREBASE_APP_ID.includes(':')
});

// Firebase 앱 초기화 (중복 초기화 방지)
let app: FirebaseApp | undefined;
let db: Firestore | undefined;

// Firebase는 클라이언트에서만 초기화
if (typeof window !== 'undefined') {
  try {
    console.log('Firebase 초기화 시도 중...');
    
    // 기존 앱 확인
    const existingApps = getApps();
    console.log(`기존 Firebase 앱: ${existingApps.length}개`);
    
    if (existingApps.length > 0) {
      app = existingApps[0];
      console.log('기존 Firebase 앱 재사용');
    } else {
      // 환경 변수가 비어있는지 한번 더 확인
      if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
        throw new Error('필수 Firebase 구성 정보가 없습니다. 환경 변수를 확인하세요.');
      }
      
      app = initializeApp(firebaseConfig);
      console.log('새 Firebase 앱 초기화 완료');
    }
    
    // Firestore 초기화
    console.log('Firestore 초기화 시도 중...');
    db = getFirestore(app);
    
    console.log('Firebase 초기화 성공:', {
      appInitialized: !!app,
      dbInitialized: !!db,
      projectId: firebaseConfig.projectId
    });
    
    // 연결 테스트 정보 출력
    console.log('Firebase 연결 정보:', {
      연결된_프로젝트: app.options.projectId || '알 수 없음',
      앱_이름: app.name,
      데이터베이스_존재: !!db
    });
  } catch (error) {
    console.error('Firebase 초기화 실패:', error);
    console.error('Firebase 구성 정보 확인 필요:', {
      apiKeyPrefix: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? process.env.NEXT_PUBLIC_FIREBASE_API_KEY.substring(0, 5) + '...' : '없음',
      projectIdExists: !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appIdFormat: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ? (process.env.NEXT_PUBLIC_FIREBASE_APP_ID.includes(':') ? '유효' : '무효') : '없음'
    });
  }
} else {
  console.log('서버 환경에서는 Firebase를 초기화하지 않습니다.');
}

export { app, db }; 