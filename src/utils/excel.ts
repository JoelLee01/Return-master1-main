import * as XLSX from 'xlsx';
import { ReturnItem, ProductInfo } from '@/types/returns';

// 엑셀 파일 읽기 함수
async function readExcelFile(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        if (!e.target || !e.target.result) {
          throw new Error('파일 데이터를 읽을 수 없습니다.');
        }
        
        const data = new Uint8Array(e.target.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error('엑셀 파일에 시트가 없습니다.');
        }
        
        resolve(workbook);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}

// 시트를 JSON으로 변환하는 함수
function sheetToJson(workbook: any): any[] {
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) {
    throw new Error('엑셀 시트를 읽을 수 없습니다.');
  }
  
  // 전체 시트 내용 로깅 (디버깅용)
  const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  // 헤더 행 찾기
  const headerRowIndex = findHeaderRowIndex(rawData);
  if (headerRowIndex === -1) {
    throw new Error('헤더 행을 찾을 수 없습니다.');
  }
  
  // JSON 데이터 생성
  const jsonData: Record<string, any>[] = [];
  const headers = rawData[headerRowIndex].map(h => String(h || '').trim());
  
  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;
    
    const rowData: Record<string, any> = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) {
        rowData[headers[j]] = row[j];
      }
    }
    
    jsonData.push(rowData);
  }
  
  return jsonData;
}

// 고유 ID 생성 함수 - 반품 아이템용
export function generateReturnItemId(orderNumber: string, productName: string, optionName: string, quantity: number): string {
  // 문자열 정규화
  const normalizedOrder = (orderNumber || '').toString().trim();
  const normalizedProduct = (productName || '').toString().trim();
  const normalizedOption = (optionName || '').toString().trim();
  const timestamp = Date.now();
  // 무작위 숫자 추가로 고유성 확보
  const random = Math.floor(Math.random() * 10000);
  
  return `${normalizedOrder}_${normalizedProduct.substring(0, 10)}_${normalizedOption.substring(0, 5)}_${quantity}_${timestamp}_${random}`;
}

// 고유 ID 생성 함수 - 상품 아이템용
export function generateProductItemId(barcode: string, productName: string): string {
  // 문자열 정규화
  const normalizedBarcode = (barcode || '').toString().trim();
  const normalizedProduct = (productName || '').toString().trim();
  const timestamp = Date.now();
  // 무작위 숫자 추가로 고유성 확보
  const random = Math.floor(Math.random() * 10000);
  
  return `${normalizedBarcode}_${normalizedProduct.substring(0, 10)}_${timestamp}_${random}`;
}

// 옵션명 단순화 함수
export function simplifyOptionName(optionName: string): string {
  if (!optionName) return '';
  
  // 불필요한 텍스트 제거
  let simplified = optionName.trim()
    .replace(/사이즈\s*:\s*/gi, '') // "사이즈:" 제거
    .replace(/색상\s*:\s*/gi, '') // "색상:" 제거
    .replace(/옵션\s*:\s*/gi, '') // "옵션:" 제거
    .replace(/\bone\s*size\b/gi, '') // "one size" 제거
    .replace(/\bfree\s*size\b/gi, '') // "free size" 제거
    .replace(/\bfree\b/gi, '') // "free" 제거
    .replace(/\s+/g, ' ') // 연속된 공백을 하나로 줄임
    .trim();
  
  // 색상과 사이즈 정보 추출을 시도
  const colorPatterns = [
    '블랙', '화이트', '네이비', '그레이', '베이지', '레드', '블루', '그린', 
    '옐로우', '퍼플', '핑크', '브라운', '오렌지', '민트', '라벤더', '와인'
  ];
  
  const sizePatterns = ['S', 'M', 'L', 'XL', 'XXL'];
  
  let foundColor = '';
  let foundSize = '';
  
  // 색상 찾기
  for (const color of colorPatterns) {
    if (simplified && typeof simplified === 'string' && simplified.includes && simplified.includes(color)) {
      foundColor = color;
      break;
    }
  }
  
  // 사이즈 찾기 (전체 단어로)
  for (const size of sizePatterns) {
    const regex = new RegExp(`\\b${size}\\b`, 'i');
    if (simplified && typeof simplified === 'string' && regex.test(simplified)) {
      foundSize = size.toUpperCase();
      break;
    }
  }
  
  // 결과 조합
  if (foundColor && foundSize) {
    return `${foundColor} / ${foundSize}`;
  } else if (foundColor) {
    return foundColor;
  } else if (foundSize) {
    return foundSize;
  }
  
  // 추출 실패 시 원본 반환 (불필요한 텍스트만 제거한 상태)
  return simplified;
}

