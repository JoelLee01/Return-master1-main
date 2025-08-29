// 전역 팝업 관리자
class ModalManager {
  private static instance: ModalManager;
  private modalContainer: HTMLElement | null = null;
  private activeModals: Set<string> = new Set();
  private modalElements: Map<string, HTMLElement> = new Map();
  private isClient: boolean = false;

  private constructor() {
    // 클라이언트 사이드에서만 초기화
    if (typeof window !== 'undefined') {
      this.isClient = true;
      this.createModalContainer();
    }
  }

  public static getInstance(): ModalManager {
    if (!ModalManager.instance) {
      ModalManager.instance = new ModalManager();
    }
    return ModalManager.instance;
  }

  private createModalContainer(): void {
    // 클라이언트 사이드가 아니면 실행하지 않음
    if (!this.isClient || typeof document === 'undefined') {
      return;
    }

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
    // 클라이언트 사이드가 아니면 실행하지 않음
    if (!this.isClient || typeof document === 'undefined') {
      return;
    }

    if (!this.modalContainer) {
      this.createModalContainer();
    }

    // 기존 모달이 있으면 제거
    this.removeModal(modalId);

    // 새 모달 추가
    this.activeModals.add(modalId);
    this.modalElements.set(modalId, modalElement);
    
    // DOM에 추가하고 맨 뒤로 이동하여 최상위에 표시
    if (this.modalContainer) {
      this.modalContainer.appendChild(modalElement);
      
      // 포인터 이벤트 활성화
      modalElement.style.pointerEvents = 'auto';
      
      console.log(`모달 추가: ${modalId}, 총 모달 수: ${this.activeModals.size}`);
    }
  }

  public removeModal(modalId: string): void {
    // 클라이언트 사이드가 아니면 실행하지 않음
    if (!this.isClient) {
      return;
    }

    const modalElement = this.modalElements.get(modalId);
    if (modalElement && modalElement.parentNode) {
      modalElement.parentNode.removeChild(modalElement);
    }
    
    this.activeModals.delete(modalId);
    this.modalElements.delete(modalId);
    
    console.log(`모달 제거: ${modalId}, 남은 모달 수: ${this.activeModals.size}`);
  }

  public bringToFront(modalId: string): void {
    // 클라이언트 사이드가 아니면 실행하지 않음
    if (!this.isClient) {
      return;
    }

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
    // 클라이언트 사이드가 아니면 실행하지 않음
    if (!this.isClient) {
      return;
    }

    this.activeModals.clear();
    this.modalElements.clear();
    if (this.modalContainer) {
      this.modalContainer.innerHTML = '';
    }
  }
}

// 싱글톤 인스턴스 내보내기 (클라이언트 사이드에서만 생성)
let modalManagerInstance: ModalManager | null = null;

const getModalManager = (): ModalManager => {
  if (typeof window !== 'undefined' && !modalManagerInstance) {
    modalManagerInstance = ModalManager.getInstance();
  }
  return modalManagerInstance!;
};

// 유틸리티 함수들
export const addModalToManager = (modalId: string, modalElement: HTMLElement) => {
  if (typeof window !== 'undefined') {
    getModalManager().addModal(modalId, modalElement);
  }
};

export const removeModalFromManager = (modalId: string) => {
  if (typeof window !== 'undefined') {
    getModalManager().removeModal(modalId);
  }
};

export const bringModalToFront = (modalId: string) => {
  if (typeof window !== 'undefined') {
    getModalManager().bringToFront(modalId);
  }
};
