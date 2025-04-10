import React, { PropsWithChildren, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PopupManager } from '../app/page';

// 팝업 컴포넌트를 포털로 렌더링하는 래퍼 컴포넌트
type PortalWrapperProps = PropsWithChildren<{
  onClose: () => void;
  isOpen: boolean;
  elementId?: string;
}>;

export const PortalWrapper: React.FC<PortalWrapperProps> = ({
  children,
  onClose,
  isOpen,
  elementId = 'portal-root',
}) => {
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // 컴포넌트가 마운트될 때 document.body에 포털 컨테이너 추가
    const container = document.createElement('div');
    container.id = elementId;
    document.body.appendChild(container);
    containerRef.current = container;

    // 컴포넌트가 언마운트될 때 포털 컨테이너 제거
    return () => {
      if (container && document.body.contains(container)) {
        document.body.removeChild(container);
      }
    };
  }, [elementId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    // isOpen이 true일 때 모달 초점 설정
    if (isOpen && modalRef.current) {
      modalRef.current.focus();
    }
  }, [isOpen]);

  // 포털이 렌더링될 컨테이너가 없거나 isOpen이 false면 아무것도 렌더링하지 않음
  if (!containerRef.current || !isOpen) {
    return null;
  }

  // PopupManager에서 z-index 가져오기
  const zIndex = PopupManager.getHighZIndex();

  return createPortal(
    <>
      <div
        ref={backdropRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: zIndex - 1,
        }}
        onClick={onClose}
      />
      <div
        ref={modalRef}
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: zIndex,
          maxHeight: '90vh',
          maxWidth: '90vw',
          overflowY: 'auto',
          outline: 'none',
        }}
      >
        {children}
      </div>
    </>,
    containerRef.current
  );
};

export default PortalWrapper; 