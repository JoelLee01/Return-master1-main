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
  | { type: 'SET_PRODUCTS'; payload: ProductInfo[] }
  | { type: 'PROCESS_RETURNS'; payload: ReturnItem[] }
  | { type: 'UPDATE_RETURN_REASON'; payload: { id: string; detailReason: string } }
  | { type: 'UPDATE_RETURN_ITEM'; payload: ReturnItem }
  | { type: 'MATCH_PRODUCTS' }
  | { type: 'REMOVE_PENDING_RETURNS'; payload: number[] }
  | { type: 'REMOVE_PENDING_RETURN'; payload: { id: string } }
  | { type: 'ADD_COMPLETED_RETURN'; payload: ReturnItem }
  | { type: 'UPDATE_PENDING_RETURN'; payload: ReturnItem };

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
    
    case 'SET_PRODUCTS':
      return {
        ...state,
        products: action.payload,
      };
    
    case 'PROCESS_RETURNS':
      const itemsToProcess = action.payload;
      
      // 오늘 날짜 00시 00분 00초 기준으로 설정 (자정 기준)
      const today = new Date();
      const midnightToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      midnightToday.setHours(0, 0, 0, 0); // 명시적으로 0시 0분 0초 0밀리초 설정
      
      // 완료 상태로 변경 및 완료 시간 설정
      const processedItems = itemsToProcess.map(item => ({
        ...item,
        status: 'COMPLETED' as const,
        completedAt: midnightToday // 오늘 자정으로 설정
      }));
      
      const remainingPending = state.pendingReturns.filter(
        item => !itemsToProcess.some(processItem => processItem.id === item.id)
      );
      
      return {
        ...state,
        pendingReturns: remainingPending,
        completedReturns: [...processedItems, ...state.completedReturns],
      };
    
    case 'UPDATE_RETURN_REASON':
      return {
        ...state,
        pendingReturns: state.pendingReturns.map(item => 
          item.id === action.payload.id 
            ? { 
                ...item, 
                detailReason: action.payload.detailReason,
                returnReason: item.returnReason + (action.payload.detailReason ? ` (${action.payload.detailReason})` : '')
              } 
            : item
        ),
        completedReturns: state.completedReturns.map(item => 
          item.id === action.payload.id 
            ? { 
                ...item, 
                detailReason: action.payload.detailReason,
                returnReason: item.returnReason.includes('(') 
                  ? item.returnReason.split('(')[0].trim() + (action.payload.detailReason ? ` (${action.payload.detailReason})` : '') 
                  : item.returnReason + (action.payload.detailReason ? ` (${action.payload.detailReason})` : '')
              } 
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
      // 상품 매칭 로직 구현 - 옵션명을 우선 고려한 정확한 바코드 매칭
      const matchedReturns = state.pendingReturns.map(returnItem => {
        // 이미 바코드가 있는 경우 건너뛰기
        if (returnItem.barcode && returnItem.barcode !== '-') {
          return returnItem;
        }

        // 옵션명을 고려한 최적 매칭 헬퍼 함수 - 정밀도 향상
        const findBestMatchWithOption = (candidates: any[]): any | null => {
          if (!returnItem.optionName || candidates.length === 0) {
            return candidates[0] || null;
          }

          const returnOptionName = returnItem.optionName.toLowerCase().trim();

          // 1단계: 옵션명이 정확히 일치하는 상품 우선 탐색
          const exactOptionMatch = candidates.find(product => 
            product.optionName && 
            product.optionName.toLowerCase().trim() === returnOptionName
          );
          
          if (exactOptionMatch) {
            return exactOptionMatch;
          }

          // 2단계: 포함 관계 확인
          let bestOptionMatch: any | null = null;
          let highestOptionSimilarity = 0.7;

          for (const product of candidates) {
            if (product.optionName) {
              const productOption = product.optionName.toLowerCase().trim();
              
              // 포함 관계 확인
              if (productOption.includes(returnOptionName) || returnOptionName.includes(productOption)) {
                const similarity = 0.9;
                if (similarity > highestOptionSimilarity) {
                  highestOptionSimilarity = similarity;
                  bestOptionMatch = product;
                }
              }
            }
          }

          if (bestOptionMatch) {
            return bestOptionMatch;
          }

          // 3단계: 부분 텍스트 매칭 - 공통 키워드 기반
          let bestPartialMatch: any | null = null;
          let highestPartialScore = 0;

          // 키워드 추출 함수
          const extractKeywords = (text: string): string[] => {
            return text
              .replace(/[\[\]]/g, '')
              .split(/[,\/:\-\s]+/)
              .map(keyword => keyword.trim())
              .filter(keyword => keyword.length > 0 && keyword !== '선택');
          };

          const returnKeywords = extractKeywords(returnOptionName);

          for (const product of candidates) {
            if (product.optionName) {
              const productOptionName = product.optionName.toLowerCase().trim();
              const productKeywords = extractKeywords(productOptionName);
              
              // 공통 키워드 개수 계산 - 정확한 키워드 매칭만 허용
              const commonKeywords = returnKeywords.filter(keyword => 
                productKeywords.some(pKeyword => {
                  // 1. 정확한 키워드 매칭 (가장 높은 우선순위)
                  if (pKeyword === keyword) {
                    return true;
                  }
                  
                  // 2. 부분 포함 관계 (더 엄격한 조건)
                  // 키워드가 3글자 이상일 때만 부분 포함 허용
                  if (keyword.length >= 3 && pKeyword.includes(keyword)) {
                    return true;
                  }
                  
                  // 3. 상품 키워드가 3글자 이상일 때만 역방향 포함 허용
                  if (pKeyword.length >= 3 && keyword.includes(pKeyword)) {
                    return true;
                  }
                  
                  return false;
                })
              );
              
              if (commonKeywords.length > 0) {
                // 매칭 점수 계산
                const score = (commonKeywords.length / Math.max(returnKeywords.length, productKeywords.length)) * 0.8 + 
                             (commonKeywords.length / returnKeywords.length) * 0.2;
                
                if (score > highestPartialScore && score >= 0.4) { // 최소 40% 매칭으로 상향 조정
                  highestPartialScore = score;
                  bestPartialMatch = product;
                }
              }
            }
          }

          // 부분 매칭 결과가 있으면 반환, 없으면 null 반환
          return bestPartialMatch || null;
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
          
          // 2. 지그재그 자체상품코드와 사입상품명 간 유사도 매칭
          let bestZigzagMatch: { product: any, similarity: number, matchType: string } | null = null;
          const returnZigzagCode = returnItem.zigzagProductCode.toLowerCase().trim();
          
          for (const product of state.products) {
            if (product.purchaseName && typeof product.purchaseName === 'string') {
              const purchaseNameLower = product.purchaseName.toLowerCase().trim();
              
              // 포함 관계 확인
              if (purchaseNameLower.includes(returnZigzagCode) || returnZigzagCode.includes(purchaseNameLower)) {
                const similarity = 0.95;
                
                if (!bestZigzagMatch || similarity > bestZigzagMatch.similarity) {
                  bestZigzagMatch = { 
                    product, 
                    similarity, 
                    matchType: '자체상품코드-사입명 포함관계' 
                  };
                }
              } 
              // 유사도 계산 (간단한 버전)
              else {
                const minLen = Math.min(returnZigzagCode.length, purchaseNameLower.length);
                const maxLen = Math.max(returnZigzagCode.length, purchaseNameLower.length);
                
                if (minLen > 0 && maxLen > 0) {
                  // 간단한 유사도 계산 (공통 문자 비율)
                  let commonChars = 0;
                  for (let i = 0; i < minLen; i++) {
                    if (returnZigzagCode[i] === purchaseNameLower[i]) {
                      commonChars++;
                    }
                  }
                  const similarity = commonChars / maxLen;
                  
                  if (similarity > 0.4 && (!bestZigzagMatch || similarity > bestZigzagMatch.similarity)) {
                    bestZigzagMatch = { 
                      product, 
                      similarity, 
                      matchType: '자체상품코드-사입명 유사도' 
                    };
                  }
                }
              }
            }
          }
          
          // 지그재그 코드 기반 매칭 결과 반환
          if (bestZigzagMatch && bestZigzagMatch.similarity > 0.5) {
            return {
              ...returnItem,
              barcode: bestZigzagMatch.product.barcode || '',
              purchaseName: bestZigzagMatch.product.purchaseName || bestZigzagMatch.product.productName,
              zigzagProductCode: bestZigzagMatch.product.zigzagProductCode || returnItem.zigzagProductCode,
              customProductCode: bestZigzagMatch.product.customProductCode || bestZigzagMatch.product.zigzagProductCode || '',
              matchSimilarity: bestZigzagMatch.similarity,
              matchType: bestZigzagMatch.matchType
            };
          }
        }
        
        // 2. 상품명 완전일치 시도 (옵션명 고려)
        if (returnItem.productName) {
          const exactNameMatches = state.products.filter(product => 
            product.productName && 
            typeof product.productName === 'string' &&
            typeof returnItem.productName === 'string' &&
            product.productName.toLowerCase().trim() === returnItem.productName.toLowerCase().trim()
          );
          
          if (exactNameMatches.length > 0) {
            const bestMatch = findBestMatchWithOption(exactNameMatches);
            if (bestMatch) {
              return {
                ...returnItem,
                barcode: bestMatch.barcode || '',
                purchaseName: bestMatch.purchaseName || bestMatch.productName,
                zigzagProductCode: bestMatch.zigzagProductCode || '',
                matchSimilarity: 1,
                matchType: '상품명 완전일치'
              };
            }
          }
          
          // 3. 사입상품명 완전일치 시도 (옵션명 고려)
          const exactPurchaseNameMatches = state.products.filter(product => 
            product.purchaseName && 
            typeof product.purchaseName === 'string' &&
            typeof returnItem.productName === 'string' &&
            product.purchaseName.toLowerCase().trim() === returnItem.productName.toLowerCase().trim()
          );
          
          if (exactPurchaseNameMatches.length > 0) {
            const bestMatch = findBestMatchWithOption(exactPurchaseNameMatches);
            if (bestMatch) {
              return {
                ...returnItem,
                barcode: bestMatch.barcode || '',
                purchaseName: bestMatch.purchaseName || bestMatch.productName,
                zigzagProductCode: bestMatch.zigzagProductCode || '',
                matchSimilarity: 1,
                matchType: '사입상품명 완전일치'
              };
            }
          }
          
          // 4. 상품명/사입상품명 포함 관계 검사 (옵션명 고려)
          const inclusionMatches: any[] = [];
          
          for (const product of state.products) {
            // 상품명 포함 관계 확인
            if (product.productName && returnItem.productName && 
                typeof product.productName === 'string' && 
                typeof returnItem.productName === 'string') {
              
              const productNameLower = product.productName.toLowerCase();
              const returnItemNameLower = returnItem.productName.toLowerCase();
              
              if (productNameLower.includes(returnItemNameLower) ||
                  returnItemNameLower.includes(productNameLower)) {
                inclusionMatches.push(product);
              }
            }
            
            // 사입상품명 포함 관계 확인
            if (product.purchaseName && returnItem.productName && 
                typeof product.purchaseName === 'string' && 
                typeof returnItem.productName === 'string') {
              
              const purchaseNameLower = product.purchaseName.toLowerCase();
              const returnItemNameLower = returnItem.productName.toLowerCase();
              
              if (purchaseNameLower.includes(returnItemNameLower) ||
                  returnItemNameLower.includes(purchaseNameLower)) {
                inclusionMatches.push(product);
              }
            }
          }
          
          if (inclusionMatches.length > 0) {
            const bestMatch = findBestMatchWithOption(inclusionMatches);
            if (bestMatch) {
              return {
                ...returnItem,
                barcode: bestMatch.barcode || '',
                purchaseName: bestMatch.purchaseName || bestMatch.productName,
                zigzagProductCode: bestMatch.zigzagProductCode || '',
                matchSimilarity: 0.7,
                matchType: '상품명 포함관계'
              };
            }
          }
        }
        
        // 매칭 실패시 원본 반환
        return returnItem;
      });
      
      return {
        ...state,
        pendingReturns: matchedReturns
      };
    
    case 'REMOVE_PENDING_RETURNS': {
      const indicesToRemove = action.payload;
      
      return {
        ...state,
        pendingReturns: state.pendingReturns.filter((_, index) => !indicesToRemove.includes(index))
      };
    }
    
    case 'REMOVE_PENDING_RETURN': {
      const idToRemove = action.payload.id;
      
      return {
        ...state,
        pendingReturns: state.pendingReturns.filter(item => item.id !== idToRemove)
      };
    }
    
    case 'ADD_COMPLETED_RETURN': {
      // 중복 체크
      const isDuplicate = state.completedReturns.some(item => item.id === action.payload.id);
      
      if (isDuplicate) {
        return state;
      }
      
      return {
        ...state,
        completedReturns: [...state.completedReturns, action.payload]
      };
    }
    
    case 'UPDATE_PENDING_RETURN': {
      return {
        ...state,
        pendingReturns: state.pendingReturns.map(item => 
          item.id === action.payload.id 
            ? action.payload
            : item
        )
      };
    }
    
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