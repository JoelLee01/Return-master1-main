"use client";

import React, { useEffect, useRef } from 'react';

interface NewModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  modalId?: string;
}

const NewModal: React.FC<NewModalProps> = ({ isOpen, onClose, children, modalId: propModalId }) => {
  const modalId = useRef<string>(propModalId || `modal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      // 스크롤 방지
      if (typeof document !== 'undefined') {
        document.body.style.overflow = 'hidden';
      }

      // 포커스 설정
      setTimeout(() => {
        if (modalRef.current) {
          // 먼저 textarea나 input을 찾아서 포커스
          const textareaElement = modalRef.current.querySelector('textarea') as HTMLElement;
          const inputElement = modalRef.current.querySelector('input') as HTMLElement;
          const focusableElement = modalRef.current.querySelector(
            'button, [tabindex]:not([tabindex="-1"]), input, select, textarea, a[href]'
          ) as HTMLElement;
          
          if (textareaElement) {
            textareaElement.focus();
          } else if (inputElement) {
            inputElement.focus();
          } else if (focusableElement) {
            focusableElement.focus();
          }
        }
      }, 100);
    } else {
      // 스크롤 복원
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
    };
  }, [isOpen]);

  // ESC 키 누르면 모달 닫기
  useEffect(() => {
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

  // 모달이 열려있지 않으면 아무것도 렌더링하지 않음
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10000,
      }}
      role="dialog"
      aria-modal="true"
      data-modal-id={modalId.current}
    >
      <div 
        className="relative"
        ref={modalRef}
        tabIndex={-1}
        style={{
          maxWidth: '77.25vw',
          maxHeight: '67.5vh',
          overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)'
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default NewModal;
