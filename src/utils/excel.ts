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
 * 옵션명을 간소화하는 함수
 * - "사이즈:", "사이즈선택:", "사이즈 : " 등 사이즈 관련 텍스트 제거
 * - "one size" 표시 제외
 * - 사이즈는 S, M, L, XL 또는 숫자 사이즈(예: 2사이즈)만 표시
 * - 슬래시(/) 기준으로 컬러/사이즈를 붙이되, 사이즈가 없으면 컬러만 표시
 */
export function simplifyOptionName(optionName: string): string {
  if (!optionName) return '';
  
  // 슬래시로 분리하여 색상과 사이즈 분리
  const parts = optionName.split('/').map(part => part.trim());
  
  // 색상 부분 (일반적으로 첫 번째 부분)
  let color = parts[0] || '';
  
  // 사이즈 부분 (일반적으로 두 번째 부분)
  let size = '';
  if (parts.length > 1) {
    const sizePart = parts[1];
    
    // "사이즈:", "사이즈선택:", "사이즈 : " 등 제거
    const sizePattern = /사이즈\s*[:]?\s*선택?\s*:?\s*/;
    const cleanSizePart = sizePart.replace(sizePattern, '').trim();
    
    // "one size" 제외
    if (!/^one\s*size$/i.test(cleanSizePart)) {
      // 괄호 내용 제거 (예: "XL(~77)" -> "XL")
      size = cleanSizePart.replace(/\s*\([^)]*\)\s*/g, '');
      
      // 영문 사이즈 (S, M, L, XL 등) 또는 숫자 사이즈 (2사이즈 등)만 유지
      const sizeRegex = /^(S|M|L|XL|XXL|XXXL|\d+사이즈)$/i;
      if (!sizeRegex.test(size)) {
        // 패턴에 맞지 않는 경우, 숫자와 영문 사이즈 부분만 추출 시도
        const match = size.match(/(S|M|L|XL|XXL|XXXL|\d+사이즈)/i);
        size = match ? match[0] : '';
      }
    }
  }
  
  // 결과 조합 (사이즈가 있으면 "색상/사이즈", 없으면 "색상"만)
  return size ? `${color}/${size}` : color;
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
            zigzagProductCode: ''
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
          const barcode = row[barcodeIndex] ? String(row[barcodeIndex]).trim() : '';
          
          // 중복 바코드 체크 (중복이면 건너뜀)
          if (barcode && barcodeMap.has(barcode)) {
            console.log(`중복 바코드 무시: ${barcode}`);
            continue;
          }
          
          // 상품명 데이터 추출
          const productName = row[productNameIndex] ? String(row[productNameIndex]).trim() : '';
          
          // 옵션명 정확히 추출 및 간소화
          const rawOptionName = optionNameIndex >= 0 && row[optionNameIndex] 
            ? String(row[optionNameIndex]).trim() 
            : '';
          const optionName = simplifyOptionName(rawOptionName);
          
          // 사입상품명 추출 (없으면 상품명 사용)
          const purchaseName = purchaseNameIndex >= 0 && row[purchaseNameIndex] 
            ? String(row[purchaseNameIndex]).trim() 
            : productName;
          
          // 자체상품코드 추출
          const zigzagProductCode = zigzagProductCodeIndex >= 0 && row[zigzagProductCodeIndex] 
            ? String(row[zigzagProductCodeIndex]).trim() 
            : '';
          
          // 생성된 상품 객체
          const product: ProductInfo = {
            id: generateProductItemId(barcode, productName),
            productName,
            purchaseName,
            optionName,
            barcode,
            zigzagProductCode
          };
          
          // 최소한 상품명과 바코드가 있는 경우만 추가
          if (product.productName && product.barcode) {
            products.push(product);
            // 중복 체크를 위해 바코드 추가
            barcodeMap.set(barcode, true);
          }
        }
        
        console.log('파싱된 상품 데이터:', {
          총개수: products.length,
          첫번째상품: products.length > 0 ? products[0] : null,
          바코드샘플: products.slice(0, 3).map(p => p.barcode)
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

  // 지그재그 상품코드로 먼저 매칭 시도
  if (returnItem.orderNumber?.includes('Z') && returnItem.zigzagProductCode) {
    const exactCodeMatch = products.find(p => 
      p.zigzagProductCode && p.zigzagProductCode === returnItem.zigzagProductCode
    );
    
    if (exactCodeMatch) {
      console.log(`✅ 지그재그 상품코드 일치 발견: ${exactCodeMatch.zigzagProductCode}`);
      matchResults.push({
        product: exactCodeMatch,
        similarity: 1,
        matchType: '자체상품코드 완전일치'
      });
    }
  }

  // 자체상품코드 매칭이 없으면 정확한 상품명 일치 확인
  if (matchResults.length === 0) {
    const exactMatch = products.find(p => 
      p.productName && typeof p.productName === 'string' &&
      p.productName.trim().toLowerCase() === returnItem.productName.trim().toLowerCase()
    );
    
    if (exactMatch) {
      console.log(`✅ 정확한 상품명 일치 발견: ${exactMatch.productName}`);
      matchResults.push({
        product: exactMatch,
        similarity: 1,
        matchType: '상품명 완전일치'
      });
    }
  }

  // 정확한 일치가 없으면 유사도 매칭 시도 (단계별 임계값 적용)
  if (matchResults.length === 0) {
    const similarityThresholds = [0.9, 0.8, 0.7]; // 90%, 80%, 70% 순으로 유사도 기준 완화
    
    for (const threshold of similarityThresholds) {
      if (matchResults.length > 0) break; // 이미 매칭된 경우 중단
      
      console.log(`🔍 유사도 ${threshold * 100}% 이상 매칭 시도 중...`);
      
      for (const product of products) {
        // 상품명 유효성 검사
        if (!product.productName || typeof product.productName !== 'string') {
          continue;
        }
        
        // 유사도 계산 - 상품명 기준
        const productNameSimilarity = calculateStringSimilarity(
          returnItem.productName.trim().toLowerCase(),
          product.productName.trim().toLowerCase()
        );
        
        // 옵션명 유사도 계산 (있는 경우)
        let optionSimilarity = 0;
        if (returnItem.optionName && product.optionName) {
          optionSimilarity = calculateStringSimilarity(
            returnItem.optionName.trim().toLowerCase(),
            product.optionName.trim().toLowerCase()
          );
        }
        
        // 최종 유사도 - 상품명 70%, 옵션명 30% 비중
        const finalSimilarity = product.optionName && returnItem.optionName 
          ? (productNameSimilarity * 0.7) + (optionSimilarity * 0.3)
          : productNameSimilarity;
        
        if (finalSimilarity >= threshold) {
          console.log(`🔄 유사도 ${(finalSimilarity * 100).toFixed(1)}% 매칭: ${product.productName}`);
          matchResults.push({
            product,
            similarity: finalSimilarity,
            matchType: '유사도 매칭'
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
      matchType: bestMatch.matchType,
      productId: bestMatch.product.id // productId 설정 추가
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