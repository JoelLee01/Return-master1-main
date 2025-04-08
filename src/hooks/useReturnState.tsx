import { createContext, useContext, useReducer, ReactNode, Dispatch } from 'react';
import { ReturnItem, ProductInfo } from '@/types/returns';

export interface ReturnState {
  pendingReturns: ReturnItem[];
  completedReturns: ReturnItem[];
  products: ProductInfo[];
}

type ReturnAction = 
  | { type: 'SET_RETURNS'; payload: ReturnState }
  | { type: 'ADD_RETURNS'; payload: ReturnItem[] }
  | { type: 'ADD_PRODUCTS'; payload: ProductInfo[] }
  | { type: 'PROCESS_RETURNS'; payload: ReturnItem[] }
  | { type: 'UPDATE_RETURN_REASON'; payload: { id: string; detailReason: string } }
  | { type: 'UPDATE_RETURN_ITEM'; payload: ReturnItem }
  | { type: 'MATCH_PRODUCTS' };

const initialState: ReturnState = {
  pendingReturns: [],
  completedReturns: [],
  products: [],
};

// 리듀서 함수
function returnReducer(state: ReturnState, action: ReturnAction): ReturnState {
  switch (action.type) {
    case 'SET_RETURNS':
      return action.payload;
    
    case 'ADD_RETURNS':
      return {
        ...state,
        pendingReturns: [...state.pendingReturns, ...action.payload],
      };
    
    case 'ADD_PRODUCTS':
      return {
        ...state,
        products: [...state.products, ...action.payload],
      };
    
    case 'PROCESS_RETURNS':
      const itemsToProcess = action.payload;
      const remainingPending = state.pendingReturns.filter(
        item => !itemsToProcess.some(processItem => processItem.id === item.id)
      );
      
      return {
        ...state,
        pendingReturns: remainingPending,
        completedReturns: [...state.completedReturns, ...itemsToProcess],
      };
    
    case 'UPDATE_RETURN_REASON':
      return {
        ...state,
        pendingReturns: state.pendingReturns.map(item => 
          item.id === action.payload.id 
            ? { ...item, detailReason: action.payload.detailReason } 
            : item
        ),
        completedReturns: state.completedReturns.map(item => 
          item.id === action.payload.id 
            ? { ...item, detailReason: action.payload.detailReason } 
            : item
        )
      };
    
    case 'UPDATE_RETURN_ITEM':
      return {
        ...state,
        pendingReturns: state.pendingReturns.map(item => 
          item.id === action.payload.id 
            ? action.payload
            : item
        )
      };
    
    case 'MATCH_PRODUCTS':
      // 상품 매칭 로직 구현
      const matchedReturns = state.pendingReturns.map(returnItem => {
        // 반품 항목과 상품명이 모두 유효한지 확인
        if (!returnItem.productName) {
          console.warn('상품 매칭 실패: 반품 항목의 상품명이 없음', returnItem);
          return returnItem;
        }

        // 상품명 기준으로 매칭
        const matchedProduct = state.products.find(product => {
          // 상품 데이터가 유효한지 확인
          if (!product || !product.productName) {
            return false;
          }
          
          // 상품명 일치 여부 확인 (안전한 방식으로 includes 호출)
          const productNameMatch = 
            (product.productName && typeof product.productName === 'string' && product.productName.includes(returnItem.productName)) ||
            (product.purchaseName && typeof product.purchaseName === 'string' && product.purchaseName.includes(returnItem.productName));
          
          // 옵션명도 확인 (있는 경우)
          const optionMatch = 
            !returnItem.optionName || 
            !product.optionName || 
            returnItem.optionName === product.optionName;
          
          return productNameMatch && optionMatch;
        });
        
        if (matchedProduct) {
          return {
            ...returnItem,
            barcode: matchedProduct.barcode || '',
            purchaseName: matchedProduct.purchaseName || '',
            zigzagProductCode: matchedProduct.zigzagProductCode || ''
          };
        }
        
        return returnItem;
      });
      
      return {
        ...state,
        pendingReturns: matchedReturns
      };
    
    default:
      return state;
  }
}

// Context 생성
const ReturnStateContext = createContext<{
  returnState: ReturnState;
  dispatch: Dispatch<ReturnAction>;
} | undefined>(undefined);

// Provider 컴포넌트
export function ReturnStateProvider({ children }: { children: ReactNode }) {
  const [returnState, dispatch] = useReducer(returnReducer, initialState);
  
  return (
    <ReturnStateContext.Provider value={{ returnState, dispatch }}>
      {children}
    </ReturnStateContext.Provider>
  );
}

// 커스텀 훅
export function useReturnState() {
  const context = useContext(ReturnStateContext);
  if (context === undefined) {
    throw new Error('useReturnState must be used within a ReturnStateProvider');
  }
  return context;
} 