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

/**
 * 옵션명 간소화 함수
 * 불필요한 텍스트를 제거하고 '색상 / 사이즈' 형식으로 변환
 */
export function simplifyOptionName(optionName: string): string {
  if (!optionName) return '';
  
  // 입력 문자열 정규화
  let simplified = optionName.trim();
  
  // "사이즈:" 또는 "사이즈 :"와 같은 패턴 제거
  simplified = simplified.replace(/사이즈\s*:\s*/g, '');
  simplified = simplified.replace(/컬러\s*:\s*/g, '');
  simplified = simplified.replace(/색상\s*:\s*/g, '');
  
  // "사이즈선택:"과 같은 패턴 제거
  simplified = simplified.replace(/사이즈\s*선택\s*:\s*/g, '');
  simplified = simplified.replace(/컬러\s*선택\s*:\s*/g, '');
  simplified = simplified.replace(/색상\s*선택\s*:\s*/g, '');
  
  // 괄호와 내용 제거 (예: "XL(~77)" -> "XL")
  simplified = simplified.replace(/\([^)]*\)/g, '');
  
  // "one size" 제거
  simplified = simplified.replace(/\b[Oo]ne\s*[Ss]ize\b/g, '');
  
  // 여러 공백을 하나로 압축
  simplified = simplified.replace(/\s+/g, ' ').trim();
  
  // "/"를 기준으로 분리하여 색상과 사이즈 처리
  const parts = simplified.split('/').map(part => part.trim());
  
  if (parts.length >= 2) {
    // 색상과 사이즈 분리된 경우
    return parts.filter(part => part).join('/');
  } else {
    // 색상이나 사이즈만 있는 경우
    const singlePart = parts[0];
    
    // 사이즈만 있는 경우 (S, M, L, XL)
    if (/^[SMLX]+$/i.test(singlePart)) {
      return singlePart.toUpperCase();
    }
    
    return singlePart;
  }
}

// 반품사유 자동 간소화 함수 추가
export function simplifyReturnReason(reason: string): string {
  if (!reason || typeof reason !== 'string') return '';
  
  const lowerReason = reason.toLowerCase();
  
  if (lowerReason && lowerReason.includes && lowerReason.includes('변심')) {
    return '단순변심';
  }
  
  // "실못" → "주문실수"
  if (lowerReason.includes('실못') || (lowerReason.includes('잘못') && lowerReason.includes('주문'))) {
    return '주문실수';
  }
  
  // "파손", "불량" → "파손 및 불량"
  if (lowerReason.includes('파손') || lowerReason.includes('불량')) {
    return '파손 및 불량';
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
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // 셀 데이터를 행 객체 배열로 변환
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        // 필드를 찾기 위한 헤더 행 인덱스 찾기
        let headerRowIndex = -1;
        
        // 헤더 행 찾기
        for (let i = 0; i < Math.min(10, rows.length); i++) {
          const row = rows[i];
          const possibleHeaders = row.map(cell => String(cell || '').toLowerCase());
          
          if (
            possibleHeaders.some(header => 
              header.includes('주문번호') || 
              header.includes('상품명') || 
              header.includes('고객명')
            )
          ) {
            headerRowIndex = i;
            break;
          }
        }
        
        if (headerRowIndex === -1) {
          throw new Error('유효한 헤더를 찾을 수 없습니다. 엑셀 형식을 확인해주세요.');
        }
        
        const headerRow = rows[headerRowIndex];
        
        // 필요한 열 인덱스 찾기
        const getFieldIndex = (fieldName: string) => {
          let index = headerRow.findIndex(
            header => typeof header === 'string' && header.toLowerCase().includes(fieldName.toLowerCase())
          );
          return index;
        };
        
        const getFieldValue = (row: any[], fieldNames: string[]): string => {
          for (const fieldName of fieldNames) {
            const index = getFieldIndex(fieldName);
            if (index !== -1 && row[index]) {
              return String(row[index]);
            }
          }
          return '';
        };
        
        const returnItems: ReturnItem[] = [];
        
        // 헤더 다음 행부터 데이터 처리
        for (let i = headerRowIndex + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          
          // 필수 필드 검사 (주문번호와 상품명)
          const orderNumber = getFieldValue(row, ['주문번호', '주문 번호', '주문no', '주문 no', 'order', '오더 번호']);
          const productName = getFieldValue(row, ['상품명', '품명', 'item', '제품명', '상품 명']);
          
          if (!orderNumber || !productName) continue;
          
          // 옵션명 추출 및 간소화
          const rawOptionName = getFieldValue(row, ['옵션명', '옵션', '옵션정보', '옵션 정보', '선택 옵션', '옵션 내역']);
          const optionName = simplifyOptionName(rawOptionName);
          
          // ReturnItem 객체 생성
          const returnItem: ReturnItem = {
            id: generateReturnItemId(orderNumber, productName, optionName, parseInt(getFieldValue(row, ['수량', '주문수량', '입고수량', '반품수량', 'quantity']), 10) || 1),
            orderNumber,
            customerName: getFieldValue(row, ['고객명', '주문자', '구매자', 'customer', '구매자명', '고객 이름']),
            productName,
            optionName,
            quantity: parseInt(getFieldValue(row, ['수량', '주문수량', '입고수량', '반품수량', 'quantity']), 10) || 1,
            returnReason: getFieldValue(row, ['반품사유', '반품 사유', '사유', '메모', '반품메모', '반품 메모']),
            returnTrackingNumber: getFieldValue(row, ['반품송장번호', '반품운송장', '반품 송장', '반품송장', '송장번호', '송장']),
            status: 'PENDING',
            barcode: '',
            zigzagProductCode: getFieldValue(row, ['자체상품코드', '지그재그코드', '상품코드']),
            customProductCode: getFieldValue(row, ['자체상품코드', '지그재그코드', '상품코드'])
          };
          
          returnItems.push(returnItem);
        }
        
        console.log(`${returnItems.length}개의 반품 항목이 추출되었습니다.`);
        resolve(returnItems);
      } catch (error) {
        console.error('엑셀 파싱 오류:', error);
        reject(new Error('엑셀 파일을 처리하는 중 오류가 발생했습니다.'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('엑셀 파일을 읽는 중 오류가 발생했습니다.'));
    };
    
    reader.readAsArrayBuffer(file);
  });
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