// 반품사유 자동 간소화 함수 추가
export function simplifyReturnReason(reason: string): string {
  if (!reason || typeof reason !== 'string') return '';
  
  const lowerReason = reason.toLowerCase();
  
  if (lowerReason && lowerReason.includes && lowerReason.includes('변심')) {
    return '단순변심';
  }
  
  if (lowerReason && lowerReason.includes && (lowerReason.includes('파손') || lowerReason.includes('불량'))) {
    return '파손 및 불량';
  }
  
  if (lowerReason && lowerReason.includes && lowerReason.includes('잘못')) {
    return '주문실수';
  }
  
  return reason;
}

// 엑셀 생성 함수
export function generateExcel(returns: ReturnItem[], filename: string = 'returns.xlsx'): void {
  // 데이터 변환
  const data = returns.map(item => ({
    '고객명': item.customerName,
    '주문번호': item.orderNumber,
    '상품명': item.productName,
    '사입상품명': item.purchaseName || '',
    '옵션명': item.optionName,
    '수량': item.quantity,
    '반품사유': item.returnReason,
    '상세사유': item.detailReason || '',
    '바코드': item.barcode,
    '자체상품코드': item.zigzagProductCode,
    '송장번호': item.returnTrackingNumber,
    '상태': item.status,
    '완료일': item.completedAt ? new Date(item.completedAt).toLocaleString() : ''
  }));

  // 워크북 생성
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  
  // 워크시트 추가
  XLSX.utils.book_append_sheet(wb, ws, '반품데이터');
  
  // 파일 저장
  XLSX.writeFile(wb, filename);
}

function cleanOptionName(optionName: string): string {
  return simplifyOptionName(optionName);
}

// 엑셀 필드 값 가져오기 함수 개선
const getFieldValue = (row: any, fieldName: string, altFieldNames: string[] = [], defaultValue: string = ''): string => {
  // 주어진 필드명으로 직접 값 찾기
  if (row[fieldName] !== undefined && row[fieldName] !== null) {
    return String(row[fieldName]);
  }
  
  // 대체 필드명으로 값 찾기
  for (const altField of altFieldNames) {
    if (row[altField] !== undefined && row[altField] !== null) {
      return String(row[altField]);
    }
  }
  
  // 부분 일치하는 필드명 찾기
  const keys = Object.keys(row);
  for (const key of keys) {
    // 필드명이 포함된 키 찾기
    if (key.toLowerCase().includes(fieldName.toLowerCase())) {
      return String(row[key]);
    }
    
    // 대체 필드명이 포함된 키 찾기
    for (const altField of altFieldNames) {
      if (key.toLowerCase().includes(altField.toLowerCase())) {
        return String(row[key]);
      }
    }
  }
  
  return defaultValue;
};

