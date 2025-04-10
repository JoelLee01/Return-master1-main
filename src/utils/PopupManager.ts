import React from 'react';

// PopupManager 클래스 - 모달 관리용 유틸리티
export class PopupManager {
  static maxZIndex = 100000; // 충분히 높은 시작값
  static activeModals: Set<string> = new Set();
  
  // 모달 열기
  static openModal(modalRef: React.RefObject<HTMLDialogElement>) {
    if (!modalRef.current) return;
    
    const modal = modalRef.current;
    
    // 기본 스타일 설정
    modal.style.position = 'fixed';
    modal.style.left = '50%';
    modal.style.top = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
    modal.style.margin = '0';
    modal.style.padding = '0';
    modal.style.zIndex = '900'; // 낮은 z-index
    
    modal.showModal();
    PopupManager.activeModals.add(modal.id);
    
    console.log(`모달 열기: ${modal.id}, z-index: ${modal.style.zIndex}`);
  }
  
  // 모달 닫기
  static closeModal(modalRef: React.RefObject<HTMLDialogElement>) {
    if (!modalRef.current) return;
    
    const modal = modalRef.current;
    modal.close();
    PopupManager.activeModals.delete(modal.id);
    
    console.log(`모달 닫기: ${modal.id}`);
  }
  
  // Portal 모달용 z-index 가져오기 (항상 최대값)
  static getHighZIndex(): number {
    return 2147483647; // 브라우저에서 허용하는 최대 z-index 값
  }
} 