"use client";

import React, { useEffect, useRef } from 'react';
import { useGlobalModal } from './GlobalModalContainer';

interface NewModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  modalId?: string;
}

const NewModal: React.FC<NewModalProps> = ({ isOpen, onClose, children, modalId: propModalId }) => {
  const { addModal, removeModal } = useGlobalModal();
  const modalId = useRef<string>(propModalId || `modal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  useEffect(() => {
    if (isOpen) {
      // 스크롤 방지
      if (typeof document !== 'undefined') {
        document.body.style.overflow = 'hidden';
      }

      // 모달 컴포넌트 생성
      const modalComponent = (
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
          }}
          role="dialog"
          aria-modal="true"
        >
          <div 
            className="relative"
            tabIndex={-1}
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

      // 전역 컨테이너에 모달 추가
      addModal(modalId.current, modalComponent);

      // 포커스 설정
      setTimeout(() => {
        const modalElement = document.querySelector(`[data-modal-id="${modalId.current}"]`);
        if (modalElement) {
          const focusableElement = modalElement.querySelector(
            'button, [tabindex]:not([tabindex="-1"]), input, select, textarea, a[href]'
          ) as HTMLElement;
          
          if (focusableElement) {
            focusableElement.focus();
          }
        }
      }, 50);
    } else {
      // 모달 제거
      removeModal(modalId.current);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
      removeModal(modalId.current);
    };
  }, [isOpen, addModal, removeModal, onClose]);

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

  // 실제 모달은 전역 컨테이너에서 렌더링되므로 여기서는 null 반환
  return null;
};

export default NewModal;
