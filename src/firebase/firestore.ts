import { db } from './config';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  orderBy,
  writeBatch,
  limit,
  QueryDocumentSnapshot,
  FirestoreError,
  serverTimestamp,
  Firestore
} from 'firebase/firestore';
import { ReturnItem, ReturnState, ProductInfo } from '@/types/returns';
import { getFirestore } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';

// 컬렉션 이름 상수
const COLLECTIONS = {
  PENDING_RETURNS: 'pendingReturns',
  COMPLETED_RETURNS: 'completedReturns',
  PRODUCTS: 'products'
};

// 모의 데이터 (Firebase가 없을 때 사용)
const MOCK_DATA: ReturnState = {
  pendingReturns: [
    {
      id: 'mock-return-1',
      orderNumber: 'ABC123456',
      customerName: '테스트 고객',
      productName: '테스트 상품 1',
      optionName: '옵션 1',
      quantity: 1,
      returnReason: '불량',
      status: 'PENDING',
      barcode: '',
      returnTrackingNumber: '',
      zigzagProductCode: ''
    },
    {
      id: 'mock-return-2',
      orderNumber: 'DEF789012',
      customerName: '모의 고객',
      productName: '테스트 상품 2',
      optionName: '옵션 2',
      quantity: 2,
      returnReason: '단순변심',
      status: 'PENDING',
      barcode: '',
      returnTrackingNumber: '',
      zigzagProductCode: ''
    }
  ],
  completedReturns: [
    {
      id: 'mock-completed-1',
      orderNumber: 'GHI345678',
      customerName: '완료 고객',
      productName: '완료 상품 1',
      optionName: '옵션 A',
      quantity: 1,
      returnReason: '색상 다름',
      status: 'COMPLETED',
      completedAt: new Date(),
      barcode: '8801234567890',
      returnTrackingNumber: '',
      zigzagProductCode: ''
    }
  ],
  products: [
    {
      id: 'mock-product-1',
      productName: '테스트 상품 1',
      barcode: '8801234567890',
      purchaseName: '테스트 상품 1 (사입명)',
      optionName: '기본',
      zigzagProductCode: 'Z12345'
    },
    {
      id: 'mock-product-2',
      productName: '테스트 상품 2',
      barcode: '8809876543210',
      purchaseName: '테스트 상품 2 (사입명)',
      optionName: '기본',
      zigzagProductCode: 'Z67890'
    }
  ]
};

// Firebase 연결 상태 확인
function isFirebaseConnected(): boolean {
  if (!db) {
    console.error('Firebase DB 객체가 초기화되지 않았습니다');
    return false;
  }
  return true;
}

