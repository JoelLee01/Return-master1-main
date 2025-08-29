// 전역 팝업 관리자
class ModalManager {
  private static instance: ModalManager;
  private modalContainer: HTMLElement | null = null;
  private activeModals: Set<string> = new Set();
  private modalElements: Map<string, HTMLElement> = new Map();

  private constructor() {
    this.createModalContainer();
  }

  public static getInstance(): ModalManager {
    if (!ModalManager.instance) {
      ModalManager.instance = new ModalManager();
    }
    return ModalManager.instance;
  }

  private createModalContainer(): void {
    // 기존 컨테이너가 있으면 제거
    const existingContainer = document.getElementById('global-modal-container');
    if (existingContainer) {
      existingContainer.remove();
    }

    // 새로운 컨테이너 생성
    this.modalContainer = document.createElement('div');
    this.modalContainer.id = 'global-modal-container';
    this.modalContainer.style.position = 'fixed';
    this.modalContainer.style.top = '0';
    this.modalContainer.style.left = '0';
    this.modalContainer.style.width = '100%';
    this.modalContainer.style.height = '100%';
    this.modalContainer.style.pointerEvents = 'none';
    this.modalContainer.style.zIndex = '10000';
    
    document.body.appendChild(this.modalContainer);
  }

  public addModal(modalId: string, modalElement: HTMLElement): void {
    if (!this.modalContainer) {
      this.createModalContainer();
    }

    // 기존 모달이 있으면 제거
    this.removeModal(modalId);

    // 새 모달 추가
    this.activeModals.add(modalId);
    this.modalElements.set(modalId, modalElement);
    
    // DOM에 추가하고 맨 뒤로 이동하여 최상위에 표시
    this.modalContainer!.appendChild(modalElement);
    
    // 포인터 이벤트 활성화
    modalElement.style.pointerEvents = 'auto';
    
    console.log(`모달 추가: ${modalId}, 총 모달 수: ${this.activeModals.size}`);
  }

  public removeModal(modalId: string): void {
    const modalElement = this.modalElements.get(modalId);
    if (modalElement && modalElement.parentNode) {
      modalElement.parentNode.removeChild(modalElement);
    }
    
    this.activeModals.delete(modalId);
    this.modalElements.delete(modalId);
    
    console.log(`모달 제거: ${modalId}, 남은 모달 수: ${this.activeModals.size}`);
  }

  public bringToFront(modalId: string): void {
    const modalElement = this.modalElements.get(modalId);
    if (modalElement && this.modalContainer) {
      // 모달을 컨테이너의 맨 뒤로 이동하여 최상위에 표시
      this.modalContainer.appendChild(modalElement);
      console.log(`모달 최상위로 이동: ${modalId}`);
    }
  }

  public getActiveModals(): string[] {
    return Array.from(this.activeModals);
  }

  public clearAll(): void {
    this.activeModals.clear();
    this.modalElements.clear();
    if (this.modalContainer) {
      this.modalContainer.innerHTML = '';
    }
  }
}

// 싱글톤 인스턴스 내보내기
export const modalManager = ModalManager.getInstance();

// 유틸리티 함수들
export const addModalToManager = (modalId: string, modalElement: HTMLElement) => {
  modalManager.addModal(modalId, modalElement);
};

export const removeModalFromManager = (modalId: string) => {
  modalManager.removeModal(modalId);
};

export const bringModalToFront = (modalId: string) => {
  modalManager.bringToFront(modalId);
};
