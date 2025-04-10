import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// 팝업 컴포넌트를 포털로 렌더링하는 래퍼 컴포넌트
interface PortalWrapperProps {
  children: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
  zIndex?: number;
}

const PortalWrapper: React.FC<PortalWrapperProps> = ({ children, isOpen, onClose, zIndex }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  
  // 매우 높은 z-index 값 사용
  const useZIndex = zIndex || 99999;
  
  useEffect(() => {
    if (isOpen) {
      // 모달이 열릴 때 백드롭과 모달에 매우 높은 z-index 설정
      if (backdropRef.current) {
        backdropRef.current.style.zIndex = String(useZIndex - 1);
      }
      
      if (modalRef.current) {
        modalRef.current.style.zIndex = String(useZIndex);
        
        // 모달에 포커스 설정
        setTimeout(() => {
          const focusableElement = modalRef.current?.querySelector(
            'button, [tabindex]:not([tabindex="-1"]), input, select, textarea, a[href]'
          ) as HTMLElement;
          
          if (focusableElement) {
            focusableElement.focus();
          } else if (modalRef.current) {
            modalRef.current.focus();
          }
        }, 50);
      }
      
      // 스크롤 방지
      document.body.style.overflow = 'hidden';
      
      // ESC 키 이벤트 리스너 등록
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault(); // 기본 dialog ESC 동작 방지
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
  }, [isOpen, onClose, useZIndex]);
  
  // 모달 외부 클릭 시 닫기
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };
  
  if (!isOpen) return null;
  
  return createPortal(
    <>
      {/* 백드롭 - 항상 최상위 레이어로 설정 */}
      <div 
        ref={backdropRef}
        className="modal-backdrop-high fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
        onClick={handleBackdropClick}
        style={{
          zIndex: useZIndex - 1,
        }}
      />
      
      {/* 모달 컨테이너 - 항상 백드롭보다 위에 설정 */}
      <div 
        className="modal-high fixed inset-0 flex items-center justify-center"
        style={{
          zIndex: useZIndex,
        }}
      >
        <div 
          className="relative bg-white rounded-lg shadow-xl"
          ref={modalRef}
          tabIndex={-1} // 키보드 포커스 지원
          style={{
            maxWidth: '95vw',
            maxHeight: '90vh',
            overflow: 'auto',
          }}
        >
          {children}
        </div>
      </div>
    </>,
    document.body // 항상 document.body에 직접 렌더링
  );
};

export default PortalWrapper; 