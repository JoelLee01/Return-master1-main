import React, { ReactNode, useRef, useEffect } from 'react';
import { addModalToManager, removeModalFromManager } from '@/utils/modalManager';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  zIndex?: number;
}

const Modal: React.FC<ModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  size = 'md',
  zIndex = 50
}) => {
  const modalId = useRef<string>(`modal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 클라이언트 사이드에서만 실행
    if (typeof window === 'undefined') {
      return;
    }

    if (isOpen && modalRef.current) {
      // 전역 관리자에 모달 추가 (최상위로 자동 이동)
      addModalToManager(modalId.current, modalRef.current);
    } else if (!isOpen) {
      // 모달이 닫힐 때 관리자에서 제거
      removeModalFromManager(modalId.current);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackgroundClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      removeModalFromManager(modalId.current);
      onClose();
    }
  };

  const getMaxWidthClass = () => {
    switch (size) {
      case 'sm': return 'max-w-md';
      case 'md': return 'max-w-lg';
      case 'lg': return 'max-w-2xl';
      case 'xl': return 'max-w-4xl';
      default: return 'max-w-lg';
    }
  };

  return (
    <div 
      className="fixed inset-0 flex items-center justify-center"
      onClick={handleBackgroundClick}
      ref={modalRef}
      style={{ zIndex: zIndex || 10000 }}
    >
      <div className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"></div>
      
      <div className={`relative bg-white rounded-lg shadow-xl ${getMaxWidthClass()} w-full mx-4 overflow-hidden`}>
        {/* 헤더 */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold text-white">{title}</h3>
            <button
              className="text-white hover:bg-white/20 rounded-full p-1 transition-colors"
              onClick={() => {
                removeModalFromManager(modalId.current);
                onClose();
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* 컨텐츠 */}
        {children}
      </div>
    </div>
  );
};

export default Modal; 