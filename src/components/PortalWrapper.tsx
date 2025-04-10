import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// 전역 z-index 관리를 위한 변수
let highestZIndex = 1000;

// 최상단 z-index 값을 가져오는 함수
export const getHighestZIndex = () => {
  highestZIndex += 10;
  return highestZIndex;
};

// 팝업 컴포넌트를 포털로 렌더링하는 래퍼 컴포넌트
interface PortalWrapperProps {
  children: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
  zIndex?: number;
}

const PortalWrapper: React.FC<PortalWrapperProps> = ({ children, isOpen, onClose, zIndex }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const portalRoot = useRef<HTMLElement | null>(null);
  
  useEffect(() => {
    // 컴포넌트가 마운트될 때 모달 컨테이너 생성 및 추가
    if (!portalRoot.current) {
      let existingRoot = document.getElementById('portal-root');
      
      if (!existingRoot) {
        existingRoot = document.createElement('div');
        existingRoot.id = 'portal-root';
        document.body.appendChild(existingRoot);
      }
      
      portalRoot.current = existingRoot;
    }
    
    // 모달 열릴 때 스크롤 방지
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    
    // 컴포넌트가 언마운트될 때 스크롤 복원
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);
  
  // ESC 키 누르면 모달 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);
  
  // 모달 외부 클릭 시 닫기
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };
  
  if (!isOpen || !portalRoot.current) return null;
  
  return createPortal(
    <div 
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50"
      onClick={handleBackdropClick}
      style={{ zIndex: zIndex || 1000 }}
    >
      <div 
        className="relative"
        ref={modalRef}
      >
        {children}
      </div>
    </div>,
    portalRoot.current
  );
};

export default PortalWrapper; 