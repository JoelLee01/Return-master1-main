import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { ReturnItem, ReturnState, ProductInfo } from '@/types/returns';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'returns.json');
const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');
const MAX_BACKUPS = 5; // 최대 백업 파일 수

// 초기 데이터 구조
const initialData = {
  pendingReturns: [],
  completedReturns: [],
  products: []
};

// 데이터 디렉토리 확인 및 생성
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 데이터 파일 확인 및 생성
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
}

// 백업 파일 생성
async function createBackup() {
  try {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `returns-${timestamp}.json`);
    await fs.promises.copyFile(DATA_FILE, backupFile);

    // 오래된 백업 파일 정리
    const backups = await fs.promises.readdir(BACKUP_DIR);
    if (backups.length > MAX_BACKUPS) {
      const oldestBackup = backups.sort()[0];
      await fs.promises.unlink(path.join(BACKUP_DIR, oldestBackup));
    }
  } catch (error) {
    console.error('Error creating backup:', error);
  }
}

// 데이터 읽기
function readData() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('데이터 파일 읽기 오류:', error);
    return initialData;
  }
}

// 데이터 쓰기
function writeData(data: any) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log('데이터 저장 완료');
    return true;
  } catch (error) {
    console.error('데이터 파일 쓰기 오류:', error);
    return false;
  }
}

// 중복 제거 함수 추가
function removeDuplicates<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  items.forEach(item => {
    const key = keyFn(item);
    seen.set(key, item);
  });
  return Array.from(seen.values());
}

// 반품 항목 중복 체크 함수 (완료된 항목과 비교)
function checkDuplicatesWithCompleted(newItems: ReturnItem[], completedItems: ReturnItem[]): ReturnItem[] {
  // 완료된 항목의 키 맵 생성
  const completedKeys = new Set<string>();
  
  completedItems.forEach(item => {
    // 고유 키 생성 (주문번호, 상품명, 옵션명, 수량, 반품사유 조합)
    const key = `${item.orderNumber}-${item.productName}-${item.optionName}-${item.quantity}-${item.returnReason}`;
    completedKeys.add(key);
    
    // 바코드가 있는 경우 바코드 기반 키도 추가
    if (item.barcode) {
      const barcodeKey = `barcode-${item.barcode}-${item.quantity}`;
      completedKeys.add(barcodeKey);
    }
    
    // 송장번호 기반 키도 추가
    if (item.returnTrackingNumber) {
      completedKeys.add(`tracking-${item.returnTrackingNumber}`);
    }
  });
  
  // 완료된 항목과 중복되지 않는 새 항목만 필터링
  return newItems.filter(item => {
    const key = `${item.orderNumber}-${item.productName}-${item.optionName}-${item.quantity}-${item.returnReason}`;
    const barcodeKey = item.barcode ? `barcode-${item.barcode}-${item.quantity}` : '';
    const trackingKey = item.returnTrackingNumber ? `tracking-${item.returnTrackingNumber}` : '';
    
    // 어떤 키도 완료된 항목에 없으면 중복이 아님
    return !completedKeys.has(key) && 
           (!barcodeKey || !completedKeys.has(barcodeKey)) && 
           (!trackingKey || !completedKeys.has(trackingKey));
  });
}

