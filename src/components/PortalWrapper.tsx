import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// 전역 z-index 관리를 위한 변수 - 기본값 높게 설정
let highestZIndex = 10000;

// 최상단 z-index 값을 가져오는 함수
export const getHighestZIndex = () => {
  // 현재 관리 중인 z-index보다 항상 높은 값 반환
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
  // 외부에서 지정한 zIndex가 있으면 항상 그 값을 우선 적용, 없으면 새로운 값 생성
  const modalZIndex = useRef<number>(zIndex || getHighestZIndex());
  
  // zIndex prop이 변경되면 modalZIndex 값을 업데이트
  useEffect(() => {
    if (zIndex !== undefined) {
      modalZIndex.current = zIndex;
    }
  }, [zIndex]);
  
  // ESC 키 누르면 모달 닫기
  useEffect(() => {
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
      
      // ESC 키 이벤트 리스너 등록
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };
      
      window.addEventListener('keydown', handleKeyDown);
      
      // 이벤트 리스너 정리
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
      };
    }
  }, [isOpen, zIndex, onClose]);
  
  // 모달 외부 클릭 시 닫기
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };
  
  if (!isOpen) return null;
  
  // 항상 document.body에 직접 렌더링
  return createPortal(
    <div 
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50"
      onClick={handleBackdropClick}
      style={{ 
        zIndex: modalZIndex.current,
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div 
        className="relative bg-white"
        ref={modalRef}
        tabIndex={-1} // 키보드 포커스 지원
        style={{
          maxWidth: '95vw',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
          borderRadius: '0.5rem',
          padding: '1rem'
        }}
      >
        {children}
      </div>
    </div>,
    document.body // 항상 document.body에 직접 렌더링
  );
};

export default PortalWrapper; 