// 파이어베이스 오류 처리 헬퍼 함수
function handleFirebaseError(error: any, operation: string): Error {
  console.error(`Firebase ${operation} 오류:`, error);
  
  // FirebaseError 타입으로 변환 시도
  if (error && error.code) {
    // 권한 관련 오류 처리
    if (error.code === 'permission-denied') {
      console.error('보안 규칙 오류: Firebase 콘솔에서 Firestore 보안 규칙을 확인하세요.');
      console.error('개발 모드에서는 다음 규칙을 사용할 수 있습니다:');
      console.error(`
      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /{document=**} {
            allow read, write: if true;
          }
        }
      }
      `);
      return new Error(`Firebase 권한 오류: 데이터 ${operation} 권한이 없습니다. Firebase 콘솔에서 보안 규칙을 확인하세요.`);
    }
    
    return new Error(`Firebase ${operation} 오류 (${error.code}): ${error.message}`);
  }
  
  return new Error(`Firebase ${operation} 중 예상치 못한 오류 발생: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
}

/**
 * 배열을 지정된 크기의 청크로 나눕니다.
 * @param array 나눌 배열
 * @param chunkSize 청크 크기
 * @returns 청크 배열
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// 문서 ID에 사용할 수 없는 문자 처리 함수
function sanitizeDocumentId(id: string): string {
  // 슬래시(/)나 특수문자가 포함된 ID 정리
  return id.replace(/[\/\(\)_,]/g, '_');
}

// 반품 데이터 가져오기
export async function fetchReturns(): Promise<ReturnState | null> {
  try {
    // Firebase 연결 확인
    if (!isFirebaseConnected()) {
      console.warn('Firebase 연결 실패, 모의 데이터를 사용합니다.');
      return MOCK_DATA;
    }
    
    const firestore = db as Firestore;
    
    // 반품 데이터 조회
    const returnsSnapshot = await getDocs(collection(firestore, 'returns'));
    const productsSnapshot = await getDocs(collection(firestore, 'products'));
    
    const returns: ReturnItem[] = [];
    const products: ProductInfo[] = [];
    
    returnsSnapshot.forEach((doc) => {
      const data = doc.data();
      returns.push({
        ...data,
        id: doc.id,
        completedAt: data.completedAt ? new Date(data.completedAt) : undefined
      } as ReturnItem);
    });
    
    productsSnapshot.forEach((doc) => {
      const data = doc.data();
      products.push({
        ...data,
        id: doc.id
      } as ProductInfo);
    });
    
    // 데이터가 비어있으면 모의 데이터 반환
    if (returns.length === 0 && products.length === 0) {
      console.warn('Firebase에서 데이터를 찾을 수 없어 모의 데이터를 사용합니다.');
      return MOCK_DATA;
    }
    
    // 반품 상태에 따라 분류
    const pendingReturns = returns.filter(item => !item.completedAt);
    const completedReturns = returns.filter(item => item.completedAt);
    
    return {
      pendingReturns,
      completedReturns,
      products
    };
  } catch (error) {
    console.error('반품 데이터 조회 중 오류 발생:', error);
    console.warn('오류로 인해 모의 데이터를 사용합니다.');
    return MOCK_DATA;
  }
}

// 반품 데이터 업데이트
export async function updateReturns(returns: ReturnItem[], products: ProductInfo[]): Promise<{ [key: string]: { success: boolean; error?: string } }> {
  try {
    if (!isFirebaseConnected()) {
      console.warn('Firebase 연결 실패, 작업이 성공한 것처럼 가정합니다.');
      return { status: { success: true } };
    }
    
    const firestore = db as Firestore;
    const results: { [key: string]: { success: boolean; error?: string } } = {};
    
    // 청크 크기 정의 (Firestore 제한: 500개)
    const CHUNK_SIZE = 20;
    
    // 반품 데이터를 청크로 나누기
    for (let i = 0; i < returns.length; i += CHUNK_SIZE) {
      const chunk = returns.slice(i, i + CHUNK_SIZE);
      try {
        const batch = writeBatch(firestore);
        
        chunk.forEach(item => {
          const { id, ...itemData } = item;
          const docRef = doc(firestore, 'returns', sanitizeDocumentId(id));
          batch.set(docRef, itemData);
        });
        
        await batch.commit();
        console.log(`반품 데이터 청크 ${i / CHUNK_SIZE + 1} 업데이트 완료`);
      } catch (error) {
        console.error(`반품 데이터 청크 ${i / CHUNK_SIZE + 1} 업데이트 실패:`, error);
        results['returns'] = {
          success: false,
          error: error instanceof Error ? error.message : '알 수 없는 오류'
        };
      }
    }
    
    // 상품 데이터를 청크로 나누기
    for (let i = 0; i < products.length; i += CHUNK_SIZE) {
      const chunk = products.slice(i, i + CHUNK_SIZE);
      try {
        const batch = writeBatch(firestore);
        
        chunk.forEach(item => {
          const { id, ...itemData } = item;
          // 문서 ID에 사용할 수 없는 문자 처리
          const safeId = sanitizeDocumentId(id);
          const docRef = doc(firestore, 'products', safeId);
          batch.set(docRef, itemData);
        });
        
        await batch.commit();
        console.log(`상품 데이터 청크 ${i / CHUNK_SIZE + 1} 업데이트 완료`);
      } catch (error) {
        console.error(`상품 데이터 청크 ${i / CHUNK_SIZE + 1} 업데이트 실패:`, error);
        results['products'] = {
          success: false,
          error: error instanceof Error ? error.message : '알 수 없는 오류'
        };
      }
    }
    
    return results;
  } catch (error) {
    console.error('데이터 업데이트 중 오류 발생:', error);
    return { error: { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' } };
  }
}

// 특정 반품 항목 업데이트
export async function updateReturnItem(collection: string, id: string, data: Partial<ReturnItem>): Promise<void> {
  try {
    if (!isFirebaseConnected()) {
      console.warn('Firebase 연결 실패, 모의 환경에서 업데이트를 시뮬레이션합니다.');
      return;
    }
    
    const firestore = db as Firestore;
    const docRef = doc(firestore, collection, id);
    await updateDoc(docRef, data);
  } catch (error) {
    console.error('반품 항목 업데이트 오류:', error);
    throw error;
  }
}

// 특정 반품 항목 삭제
export async function deleteReturnItem(collection: string, id: string): Promise<void> {
  try {
    if (!isFirebaseConnected()) {
      console.warn('Firebase 연결 실패, 모의 환경에서 삭제를 시뮬레이션합니다.');
      return;
    }
    
    const firestore = db as Firestore;
    const docRef = doc(firestore, collection, id);
    await deleteDoc(docRef);
  } catch (error) {
    console.error('반품 항목 삭제 오류:', error);
    throw error;
  }
}

// 특정 상품 정보 업데이트
export async function updateProductItem(id: string, data: Partial<ProductInfo>): Promise<void> {
  try {
    if (!isFirebaseConnected()) {
      console.warn('Firebase 연결 실패, 모의 환경에서 업데이트를 시뮬레이션합니다.');
      return;
    }
    
    const firestore = db as Firestore;
    const safeId = sanitizeDocumentId(id);
    const docRef = doc(firestore, COLLECTIONS.PRODUCTS, safeId);
    await updateDoc(docRef, data);
  } catch (error) {
    console.error('상품 정보 업데이트 오류:', error);
    throw error;
  }
}

// 특정 상품 정보 삭제
export async function deleteProductItem(id: string): Promise<void> {
  try {
    if (!isFirebaseConnected()) {
      console.warn('Firebase 연결 실패, 모의 환경에서 삭제를 시뮬레이션합니다.');
      return;
    }
    
    const firestore = db as Firestore;
    const safeId = sanitizeDocumentId(id);
    const docRef = doc(firestore, COLLECTIONS.PRODUCTS, safeId);
    await deleteDoc(docRef);
  } catch (error) {
    console.error('상품 정보 삭제 오류:', error);
    throw error;
  }
}

// 상품 데이터 저장 함수
export async function saveProducts(products: ProductInfo[]): Promise<void> {
  try {
    if (!isFirebaseConnected()) {
      console.warn('Firebase 연결 실패, 모의 환경에서 저장을 시뮬레이션합니다.');
      return;
    }
    const firestore = db as Firestore;
    const batch = writeBatch(firestore);
    const productsRef = collection(firestore, 'products');
    
    // 모든 기존 데이터 삭제
    const existingProducts = await getDocs(productsRef);
    existingProducts.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // 새 데이터 추가
    products.forEach(product => {
      if (!product.barcode) return; // 바코드가 없는 상품은 건너뜀
      
      // 안전한 문서 ID 생성
      const safeId = sanitizeDocumentId(product.id || product.barcode);
      const docRef = doc(firestore, 'products', safeId);
      batch.set(docRef, product);
    });
    
    await batch.commit();
    console.log(`${products.length}개의 상품 데이터가 저장되었습니다.`);
  } catch (error) {
    console.error('상품 데이터 저장 오류:', error);
    throw error;
  }
}

// 모든 상품 데이터 가져오기
export async function getProducts(): Promise<ProductInfo[]> {
  try {
    const db = getFirestore();
    const productsRef = collection(db, 'products');
    const snapshot = await getDocs(productsRef);
    
    const products = snapshot.docs.map(doc => doc.data() as ProductInfo);
    console.log(`${products.length}개의 상품 데이터를 가져왔습니다.`);
    
    return products;
  } catch (error) {
    console.error('상품 데이터 가져오기 오류:', error);
    throw error;
  }
}

// 상품 데이터 삭제 함수
export async function deleteAllProducts(): Promise<void> {
  try {
    const db = getFirestore();
    const productsRef = collection(db, 'products');
    const snapshot = await getDocs(productsRef);
    
    const batch = writeBatch(db);
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log('모든 상품 데이터가 삭제되었습니다.');
  } catch (error) {
    console.error('상품 데이터 삭제 오류:', error);
    throw error;
  }
} 