import { createContext, useContext, useReducer, ReactNode, Dispatch } from 'react';
import { ReturnItem, ProductInfo } from '@/types/returns';

// 색상 추출 헬퍼 함수
function extractColorFromOption(optionText: string): string | null {
  const colors = [
    '블랙', '화이트', '화이트', '그레이', '그레이', '네이비', '네이비', '베이지', '베이지',
    '브라운', '브라운', '레드', '레드', '핑크', '핑크', '옐로우', '옐로우', '그린', '그린',
    '블루', '블루', '퍼플', '퍼플', '오렌지', '오렌지', '골드', '골드', '실버', '실버',
    '아이보리', '아이보리', '크림', '크림', '차콜', '차콜', '카키', '카키', '민트', '민트',
    '로즈', '로즈', '라벤더', '라벤더', '코랄', '코랄', '터콰이즈', '터콰이즈', '버건디', '버건디',
    '마린', '마린', '올리브', '올리브', '샌드', '샌드', '타우프', '타우프', '인디고', '인디고'
  ];
  
  const lowerText = optionText.toLowerCase();
  for (const color of colors) {
    if (lowerText.includes(color.toLowerCase())) {
      return color;
    }
  }
  return null;
}

// 문자열 유사도 계산 함수
function calculateStringSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) {
    return 1.0;
  }
  
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

// 레벤슈타인 거리 계산
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

export interface ReturnState {
  pendingReturns: ReturnItem[];
  completedReturns: ReturnItem[];
  products: ProductInfo[];
}

type ReturnAction = 
  | { type: 'ADD_RETURN'; payload: ReturnItem }
  | { type: 'UPDATE_RETURN'; payload: ReturnItem }
  | { type: 'DELETE_RETURN'; payload: string }
  | { type: 'COMPLETE_RETURN'; payload: string }
  | { type: 'ADD_PRODUCT'; payload: ProductInfo }
  | { type: 'UPDATE_PRODUCT'; payload: ProductInfo }
  | { type: 'DELETE_PRODUCT'; payload: string }
  | { type: 'SET_PRODUCTS'; payload: ProductInfo[] }
  | { type: 'SET_RETURNS'; payload: ReturnState }
  | { type: 'MATCH_PRODUCTS' }
  | { type: 'CLEAR_ALL' };

