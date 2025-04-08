import * as XLSX from 'xlsx';
import { ReturnItem, ProductInfo } from '@/types/returns';

export function parseReturnExcel(file: File): Promise<ReturnItem[]> {
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
        
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, any>[];
        
        if (!jsonData || jsonData.length === 0) {
          throw new Error('엑셀 파일에 데이터가 없습니다.');
        }

        // 셀메이트 엑셀 형식인지 확인 (바코드번호, 입고수량 컬럼이 있는지)
        const isCellmateFormat = jsonData.length > 0 && 
          ('바코드번호' in jsonData[0] && '입고수량' in jsonData[0]);

        // 반품 엑셀 형식인지 확인 (고객명, 주문번호 컬럼이 있는지)
        const firstRow = jsonData[0];
        const hasCustomerColumn = 
          '고객명' in firstRow || 
          '주문자명' in firstRow || 
          '구매자명' in firstRow;
        
        const hasOrderNumberColumn = 
          '주문번호' in firstRow || 
          '주문 번호' in firstRow || 
          '주문정보' in firstRow;

        // 고객명과 주문번호 열이 모두 없으면 상품 리스트로 간주하고 오류 발생
        if (!isCellmateFormat && !hasCustomerColumn && !hasOrderNumberColumn) {
          throw new Error('반품 엑셀 형식이 아닙니다. 고객명과 주문번호 열이 필요합니다.');
        }

        if (isCellmateFormat) {
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
          resolve(returns);
        } else {
          // 기존 스마트스토어/지그재그 엑셀 형식 처리
          const returns: ReturnItem[] = jsonData.map((row: Record<string, any>) => {
            // 디버깅: 자체상품코드 확인
            console.log('자체상품코드 확인:', {
              '자체상품코드': row['자체상품코드'],
              '상품코드': row['상품코드'],
              '모든 키': Object.keys(row)
            });
            
            // 자체상품코드 추출 (여러 가능한 열 이름 확인)
            const zigzagCodeColumns = [
              '자체상품코드', '자체 상품코드', '지그재그코드', '지그재그 코드', 
              'zigzag_code', 'custom_code', '자체코드'
            ];
            
            let zigzagProductCode = '';
            for (const colName of zigzagCodeColumns) {
              if (row[colName] !== undefined && row[colName] !== null) {
                zigzagProductCode = String(row[colName] || '');
                break;
              }
            }
            
            return {
              customerName: row['고객명']?.toString() || row['주문자명']?.toString() || row['구매자명']?.toString() || '',
              orderNumber: row['주문번호']?.toString() || row['주문 번호']?.toString() || row['주문정보']?.toString() || '',
              productName: row['상품명']?.toString() || row['제품명']?.toString() || row['품명']?.toString() || '',
              optionName: cleanOptionName(row['옵션명']?.toString() || row['옵션정보']?.toString() || row['옵션']?.toString() || ''),
              quantity: parseInt(row['수량']?.toString() || row['주문수량']?.toString() || row['반품수량']?.toString() || '0'),
              returnTrackingNumber: row['반품송장번호']?.toString() || row['송장번호']?.toString() || row['운송장번호']?.toString() || '',
              returnReason: row['반품사유']?.toString() || row['반품 사유']?.toString() || row['사유']?.toString() || '',
              barcode: row['바코드']?.toString() || row['상품코드']?.toString() || row['제품코드']?.toString() || '',
              zigzagProductCode: zigzagProductCode,
              status: 'PENDING' as const
            };
          });
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

export function parseProductExcel(file: File): Promise<ProductInfo[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        console.log('파일 읽기 성공:', file.name, file.type, file.size);
        
        if (!e.target || !e.target.result) {
          throw new Error('파일 데이터를 읽을 수 없습니다.');
        }
        
        // 파일 타입 확인
        const isCSV = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
        let jsonData: any[] = [];
        
        if (isCSV) {
          // CSV 파일 처리
          console.log('CSV 파일 형식 감지됨');
          const csvContent = e.target.result as string;
          
          // CSV 파싱 (XLSX 라이브러리 사용)
          const workbook = XLSX.read(csvContent, { type: 'string' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          jsonData = XLSX.utils.sheet_to_json(worksheet);
          
          console.log('CSV 데이터 변환 성공, 행 수:', jsonData.length);
        } else {
          // Excel 파일 처리
          console.log('Excel 파일 형식 감지됨');
          const data = new Uint8Array(e.target.result as ArrayBuffer);
          console.log('파일 데이터 크기:', data.length);
          
          const workbook = XLSX.read(data, { type: 'array' });
          console.log('워크북 읽기 성공, 시트 목록:', workbook.SheetNames);
          
          if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
            throw new Error('엑셀 파일에 시트가 없습니다.');
          }
          
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          if (!worksheet) {
            throw new Error('엑셀 시트를 읽을 수 없습니다.');
          }
          
          // 워크시트 범위 확인
          console.log('워크시트 범위:', worksheet['!ref']);
          
          jsonData = XLSX.utils.sheet_to_json(worksheet);
          console.log('JSON 데이터 변환 성공, 행 수:', jsonData.length);
        }
        
        if (!jsonData || jsonData.length === 0) {
          throw new Error('파일에 데이터가 없습니다.');
        }

        // 열 이름 매핑을 위한 함수
        const findColumnValue = (row: any, possibleNames: string[]): string => {
          for (const name of possibleNames) {
            if (row[name] !== undefined) {
              return String(row[name] || '');
            }
          }
          return '';
        };

        // 첫 번째 행의 열 이름 확인 (디버깅용)
        const firstRow = jsonData[0] as any;
        console.log('첫 번째 행의 열 이름:', Object.keys(firstRow));
        console.log('첫 번째 행 데이터:', firstRow);

        const products: ProductInfo[] = jsonData.map((row: any, index) => {
          // 바코드 열 이름 가능성
          const barcodeColumns = [
            '바코드번호', '바코드', '바코드 번호', '상품코드', '상품 코드', 
            '제품코드', '제품 코드', 'barcode', 'product_code'
          ];
          
          // 상품명 열 이름 가능성
          const productNameColumns = [
            '상품명(서식)', '상품명', '제품명', '품명', '상품 이름', 
            '제품 이름', 'product_name', 'name'
          ];
          
          // 사입상품명 열 이름 가능성
          const purchaseNameColumns = [
            '사입상품명', '사입 상품명', '사입명', '사입 이름', 
            '매입상품명', '매입 상품명', 'purchase_name'
          ];
          
          // 옵션명 열 이름 가능성
          const optionNameColumns = [
            '옵션명', '옵션정보', '옵션', '옵션 이름', '옵션 정보', 
            'option_name', 'option'
          ];
          
          // 지그재그 상품코드 열 이름 가능성
          const zigzagCodeColumns = [
            '자체상품코드', '자체 상품코드', '지그재그코드', '지그재그 코드', 
            'zigzag_code', 'custom_code', '자체코드'
          ];

          // 각 필드에 대해 가능한 열 이름을 검색
          const barcode = findColumnValue(row, barcodeColumns);
          const productName = findColumnValue(row, productNameColumns);
          
          // 사입상품명이 없으면 상품명을 사용
          let purchaseName = findColumnValue(row, purchaseNameColumns);
          if (!purchaseName) {
            purchaseName = productName;
          }
          
          const optionName = findColumnValue(row, optionNameColumns);
          const zigzagProductCode = findColumnValue(row, zigzagCodeColumns);

          // 첫 10개 행에 대해 디버깅 로그 출력
          if (index < 10) {
            console.log(`행 ${index + 1} 데이터:`, {
              barcode,
              productName,
              purchaseName,
              optionName,
              zigzagProductCode,
              원본키: Object.keys(row),
              자체상품코드_원본: row['자체상품코드'] || row['자체 상품코드'] || null
            });
          }

          return {
            barcode,
            productName,
            purchaseName,
            optionName,
            zigzagProductCode
          };
        });

        // 빈 행 제거 (모든 필드가 비어있는 경우)
        const filteredProducts = products.filter(product => 
          product.barcode || product.productName || product.purchaseName || product.optionName || product.zigzagProductCode
        );

        // 디버깅 로그 추가
        console.log('파싱된 상품 데이터 샘플:', filteredProducts.slice(0, 3));
        console.log('총 상품 데이터 수:', filteredProducts.length);
        console.log('필터링 전 데이터 수:', products.length);
        console.log('필터링으로 제거된 행 수:', products.length - filteredProducts.length);

        resolve(filteredProducts);
      } catch (error) {
        console.error('파일 파싱 오류:', error);
        reject(error);
      }
    };

    reader.onerror = (error) => {
      console.error('파일 읽기 오류:', error);
      reject(new Error('파일을 읽는 중 오류가 발생했습니다.'));
    };
    
    try {
      // CSV 파일인 경우 텍스트로 읽기, 그 외에는 ArrayBuffer로 읽기
      if (file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv') {
        reader.readAsText(file, 'UTF-8');
      } else {
        reader.readAsArrayBuffer(file);
      }
    } catch (error) {
      console.error('파일 읽기 시작 오류:', error);
      reject(new Error('파일 읽기를 시작할 수 없습니다.'));
    }
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