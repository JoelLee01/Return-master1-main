"use client";

import React from 'react';
import { ReturnItem } from '@/types/returns';
import NewModal from './NewModal';

interface PendingReturnsModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: ReturnItem[];
  selectedItems: number[];
  onRefresh: () => void;
  onProcessSelected: () => void;
  onDeleteSelected: () => void;
  onRematchSelected: () => void;
  onItemSelect: (item: ReturnItem, checked: boolean) => void;
  PendingItemsTable: React.ComponentType<{ items: ReturnItem[] }>;
}

const PendingReturnsModal: React.FC<PendingReturnsModalProps> = ({
  isOpen,
  onClose,
  items,
  selectedItems,
  onRefresh,
  onProcessSelected,
  onDeleteSelected,
  onRematchSelected,
  onItemSelect,
  PendingItemsTable
}) => {
  return (
         <NewModal isOpen={isOpen} onClose={onClose}>
       <div className="bg-white rounded-lg shadow-xl w-full max-w-[108vw] max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-4 text-white">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold">입고전 반품 목록</h3>
            <button onClick={onClose} className="text-white hover:text-gray-200">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto p-6">
          {items && items.length > 0 ? (
            <div className="overflow-x-auto max-h-[70vh]">
              <PendingItemsTable items={items} />
            </div>
          ) : (
            <p className="text-center text-gray-500 py-8">대기 중인 반품이 없습니다.</p>
          )}
        </div>
        
        <div className="bg-gray-50 p-4 flex flex-wrap gap-2 justify-end">
          <button 
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
            onClick={onRefresh}
          >
            새로고침
          </button>
                     {selectedItems.length > 0 && (
             <>
               <button 
                 className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md transition-colors"
                 onClick={onProcessSelected}
               >
                 선택항목 입고처리 ({selectedItems.length}개)
               </button>
               <button 
                 className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors"
                 onClick={onDeleteSelected}
               >
                 선택항목 삭제 ({selectedItems.length}개)
               </button>
             </>
           )}
           {selectedItems.length > 0 && (
             <button 
               className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-md transition-colors"
               onClick={onRematchSelected}
             >
               재매칭 ({selectedItems.length}개)
             </button>
           )}
          <button 
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors"
            onClick={onClose}
          >
            닫기
          </button>
        </div>
      </div>
    </NewModal>
  );
};

export default PendingReturnsModal;
