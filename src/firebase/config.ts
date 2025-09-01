// Firebase 설정 파일
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";

// 환경 변수 체크는 유지하되, 오류 메시지 표시하지 않음
const firebaseEnvKeys = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

// Firebase 구성 정보 - 하드코딩된 값 사용
const firebaseConfig = {
  apiKey: "AIzaSyDqvgH7ZvupoE7v1MddkYqOfnGe_-3tiws",
  authDomain: "return-master.firebaseapp.com",
  projectId: "return-master",
  storageBucket: "return-master.firebasestorage.app",
  messagingSenderId: "551515223341",
  appId: "1:551515223341:web:7239ec2f45b2ba54360fa4",
  measurementId: "G-B7DQW2Q91D"
};

// Firebase 앱 초기화 (중복 초기화 방지)
let app: FirebaseApp | undefined;
let db: Firestore | undefined;

// Firebase는 클라이언트에서만 초기화
if (typeof window !== 'undefined') {
  try {
    // 기존 앱 확인
    const existingApps = getApps();
    
    if (existingApps.length > 0) {
      app = existingApps[0];
    } else {
      app = initializeApp(firebaseConfig);
    }
    
    // Firestore 초기화
    db = getFirestore(app);
    
    console.log('Firebase 초기화 성공:', {
      appInitialized: !!app,
      dbInitialized: !!db,
      projectId: firebaseConfig.projectId
    });
  } catch (error) {
    console.error('Firebase 초기화 실패:', error);
  }
} else {
  console.log('서버 환경에서는 Firebase를 초기화하지 않습니다.');
}

export { app, db }; 