// 'B-' 또는 'S-' 패턴으로 시작하는 바코드 데이터가 있는지 확인하는 함수
function hasValidBarcodeFormat(data: any[][], columnIndex: number): boolean {
  // 최대 20행을 검사
  const maxRows = Math.min(20, data.length);
  let validCount = 0;
  
  for (let i = 0; i < maxRows; i++) {
    const row = data[i];
    if (!row || row.length <= columnIndex) continue;
    
    const value = String(row[columnIndex] || '');
    if (value.startsWith('B-') || value.startsWith('S-')) {
      validCount++;
    }
  }
  
  // 적어도 1개 이상의 유효한 바코드 형식이 발견되면 true
  return validCount > 0;
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
        
        const headers = rawData[headerRowIndex].map(h => String(h || '').trim());
        
        // 필요한 열 찾기
        const getColumnIndex = (keyword: string, fallbackKeywords: string[] = []): number => {
          // 정확한 일치 먼저 검색
          let index = headers.findIndex(h => h === keyword);
          
          // 부분 일치 검색
          if (index === -1) {
            index = headers.findIndex(h => h.includes(keyword));
          }
          
          // 대체 키워드로 검색
          if (index === -1 && fallbackKeywords.length > 0) {
            for (const fallback of fallbackKeywords) {
              // 정확한 일치
              index = headers.findIndex(h => h === fallback);
              if (index !== -1) break;
              
              // 부분 일치
              index = headers.findIndex(h => h.includes(fallback));
              if (index !== -1) break;
            }
          }
          
          return index;
        };
        
        // 필수 열 인덱스 찾기
        const productNameIndex = getColumnIndex('상품명', ['제품명', '품명']);
        const barcodeIndex = getColumnIndex('바코드번호', ['바코드']);
        const optionNameIndex = getColumnIndex('옵션명', ['옵션', '옵션정보']);
        const purchaseNameIndex = getColumnIndex('사입상품명', ['사입명', '매입상품명']);
        const zigzagProductCodeIndex = getColumnIndex('자체상품코드', ['지그재그코드', '상품코드']);
        
        // 상품명, 바코드 중 하나라도 없으면 오류
        if (productNameIndex === -1 || barcodeIndex === -1) {
          throw new Error('필수 열(상품명, 바코드번호)을 찾을 수 없습니다.');
        }
        
        console.log('컬럼 인덱스:', {
          상품명: productNameIndex,
          바코드번호: barcodeIndex,
          옵션명: optionNameIndex,
          사입상품명: purchaseNameIndex,
          자체상품코드: zigzagProductCodeIndex
        });
        
        const products: ProductInfo[] = [];
        
        // 중복 체크를 위한 바코드 맵
        const barcodeMap = new Map<string, boolean>();
        
        // 데이터 행 처리
        for (let i = headerRowIndex + 1; i < rawData.length; i++) {
          const row = rawData[i];
          if (!row || row.length === 0) continue;
          
          // 바코드 데이터 정확히 추출
          let barcode = '';
          if (row[barcodeIndex] !== undefined && row[barcodeIndex] !== null) {
            // 숫자, 문자열 등 모든 타입 처리
            barcode = String(row[barcodeIndex]).trim();
          }
          
          // 빈 바코드 체크
          if (!barcode) {
            console.warn(`행 ${i+1}: 바코드 없음, 건너뜀`);
            continue;
          }
          
          // 중복 바코드 체크 (중복이면 건너뜀)
          if (barcodeMap.has(barcode)) {
            console.log(`중복 바코드 무시: ${barcode}`);
            continue;
          }
          
          // 상품명 데이터 추출
          let productName = '';
          if (row[productNameIndex] !== undefined && row[productNameIndex] !== null) {
            productName = String(row[productNameIndex]).trim();
          }
          
          // 상품명이 없으면 건너뜀
          if (!productName) {
            console.warn(`행 ${i+1}: 상품명 없음, 건너뜀`);
            continue;
          }
          
          // 옵션명 추출 및 간소화
          let optionName = '';
          if (optionNameIndex !== -1 && row[optionNameIndex] !== undefined && row[optionNameIndex] !== null) {
            const rawOptionName = String(row[optionNameIndex]);
            optionName = simplifyOptionName(rawOptionName);
          }
          
          // 사입상품명 추출
          let purchaseName = '';
          if (purchaseNameIndex !== -1 && row[purchaseNameIndex] !== undefined && row[purchaseNameIndex] !== null) {
            purchaseName = String(row[purchaseNameIndex]).trim();
          }
          
          // 자체상품코드 추출
          let zigzagProductCode = '';
          let customProductCode = '';
          if (zigzagProductCodeIndex !== -1 && row[zigzagProductCodeIndex] !== undefined && row[zigzagProductCodeIndex] !== null) {
            zigzagProductCode = String(row[zigzagProductCodeIndex]).trim();
            customProductCode = zigzagProductCode; // 동일한 값을 customProductCode에도 할당
          }
          
          // 고유 ID 생성
          const id = generateProductItemId(barcode, productName);
          
          // 상품 객체 생성
          const product: ProductInfo = {
            id,
            productName,
            barcode,
            optionName,
            purchaseName: purchaseName || productName, // 사입명이 없으면 상품명 사용
            zigzagProductCode,
            customProductCode  // 추가된 customProductCode 필드
          };
          
          // 맵에 바코드 추가 (중복 체크용)
          barcodeMap.set(barcode, true);
          
          // 상품 목록에 추가
          products.push(product);
        }
        
        console.log(`${products.length}개의 상품 데이터가 추출되었습니다.`);
        resolve(products);
      } catch (error) {
        console.error('엑셀 파싱 오류:', error);
        reject(new Error('엑셀 파일을 처리하는 중 오류가 발생했습니다.'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('엑셀 파일을 읽는 중 오류가 발생했습니다.'));
    };
    
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

    // 상세 데이터 생성 (필요한 필드만 포함)
    const detailData = [
      ['바코드번호', '상품명', '옵션명', '수량'],
      ...returns.map(item => [
        item.barcode,
        item.productName,
        item.optionName,
        item.quantity
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
        barcode: exactMatch.barcode,
        customProductCode: exactMatch.customProductCode || exactMatch.zigzagProductCode || returnItem.customProductCode || ''
      };
    }
  }
  
  // 자체상품코드로 매칭 시도 (추가)
  if (returnItem.customProductCode && returnItem.customProductCode !== '-') {
    const customCodeMatch = products.find(p => 
      (p.customProductCode && p.customProductCode === returnItem.customProductCode) ||
      (p.zigzagProductCode && p.zigzagProductCode === returnItem.customProductCode)
    );
    
    if (customCodeMatch) {
      return {
        ...returnItem,
        productName: returnItem.productName || customCodeMatch.productName,
        purchaseName: customCodeMatch.purchaseName || customCodeMatch.productName,
        barcode: customCodeMatch.barcode,
        zigzagProductCode: customCodeMatch.zigzagProductCode || '',
        customProductCode: customCodeMatch.customProductCode || customCodeMatch.zigzagProductCode || ''
      };
    }
  }
  
  return returnItem;
}

