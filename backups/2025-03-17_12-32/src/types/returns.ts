export interface ReturnItem {
  customerName: string;
  orderNumber: string;
  productName: string;
  purchaseName?: string;
  optionName: string;
  quantity: number;
  returnTrackingNumber: string;
  returnReason: string;
  barcode: string;
  zigzagProductCode: string;
  status: 'PENDING' | 'COMPLETED';
  completedAt?: Date;
  orderId?: string;
  productId?: string;
  detailReason?: string;  // 상세 반품사유
}

export interface ProductInfo {
  barcode: string;
  productName: string;
  purchaseName: string;  // 사입상품명
  optionName: string;    // 옵션명
  zigzagProductCode: string;
  // 추가 상품 정보가 필요한 경우 여기에 추가
}

export interface ReturnState {
  pendingReturns: ReturnItem[];
  completedReturns: ReturnItem[];
  products: ProductInfo[];
} 