// GET 요청 처리 (데이터 조회)
export async function GET(request: NextRequest) {
  try {
    const data = readData();
    return NextResponse.json(data);
  } catch (error) {
    console.error('GET 요청 처리 오류:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST 요청 처리 (데이터 업데이트)
export async function POST(request: NextRequest) {
  try {
    const requestData = await request.json();
    const { action, data } = requestData;
    
    console.log('API 요청 받음:', action, JSON.stringify(requestData).substring(0, 100) + '...');
    
    if (!action) {
      return NextResponse.json({ error: 'Action is required' }, { status: 400 });
    }
    
    const existingData = readData();
    console.log('기존 데이터:', {
      pendingReturns: existingData.pendingReturns?.length || 0,
      completedReturns: existingData.completedReturns?.length || 0,
      products: existingData.products?.length || 0
    });
    
    let newData;
    
    switch (action) {
      case 'UPDATE_RETURNS':
        // 반품 데이터 업데이트
        console.log('UPDATE_RETURNS 처리:', {
          pendingReturns: data.pendingReturns?.length || 0,
          completedReturns: data.completedReturns?.length || 0
        });
        
        // 새로운 대기 반품 목록에서 완료된 항목과 중복되는 것 제거
        let filteredPendingReturns = data.pendingReturns || [];
        if (existingData.completedReturns && existingData.completedReturns.length > 0) {
          const beforeCount = filteredPendingReturns.length;
          filteredPendingReturns = checkDuplicatesWithCompleted(
            filteredPendingReturns, 
            existingData.completedReturns
          );
          console.log(`완료된 항목과 중복 체크: ${beforeCount - filteredPendingReturns.length}개 제거됨`);
        }
        
        newData = {
          ...existingData,
          pendingReturns: filteredPendingReturns || existingData.pendingReturns,
          completedReturns: data.completedReturns || existingData.completedReturns
        };
        break;
        
      case 'UPDATE_PRODUCTS':
        // 상품 데이터 업데이트
        let productsArray: ProductInfo[] = [];
        
        // 데이터 형식 확인 및 처리
        if (Array.isArray(data)) {
          // 배열이 직접 전달된 경우
          productsArray = data;
          console.log('UPDATE_PRODUCTS 처리: 배열 형식', { products: productsArray.length });
        } else if (data && typeof data === 'object') {
          if (Array.isArray(data.products)) {
            // { products: [...] } 형식
            productsArray = data.products;
            console.log('UPDATE_PRODUCTS 처리: products 객체 형식', { products: productsArray.length });
          } else {
            // 다른 객체 형식 - 유효한 ProductInfo 배열로 변환 시도
            console.log('UPDATE_PRODUCTS 처리: 기타 객체 형식', { dataType: typeof data });
            
            // 빈 객체인 경우
            if (Object.keys(data).length === 0) {
              console.warn('UPDATE_PRODUCTS: 빈 객체');
              return NextResponse.json({ error: 'Empty data object' }, { status: 400 });
            }
          }
        } else {
          console.error('UPDATE_PRODUCTS: 유효하지 않은 데이터 형식', typeof data);
          return NextResponse.json({ error: 'Invalid data format for UPDATE_PRODUCTS' }, { status: 400 });
        }
        
        if (productsArray.length === 0) {
          console.warn('UPDATE_PRODUCTS: 빈 상품 배열');
          return NextResponse.json({ error: 'Empty products array' }, { status: 400 });
        }
        
        // 기존 상품 데이터와 새 상품 데이터 병합
        const combinedProducts = [...existingData.products, ...productsArray];
        
        // 중복 제거 (바코드 기준)
        const uniqueProducts = removeDuplicates(combinedProducts, (product) => {
          // 바코드가 있으면 바코드로 구분, 없으면 상품명+옵션명 조합으로 구분
          if (product.barcode) {
            return product.barcode;
          } else {
            return `${product.productName}-${product.optionName}`;
          }
        });
        
        newData = {
          ...existingData,
      products: uniqueProducts
    };
    
        console.log('UPDATE_PRODUCTS 처리:', { 
          기존상품: existingData.products.length,
          새상품: productsArray.length,
          병합후: uniqueProducts.length,
          중복제거: combinedProducts.length - uniqueProducts.length
        });
        break;
        
      case 'DELETE_ALL_PRODUCTS':
        // 모든 상품 데이터 삭제
        console.log('DELETE_ALL_PRODUCTS 처리: 모든 상품 데이터 삭제');
        
        // 백업 생성
        await createBackup();
        
        newData = {
          ...existingData,
          products: []
        };
        break;
        
      case 'COMPLETE_RETURN':
        // 반품 완료 처리
        const { trackingNumber } = data;
        console.log(`COMPLETE_RETURN 처리: ${trackingNumber}`);
        
        if (!trackingNumber) {
          console.log('송장번호 누락');
          return NextResponse.json({ error: 'Tracking number is required' }, { status: 400 });
        }
        
        // 해당 송장번호를 가진 반품 찾기
        const pendingIndex = existingData.pendingReturns.findIndex(
          (item: ReturnItem) => item.returnTrackingNumber === trackingNumber
        );
        
        console.log(`송장번호 ${trackingNumber} 검색 결과: ${pendingIndex !== -1 ? '찾음' : '찾지 못함'}`);
        
        if (pendingIndex !== -1) {
          const completedItem = {
            ...existingData.pendingReturns[pendingIndex],
            completedAt: new Date(),
            status: 'COMPLETED' as const
          };
          
          // 완료 목록에 추가하고 대기 목록에서 제거
          newData = {
            ...existingData,
            pendingReturns: existingData.pendingReturns.filter((_: ReturnItem, i: number) => i !== pendingIndex),
            completedReturns: [...existingData.completedReturns, completedItem]
          };
        } else {
          return NextResponse.json({ error: 'Return with specified tracking number not found' }, { status: 404 });
        }
        break;
        
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    
    console.log('새 데이터:', {
      pendingReturns: newData.pendingReturns?.length || 0,
      completedReturns: newData.completedReturns?.length || 0,
      products: newData.products?.length || 0
    });
    
    const success = writeData(newData);
    
    if (success) {
      return NextResponse.json({ success: true, data: newData });
    } else {
      return NextResponse.json({ error: 'Failed to write data' }, { status: 500 });
    }
  } catch (error) {
    console.error('POST 요청 처리 오류:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
} 