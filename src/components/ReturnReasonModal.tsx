import React, { useState, useEffect } from 'react';
import { ReturnItem } from '@/types/returns';

interface ReturnReasonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (detailReason: string) => void;
  returnItem: ReturnItem | null;
  detailReason: string;
  setDetailReason: React.Dispatch<React.SetStateAction<string>>;
}

export const ReturnReasonModal: React.FC<ReturnReasonModalProps> = ({
  isOpen,
  onClose,
  onSave,
  returnItem,
  detailReason,
  setDetailReason,
}) => {
  const [isDefective, setIsDefective] = useState(false);
  
  // 제품 불량 여부 판단 함수
  const checkIsDefective = (reason: string | undefined) => {
    if (!reason || typeof reason !== 'string') return false;
    
    const defectiveKeywords = [
      '불량', '하자', '망가', '파손', '깨짐', '훼손',
      '찢어', '구멍', '얼룩', '오염', '이염', '오배송',
      '다른상품', '품질', '하자'
    ];
    
    return defectiveKeywords.some(keyword => reason.includes(keyword));
  };
  
  useEffect(() => {
    if (returnItem && returnItem.returnReason) {
      setIsDefective(checkIsDefective(returnItem.returnReason));
    }
  }, [returnItem]);

  // 배경 클릭 핸들러 - 모달 닫기
  const handleBackgroundClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 클릭된 요소가 배경인 경우에만 모달 닫기
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen || !returnItem) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" onClick={handleBackgroundClick}>
      <div className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"></div>
      
      <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden transform transition-all">
        {/* 헤더 */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold text-white flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              반품 사유 상세
            </h3>
            <button
              className="text-white hover:bg-white/20 rounded-full p-1 transition-colors"
              onClick={onClose}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* 컨텐츠 */}
        <div className="p-6">
          <div className="mb-6 grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">주문 정보</label>
              <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                <div className="text-sm"><span className="font-medium">고객명:</span> {returnItem.customerName}</div>
                <div className="text-sm"><span className="font-medium">주문번호:</span> {returnItem.orderNumber}</div>
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">상품 정보</label>
              <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                <div className="text-sm"><span className="font-medium">상품명:</span> {returnItem.productName}</div>
                {returnItem.optionName && (
                  <div className="text-sm"><span className="font-medium">옵션:</span> {returnItem.optionName}</div>
                )}
                <div className="text-sm"><span className="font-medium">수량:</span> {returnItem.quantity}</div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">반품 사유</label>
              <div className={`p-3 rounded-lg border ${
                isDefective ? 'bg-red-50 border-red-200 text-red-800' : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="flex items-center">
                  {isDefective && (
                    <svg className="h-5 w-5 text-red-600 mr-1" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  )}
                  <span className={`${isDefective ? 'font-medium' : ''}`}>{returnItem.returnReason}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="detailReason" className="block text-sm font-medium text-gray-700">
                상세 사유 메모
              </label>
              <textarea
                id="detailReason"
                className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all min-h-[100px]"
                value={detailReason}
                onChange={(e) => setDetailReason(e.target.value)}
                placeholder="추가 상세 사유나 특이사항을 기록하세요..."
              />
            </div>
          </div>
        </div>
        
        {/* 푸터 */}
        <div className="px-6 py-4 bg-gray-50 flex justify-end space-x-2">
          <button
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            onClick={onClose}
          >
            취소
          </button>
          <button
            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-colors"
            onClick={() => onSave(detailReason)}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}; 