import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { addModalToManager, removeModalFromManager } from '@/utils/modalManager';

// 팝업 컴포넌트를 포털로 렌더링하는 래퍼 컴포넌트
interface PortalWrapperProps {
  children: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
  zIndex?: number;
}

const PortalWrapper: React.FC<PortalWrapperProps> = ({ children, isOpen, onClose, zIndex }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const modalId = useRef<string>(`modal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  
  useEffect(() => {
    // 클라이언트 사이드에서만 실행
    if (typeof window === 'undefined') {
      return;
    }

    // 모달 열릴 때마다 전역 관리자에 추가
    if (isOpen && modalRef.current) {
      // 스크롤 방지
      document.body.style.overflow = 'hidden';
      
      // 전역 관리자에 모달 추가 (최상위로 자동 이동)
      addModalToManager(modalId.current, modalRef.current);
      
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
    
    // 컴포넌트가 언마운트될 때 스크롤 복원 및 모달 제거
    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
      if (isOpen) {
        removeModalFromManager(modalId.current);
      }
    };
  }, [isOpen]);
  
  // ESC 키 누르면 모달 닫기
  useEffect(() => {
    // 클라이언트 사이드에서만 실행
    if (typeof window === 'undefined') {
      return;
    }

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
  
  if (!isOpen) return null;
  
  // 모달 요소 생성
  const modalElement = (
    <div 
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50"
      onClick={handleBackdropClick}
      style={{ 
        position: 'fixed',
        inset: 0,
        zIndex: zIndex || 10000,
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
    </div>
  );
  
  // document.body에 직접 포털 생성 (클라이언트 사이드에서만)
  if (typeof window === 'undefined') {
    return null;
  }
  
  return createPortal(modalElement, document.body);
};

export default PortalWrapper; 