// parseReturnExcel 함수 수정
export async function parseReturnExcel(file: File): Promise<ReturnItem[]> {
  try {
    const data = await readExcelFile(file);
    const jsonData = sheetToJson(data);
    
    if (!jsonData || jsonData.length === 0) {
      throw new Error('유효한 데이터가 없습니다.');
    }
    
    console.log(`엑셀 파일 파싱: ${jsonData.length}개 행 발견`);
    
    // 반품 항목 매핑
    const returns: ReturnItem[] = jsonData.map((row: any) => {
      // 필요한 데이터 추출 (필드 이름 다양성 처리)
      const orderNumber = getFieldValue(row, '주문번호', ['주문_번호', 'order_number', '주문 번호'], '');
      const customerName = getFieldValue(row, '고객명', ['주문자명', '구매자명', '주문자', '구매자', '고객', 'customer_name'], '');
      const productName = getFieldValue(row, '상품명', ['제품명', '품명', '상품_명칭', '상품 이름', 'product_name'], '');
      const optionName = getFieldValue(row, '옵션명', ['옵션정보', '옵션상세', '옵션 정보', '옵션 내용', 'option_name'], '');
      const returnReason = getFieldValue(row, '반품사유', ['반품_사유', '반품 이유', '사유', 'return_reason'], '');
      const quantity = parseInt(getFieldValue(row, '수량', ['주문수량', '반품수량', '주문 수량', 'quantity'], '1'), 10) || 1;
      
      // 반품 송장번호 추출 개선
      const returnTrackingNumber = getFieldValue(
        row, 
        '반품송장번호', 
        ['반품송장', '송장번호', '반품 송장번호', '반품 송장', 'tracking_number', '반송장'], 
        ''
      );
      
      // 바코드 추출 (정확도 향상)
      const barcode = getFieldValue(
        row, 
        '바코드', 
        ['바코드번호', '상품바코드', '바코드 번호', 'barcode', '바코드정보'], 
        ''
      );
      
      // 자체상품코드 추출
      const zigzagProductCode = getFieldValue(
        row, 
        '자체상품코드', 
        ['상품코드', '지그재그코드', '자체코드', '상품번호', 'product_code', '상품관리코드'], 
        ''
      );
      
      // 고유 ID 생성
      const id = generateReturnItemId(orderNumber, productName, optionName, quantity);
      
      // 간소화된 반품 사유 적용
      const simplifiedReason = simplifyReturnReason(returnReason);
      
      return {
        id,
        orderNumber,
        customerName,
        productName,
        optionName,
        returnReason: simplifiedReason,
        quantity,
        returnTrackingNumber,
        barcode,
        zigzagProductCode,
        status: 'PENDING' as 'PENDING' | 'COMPLETED'
      };
    }).filter(item => item.productName && item.orderNumber); // 상품명과 주문번호가 있는 항목만 포함
    
    console.log(`유효한 반품 데이터 ${returns.length}개 처리 완료`);
    return returns;
  } catch (error) {
    console.error('반품 엑셀 파싱 오류:', error);
    throw error;
  }
}

// 엑셀 헤더 행 찾기 함수 - includes 사용 부분 안전하게 수정
function findHeaderRowIndex(data: any[][]): number {
  // 주문번호, 상품명, 옵션 등의 키워드가 포함된 행을 찾음
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    
    // 헤더로 판단할 수 있는 키워드들
    const headerKeywords = ['상품명', '바코드', '옵션'];
    
    // 현재 행에 헤더 키워드가 몇 개 포함되어 있는지 확인
    const keywordCount = headerKeywords.reduce((count, keyword) => {
      const hasKeyword = row.some((cell: any) => 
        typeof cell === 'string' && cell.includes && cell.includes(keyword)
      );
      return hasKeyword ? count + 1 : count;
    }, 0);
    
    // 2개 이상의 키워드가 포함되어 있으면 헤더 행으로 판단
    if (keywordCount >= 2) {
      return i;
    }
  }
  
  return -1; // 헤더 행을 찾지 못한 경우
}

// 엑셀 파싱 시 문자열에 특정 키워드가 포함되어 있는지 안전하게 확인하는 함수
function safeIncludes(str: any, keyword: string): boolean {
  return typeof str === 'string' && str.includes && str.includes(keyword);
}

