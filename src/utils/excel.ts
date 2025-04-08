import * as XLSX from 'xlsx';
import { ReturnItem, ProductInfo } from '@/types/returns';

export function parseReturnExcel(file: File): Promise<ReturnItem[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        console.log('반품 엑셀 파일 처리 시작:', file.name);
        
        if (!e.target || !e.target.result) {
          throw new Error('파일 데이터를 읽을 수 없습니다.');
        }
        
        const data = new Uint8Array(e.target.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        console.log('워크북 정보:', {
          시트개수: workbook.SheetNames.length,
          시트이름: workbook.SheetNames
        });
        
        if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error('엑셀 파일에 시트가 없습니다.');
        }
        
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!worksheet) {
          throw new Error('엑셀 시트를 읽을 수 없습니다.');
        }
        
        // 전체 시트 내용 로깅 (디버깅용)
        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        console.log('시트 데이터 (헤더 행):', rawData.slice(0, 3));
        
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, any>[];
        
        console.log('변환된 JSON 데이터 개수:', jsonData.length);
        if (jsonData.length > 0) {
          console.log('첫 번째 행 필드:', Object.keys(jsonData[0]));
          console.log('첫 번째 행 값:', jsonData[0]);
        }
        
        if (!jsonData || jsonData.length === 0) {
          throw new Error('엑셀 파일에 데이터가 없습니다.');
        }

        // 셀메이트 엑셀 형식인지 확인 (바코드번호, 입고수량 컬럼이 있는지)
        const isCellmateFormat = jsonData.length > 0 && 
          (jsonData[0].hasOwnProperty('바코드번호') && jsonData[0].hasOwnProperty('입고수량'));
        
        console.log('셀메이트 형식 여부:', isCellmateFormat);

        // 반품 엑셀 형식인지 확인 (고객명, 주문번호 컬럼이 있는지)
        const firstRow = jsonData[0];
        // 가능한 모든 고객명 관련 컬럼명
        const possibleCustomerColumns = [
          '고객명', '주문자명', '구매자명', '주문자 이름', '주문인', '고객이름', '구매자', 
          '반품자명', '반품자', '반품고객명', '수취인명', '수취인'
        ];
        
        // 가능한 모든 주문번호 관련 컬럼명
        const possibleOrderNumberColumns = [
          '주문번호', '주문 번호', '주문정보', '주문 정보', '주문ID', '주문 ID', 
          '오더번호', '주문코드', '거래번호', '주문관리번호'
        ];
        
        // 고객명 컬럼 존재 여부 확인
        const hasCustomerColumn = possibleCustomerColumns.some(col => 
          firstRow.hasOwnProperty(col) || 
          Object.keys(firstRow).some(key => key.includes(col))
        );
        
        // 주문번호 컬럼 존재 여부 확인
        const hasOrderNumberColumn = possibleOrderNumberColumns.some(col => 
          firstRow.hasOwnProperty(col) || 
          Object.keys(firstRow).some(key => key.includes(col))
        );
        
        console.log('컬럼 확인 결과:', {
          고객명컬럼: hasCustomerColumn, 
          주문번호컬럼: hasOrderNumberColumn
        });

        // 고객명과 주문번호 열이 모두 없으면 상품 리스트로 간주하고 오류 발생
        if (!isCellmateFormat && !hasCustomerColumn && !hasOrderNumberColumn) {
          console.error('반품 엑셀 형식이 아닙니다. 컬럼 구조:', Object.keys(firstRow));
          throw new Error('반품 엑셀 형식이 아닙니다. 고객명과 주문번호 열이 필요합니다.');
        }

        if (isCellmateFormat) {
          console.log('셀메이트 형식으로 데이터 변환');
          const returns: ReturnItem[] = jsonData.map((row: Record<string, any>) => ({
            customerName: '셀메이트 업로드',
            orderNumber: '-',
            productName: '',  // 바코드로 상품 매칭 시 업데이트됨
            optionName: '',   // 바코드로 상품 매칭 시 업데이트됨
            quantity: parseInt(row['입고수량']?.toString() || '0'),
            returnTrackingNumber: '',
            returnReason: '셀메이트 업로드',
            barcode: row['바코드번호']?.toString() || '',
            zigzagProductCode: '',
            status: 'PENDING' as const
          }));
          console.log('변환된 반품 데이터 개수:', returns.length);
          resolve(returns);
        } else {
          // 기존 스마트스토어/지그재그 엑셀 형식 처리
          // 각 필드별로 가능한 열 이름들 정의
          const fieldColumns = {
            customerName: ['고객명', '주문자명', '구매자명', '주문자 이름', '주문인', '고객이름', '구매자', '반품자명', '반품자', '수취인명', '수취인'],
            orderNumber: ['주문번호', '주문 번호', '주문정보', '주문 정보', '주문ID', '주문 ID', '오더번호', '주문코드', '거래번호'],
            productName: ['상품명', '제품명', '품명', '상품정보', '상품 정보', '상품 이름', '상품', '제품 이름', '제품'],
            optionName: ['옵션명', '옵션정보', '옵션', '선택 옵션', '옵션 정보', '옵션 이름'],
            quantity: ['수량', '주문수량', '반품수량', '수량(수)', '입고수량', '제품수량', '반품 수량', '주문 수량'],
            returnTrackingNumber: ['반품송장번호', '송장번호', '운송장번호', '반품송장', '반품 송장번호', '반품 운송장번호', '운송장 번호'],
            returnReason: ['반품사유', '반품 사유', '사유', '반품 이유', '취소 사유', '반품사유(기타)', '반품이유'],
            barcode: ['바코드', '상품코드', '제품코드', '바코드번호', '상품 코드', '제품 코드', '품목코드']
          };
          
          // 실제 데이터에서 매칭되는 열 이름 찾기
          const foundColumns: Record<string, string> = {};
          const allKeys = Object.keys(firstRow);
          
          for (const [field, possibleColumns] of Object.entries(fieldColumns)) {
            for (const colName of possibleColumns) {
              // 정확한 매칭
              if (allKeys.includes(colName)) {
                foundColumns[field] = colName;
                break;
              }
              
              // 부분 매칭 (컬럼명에 해당 키워드가 포함된 경우)
              const partialMatch = allKeys.find(key => key.includes(colName));
              if (partialMatch) {
                foundColumns[field] = partialMatch;
                break;
              }
            }
          }
          
          console.log('찾은 컬럼 매핑:', foundColumns);
            
            // 자체상품코드 추출 (여러 가능한 열 이름 확인)
            const zigzagCodeColumns = [
              '자체상품코드', '자체 상품코드', '지그재그코드', '지그재그 코드', 
            'zigzag_code', 'custom_code', '자체코드', '상품고유번호'
          ];
          
          // 실제 자체상품코드 컬럼 찾기
          let zigzagCodeColumn = '';
          for (const colName of zigzagCodeColumns) {
            if (allKeys.includes(colName)) {
              zigzagCodeColumn = colName;
              break;
            }
            
            const partialMatch = allKeys.find(key => key.includes(colName));
            if (partialMatch) {
              zigzagCodeColumn = partialMatch;
              break;
            }
          }
          
          console.log('자체상품코드 컬럼:', zigzagCodeColumn);
          
          // 데이터 매핑
          const returns: ReturnItem[] = jsonData.map((row: Record<string, any>, index) => {
            // 자체상품코드 값 가져오기
            let zigzagProductCode = '';
            if (zigzagCodeColumn && row[zigzagCodeColumn] !== undefined) {
              zigzagProductCode = String(row[zigzagCodeColumn] || '');
            }
            
            // 각 필드별로 값 가져오기
            const getFieldValue = (field: string, defaultValue: string = ''): string => {
              const column = foundColumns[field];
              if (column && row[column] !== undefined && row[column] !== null) {
                return String(row[column]);
              }
              return defaultValue;
            };
            
            const returnItem: ReturnItem = {
              customerName: getFieldValue('customerName', '고객정보없음'),
              orderNumber: getFieldValue('orderNumber', '-'),
              productName: getFieldValue('productName', '상품명없음'),
              optionName: cleanOptionName(getFieldValue('optionName')),
              quantity: parseInt(getFieldValue('quantity', '1')),
              returnTrackingNumber: getFieldValue('returnTrackingNumber'),
              returnReason: getFieldValue('returnReason', '반품사유없음'),
              barcode: getFieldValue('barcode'),
              zigzagProductCode: zigzagProductCode,
              status: 'PENDING' as const
            };
            
            // 데이터 로깅 (처음 5개 항목만)
            if (index < 5) {
              console.log(`반품항목 #${index + 1}:`, returnItem);
            }
            
            return returnItem;
          });
          
          console.log('변환된 반품 데이터 개수:', returns.length);
          resolve(returns);
        }
      } catch (error) {
        console.error('엑셀 파일 파싱 오류:', error);
        reject(error);
      }
    };

    reader.onerror = (error) => {
      console.error('파일 읽기 오류:', error);
      reject(new Error('파일을 읽는 중 오류가 발생했습니다.'));
    };
    
    try {
      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error('파일 읽기 시작 오류:', error);
      reject(new Error('파일 읽기를 시작할 수 없습니다.'));
    }
  });
}

