import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// 전역 z-index 관리를 위한 변수
let highestZIndex = 1000;

// 최상단 z-index 값을 가져오는 함수
export const getHighestZIndex = () => {
  // DOM에서 현재 최고 z-index 값 계산
  const maxDomZIndex = Math.max(
    ...Array.from(document.querySelectorAll('*'))
      .map(el => parseInt(window.getComputedStyle(el).zIndex) || 0)
  );
  
  // 현재 관리 중인 highestZIndex와 DOM에서 찾은 최고값 중 더 큰 값 선택
  highestZIndex = Math.max(highestZIndex, maxDomZIndex) + 10;
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
  const modalZIndex = useRef<number>(zIndex || getHighestZIndex());
  
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
    
    // 모달 열릴 때마다 z-index 재계산하여 항상 최상단에 표시
    if (isOpen) {
      if (!zIndex) {
        modalZIndex.current = getHighestZIndex();
      }
      
      // 스크롤 방지
      document.body.style.overflow = 'hidden';
      
      // 모달 포커스 설정 (접근성 개선)
      setTimeout(() => {
        if (modalRef.current) {
          const focusableElement = modalRef.current.querySelector(
            'button, [tabindex]:not([tabindex="-1"]), input, select, textarea, a[href]'
          ) as HTMLElement;
          
          if (focusableElement) {
            focusableElement.focus();
          } else {
            modalRef.current.focus();
          }
        }
      }, 50);
    }
    
    // 컴포넌트가 언마운트될 때 스크롤 복원
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, zIndex]);
  
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
      style={{ zIndex: modalZIndex.current }}
      role="dialog"
      aria-modal="true"
    >
      <div 
        className="relative"
        ref={modalRef}
        tabIndex={-1} // 키보드 포커스 지원
      >
        {children}
      </div>
    </div>,
    portalRoot.current
  );
};

export default PortalWrapper; 