// 리듀서 함수
function returnReducer(state: ReturnState, action: ReturnAction): ReturnState {
  switch (action.type) {
    case 'ADD_RETURN':
      return {
        ...state,
        pendingReturns: [...state.pendingReturns, action.payload]
      };
    
    case 'UPDATE_RETURN':
      return {
        ...state,
        pendingReturns: state.pendingReturns.map(item => 
          item.id === action.payload.id ? action.payload : item
        )
      };
    
    case 'DELETE_RETURN':
      return {
        ...state,
        pendingReturns: state.pendingReturns.filter(item => item.id !== action.payload)
      };
    
    case 'COMPLETE_RETURN':
      const completedItem = state.pendingReturns.find(item => item.id === action.payload);
      if (completedItem) {
        return {
          ...state,
          pendingReturns: state.pendingReturns.filter(item => item.id !== action.payload),
          completedReturns: [...state.completedReturns, completedItem]
        };
      }
      return state;
    
    case 'ADD_PRODUCT':
      return {
        ...state,
        products: [...state.products, action.payload]
      };
    
    case 'UPDATE_PRODUCT':
      return {
        ...state,
        products: state.products.map(product => 
          product.id === action.payload.id ? action.payload : product
        )
      };
    
    case 'DELETE_PRODUCT':
      return {
        ...state,
        products: state.products.filter(product => product.id !== action.payload)
      };
    
    case 'SET_PRODUCTS':
      return {
        ...state,
        products: action.payload
      };
    
    case 'MATCH_PRODUCTS':
      // 상품 매칭 로직 구현 - 점수 기반 시스템
      const matchedReturns = state.pendingReturns.map(returnItem => {
        // 이미 바코드가 있는 경우 건너뛰기
        if (returnItem.barcode && returnItem.barcode !== '-') {
          return returnItem;
        }

        // 옵션명을 고려한 최적 매칭 헬퍼 함수 - 점수 기반 시스템
        const findBestMatchWithOption = (candidates: any[]): any | null => {
          if (candidates.length === 0) {
            return null;
          }

          // 옵션명이 없는 경우 첫 번째 상품 반환
          if (!returnItem.optionName || returnItem.optionName.trim() === '') {
            return candidates[0];
          }

          const returnOptionName = returnItem.optionName.toLowerCase().trim();

          // 모든 후보에 대해 매칭 점수 계산
          const scoredCandidates = candidates.map(product => {
            if (!product.optionName) {
              return { product, score: 0, reason: '옵션명 없음' };
            }

            const productOptionName = product.optionName.toLowerCase().trim();
            let score = 0;
            let reason = '';

            // 1. 정확 일치 (최고 점수)
            if (productOptionName === returnOptionName) {
              score = 100;
              reason = '정확 일치';
            }
            // 2. 부분 일치 (포함 관계)
            else if (productOptionName.includes(returnOptionName) || returnOptionName.includes(productOptionName)) {
              score = 80;
              reason = '부분 일치';
            }
            // 3. 색상 일치
            else {
              const returnColor = extractColorFromOption(returnOptionName);
              const productColor = extractColorFromOption(productOptionName);
              
              if (returnColor && productColor && returnColor === productColor) {
                score = 60;
                reason = '색상 일치';
              }
              // 4. 유사도 계산
              else {
                const similarity = calculateStringSimilarity(returnOptionName, productOptionName);
                score = Math.round(similarity * 50); // 0-50점
                reason = `유사도 ${similarity.toFixed(2)}`;
              }
            }

            return { product, score, reason };
          });

          // 점수 순으로 정렬 (높은 점수 우선)
          scoredCandidates.sort((a, b) => b.score - a.score);

          // 최고 점수 상품 선택 (점수가 30 이상인 경우만)
          const bestMatch = scoredCandidates[0];
          if (bestMatch.score >= 30) {
            return bestMatch.product;
          } else {
            return null;
          }
        };
        
        // 1. 자체상품코드 정확 매칭 시도 (옵션명 고려)
        if (returnItem.zigzagProductCode && returnItem.zigzagProductCode !== '-') {
          const exactCodeMatches = state.products.filter(product => 
            product.zigzagProductCode && 
            product.zigzagProductCode === returnItem.zigzagProductCode
          );
          
          if (exactCodeMatches.length > 0) {
            const bestMatch = findBestMatchWithOption(exactCodeMatches);
            if (bestMatch) {
              return {
                ...returnItem,
                barcode: bestMatch.barcode || '',
                purchaseName: bestMatch.purchaseName || bestMatch.productName,
                matchSimilarity: 1,
                matchType: '자체상품코드 정확 매칭'
              };
            }
          }
        }
        
        // 2. 상품명 유사도 매칭 시도
        let bestMatch: { product: any, similarity: number } | null = null;
        const returnProductName = returnItem.productName.toLowerCase().trim();
        
        for (const product of state.products) {
          const productName = product.productName.toLowerCase().trim();
          const similarity = calculateStringSimilarity(returnProductName, productName);
          
          if (similarity > 0.7 && (!bestMatch || similarity > bestMatch.similarity)) {
            bestMatch = { product, similarity };
          }
        }
        
        if (bestMatch) {
          const candidates = [bestMatch.product];
          const bestOptionMatch = findBestMatchWithOption(candidates);
          
          if (bestOptionMatch) {
            return {
              ...returnItem,
              barcode: bestOptionMatch.barcode || '',
              purchaseName: bestOptionMatch.purchaseName || bestOptionMatch.productName,
              matchSimilarity: bestMatch.similarity,
              matchType: '상품명 유사도 매칭'
            };
          }
        }
        
        // 매칭 실패
        return returnItem;
      });
      
      return {
        ...state,
        pendingReturns: matchedReturns
      };
    
    case 'SET_RETURNS':
      return action.payload;
    
    case 'CLEAR_ALL':
      return {
        pendingReturns: [],
        completedReturns: [],
        products: []
      };
    
    default:
      return state;
  }
}

// Context 생성
const ReturnContext = createContext<{
  state: ReturnState;
  dispatch: Dispatch<ReturnAction>;
} | null>(null);

// Provider 컴포넌트
export function ReturnProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(returnReducer, {
    pendingReturns: [],
    completedReturns: [],
    products: []
  });

  return (
    <ReturnContext.Provider value={{ state, dispatch }}>
      {children}
    </ReturnContext.Provider>
  );
}

// Hook
export function useReturnState() {
  const context = useContext(ReturnContext);
  if (!context) {
    throw new Error('useReturnState must be used within a ReturnProvider');
  }
  return context;
}