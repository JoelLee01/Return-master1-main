import React, { useState, useEffect, useRef } from 'react';
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
  zIndex = 1000
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<ProductInfo[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductInfo | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const productsPerPage = 20; // 한 번에 보여줄 상품 수 제한
  const modalRef = useRef<HTMLDivElement>(null);

  // 컴포넌트 마운트 시 초기 필터링 수행 (최적화)
  useEffect(() => {
    if (isOpen && products.length > 0) {
      // 초기 로딩 상태 설정
      setIsLoading(true);
      
      // 비동기 처리로 UI 블로킹 방지
      setTimeout(() => {
        const initialFiltered = filterProducts(products, '', returnItem).slice(0, productsPerPage);
        setFilteredProducts(initialFiltered);
        setIsLoading(false);
      }, 10);
    }
  }, [isOpen, products, returnItem]);

  // 검색어 변경 시 필터링 처리 (디바운스 적용)
  useEffect(() => {
    if (!isOpen) return;
    
    const timer = setTimeout(() => {
      setIsLoading(true);
      
      // 비동기 처리로 UI 블로킹 방지
      setTimeout(() => {
        const newFilteredProducts = filterProducts(products, searchTerm, returnItem).slice(0, page * productsPerPage);
        setFilteredProducts(newFilteredProducts);
        setIsLoading(false);
      }, 50);
    }, 300); // 검색어 입력 후 300ms 대기
    
    return () => clearTimeout(timer);
  }, [searchTerm, products, returnItem, page, isOpen]);

  // 더 보기 버튼 클릭 시 추가 상품 로드
  const loadMoreProducts = () => {
    setLoadingMore(true);
    setPage(prevPage => prevPage + 1);
    
    // 비동기 처리로 UI 블로킹 방지
    setTimeout(() => {
      setLoadingMore(false);
    }, 200);
  };

  // 상품 필터링 함수
  const filterProducts = (products: ProductInfo[], term: string, returnItem: ReturnItem): ProductInfo[] => {
    let filtered = [...products];
    
    // 검색어가 있는 경우 필터링
    if (term.trim()) {
      const lowerTerm = term.toLowerCase();
      filtered = filtered.filter(product => 
        (product.productName && product.productName.toLowerCase().includes(lowerTerm)) ||
        (product.purchaseName && product.purchaseName.toLowerCase().includes(lowerTerm)) ||
        (product.optionName && product.optionName.toLowerCase().includes(lowerTerm)) ||
        (product.barcode && product.barcode.toLowerCase().includes(lowerTerm)) ||
        (product.customProductCode && product.customProductCode.toLowerCase().includes(lowerTerm))
      );
    }
    
    // 반품 아이템과 관련성 높은 순으로 정렬
    filtered.sort((a, b) => {
      // 1. 상품명 일치도 (returnItem.productName과 product.productName 비교)
      const aNameSimilarity = calculateNameSimilarity(returnItem.productName, a.productName);
      const bNameSimilarity = calculateNameSimilarity(returnItem.productName, b.productName);
      
      if (Math.abs(aNameSimilarity - bNameSimilarity) > 0.3) {
        return bNameSimilarity - aNameSimilarity;
      }
      
      // 2. 옵션명 일치도
      const aOptionSimilarity = calculateNameSimilarity(returnItem.optionName || '', a.optionName || '');
      const bOptionSimilarity = calculateNameSimilarity(returnItem.optionName || '', b.optionName || '');
      
      return bOptionSimilarity - aOptionSimilarity;
    });
    
    return filtered;
  };

  // 텍스트 유사도 계산 함수
  const calculateNameSimilarity = (str1: string, str2: string): number => {
    if (!str1 || !str2) return 0;
    
    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();
    
    // 정확히 일치하면 최고 점수
    if (str1 === str2) return 1;
    
    // 포함 관계면 높은 점수
    if (str1.includes(str2) || str2.includes(str1)) return 0.8;
    
    // 단어 단위로 비교
    const words1 = str1.split(/\s+/);
    const words2 = str2.split(/\s+/);
    
    let matchCount = 0;
    for (const word1 of words1) {
      if (word1.length < 2) continue; // 너무 짧은 단어는 제외
      for (const word2 of words2) {
        if (word2.length < 2) continue;
        if (word1 === word2 || word1.includes(word2) || word2.includes(word1)) {
          matchCount++;
          break;
        }
      }
    }
    
    return matchCount / Math.max(words1.length, words2.length);
  };

  // 추가 최적화: 모달 바깥 클릭 시 닫기
  const handleClickOutside = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center"
      style={{ zIndex }}
      onClick={handleClickOutside}
    >
      <div 
        ref={modalRef}
        className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-xl font-bold">상품 매칭</h2>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="p-4 border-b">
          <div className="mb-4">
            <p className="font-semibold">매칭할 반품 정보</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <span className="text-gray-600">고객명:</span> {returnItem.customerName}
              </div>
              <div>
                <span className="text-gray-600">주문번호:</span> {returnItem.orderNumber}
              </div>
              <div>
                <span className="text-gray-600">상품명:</span> {returnItem.productName}
              </div>
              <div>
                <span className="text-gray-600">옵션명:</span> {returnItem.optionName}
              </div>
            </div>
          </div>
          
          <div className="relative">
            <input
              type="text"
              placeholder="상품명, 사입상품명, 바코드, 자체상품코드로 검색"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded pl-10"
            />
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute left-3 top-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
              <span className="ml-2">상품 목록 로딩 중...</span>
            </div>
          ) : filteredProducts.length > 0 ? (
            <>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-2/3">사입상품명</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">옵션명</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">바코드</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">자체상품코드</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">매칭</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product, index) => (
                    <tr key={product.id || index} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-500 break-words">{product.purchaseName || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{product.optionName || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-mono">{product.barcode || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-mono">{product.customProductCode || '-'}</td>
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
              
              {filteredProducts.length < (filterProducts(products, searchTerm, returnItem).length) && (
                <div className="flex justify-center p-4">
                  <button
                    onClick={loadMoreProducts}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded transition-colors flex items-center"
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-gray-500 mr-2"></div>
                        로딩 중...
                      </>
                    ) : '더 보기'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-center text-gray-500 py-8">검색 결과가 없습니다</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default MatchProductModal; 