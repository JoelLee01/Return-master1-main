"use client";

import React, { useState, useEffect } from 'react';
import { ReturnItem, ProductInfo } from '@/types/returns';
import NewModal from './NewModal';

interface ManualRematchModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedItems: ReturnItem[];
  products: ProductInfo[];
  onRematch: (itemId: string, newBarcode: string) => void;
}

const ManualRematchModal: React.FC<ManualRematchModalProps> = ({
  isOpen,
  onClose,
  selectedItems,
  products,
  onRematch
}) => {
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredProducts, setFilteredProducts] = useState<ProductInfo[]>([]);

  const currentItem = selectedItems[selectedItemIndex];

  // 검색어에 따른 상품 필터링
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredProducts(products.slice(0, 20)); // 처음 20개만 표시
    } else {
      const filtered = products.filter(product => 
        product.productName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.purchaseName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.optionName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.barcode?.toLowerCase().includes(searchTerm.toLowerCase())
      ).slice(0, 20);
      setFilteredProducts(filtered);
    }
  }, [searchTerm, products]);

  const handleRematch = (product: ProductInfo) => {
    if (currentItem) {
      onRematch(currentItem.id, product.barcode);
      // 다음 아이템으로 이동하거나 모달 닫기
      if (selectedItemIndex < selectedItems.length - 1) {
        setSelectedItemIndex(selectedItemIndex + 1);
        setSearchTerm('');
      } else {
        // 모든 아이템 처리 완료 시 상태 초기화 후 모달 닫기
        setSelectedItemIndex(0);
        setSearchTerm('');
        onClose();
      }
    }
  };

  const handlePrevious = () => {
    if (selectedItemIndex > 0) {
      setSelectedItemIndex(selectedItemIndex - 1);
      setSearchTerm('');
    }
  };

  const handleNext = () => {
    if (selectedItemIndex < selectedItems.length - 1) {
      setSelectedItemIndex(selectedItemIndex + 1);
      setSearchTerm('');
    }
  };

  // 모달이 닫힐 때 상태 초기화
  const handleClose = () => {
    setSelectedItemIndex(0);
    setSearchTerm('');
    onClose();
  };

  if (!currentItem) return null;

  return (
    <NewModal isOpen={isOpen} onClose={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-purple-600 to-pink-600 p-4 text-white">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold">
              수동 재매칭 ({selectedItemIndex + 1}/{selectedItems.length})
            </h3>
                         <button onClick={handleClose} className="text-white hover:text-gray-200">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {/* 현재 선택된 아이템 정보 */}
          <div className="bg-blue-50 p-4 rounded-lg mb-4">
            <h4 className="font-semibold text-blue-800 mb-2">재매칭할 반품 아이템:</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">구매자:</span> {currentItem.customerName}
              </div>
              <div>
                <span className="font-medium">상품명:</span> {currentItem.purchaseName}
              </div>
              <div>
                <span className="font-medium">옵션:</span> {currentItem.optionName}
              </div>
              <div>
                <span className="font-medium">현재 바코드:</span> 
                <span className="text-red-600 font-mono">{currentItem.barcode || '매칭 안됨'}</span>
              </div>
            </div>
          </div>

          {/* 상품 검색 */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="상품명, 옵션명, 바코드로 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          {/* 상품 목록 */}
          <div className="overflow-y-auto max-h-[50vh]">
            <table className="w-full border-collapse">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="p-2 text-left border">바코드</th>
                  <th className="p-2 text-left border">상품명</th>
                  <th className="p-2 text-left border">사입상품명</th>
                  <th className="p-2 text-left border">옵션명</th>
                  <th className="p-2 text-left border">액션</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product, index) => (
                  <tr key={index} className="hover:bg-gray-50 border-b">
                    <td className="p-2 border font-mono text-sm">{product.barcode}</td>
                    <td className="p-2 border text-sm">{product.productName}</td>
                    <td className="p-2 border text-sm">{product.purchaseName}</td>
                    <td className="p-2 border text-sm">{product.optionName}</td>
                    <td className="p-2 border">
                      <button
                        onClick={() => handleRematch(product)}
                        className="px-3 py-1 bg-purple-500 hover:bg-purple-600 text-white rounded text-sm transition-colors"
                      >
                        선택
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredProducts.length === 0 && (
              <p className="text-center text-gray-500 py-4">검색 결과가 없습니다.</p>
            )}
          </div>
        </div>

        {/* 하단 버튼들 */}
        <div className="bg-gray-50 p-4 flex justify-between">
          <div className="flex gap-2">
            <button
              onClick={handlePrevious}
              disabled={selectedItemIndex === 0}
              className="px-4 py-2 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 text-white rounded-md transition-colors"
            >
              이전
            </button>
            <button
              onClick={handleNext}
              disabled={selectedItemIndex === selectedItems.length - 1}
              className="px-4 py-2 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 text-white rounded-md transition-colors"
            >
              다음
            </button>
          </div>
                     <button
             onClick={handleClose}
             className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors"
           >
             닫기
           </button>
        </div>
      </div>
    </NewModal>
  );
};

export default ManualRematchModal;
