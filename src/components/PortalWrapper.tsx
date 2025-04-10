import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PopupManager } from '../utils/PopupManager';

// 전역 z-index 관리를 위한 변수 - 기본값 높게 설정
let highestZIndex = 10000;

// 최상단 z-index 값을 가져오는 함수
export const getHighestZIndex = () => {
  // PopupManager의 함수 사용
  return PopupManager.getHighZIndex();
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
  // 외부에서 지정한 zIndex가 있으면 항상 그 값을 우선 적용, 없으면 새로운 값 생성
  const modalZIndex = useRef<number>(zIndex || getHighestZIndex());
  
  // zIndex prop이 변경되면 modalZIndex 값을 업데이트
  useEffect(() => {
    if (zIndex !== undefined) {
      modalZIndex.current = zIndex;
    }
  }, [zIndex]);
  
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
    
    // 모달 열릴 때만 처리
    if (isOpen) {
      // zIndex prop이 없는 경우에만 새로운 값 할당
      if (zIndex === undefined) {
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
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50"
      onClick={handleBackdropClick}
      style={{ 
        zIndex: modalZIndex.current,
        position: 'fixed',
        inset: 0,
      }}
      role="dialog"
      aria-modal="true"
    >
      <div 
        className="relative"
        ref={modalRef}
        tabIndex={-1} // 키보드 포커스 지원
        style={{
          maxWidth: '95vw',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)'
        }}
      >
        {children}
      </div>
    </div>,
    portalRoot.current
  );
};

export default PortalWrapper; 