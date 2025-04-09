import React, { useState, useEffect } from 'react';
import { ReturnItem, ProductInfo } from '@/types/returns';
import Modal from './ui/Modal';

interface MatchProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  returnItem: ReturnItem;
  products: ProductInfo[];
  onMatch: (returnItem: ReturnItem, product: ProductInfo) => void;
}

export default function MatchProductModal({ 
  isOpen, 
  onClose, 
  returnItem, 
  products, 
  onMatch 
}: MatchProductModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredProducts, setFilteredProducts] = useState<ProductInfo[]>([]);
  
  // 검색 기능 구현 - 사입상품명 기준 검색 추가
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredProducts(products);
      return;
    }
    
    const query = searchQuery.toLowerCase();
    const filtered = products.filter(product => 
      // 사입상품명 우선 검색
      (product.purchaseName && product.purchaseName.toLowerCase().includes(query)) ||
      (product.barcode && product.barcode.toLowerCase().includes(query)) ||
      (product.productName && product.productName.toLowerCase().includes(query)) ||
      (product.optionName && product.optionName.toLowerCase().includes(query)) ||
      (product.zigzagProductCode && product.zigzagProductCode.toLowerCase().includes(query))
    );
    
    setFilteredProducts(filtered);
  }, [searchQuery, products]);
  
  // 지그재그 상품인지 확인
  const isZigzagOrder = returnItem.orderNumber?.includes('Z') || false;
  
  // 모달 닫기 핸들러
  const handleClose = () => {
    setSearchQuery('');
    onClose();
  };
  
  return (
    <Modal 
      isOpen={isOpen} 
      onClose={handleClose} 
      title="상품 매칭" 
      size="xl"
      zIndex={1100} // Z-index 최상위로 설정
    >
      <div className="p-4">
        <div className="mb-4">
          <div className="bg-blue-50 p-3 rounded mb-4">
            <p className="text-sm text-blue-800">
              <span className="font-semibold">현재 반품:</span> {returnItem.productName} ({returnItem.optionName || '옵션 없음'})
            </p>
            <p className="text-xs text-blue-700 mt-1">
              주문번호: {returnItem.orderNumber} | 고객명: {returnItem.customerName}
            </p>
          </div>
          
          {/* 검색 입력창 */}
          <div className="relative mb-4">
            <input
              type="text"
              placeholder="사입상품명으로 검색... (바코드, 상품명, 옵션명도 검색 가능)"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setSearchQuery('')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        </div>
        
        <div className="border rounded-lg overflow-hidden shadow-sm">
          <div className="max-h-96 overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  {/* 필수 필드 순서 변경: 사입상품명, 옵션명, 바코드번호 */}
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">사입상품명</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">옵션명</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">바코드번호</th>
                  {isZigzagOrder && (
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">자체상품코드</th>
                  )}
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={isZigzagOrder ? 5 : 4} className="px-3 py-4 text-center text-sm text-gray-500">
                      {searchQuery ? '검색 결과가 없습니다.' : '상품 데이터가 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((product) => (
                    <tr 
                      key={product.id} 
                      className="hover:bg-blue-50 transition-colors cursor-pointer"
                      onClick={() => onMatch(returnItem, product)}
                    >
                      {/* 필드 순서 변경 */}
                      <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                        {product.purchaseName || product.productName}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">{product.optionName || '-'}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm font-mono text-gray-500">{product.barcode || '-'}</td>
                      {isZigzagOrder && (
                        <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-blue-600">
                          {product.zigzagProductCode || '-'}
                        </td>
                      )}
                      <td className="px-3 py-3 whitespace-nowrap text-right text-sm">
                        <button 
                          className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMatch(returnItem, product);
                          }}
                        >
                          매칭
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            취소
          </button>
        </div>
      </div>
    </Modal>
  );
} 