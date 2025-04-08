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
  console.error('Firebase 연결에 실패할 수 있습니다. 모의 구성을 사용합니다.');
}

// Firebase 구성 정보
// 환경 변수가 없는 경우 개발용 모의 구성 사용
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'demo-project.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'demo-project',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'demo-project.appspot.com',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '123456789012',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:123456789012:web:abc123def456',
};

console.log('Firebase 구성 정보 상세:', {
  apiKeyValid: !!firebaseConfig.apiKey,
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
  appIdValid: !!firebaseConfig.appId
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
      데이터베이스_존재: !!db,
      모의_데이터_사용: missingKeys.length > 0
    });
  } catch (error) {
    console.error('Firebase 초기화 실패:', error);
    console.error('Firebase 구성 정보 확인 필요:', {
      apiKeyExists: !!firebaseConfig.apiKey,
      projectIdExists: !!firebaseConfig.projectId,
      appIdExists: !!firebaseConfig.appId
    });
  }
} else {
  console.log('서버 환경에서는 Firebase를 초기화하지 않습니다.');
}

export { app, db }; 