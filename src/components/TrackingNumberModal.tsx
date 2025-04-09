import React, { useState } from 'react';
import { ReturnItem } from '@/types/returns';

interface TrackingNumberModalProps {
  isOpen: boolean;
  onClose: () => void;
  returnItem: ReturnItem;
  onSave: (trackingNumber: string) => void;
}

export default function TrackingNumberModal({
  isOpen,
  onClose,
  returnItem,
  onSave
}: TrackingNumberModalProps) {
  const [trackingNumberInput, setTrackingNumberInput] = useState(returnItem.returnTrackingNumber || '');

  const handleSave = () => {
    onSave(trackingNumberInput.trim());
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">반품송장번호 입력</h3>
        <p className="mb-2"><span className="font-medium">주문번호:</span> {returnItem.orderNumber}</p>
        <p className="mb-2"><span className="font-medium">상품명:</span> {returnItem.productName}</p>
        <p className="mb-4"><span className="font-medium">옵션:</span> {returnItem.optionName}</p>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">반품송장번호:</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded"
            value={trackingNumberInput}
            onChange={(e) => setTrackingNumberInput(e.target.value)}
            placeholder="송장번호 입력 (입력 후 입고완료 처리됨)"
            autoFocus
          />
        </div>
        
        <div className="flex justify-end space-x-2">
          <button
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded"
            onClick={onClose}
          >
            취소
          </button>
          <button
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
            onClick={handleSave}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
} 