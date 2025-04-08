import { ReturnState } from '@/types/returns';
import { updateReturns, fetchReturns } from './firestore';

// 로컬 스토리지에서 데이터 읽기
export async function readLocalData(): Promise<ReturnState | null> {
  try {
    // 브라우저 환경에서만 실행
    if (typeof window === 'undefined') {
      return null;
    }

    const localDataStr = localStorage.getItem('returnData');
    if (!localDataStr) {
      return null;
    }

    const localData = JSON.parse(localDataStr);
    return localData;
  } catch (error) {
    console.error('로컬 데이터 읽기 오류:', error);
    return null;
  }
}

// 로컬 스토리지 데이터를 Firebase로 마이그레이션
export async function migrateLocalDataToFirebase(): Promise<boolean> {
  try {
    // 브라우저 환경에서만 실행
    if (typeof window === 'undefined') {
      return false;
    }

    // 로컬 스토리지 데이터 읽기
    const localData = await readLocalData();
    
    // 로컬 데이터가 없으면 마이그레이션 필요 없음
    if (!localData) {
      console.log('마이그레이션할 로컬 데이터가 없습니다.');
      return false;
    }
    
    // Firebase에 데이터 업데이트
    await updateReturns(localData);
    
    console.log('로컬 데이터를 Firebase로 마이그레이션 완료:', {
      pendingReturns: localData.pendingReturns?.length || 0,
      completedReturns: localData.completedReturns?.length || 0,
      products: localData.products?.length || 0
    });
    
    // 마이그레이션 완료 후 로컬 스토리지 데이터 백업
    localStorage.setItem('returnData_backup', JSON.stringify(localData));
    
    return true;
  } catch (error) {
    console.error('데이터 마이그레이션 오류:', error);
    return false;
  }
} 