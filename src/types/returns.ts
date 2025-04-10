export interface ReturnItem {
  id: string;
  customerName: string;
  orderNumber: string;
  productName: string;
  purchaseName?: string;
  optionName: string;
  quantity: number;
  returnTrackingNumber: string;
  returnReason: string;
  returnDetailReason?: string; // 상세 반품사유 추가
  barcode: string;
  zigzagProductCode: string;
  customProductCode?: string;
  status: 'PENDING' | 'COMPLETED';
  completedAt?: Date;
  orderId?: string;
  productId?: string;
  detailReason?: string;  // 상세 반품사유 (기존 필드 유지)
  matchSimilarity?: number; // 상품 매칭 유사도
  matchType?: string;    // 상품 매칭 방식 (예: '상품명 완전일치', '유사도 매칭' 등)
  matchedProductName?: string; // 매칭된 상품 이름
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

export interface ReturnState {
  pendingReturns: ReturnItem[];
  completedReturns: ReturnItem[];
  products: ProductInfo[];
} 