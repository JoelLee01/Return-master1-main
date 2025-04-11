import React, { useState, useEffect } from 'react';
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
  const [trackingNumber, setTrackingNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  useEffect(() => {
    if (isOpen) {
      setTrackingNumber(returnItem.returnTrackingNumber || '');
    }
  }, [isOpen, returnItem]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    // 비동기 처리를 통해 로딩 표시를 잠시 보여줌
    setTimeout(() => {
      onSave(trackingNumber);
      setIsLoading(false);
    }, 300);
  };
  
  if (!isOpen) return null;
  
  return (
    <PortalWrapper isOpen={isOpen} onClose={onClose} zIndex={zIndex}>
      <div className="bg-white rounded-lg shadow-xl w-11/12 max-w-md">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-4 text-white">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium">송장번호 입력</h3>
            <button 
              onClick={onClose} 
              className="text-white hover:text-gray-200"
              disabled={isLoading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6">
          <div className="mb-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">반품 정보</label>
              <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                <div className="text-sm"><span className="font-medium">고객명:</span> {returnItem.customerName}</div>
                <div className="text-sm"><span className="font-medium">주문번호:</span> {returnItem.orderNumber}</div>
                <div className="text-sm"><span className="font-medium">상품명:</span> {returnItem.productName}</div>
                {returnItem.optionName && (
                  <div className="text-sm"><span className="font-medium">옵션:</span> {returnItem.optionName}</div>
                )}
              </div>
            </div>
            
            <div>
              <label htmlFor="trackingNumber" className="block text-sm font-medium text-gray-700 mb-2">
                송장번호
              </label>
              <input
                id="trackingNumber"
                type="text"
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="송장번호를 입력하세요"
                disabled={isLoading}
              />
            </div>
          </div>
          
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:opacity-50"
              disabled={isLoading}
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  저장 중...
                </>
              ) : '저장'}
            </button>
          </div>
        </form>
      </div>
    </PortalWrapper>
  );
};

export default TrackingNumberModal; 