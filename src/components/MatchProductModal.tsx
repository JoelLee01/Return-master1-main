import React, { useState, useEffect } from 'react';
import { ReturnItem, ProductInfo } from '@/types/returns';
import PortalWrapper from './PortalWrapper';

interface MatchProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  returnItem: ReturnItem;
  products: ProductInfo[];
  onMatch: (returnItem: ReturnItem, product: ProductInfo) => void;
  zIndex?: number;
}

const MatchProductModal: React.FC<MatchProductModalProps> = ({
  isOpen,
  onClose,
  returnItem,
  products,
  onMatch,
  zIndex
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredProducts, setFilteredProducts] = useState<ProductInfo[]>([]);
  
  useEffect(() => {
    if (products.length > 0) {
      setFilteredProducts(products);
    }
  }, [products]);
  
  const handleSearch = () => {
    if (!searchQuery.trim()) {
      setFilteredProducts(products);
      return;
    }
    
    const query = searchQuery.toLowerCase().trim();
    const results = products.filter(product => 
      (product.productName && product.productName.toLowerCase().includes(query)) ||
      (product.purchaseName && product.purchaseName.toLowerCase().includes(query)) ||
      (product.barcode && product.barcode.toLowerCase().includes(query)) ||
      (product.optionName && product.optionName.toLowerCase().includes(query))
    );
    
    setFilteredProducts(results);
  };
  
  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    
    // 입력값이 변경될 때마다 검색 실행
    if (e.target.value.trim()) {
      const query = e.target.value.toLowerCase().trim();
      const results = products.filter(product => 
        (product.productName && product.productName.toLowerCase().includes(query)) ||
        (product.purchaseName && product.purchaseName.toLowerCase().includes(query)) ||
        (product.barcode && product.barcode.toLowerCase().includes(query)) ||
        (product.optionName && product.optionName.toLowerCase().includes(query))
      );
      
      setFilteredProducts(results);
    } else {
      setFilteredProducts(products);
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <PortalWrapper isOpen={isOpen} onClose={onClose} zIndex={zIndex}>
      <div className="bg-white rounded-lg shadow-xl w-11/12 max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-4 text-white">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold">상품 매칭</h3>
            <button onClick={onClose} className="text-white hover:text-gray-200">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        <div className="p-4 border-b">
          <div className="mb-4">
            <h4 className="text-lg font-medium mb-2">선택된 반품 항목</h4>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div>
                  <span className="font-medium">상품명:</span> {returnItem.productName}
                </div>
                <div>
                  <span className="font-medium">주문번호:</span> {returnItem.orderNumber}
                </div>
                <div>
                  <span className="font-medium">고객명:</span> {returnItem.customerName}
                </div>
                {returnItem.optionName && (
                  <div>
                    <span className="font-medium">옵션:</span> {returnItem.optionName}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="mb-4">
            <div className="flex space-x-2">
              <input
                type="text"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={searchQuery}
                onChange={handleSearchInputChange}
                placeholder="상품명, 사입명, 바코드 등으로 검색"
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              />
              <button
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                onClick={handleSearch}
              >
                검색
              </button>
            </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto">
          {filteredProducts.length > 0 ? (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-2/3">사입상품명</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">옵션명</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">바코드</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">매칭</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product, index) => (
                  <tr key={product.id || index} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-500 break-words">{product.purchaseName || '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{product.optionName || '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-mono">{product.barcode || '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => onMatch(returnItem, product)}
                        className="text-blue-600 hover:text-blue-900 bg-blue-100 hover:bg-blue-200 px-3 py-1 rounded-full transition-colors"
                      >
                        매칭
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-center text-gray-500 py-8">검색 결과가 없습니다</p>
          )}
        </div>
        
        <div className="bg-gray-50 p-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 bg-white rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none"
          >
            닫기
          </button>
        </div>
      </div>
    </PortalWrapper>
  );
};

export default MatchProductModal; 