// 상품명으로 상품 매칭 - 키워드 매칭 로직 제거 버전
export const matchProductData = (returnItem: ReturnItem, products: ProductInfo[]): ReturnItem => {
  // 이미 매칭된 항목은 건너뜀
  if (returnItem.barcode && returnItem.barcode !== '-') {
    console.log(`이미 매칭된 상품 (바코드: ${returnItem.barcode})`);
    return returnItem;
  }
  
  // 로깅
  console.log(`\n[매칭 시작] ${returnItem.productName}`);
  
  // 지그재그 자체상품코드로 매칭 시도
  if (returnItem.zigzagProductCode && returnItem.zigzagProductCode.trim() !== '' && returnItem.zigzagProductCode !== '-') {
    const exactCodeMatch = products.find(product => 
      product.zigzagProductCode && 
      product.zigzagProductCode === returnItem.zigzagProductCode
    );
    
    if (exactCodeMatch) {
      console.log(`✅ 자체상품코드 정확 매칭 성공: ${exactCodeMatch.zigzagProductCode}`);
      return {
        ...returnItem,
        barcode: exactCodeMatch.barcode || '',
        purchaseName: exactCodeMatch.purchaseName || exactCodeMatch.productName,
        customProductCode: exactCodeMatch.customProductCode || exactCodeMatch.zigzagProductCode || '',
        matchSimilarity: 1,
        matchType: '자체상품코드 매칭'
      };
    }
    
    console.log(`❌ 자체상품코드 매칭 실패: ${returnItem.zigzagProductCode}`);
  }
  
  // 상품명으로 정확 매칭 시도
  if (returnItem.productName) {
    const exactNameMatch = products.find(product => 
      product.productName && 
      typeof product.productName === 'string' &&
      typeof returnItem.productName === 'string' &&
      product.productName.toLowerCase().trim() === returnItem.productName.toLowerCase().trim()
    );
    
    if (exactNameMatch) {
      console.log(`✅ 상품명 정확 매칭 성공: ${exactNameMatch.productName}`);
      return {
        ...returnItem,
        barcode: exactNameMatch.barcode || '',
        purchaseName: exactNameMatch.purchaseName || exactNameMatch.productName,
        zigzagProductCode: exactNameMatch.zigzagProductCode || '',
        customProductCode: exactNameMatch.customProductCode || exactNameMatch.zigzagProductCode || '',
        matchSimilarity: 1,
        matchType: '상품명 정확 매칭'
      };
    }
    
    // 사입명으로 정확 매칭 시도
    const exactPurchaseNameMatch = products.find(product => 
      product.purchaseName && 
      typeof product.purchaseName === 'string' &&
      typeof returnItem.productName === 'string' &&
      product.purchaseName.toLowerCase().trim() === returnItem.productName.toLowerCase().trim()
    );
    
    if (exactPurchaseNameMatch) {
      console.log(`✅ 사입명 정확 매칭 성공: ${exactPurchaseNameMatch.purchaseName}`);
      return {
        ...returnItem,
        barcode: exactPurchaseNameMatch.barcode || '',
        purchaseName: exactPurchaseNameMatch.purchaseName || exactPurchaseNameMatch.productName,
        zigzagProductCode: exactPurchaseNameMatch.zigzagProductCode || '',
        customProductCode: exactPurchaseNameMatch.customProductCode || exactPurchaseNameMatch.zigzagProductCode || '',
        matchSimilarity: 1,
        matchType: '사입명 정확 매칭'
      };
    }
    
    // 유사도 기반 매칭 시도
    let bestMatch: { product: ProductInfo, similarity: number, matchType: string } | null = null;
    const returnProductName = returnItem.productName.toLowerCase().trim();
    
    // 각 상품의 유사도 계산 및 최적 매칭 탐색
    for (const product of products) {
      // 상품명 유사도 확인
      if (product.productName && typeof product.productName === 'string') {
        const productNameLower = product.productName.toLowerCase().trim();
        
        // 1. 포함 관계 확인 (가장 높은 우선순위)
        if (productNameLower.includes(returnProductName) || returnProductName.includes(productNameLower)) {
          const similarity = 0.9; // 포함 관계는 높은 유사도 점수
          
          if (!bestMatch || similarity > bestMatch.similarity) {
            bestMatch = { 
              product, 
              similarity, 
              matchType: '상품명 포함 관계' 
            };
            console.log(`📌 상품명 포함 관계 발견 (유사도: ${similarity.toFixed(2)}): ${product.productName}`);
          }
        } 
        // 2. 레벤슈타인 거리 기반 유사도 계산
        else {
          const similarity = calculateStringSimilarity(productNameLower, returnProductName);
          
          // 유사도가 임계값보다 높고, 현재 최적 매칭보다 좋으면 업데이트
          if (similarity > 0.6 && (!bestMatch || similarity > bestMatch.similarity)) {
            bestMatch = { 
              product, 
              similarity, 
              matchType: '상품명 유사도 매칭' 
            };
            console.log(`📊 상품명 유사도 매칭 (유사도: ${similarity.toFixed(2)}): ${product.productName}`);
          }
        }
      }
      
      // 사입명 유사도 확인 (상품명 유사도가 낮은 경우에만)
      if (product.purchaseName && typeof product.purchaseName === 'string' && (!bestMatch || bestMatch.similarity < 0.7)) {
        const purchaseNameLower = product.purchaseName.toLowerCase().trim();
        
        // 1. 포함 관계 확인
        if (purchaseNameLower.includes(returnProductName) || returnProductName.includes(purchaseNameLower)) {
          const similarity = 0.85; // 사입명 포함은 상품명보다 약간 낮은 점수
          
          if (!bestMatch || similarity > bestMatch.similarity) {
            bestMatch = { 
              product, 
              similarity, 
              matchType: '사입명 포함 관계' 
            };
            console.log(`📌 사입명 포함 관계 발견 (유사도: ${similarity.toFixed(2)}): ${product.purchaseName}`);
          }
        }
        // 2. 레벤슈타인 거리 기반 유사도 계산
        else {
          const similarity = calculateStringSimilarity(purchaseNameLower, returnProductName);
          
          if (similarity > 0.55 && (!bestMatch || similarity > bestMatch.similarity)) {
            bestMatch = { 
              product, 
              similarity, 
              matchType: '사입명 유사도 매칭' 
            };
            console.log(`📊 사입명 유사도 매칭 (유사도: ${similarity.toFixed(2)}): ${product.purchaseName}`);
          }
        }
      }
    }
    
    // 최적 매칭 결과 반환
    if (bestMatch) {
      console.log(`✅ 최적 매칭 결과 (${bestMatch.matchType}, 유사도: ${bestMatch.similarity.toFixed(2)}): ${bestMatch.product.productName}`);
      
      return {
        ...returnItem,
        barcode: bestMatch.product.barcode || '',
        purchaseName: bestMatch.product.purchaseName || bestMatch.product.productName,
        zigzagProductCode: bestMatch.product.zigzagProductCode || '',
        customProductCode: bestMatch.product.customProductCode || bestMatch.product.zigzagProductCode || '',
        matchSimilarity: bestMatch.similarity,
        matchType: bestMatch.matchType
      };
    }
  }
  
  // 매칭 실패
  console.log(`❌ 매칭 실패: ${returnItem.productName}`);
  return returnItem;
};

// 문자열 유사도 계산 함수 (Levenshtein 거리 기반)
function calculateStringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  // 길이 차이가 너무 크면 낮은 유사도 반환
  const maxLenDiff = Math.max(str1.length, str2.length) * 0.4;
  if (Math.abs(str1.length - str2.length) > maxLenDiff) {
    return 0.2;
  }
  
  const len1 = str1.length;
  const len2 = str2.length;
  const maxLen = Math.max(len1, len2);
  
  if (maxLen === 0) return 1.0;
  
  // 편집 거리 계산을 위한 배열
  const dp: number[][] = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
  
  // 초기값 설정
  for (let i = 0; i <= len1; i++) dp[i][0] = i;
  for (let j = 0; j <= len2; j++) dp[0][j] = j;
  
  // 동적 프로그래밍으로 편집 거리 계산
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // 삭제
        dp[i][j - 1] + 1,      // 삽입
        dp[i - 1][j - 1] + cost // 대체
      );
    }
  }
  
  // 유사도 = 1 - (편집 거리 / 최대 길이)
  return 1 - dp[len1][len2] / maxLen;
}