import React, { useState, useEffect, useRef } from 'react';
import { ReturnItem } from '@/types/returns';
import PortalWrapper from './PortalWrapper';

interface ReturnReasonModalProps {
  isOpen: boolean;
  onClose: () => void;
  returnItem: ReturnItem;
  detailReason: string;
  onSave: (detailReason: string) => void;
  setDetailReason: (reason: string) => void;
  zIndex?: number;
}

const ReturnReasonModal: React.FC<ReturnReasonModalProps> = ({
  isOpen,
  onClose,
  returnItem,
  detailReason,
  onSave,
  setDetailReason,
  zIndex = 1000
}) => {
  const [localDetailReason, setLocalDetailReason] = useState(detailReason);
  const [isLoading, setIsLoading] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // 로컬 상태 초기화
  useEffect(() => {
    if (isOpen) {
      setLocalDetailReason(detailReason || '');
      // 비동기 처리로 UI 블로킹 방지
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }, 50);
    }
  }, [isOpen, detailReason]);
  
<<<<<<< HEAD
  // 자주 사용하는 사유 목록 추가
  const suggestedReasons = [
    '파손 및 불량', // "파손"을 "파손 및 불량"으로 변경
    '색상 차이',
    '사이즈 차이',
    '오배송',
    '배송 지연',
    '제품 결함',
    '포장 훼손',
    '구성품 누락'
  ];
  
  // 자주 사용하는 사유 클릭 처리
  const handleReasonClick = (reason: string) => {
    setLocalReason(prev => prev ? `${prev}, ${reason}` : reason);
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDetailReason(localReason);
    onSave(localReason);
=======
  // 유사한 반품사유 제안 목록
  const suggestedReasons = [
    '포장 훼손',
    '제품 파손',
    '구성품 누락',
    '품질 불량',
    '오염/변색',
    '작동 불량',
    '사이즈 차이',
    '색상 차이',
    '다른 상품 배송'
  ];
  
  const handleSave = () => {
    setIsLoading(true);
    
    // 비동기 처리로 UI 블로킹 방지
    setTimeout(() => {
      setDetailReason(localDetailReason);
      onSave(localDetailReason);
      setIsLoading(false);
    }, 100);
>>>>>>> 1a0917a5912cb2fd950063edf561e6b71bf08995
  };
  
  const handleSuggestionClick = (suggestion: string) => {
    setLocalDetailReason(prevReason => 
      prevReason ? `${prevReason}, ${suggestion}` : suggestion
    );
    
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };
  
  // 모달 바깥 클릭 시 닫기
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
        className="bg-white rounded-lg w-full max-w-lg overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-xl font-bold">반품사유 상세 입력</h2>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="p-4">
          <div className="mb-4">
            <p className="font-semibold mb-2">반품 정보</p>
            <div className="bg-gray-50 p-3 rounded border">
              <div className="grid grid-cols-2 gap-2">
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
                <div className="col-span-2">
                  <span className="text-gray-600">반품사유:</span> 
                  <span className={`${returnItem.returnReason.includes('파손') || returnItem.returnReason.includes('불량') ? 'text-red-500 font-semibold' : ''}`}>
                    {returnItem.returnReason}
                  </span>
                </div>
              </div>
            </div>
<<<<<<< HEAD
            
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
              <div className="bg-pink-50 p-3 rounded-lg border border-pink-200 text-red-800">
                {returnItem.returnReason?.replace('파손', '파손 및 불량') || ''}
              </div>
            </div>
            
            <div className="space-y-2">
              <label htmlFor="detailReason" className="block text-sm font-medium text-gray-700">
                상세 사유
              </label>
              <textarea
                id="detailReason"
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows={4}
                value={localReason}
                onChange={(e) => setLocalReason(e.target.value)}
                placeholder="반품 상세 사유를 입력하세요"
              />
            </div>
            
            {/* 자주 사용하는 사유 목록 */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">자주 사용하는 사유</label>
              <div className="flex flex-wrap gap-2">
                {suggestedReasons.map((reason, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleReasonClick(reason)}
                    className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-full"
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>
=======
>>>>>>> 1a0917a5912cb2fd950063edf561e6b71bf08995
          </div>
          
          <div className="mb-4">
            <label className="block font-medium mb-1">상세 사유 입력</label>
            <textarea
              ref={textareaRef}
              value={localDetailReason}
              onChange={(e) => setLocalDetailReason(e.target.value)}
              placeholder="상세 반품사유를 입력하세요..."
              className="w-full p-2 border border-gray-300 rounded h-32 resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          <div className="mb-4">
            <p className="text-sm font-medium mb-2">자주 사용하는 사유</p>
            <div className="flex flex-wrap gap-2">
              {suggestedReasons.map((reason, index) => (
                <button
                  key={index}
                  onClick={() => handleSuggestionClick(reason)}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-full text-sm transition-colors"
                >
                  {reason}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        <div className="bg-gray-50 p-4 flex justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 bg-white rounded shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-500 text-white rounded shadow-sm text-sm font-medium hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                저장 중...
              </span>
            ) : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReturnReasonModal; 