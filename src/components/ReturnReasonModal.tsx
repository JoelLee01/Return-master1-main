import React, { useState, useEffect } from 'react';
import { ReturnItem } from '@/types/returns';
import PortalWrapper from './PortalWrapper';

interface ReturnReasonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (detailReason: string) => void;
  returnItem: ReturnItem | null;
  detailReason: string;
  setDetailReason: React.Dispatch<React.SetStateAction<string>>;
  zIndex?: number;
}

export const ReturnReasonModal: React.FC<ReturnReasonModalProps> = ({
  isOpen,
  onClose,
  onSave,
  returnItem,
  detailReason,
  setDetailReason,
  zIndex
}) => {
  const [localReason, setLocalReason] = useState(detailReason);
  
  useEffect(() => {
    setLocalReason(detailReason);
  }, [detailReason]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDetailReason(localReason);
    onSave(localReason);
  };
  
  if (!isOpen || !returnItem) return null;
  
  return (
    <PortalWrapper isOpen={isOpen} onClose={onClose} zIndex={zIndex}>
      <div className="bg-white rounded-lg shadow-xl w-11/12 max-w-xl defect-modal-container">
        <div className="bg-gradient-to-r from-red-600 to-red-700 p-4 text-white">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium">반품 사유 상세</h3>
            <button onClick={onClose} className="text-white hover:text-gray-200"
              style={{ position: 'relative', zIndex: (zIndex || 9000) + 1 }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6">
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
              <div className="bg-pink-50 p-3 rounded-lg border border-pink-200 text-red-800">
                {returnItem.returnReason}
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
          </div>
          
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              저장
            </button>
          </div>
        </form>
      </div>
    </PortalWrapper>
  );
}; 