export function parseProductExcel(file: File): Promise<ProductInfo[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        if (!e.target || !e.target.result) {
          throw new Error('파일 데이터를 읽을 수 없습니다.');
        }
        
        const data = new Uint8Array(e.target.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error('엑셀 파일에 시트가 없습니다.');
        }
        
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!worksheet) {
          throw new Error('엑셀 시트를 읽을 수 없습니다.');
        }
        
        // 데이터를 2차원 배열로 변환
        const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (!rawData || rawData.length === 0) {
          throw new Error('엑셀 파일에 데이터가 없습니다.');
        }
        
        console.log('엑셀 데이터 로드 완료:', {
          행수: rawData.length,
          첫번째행: rawData[0]
        });
        
        // 헤더 행 찾기
        const headerRowIndex = findHeaderRowIndex(rawData);
        if (headerRowIndex === -1) {
          throw new Error('상품 데이터 헤더 행을 찾을 수 없습니다.');
        }
        
        // 헤더 행을 기준으로 데이터 변환
        const jsonData: Record<string, any>[] = [];
        const headers = rawData[headerRowIndex].map(h => String(h || '').trim());
        
        for (let i = headerRowIndex + 1; i < rawData.length; i++) {
          const row = rawData[i];
          if (!row || row.length === 0) continue;
          
          const rowData: Record<string, any> = {};
          for (let j = 0; j < headers.length; j++) {
            if (headers[j]) {
              rowData[headers[j]] = row[j];
            }
          }
          
          jsonData.push(rowData);
        }
        
        console.log('변환된 JSON 데이터:', {
          행수: jsonData.length,
          첫번째행: jsonData[0]
        });
        
        // 필요한 열 찾기
        const productNameIndex = headers.findIndex(h => 
          h.includes('상품명') || h.includes('제품명') || h.includes('품명')
        );
        
        const purchaseNameIndex = headers.findIndex(h => 
          h.includes('사입상품명') || h.includes('사입명') || h.includes('매입상품명')
        );
        
        const optionNameIndex = headers.findIndex(h => 
          h.includes('옵션명') || h.includes('옵션') || h.includes('옵션정보')
        );
        
        const barcodeIndex = headers.findIndex(h => 
          h.includes('바코드') || h.includes('바코드번호') || h.includes('상품코드')
        );
        
        const zigzagProductCodeIndex = headers.findIndex(h => 
          h.includes('자체상품코드') || h.includes('지그재그코드') || 
          h.includes('자체코드') || h.includes('상품번호') ||
          h.includes('상품코드') && !h.includes('바코드')
        );
        
        if (productNameIndex === -1 || barcodeIndex === -1) {
          throw new Error('필수 열(상품명, 바코드)이 없습니다.');
        }
        
        console.log('컬럼 인덱스:', {
          상품명: productNameIndex,
          사입상품명: purchaseNameIndex,
          옵션명: optionNameIndex,
          바코드: barcodeIndex,
          자체상품코드: zigzagProductCodeIndex
        });

        const products: ProductInfo[] = [];

        // 데이터 행 처리
        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;

          const productName = row[headers[productNameIndex]]?.toString() || '';
          const barcode = row[headers[barcodeIndex]]?.toString() || '';
          
          const product: ProductInfo = {
            id: generateProductItemId(barcode, productName),
            productName,
            purchaseName: row[headers[purchaseNameIndex]]?.toString() || productName,
            optionName: row[headers[optionNameIndex]]?.toString() || '',
            barcode,
            zigzagProductCode: zigzagProductCodeIndex >= 0 ? (row[headers[zigzagProductCodeIndex]]?.toString() || '-') : '-'
          };

          // 최소한 상품명과 바코드가 있는 경우만 추가
          if (product.productName && product.barcode) {
            products.push(product);
          }
        }

        console.log('파싱된 상품 데이터:', {
          총개수: products.length,
          첫번째상품: products[0]
        });

        resolve(products);
      } catch (error) {
        console.error('상품 엑셀 파싱 오류:', error);
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}

