import { useState, useCallback } from 'react';

// 전역 z-index 관리
let globalZIndex = 12000;

// 모달 스택 타입
interface ModalInfo {
  id: string;
  zIndex: number;
  timestamp: number;
}

// 전역 모달 스택
let modalStack: ModalInfo[] = [];

export const useModalStack = () => {
  const [stackVersion, setStackVersion] = useState(0);

  // 모달 열기
  const openModal = useCallback((modalId: string): number => {
    // 이미 있는 모달이면 제거
    modalStack = modalStack.filter(modal => modal.id !== modalId);
    
    // 새로운 z-index 할당
    globalZIndex += 10;
    const newModal: ModalInfo = {
      id: modalId,
      zIndex: globalZIndex,
      timestamp: Date.now()
    };
    
    // 스택에 추가
    modalStack.push(newModal);
    setStackVersion(prev => prev + 1);
    
    console.log(`모달 열기: ${modalId}, z-index: ${globalZIndex}`);
    return globalZIndex;
  }, []);

  // 모달 닫기
  const closeModal = useCallback((modalId: string) => {
    modalStack = modalStack.filter(modal => modal.id !== modalId);
    setStackVersion(prev => prev + 1);
    console.log(`모달 닫기: ${modalId}`);
  }, []);

  // 최상위 모달 가져오기
  const getTopModal = useCallback((): ModalInfo | null => {
    if (modalStack.length === 0) return null;
    return modalStack[modalStack.length - 1];
  }, []);

  // 모달이 최상위인지 확인
  const isTopModal = useCallback((modalId: string): boolean => {
    const topModal = getTopModal();
    return topModal?.id === modalId;
  }, [getTopModal]);

  // 현재 스택 상태 가져오기
  const getStack = useCallback((): ModalInfo[] => {
    return [...modalStack];
  }, []);

  return {
    openModal,
    closeModal,
    getTopModal,
    isTopModal,
    getStack,
    stackVersion
  };
};
