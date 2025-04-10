import React, { useState } from 'react';
import { ReturnItem } from '@/types/returns';
import PortalWrapper from './PortalWrapper';

interface TrackingNumberModalProps {
  isOpen: boolean;
  onClose: () => void;
  returnItem: ReturnItem;
  onSave: (trackingNumber: string) => void;
  zIndex?: number;
}

const TrackingNumberModal: React.FC<TrackingNumberModalProps> = ({
  isOpen,
  onClose,
  returnItem,
  onSave,
  zIndex
}) => {
  const [trackingNumber, setTrackingNumber] = useState(returnItem?.returnTrackingNumber || '');
  
  const handleSave = () => {
    onSave(trackingNumber);
  };
  
  if (!isOpen) return null;
  
  return (
    <PortalWrapper isOpen={isOpen} onClose={onClose} zIndex={zIndex}>
      <div className="bg-white rounded-lg shadow-xl w-96 max-w-full">
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 p-4 text-white">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium">반품송장번호 입력</h3>
            <button onClick={onClose} className="text-white hover:text-gray-200">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
        
        <div className="p-6">
          <div className="mb-4">
            <div className="text-sm font-medium text-gray-500 mb-2">주문 정보</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 p-3 rounded border border-gray-200">
              <div className="text-sm"><span className="font-medium">고객명:</span> {returnItem.customerName}</div>
              <div className="text-sm"><span className="font-medium">주문번호:</span> {returnItem.orderNumber}</div>
              <div className="text-sm sm:col-span-2"><span className="font-medium">상품명:</span> {returnItem.productName}</div>
            </div>
          </div>
          
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">반품 송장번호</label>
            <input
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="송장번호를 입력하세요"
            />
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
              type="button"
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </PortalWrapper>
  );
};

export default TrackingNumberModal; 