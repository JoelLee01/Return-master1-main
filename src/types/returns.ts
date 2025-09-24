export interface ReturnItem {
  id: string;
  customerName: string;
  orderNumber: string;
  productName: string;
  purchaseName?: string;
  optionName: string;
  quantity: number;
  returnTrackingNumber: string;
  pickupTrackingNumber?: string;  // 수거송장번호 추가
  returnReason: string;
  barcode: string;
  zigzagProductCode: string;
  customProductCode?: string;
  status: 'PENDING' | 'COMPLETED';
  completedAt?: Date;
  orderId?: string;
  productId?: string;
  detailReason?: string;  // 상세 반품사유
  matchSimilarity?: number; // 상품 매칭 유사도
  matchType?: string;    // 상품 매칭 방식 (예: '상품명 완전일치', '유사도 매칭' 등)
  matchedProductName?: string; // 매칭된 상품 이름
  matchedProductOption?: string; // 매칭된 상품 옵션명
}

export interface ProductInfo {
  id: string;
  barcode: string;
  productName: string;
  purchaseName: string;  // 사입상품명
  optionName: string;    // 옵션명
  zigzagProductCode: string;
  customProductCode?: string; // 커스텀 상품 코드 추가
  // 추가 상품 정보가 필요한 경우 여기에 추가
}

// 스마트스토어 상품 정보 인터페이스
export interface SmartStoreProductInfo {
  id: string;
  productCode: string;        // 스마트스토어 상품코드 (숫자)
  productName: string;        // 스마트스토어 상품명
  optionName: string;         // 옵션명
  barcode?: string;           // 바코드 (선택적)
  category?: string;          // 카테고리 (선택적)
  price?: number;             // 가격 (선택적)
  stock?: number;             // 재고 (선택적)
}

export interface ReturnState {
  pendingReturns: ReturnItem[];
  completedReturns: ReturnItem[];
  products: ProductInfo[];
} 