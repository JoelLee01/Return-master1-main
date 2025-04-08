import React, { useState, useEffect } from 'react';
import { ReturnItem, ProductInfo } from '@/types/returns';

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
  
  // 검색 기능 구현
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredProducts(products);
      return;
    }
    
    const query = searchQuery.toLowerCase();
    const filtered = products.filter(product => 
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

  // 배경 클릭 핸들러 - 모달 닫기
  const handleBackgroundClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 클릭된 요소가 배경인 경우에만 모달 닫기
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 flex items-center justify-center z-[1100]" onClick={handleBackgroundClick}>
      <div className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"></div>
      
      <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 overflow-hidden transform transition-all">
        {/* 헤더 */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold text-white flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
              </svg>
              상품 매칭
            </h3>
            <button
              className="text-white hover:bg-white/20 rounded-full p-1 transition-colors"
              onClick={handleClose}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* 컨텐츠 */}
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
                placeholder="바코드, 상품명, 옵션명, 자체상품코드로 검색..."
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
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
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">바코드번호</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">상품명</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">옵션명</th>
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
                        <td className="px-3 py-3 whitespace-nowrap text-sm font-mono text-gray-500">{product.barcode}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{product.productName}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">{product.optionName}</td>
                        {isZigzagOrder && (
                          <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-blue-600">{product.zigzagProductCode}</td>
                        )}
                        <td className="px-3 py-3 whitespace-nowrap text-right text-sm">
                          <button 
                            className="text-blue-600 hover:text-blue-900 font-medium"
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
          
          {/* 푸터 */}
          <div className="mt-4 px-6 py-4 bg-gray-50 flex justify-end">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 