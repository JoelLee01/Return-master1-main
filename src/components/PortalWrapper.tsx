import React, { useEffect, useState } from 'react';
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
  onClose?: () => void;
  className?: string;
}

const PortalWrapper: React.FC<PortalWrapperProps> = ({ 
  children, 
  isOpen, 
  onClose,
  className = ''
}) => {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [zIndex, setZIndex] = useState(0);
  
  // 컴포넌트 마운트 시 포털 컨테이너 생성
  useEffect(() => {
    // 클라이언트 사이드에서만 실행되도록 체크
    if (typeof document !== 'undefined') {
      // 컨테이너 생성 또는 기존 컨테이너 재사용
      let container = document.getElementById('modal-portal-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'modal-portal-container';
        document.body.appendChild(container);
      }
      setPortalContainer(container);
    }
  }, []);

  // 모달이 열릴 때마다 최상단 z-index 설정
  useEffect(() => {
    if (isOpen) {
      const newZIndex = getHighestZIndex();
      setZIndex(newZIndex);
    }
  }, [isOpen]);

  // 모달이 닫힐 때 z-index 초기화
  useEffect(() => {
    return () => {
      if (!isOpen) {
        setZIndex(0);
      }
    };
  }, [isOpen]);

  // 배경 클릭 시 모달 닫기
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  // SSR 및 모달이 닫혀있을 때는 아무것도 렌더링하지 않음
  if (!isOpen || !portalContainer) return null;

  // Portal을 사용하여 모달을 body 바로 아래에 렌더링
  return createPortal(
    <div 
      className={`fixed inset-0 flex items-center justify-center ${className}`}
      style={{ zIndex }}
      onClick={handleBackdropClick}
    >
      <div className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"></div>
      <div className="relative" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    portalContainer
  );
};

export default PortalWrapper; 