// 엑셀 헤더 행 찾기 함수
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
        typeof cell === 'string' && cell.includes(keyword)
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

export function parseProductExcel(file: File): Promise<ProductInfo[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        console.log('상품 엑셀 파일 읽기 시작');
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        console.log('엑셀 데이터 파싱 완료:', {
          시트이름: firstSheetName,
          전체행수: jsonData.length
        });

        // 헤더 행 찾기
        const headerRowIndex = findHeaderRowIndex(jsonData);
        if (headerRowIndex === -1) {
          reject(new Error('헤더 행을 찾을 수 없습니다.'));
          return;
        }

        const headers = jsonData[headerRowIndex];
        console.log('찾은 헤더:', headers);

        // 헤더 인덱스 찾기
        const productNameIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && header.includes('상품명')
        );
        const purchaseNameIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && header.includes('사입상품명')
        );
        const optionNameIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && header.includes('옵션')
        );
        const barcodeIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && header.includes('바코드')
        );
        const zigzagProductCodeIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && (
            header.includes('자체상품코드') || 
            header.includes('지그재그코드') || 
            header.includes('상품코드')
          )
        );

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

          const product: ProductInfo = {
            productName: row[productNameIndex]?.toString() || '',
            purchaseName: row[purchaseNameIndex]?.toString() || '',
            optionName: row[optionNameIndex]?.toString() || '',
            barcode: row[barcodeIndex]?.toString() || '',
            zigzagProductCode: row[zigzagProductCodeIndex]?.toString() || '-'
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

function cleanOptionName(optionName: string): string {
  return optionName
    .replace(/색상:|색상선택:|사이즈 :|one size/gi, '')
    .trim();
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