export function generateCellmateExcel(returns: ReturnItem[]) {
  const data = [
    ['바코드번호', '입고수량'],
    ...returns.map(item => [item.barcode, item.quantity])
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadCellmateCSV(returns: ReturnItem[], date: string) {
  try {
    const blob = generateCellmateExcel(returns);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    
    // 날짜에서 숫자만 추출 (예: "2024. 3. 12." -> "0312")
    const dateNumbers = date.split('.').map(part => part.trim());
    const month = dateNumbers[1].padStart(2, '0');
    const day = dateNumbers[2].padStart(2, '0');
    const formattedDate = `${month}${day}`;
    
    link.download = `barcode${formattedDate}`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    console.error('파일 다운로드 오류:', error);
    throw new Error('파일 다운로드 중 오류가 발생했습니다.');
  }
}

// 날짜별 입고완료 항목을 엑셀로 다운로드하는 함수
export function downloadCompletedReturnsExcel(returns: ReturnItem[], date: string) {
  try {
    // 셀메이트 형식 데이터 생성 (바코드번호, 입고수량)
    const cellmateData = [
      ['바코드번호', '입고수량'],
      ...returns
        .filter(item => item.barcode) // 바코드가 있는 항목만 포함
        .map(item => [item.barcode, item.quantity])
    ];

    // 상세 데이터 생성 (모든 필드 포함)
    const detailData = [
      ['고객명', '주문번호', '상품명', '옵션명', '수량', '반품송장번호', '반품사유', '바코드', '자체상품코드'],
      ...returns.map(item => [
        item.customerName,
        item.orderNumber,
        item.productName,
        item.optionName,
        item.quantity,
        item.returnTrackingNumber,
        item.returnReason,
        item.barcode,
        item.zigzagProductCode
      ])
    ];

    // 워크북 생성
    const workbook = XLSX.utils.book_new();
    
    // 셀메이트 형식 시트 추가
    const cellmateSheet = XLSX.utils.aoa_to_sheet(cellmateData);
    XLSX.utils.book_append_sheet(workbook, cellmateSheet, '셀메이트');
    
    // 상세 데이터 시트 추가
    const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
    XLSX.utils.book_append_sheet(workbook, detailSheet, '상세정보');
    
    // 날짜 형식 변환
    const dateNumbers = date.split('.').map(part => part.trim());
    const month = dateNumbers[1].padStart(2, '0');
    const day = dateNumbers[2].padStart(2, '0');
    const formattedDate = `${month}${day}`;
    
    // 엑셀 파일 다운로드
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `입고완료_${formattedDate}.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
    
    return true;
  } catch (error) {
    console.error('엑셀 다운로드 오류:', error);
    throw new Error('엑셀 파일 다운로드 중 오류가 발생했습니다.');
  }
}

// 상품 데이터와 반품 데이터 매칭 함수 (utils/excel.ts에 추가)
export function matchProductWithZigzagCode(returnItem: ReturnItem, products: ProductInfo[]): ReturnItem {
  // 이미 바코드가 있으면 그대로 반환
  if (returnItem.barcode) {
    return returnItem;
  }
  
  // 지그재그 상품코드로 매칭 시도
  if (returnItem.zigzagProductCode && returnItem.zigzagProductCode !== '-') {
    const exactMatch = products.find(p => 
      p.zigzagProductCode && p.zigzagProductCode === returnItem.zigzagProductCode
    );
    
    if (exactMatch) {
      return {
        ...returnItem,
        productName: returnItem.productName || exactMatch.productName,
        purchaseName: exactMatch.purchaseName || exactMatch.productName,
        barcode: exactMatch.barcode
      };
    }
  }
  
  return returnItem;
}

// 상품명으로 상품 매칭 - includes 사용 부분 안전하게 수정
export const matchProductData = (returnItem: ReturnItem, products: ProductInfo[]): ReturnItem => {
  console.log(`🔍 '${returnItem.productName}' 상품 매칭 시작`);
  
  // 결과 저장할 배열
  const matchResults: Array<{
    product: ProductInfo;
    similarity: number;
    matchType: string;
  }> = [];

  // 반품 항목 유효성 검사
  if (!returnItem.productName || typeof returnItem.productName !== 'string') {
    console.log(`❌ 매칭 실패: 상품명이 유효하지 않음`);
    return returnItem;
  }

  // 정확한 일치 먼저 확인
  const exactMatch = products.find(p => 
    p.productName && typeof p.productName === 'string' &&
    p.productName.trim().toLowerCase() === returnItem.productName.trim().toLowerCase()
  );
  
  if (exactMatch) {
    console.log(`✅ 정확한 일치 발견: ${exactMatch.productName}`);
    matchResults.push({
      product: exactMatch,
      similarity: 1,
      matchType: '상품명 완전일치'
    });
  }

  // 정확한 일치가 없으면 유사도 매칭 시도
  if (!exactMatch) {
    console.log(`🔍 유사도 매칭 시도 중...`);
    
    for (const product of products) {
      // 상품명 유효성 검사
      if (!product.productName || typeof product.productName !== 'string') {
        continue;
      }
      
      // 유사도 계산
      const similarity = calculateStringSimilarity(
        returnItem.productName.trim().toLowerCase(),
        product.productName.trim().toLowerCase()
      );
      
      if (similarity >= 0.6) {
        console.log(`🔄 유사도 ${(similarity * 100).toFixed(1)}% 매칭: ${product.productName}`);
        matchResults.push({
          product,
          similarity,
          matchType: '유사도 매칭'
        });
      }
    }
    
    // 유사도 매칭도 없으면 키워드 매칭 시도
    if (matchResults.length === 0) {
      console.log(`🔍 키워드 매칭 시도 중...`);
      const returnItemKeywords = returnItem.productName.trim().toLowerCase().split(/\s+/);
      
      for (const product of products) {
        // 상품명 유효성 검사
        if (!product.productName || typeof product.productName !== 'string') {
          continue;
        }
        
        const productKeywords = product.productName.trim().toLowerCase().split(/\s+/);
        
        // 키워드 일치 개수 확인 - includes 안전하게 사용
        const matchingKeywords = returnItemKeywords.filter(k => {
          if (!k) return false;
          
          return productKeywords.some(pk => {
            if (!pk) return false;
            return pk.includes(k) || k.includes(pk);
          });
        });
        
        // 30% 이상의 키워드가 일치하면 매칭으로 간주
        if (matchingKeywords.length / returnItemKeywords.length >= 0.3) {
          const keywordSimilarity = matchingKeywords.length / Math.max(returnItemKeywords.length, productKeywords.length);
          console.log(`🔤 키워드 매칭 (${matchingKeywords.length}/${returnItemKeywords.length} 키워드 일치): ${product.productName}`);
          
          matchResults.push({
            product,
            similarity: keywordSimilarity,
            matchType: '키워드 매칭'
          });
        }
      }
    }
  }
  
  // 결과 정렬: 유사도 높은 순
  matchResults.sort((a, b) => b.similarity - a.similarity);
  
  // 결과 요약 로깅
  console.log(`🔍 매칭 결과: ${matchResults.length}개 발견`);
  
  // 최상위 매칭 선택
  if (matchResults.length > 0) {
    const bestMatch = matchResults[0];
    console.log(`✅ 최종 매칭: ${bestMatch.product.productName} (${bestMatch.matchType}, 유사도: ${(bestMatch.similarity * 100).toFixed(1)}%)`);
    
    // 기존 아이템 복사 후 업데이트
    return {
      ...returnItem,
      barcode: bestMatch.product.barcode || '',
      matchedProductName: bestMatch.product.productName,
      purchaseName: bestMatch.product.purchaseName || bestMatch.product.productName,
      zigzagProductCode: bestMatch.product.zigzagProductCode || '',
      matchSimilarity: bestMatch.similarity,
      matchType: bestMatch.matchType
    };
  }
  
  console.log(`❌ 매칭 실패: '${returnItem.productName}'에 대한 매칭 상품 없음`);
  return returnItem; // 매칭 실패 시 원본 그대로 반환
};

// 문자열 유사도 계산 함수 (Levenshtein 거리 기반)
function calculateStringSimilarity(str1: string, str2: string): number {
  // 길이가 0이면 바로 처리
  if (str1.length === 0) return str2.length === 0 ? 1 : 0;
  if (str2.length === 0) return 0;

  // Levenshtein 거리 계산 행렬
  const matrix: number[][] = [];
  
  // 행렬 초기화
  for (let i = 0; i <= str1.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str2.length; j++) {
    matrix[0][j] = j;
  }
  
  // 행렬 채우기
  for (let i = 1; i <= str1.length; i++) {
    for (let j = 1; j <= str2.length; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // 삭제
        matrix[i][j - 1] + 1,      // 삽입
        matrix[i - 1][j - 1] + cost // 대체
      );
    }
  }
  
  // 최대 거리와 실제 거리의 비율로 유사도 계산
  const maxDistance = Math.max(str1.length, str2.length);
  const distance = matrix[str1.length][str2.length];
  
  return 1 - distance / maxDistance;
} 