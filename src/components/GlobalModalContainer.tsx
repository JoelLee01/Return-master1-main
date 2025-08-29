"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// 모달 정보 타입
interface ModalInfo {
  id: string;
  component: ReactNode;
  zIndex: number;
}

// 컨텍스트 타입
interface GlobalModalContextType {
  addModal: (id: string, component: ReactNode) => void;
  removeModal: (id: string) => void;
  bringToFront: (id: string) => void;
}

// 컨텍스트 생성
const GlobalModalContext = createContext<GlobalModalContextType | null>(null);

// 전역 z-index 관리
let globalZIndex = 10000;

// 전역 모달 컨테이너 컴포넌트
export const GlobalModalContainer: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [modals, setModals] = useState<ModalInfo[]>([]);

  const addModal = useCallback((id: string, component: ReactNode) => {
    globalZIndex += 10;
    
    setModals(prev => {
      // 기존 모달 제거
      const filtered = prev.filter(modal => modal.id !== id);
      // 새 모달을 맨 뒤에 추가 (최상위 표시)
      return [...filtered, { id, component, zIndex: globalZIndex }];
    });
    
    console.log(`모달 추가: ${id}, z-index: ${globalZIndex}`);
  }, []);

  const removeModal = useCallback((id: string) => {
    setModals(prev => prev.filter(modal => modal.id !== id));
    console.log(`모달 제거: ${id}`);
  }, []);

  const bringToFront = useCallback((id: string) => {
    globalZIndex += 10;
    
    setModals(prev => {
      const modal = prev.find(m => m.id === id);
      if (!modal) return prev;
      
      const filtered = prev.filter(m => m.id !== id);
      return [...filtered, { ...modal, zIndex: globalZIndex }];
    });
    
    console.log(`모달 최상위로 이동: ${id}, z-index: ${globalZIndex}`);
  }, []);

  const contextValue: GlobalModalContextType = {
    addModal,
    removeModal,
    bringToFront
  };

  return (
    <GlobalModalContext.Provider value={contextValue}>
      {children}
      
      {/* 모달들을 렌더링 순서대로 표시 (마지막이 최상위) */}
      {modals.map((modal) => (
        <div
          key={modal.id}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: modal.zIndex,
            pointerEvents: 'auto'
          }}
        >
          {modal.component}
        </div>
      ))}
    </GlobalModalContext.Provider>
  );
};

// 훅으로 컨텍스트 사용
export const useGlobalModal = () => {
  const context = useContext(GlobalModalContext);
  if (!context) {
    throw new Error('useGlobalModal must be used within GlobalModalContainer');
  }
  return context;
};
