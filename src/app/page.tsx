'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ReturnItem, ReturnState, ProductInfo } from '@/types/returns';
import { parseProductExcel, parseReturnExcel, generateExcel } from '@/utils/excel';
import { updateReturns, fetchReturns } from '@/firebase/firestore';
import * as XLSX from 'xlsx';
import { db, app } from '@/firebase/config';
import { collection, getDocs, query, limit } from 'firebase/firestore';
import { useReturnState } from '@/hooks/useReturnState';
import { ReturnReasonModal } from '@/components/ReturnReasonModal';

// 문자열 유사도 계산 함수 (Levenshtein 거리 기반)
function stringSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  
  // 문자열 정규화: 소문자로 변환, 불필요한 공백 제거
  s1 = s1.toLowerCase().trim();
  s2 = s2.toLowerCase().trim();
  
  const len1 = s1.length;
  const len2 = s2.length;
  
  // 길이 차이가 너무 크면 유사도 낮음 (차이가 작은 문자열의 30% 이상이면 낮은 유사도)
  if (Math.abs(len1 - len2) > Math.min(len1, len2) * 0.3) {
    return 0;
  }
  
  // Levenshtein 거리 계산 (동적 프로그래밍)
  const dp: number[][] = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
  
  for (let i = 0; i <= len1; i++) dp[i][0] = i;
  for (let j = 0; j <= len2; j++) dp[0][j] = j;
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // 삭제
        dp[i][j - 1] + 1,      // 삽입
        dp[i - 1][j - 1] + cost // 대체
      );
    }
  }
  
  // 최대 거리는 두 문자열 중 긴 것의 길이
  const maxDistance = Math.max(len1, len2);
  // 유사도 = 1 - (편집 거리 / 최대 거리)
  return 1 - dp[len1][len2] / maxDistance;
}

// 키워드 기반 유사도 검증 함수
function validateKeywordSimilarity(s1: string, s2: string): boolean {
  if (!s1 || !s2) return false;
  
  // 문자열을 소문자로 변환하고 특수문자 제거
  const clean1 = s1.toLowerCase().replace(/[^\w\s가-힣]/g, ' ').replace(/\s+/g, ' ').trim();
  const clean2 = s2.toLowerCase().replace(/[^\w\s가-힣]/g, ' ').replace(/\s+/g, ' ').trim();
  
  // 각 문자열에서 주요 키워드 추출 (2글자 이상인 단어만)
  const words1 = clean1.split(' ').filter(word => word.length >= 2);
  const words2 = clean2.split(' ').filter(word => word.length >= 2);
  
  // 공통 키워드 찾기 - 키워드가 서로 포함 관계면 유사하다고 판단
  const commonWords = words1.filter(word => {
    if (!word || typeof word !== 'string') return false;
    
    return words2.some(w => {
      if (!w || typeof w !== 'string') return false;
      return w.includes(word) || word.includes(w);
    });
  });
  
  // 공통 키워드가 없으면 유사하지 않음
  if (commonWords.length === 0) return false;
  
  // 공통 키워드가 전체 키워드의 25% 이상이면 유사하다고 판단 (임계값 낮춤)
  const totalUniqueWords = new Set([...words1, ...words2]).size;
  return commonWords.length / totalUniqueWords >= 0.25;
}

// 상품 데이터와 반품 데이터 매칭 함수
function matchProductData(returnItem: ReturnItem, products: ProductInfo[]): ReturnItem {
  try {
    // 로깅 시작
    console.log(`[상품 매칭 시작] 상품명: ${returnItem.productName}, 옵션: ${returnItem.optionName || '없음'}`);
    
    // 이미 바코드가 있으면 그대로 반환
    if (returnItem.barcode) {
      console.log(`[매칭 완료] 이미 바코드 있음: ${returnItem.barcode}`);
      return returnItem;
    }
    
    if (!returnItem.productName) {
      console.log(`[매칭 실패] 상품명이 없음, 매칭 불가`);
      return returnItem;
    }
    
    // 매칭 결과를 담을 배열
    let matchResults: {product: ProductInfo, similarity: number, matchType: string}[] = [];
    
    // 1. 자체상품코드 정확 매칭 시도 (가장 높은 우선순위)
    if (returnItem.zigzagProductCode && returnItem.zigzagProductCode !== '-') {
      const exactZigzagMatch = products.find(p => 
        p.zigzagProductCode && p.zigzagProductCode === returnItem.zigzagProductCode
      );
      
      if (exactZigzagMatch) {
        console.log(`[매칭 성공] 자체상품코드 정확 매칭: ${returnItem.zigzagProductCode}`);
        matchResults.push({
          product: exactZigzagMatch,
          similarity: 1.0,
          matchType: '자체상품코드 일치'
        });
      }
    }
    
    // 2. 상품명 완전일치 시도
    const exactNameMatch = products.find(p => 
      p.productName && p.productName.toLowerCase().trim() === returnItem.productName.toLowerCase().trim()
    );
    
    if (exactNameMatch) {
      console.log(`[매칭 성공] 상품명 완전일치: ${returnItem.productName}`);
      matchResults.push({
        product: exactNameMatch,
        similarity: 1.0,
        matchType: '상품명 완전일치'
      });
    }
    
    // 3. 사입상품명 완전일치 시도
    const exactPurchaseNameMatch = products.find(p => 
      p.purchaseName && p.purchaseName.toLowerCase().trim() === returnItem.productName.toLowerCase().trim()
    );
    
    if (exactPurchaseNameMatch) {
      console.log(`[매칭 성공] 사입상품명 완전일치: ${returnItem.productName}`);
      matchResults.push({
        product: exactPurchaseNameMatch,
        similarity: 1.0,
        matchType: '사입상품명 완전일치'
      });
    }
    
    // 4. 상품명과 사입상품명 간의 유사도 매칭 시도
    for (const product of products) {
      // 상품명 매칭
      if (product.productName && returnItem.productName) {
        const similarity = stringSimilarity(returnItem.productName, product.productName);
        
        // 유사도가 0.55 이상이고 키워드 검증도 통과하는 경우만 매칭
        if (similarity >= 0.55 && validateKeywordSimilarity(returnItem.productName, product.productName)) {
          matchResults.push({
            product,
            similarity,
            matchType: '상품명 유사도'
          });
        }
      }
      
      // 사입상품명 매칭
      if (product.purchaseName && returnItem.productName) {
        const similarity = stringSimilarity(returnItem.productName, product.purchaseName);
        
        // 유사도가 0.55 이상이고 키워드 검증도 통과하는 경우만 매칭
        if (similarity >= 0.55 && validateKeywordSimilarity(returnItem.productName, product.purchaseName)) {
          matchResults.push({
            product,
            similarity,
            matchType: '사입상품명 유사도'
          });
        }
      }
    }
    
    // 5. 옵션명 유사도 매칭 추가 (옵션명이 있는 경우만)
    if (returnItem.optionName && returnItem.optionName.length > 1) {
      // 기존에 매칭된 상품들 중에서 옵션명이 유사한 것 찾기
      const optionMatchResults: {product: ProductInfo, similarity: number, matchType: string}[] = [];
      
      for (const product of products) {
        if (product.optionName && product.optionName.length > 1) {
          const optionSimilarity = stringSimilarity(returnItem.optionName, product.optionName);
          
          if (optionSimilarity >= 0.6) { // 옵션명은 더 높은 임계값 적용
            // 상품명/사입상품명 유사도도 확인
            const productNameSim = product.productName ? 
              stringSimilarity(returnItem.productName, product.productName) : 0;
            const purchaseNameSim = product.purchaseName ? 
              stringSimilarity(returnItem.productName, product.purchaseName) : 0;
            
            // 상품명이나 사입상품명 중 하나라도 어느 정도 유사하면
            if (Math.max(productNameSim, purchaseNameSim) >= 0.4) {
              optionMatchResults.push({
                product,
                similarity: optionSimilarity * 0.5 + Math.max(productNameSim, purchaseNameSim) * 0.5,
                matchType: '옵션명 유사도'
              });
            }
          }
        }
      }
      
      // 옵션 기반 매칭 결과가 있으면 기존 결과에 추가
      if (optionMatchResults.length > 0) {
        matchResults = [...matchResults, ...optionMatchResults];
      }
    }
    
    // 6. 상품명 포함 관계 검사 (마지막 시도)
    if (matchResults.length === 0) {
      for (const product of products) {
        // 안전한 상품명 확인
        if (product.productName && returnItem.productName && 
            typeof product.productName === 'string' && 
            typeof returnItem.productName === 'string') {
          
          const productNameLower = product.productName.toLowerCase();
          const returnItemNameLower = returnItem.productName.toLowerCase();
          
          // 상품명이 서로 포함 관계인지 확인
          if (productNameLower.includes(returnItemNameLower) ||
              returnItemNameLower.includes(productNameLower)) {
            matchResults.push({
              product,
              similarity: 0.5, // 포함 관계는 낮은 유사도 부여
              matchType: '상품명 포함관계'
            });
          }
        }
        
        // 안전한 사입상품명 확인
        if (product.purchaseName && returnItem.productName && 
            typeof product.purchaseName === 'string' && 
            typeof returnItem.productName === 'string') {
          
          const purchaseNameLower = product.purchaseName.toLowerCase();
          const returnItemNameLower = returnItem.productName.toLowerCase();
          
          // 사입상품명이 서로 포함 관계인지 확인
          if (purchaseNameLower.includes(returnItemNameLower) ||
              returnItemNameLower.includes(purchaseNameLower)) {
            matchResults.push({
              product,
              similarity: 0.5, // 포함 관계는 낮은 유사도 부여
              matchType: '사입상품명 포함관계'
            });
          }
        }
      }
    }
    
    // 결과가 없으면 원본 반환
    if (matchResults.length === 0) {
      console.log(`[매칭 실패] 매칭 결과 없음: ${returnItem.productName}`);
      return returnItem;
    }
    
    // 유사도 높은 순으로 정렬
    matchResults.sort((a, b) => b.similarity - a.similarity);
    
    // 최고 유사도 결과 사용
    const bestMatch = matchResults[0];
    console.log(`[매칭 성공] ${bestMatch.matchType} 매칭: 유사도 ${bestMatch.similarity.toFixed(2)}`);
    
    return {
      ...returnItem,
      purchaseName: bestMatch.product.purchaseName || bestMatch.product.productName,
      barcode: bestMatch.product.barcode,
      optionName: returnItem.optionName || bestMatch.product.optionName,
      matchSimilarity: bestMatch.similarity, // 매칭 유사도 저장
      matchType: bestMatch.matchType     // 매칭 방식 저장
    };
  } catch (error) {
    console.error('매칭 중 오류 발생:', error);
    // 오류 발생 시 원본 반환
    return returnItem;
  }
}

// 전역 오류 처리기 재정의를 방지하는 원본 콘솔 메서드 보존
const originalConsoleError = console.error;
const safeConsoleError = (...args: any[]) => {
  try {
    originalConsoleError(...args);
  } catch (e) {
    // 오류가 발생해도 앱 실행에 영향을 주지 않도록 함
  }
};

export default function Home() {
  const { returnState, dispatch } = useReturnState();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const returnFileRef = useRef<HTMLInputElement>(null);
  const productFileRef = useRef<HTMLInputElement>(null);
  const pendingModalRef = useRef<HTMLDialogElement>(null);
  const productModalRef = useRef<HTMLDialogElement>(null);
  
  // 반품 사유 관련 상태
  const [isReasonModalOpen, setIsReasonModalOpen] = useState(false);
  const [currentReasonItem, setCurrentReasonItem] = useState<ReturnItem | null>(null);
  const [detailReason, setDetailReason] = useState('');
  
  // 선택 항목 관련 상태
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [selectAll, setSelectAll] = useState(false);

  // 색상 설정 관련 상태
  const [buttonColors, setButtonColors] = useState({
    testButton: 'bg-purple-500 hover:bg-purple-600',
    uploadProducts: 'bg-green-500 hover:bg-green-600',
    viewPending: 'bg-blue-500 hover:bg-blue-600',
    settings: 'bg-gray-500 hover:bg-gray-600'
  });
  
  // 모달 관련 상태
  const settingsModalRef = useRef<HTMLDialogElement>(null);
  
  // 오류 포착 핸들러
  const handleError = useCallback((error: any, context: string) => {
    safeConsoleError(`[${context}] 오류:`, error);
    setMessage(`${context} 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    return null;
  }, []);
  
  // 로컬 스토리지에서 데이터 가져오기
  const getLocalData = useCallback((): ReturnState | null => {
    try {
      const storedData = localStorage.getItem('returnData');
      if (!storedData) return null;
      
      const parsedData = JSON.parse(storedData) as ReturnState;
      
      // 데이터 유효성 검사
      if (!parsedData.pendingReturns && !parsedData.products) {
        return null;
      }
      
      // completedReturns 날짜 변환
      if (parsedData.completedReturns) {
        parsedData.completedReturns = parsedData.completedReturns.map((item: ReturnItem) => ({
          ...item,
          completedAt: item.completedAt ? new Date(item.completedAt) : undefined
        }));
      }
      
      safeConsoleError('로컬 스토리지에서 데이터 로드 완료:', {
        pendingReturns: parsedData.pendingReturns?.length || 0,
        completedReturns: parsedData.completedReturns?.length || 0,
        products: parsedData.products?.length || 0
      });
      
      return parsedData;
    } catch (e) {
      safeConsoleError('로컬 스토리지 데이터 로드 오류:', e);
      return null;
    }
  }, []);
  
  // 로컬 스토리지에 데이터 저장
  const saveLocalData = useCallback((data: ReturnState) => {
    try {
      localStorage.setItem('returnData', JSON.stringify(data));
      safeConsoleError('로컬 스토리지에 데이터 저장 완료');
      return true;
    } catch (e) {
      safeConsoleError('로컬 스토리지 데이터 저장 오류:', e);
      return false;
    }
  }, []);
  
  // 데이터 로딩 함수 
  const loadData = async () => {
    setLoading(true);
    setMessage('Firebase에서 데이터를 가져오는 중...');
    
    try {
      console.log('Firebase 연결 확인 중...');
      
      // Firebase 연결 확인
      if (!db) {
        console.error('Firebase DB 객체가 초기화되지 않았습니다');
        setMessage('Firebase 연결 실패. 오프라인 모드로 전환합니다.');
        handleFirebaseError();
          return;
        }

      console.log('fetchReturns 함수 호출 시작');
      const data = await fetchReturns();
      console.log('fetchReturns 함수 호출 완료:', data ? '데이터 있음' : '데이터 없음');
      
      if (data) {
        dispatch({ type: 'SET_RETURNS', payload: data });
        
        // 데이터 로드 후 자동으로 상품 매칭 실행
        if (data.pendingReturns.length > 0 && data.products.length > 0) {
          console.log('자동 상품 매칭 시작...');
          setTimeout(() => {
            dispatch({ type: 'MATCH_PRODUCTS' });
            setMessage('데이터를 성공적으로 불러왔으며, 상품 매칭도 완료했습니다.');
          }, 500); // 약간의 지연을 두고 실행
        } else {
          setMessage('데이터를 성공적으로 불러왔습니다.');
        }
        
        localStorage.setItem('returnData', JSON.stringify(data));
        localStorage.setItem('lastUpdated', new Date().toISOString());
      } else {
        setMessage('데이터가 없습니다. 엑셀 파일을 업로드해주세요.');
      }
    } catch (error: any) {
      handleFirebaseError(error);
    } finally {
      setLoading(false);
    }
  };

  // Firebase 오류 처리 함수
  const handleFirebaseError = (error?: any) => {
    console.error('Firebase 오류:', error);
    
    // 로컬 데이터 확인
    const localDataStr = localStorage.getItem('returnData');
    if (localDataStr) {
      try {
        const parsed = JSON.parse(localDataStr);
        dispatch({ type: 'SET_RETURNS', payload: parsed });
        setMessage('Firebase 연결 실패. 로컬 데이터를 표시합니다.');
      } catch (e) {
        setMessage('데이터 로딩 실패. 새로고침 후 다시 시도해주세요.');
      }
      } else {
      setMessage('데이터 로딩 실패. 인터넷 연결을 확인하세요.');
    }
  };

  // 컴포넌트 마운트 시 데이터 로딩
  useEffect(() => {
    loadData();
  }, []);

  // 색상 설정 저장
  useEffect(() => {
    // 로컬 스토리지에서 색상 설정 로드
    const savedColors = localStorage.getItem('buttonColors');
    if (savedColors) {
      try {
        setButtonColors(JSON.parse(savedColors));
      } catch (e) {
        console.error('색상 설정 로드 오류:', e);
      }
    }
  }, []);
  
  // 색상 변경 핸들러
  const handleColorChange = (buttonKey: string, color: string) => {
    const newColors = { ...buttonColors };
    
    // 색상 코드에 따른 hover 색상 결정
    const colorCode = color.split('-')[1];
    const hoverColorCode = parseInt(colorCode) + 100;
    const baseColor = color.split('-')[0];
    
    newColors[buttonKey] = `${baseColor}-${colorCode} hover:${baseColor}-${hoverColorCode}`;
    
    setButtonColors(newColors);
    localStorage.setItem('buttonColors', JSON.stringify(newColors));
  };

  // 엑셀 데이터 처리 함수
  const processExcelData = useCallback(async (file: File, type: 'products' | 'returns'): Promise<any[]> => {
    try {
      safeConsoleError(`${type === 'products' ? '상품' : '반품'} 엑셀 파일 처리 시작:`, file.name);
      
      // 파일 형식에 따라 다른 파서 사용
      const data = type === 'products' 
        ? await parseProductExcel(file) 
        : await parseReturnExcel(file);
      
      safeConsoleError(`${type === 'products' ? '상품' : '반품'} 엑셀 파일 처리 완료:`, {
        파일명: file.name,
        데이터길이: data.length
      });
      
      return data;
      } catch (error) {
      throw new Error(`엑셀 파일 처리 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    }
  }, []);
  
  // 청크로 분할하는 함수
  const splitIntoChunks = useCallback((data: any[], chunkSize: number) => {
    const chunks: any[][] = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }
    return chunks;
  }, []);

  // 파일 업로드 핸들러
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'returns' | 'products') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      setLoading(true);
      setMessage(`${type === 'returns' ? '반품' : '상품'} 파일을 처리 중입니다...`);
      
      if (type === 'returns') {
        const returns = await parseReturnExcel(files[0]);
        if (returns.length > 0) {
          dispatch({ type: 'ADD_RETURNS', payload: returns });
          setMessage(`${returns.length}개의 반품 항목이 추가되었습니다.`);
        } else {
          setMessage('처리할 데이터가 없습니다. 파일을 확인해주세요.');
        }
      } else {
        const products = await parseProductExcel(files[0]);
        if (products.length > 0) {
          dispatch({ type: 'ADD_PRODUCTS', payload: products });
          // 상품 데이터가 추가되면 자동으로 매칭 시도
          dispatch({ type: 'MATCH_PRODUCTS' });
          setMessage(`${products.length}개의 상품이 추가되었습니다. 상품 매칭을 완료했습니다.`);
        } else {
          setMessage('처리할 데이터가 없습니다. 파일을 확인해주세요.');
        }
      }
    } catch (error) {
      console.error('파일 처리 중 오류 발생:', error);
      setMessage(`파일 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
      // 파일 입력 초기화
      e.target.value = '';
    }
  };

  // Firebase 연결 테스트 함수
  const testFirebaseConnection = async () => {
    try {
      setLoading(true);
      setMessage('Firebase 연결 테스트 중...');
      
      // 앱 정보 확인
      if (!app) {
        setMessage('Firebase 앱이 초기화되지 않았습니다. 환경 변수를 확인하세요.');
        console.error('Firebase 앱이 초기화되지 않음');
        return;
      }
      
      console.log('Firebase 앱 정보:', {
        앱이름: app.name,
        프로젝트ID: app.options.projectId,
        apiKey존재: !!app.options.apiKey,
        authDomain: app.options.authDomain
      });
      
      // DB 확인
      if (!db) {
        setMessage('Firestore DB가 초기화되지 않았습니다.');
        console.error('Firestore DB가 초기화되지 않음');
        return;
      }
      
      // 컬렉션 테스트
      const testCollections = ['returns', 'products', 'pendingReturns', 'completedReturns'];
      const results = {};
      
      let hasAnyData = false;
      
      for (const collName of testCollections) {
        try {
          console.log(`${collName} 컬렉션 읽기 시도...`);
          const q = query(collection(db, collName), limit(5));
          const querySnapshot = await getDocs(q);
          
          results[collName] = {
            count: querySnapshot.size,
            success: true
          };
          
          if (querySnapshot.size > 0) {
            hasAnyData = true;
            console.log(`${collName} 컬렉션에서 ${querySnapshot.size}개 문서 발견`);
            
            // 첫 번째 문서 데이터 로깅 (디버깅용)
            const firstDoc = querySnapshot.docs[0].data();
            console.log(`${collName} 컬렉션의 첫 번째 문서:`, firstDoc);
          } else {
            console.log(`${collName} 컬렉션에 문서가 없음`);
          }
      } catch (error) {
          console.error(`${collName} 컬렉션 읽기 실패:`, error);
          results[collName] = {
            success: false,
            error: error instanceof Error ? error.message : '알 수 없는 오류'
          };
        }
      }
      
      // 결과 메시지 설정
      if (hasAnyData) {
        setMessage(`Firebase 연결 성공! ${app.options.projectId} 프로젝트에 접속됨. 데이터가 존재합니다.`);
      } else {
        setMessage(`Firebase 연결은 성공했지만 데이터가 없습니다. ${app.options.projectId} 프로젝트에 접속됨.`);
      }
      
      console.log('Firebase 테스트 결과:', {
        appInitialized: !!app,
        dbInitialized: !!db,
        projectId: app.options.projectId,
        collectionResults: results
      });
      
    } catch (error) {
      setMessage(`Firebase 연결 테스트 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      console.error('Firebase 연결 테스트 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  // 체크박스 선택 기능
  const handleCheckboxChange = (index: number) => {
    setSelectedItems(prev => {
      if (prev.includes(index)) {
        return prev.filter(i => i !== index);
      } else {
        return [...prev, index];
      }
    });
  };

  // 전체 선택 기능
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedItems([]);
    } else {
      setSelectedItems(returnState.pendingReturns.map((_, index) => index));
    }
    setSelectAll(!selectAll);
  };

  // 선택한 항목들 입고 처리
  const handleProcessSelected = () => {
    if (selectedItems.length === 0) return;
    
    const itemsToProcess = selectedItems.map(index => returnState.pendingReturns[index]);
    dispatch({ type: 'PROCESS_RETURNS', payload: itemsToProcess });
    setSelectedItems([]);
    setSelectAll(false);
    setMessage(`${itemsToProcess.length}개 항목을 입고 처리했습니다.`);
  };

  // 단일 항목 입고 처리
  const handleProcessSingle = (index: number) => {
    const itemToProcess = returnState.pendingReturns[index];
    dispatch({ type: 'PROCESS_RETURNS', payload: [itemToProcess] });
    setSelectedItems(prev => prev.filter(i => i !== index));
    setMessage('1개 항목을 입고 처리했습니다.');
  };

  // 반품사유 클릭 처리
  const handleReturnReasonClick = (item: ReturnItem) => {
    setCurrentReasonItem(item);
    setDetailReason(item.detailReason || '');
    setIsReasonModalOpen(true);
  };

  // 반품사유 상세 정보 저장
  const handleSaveDetailReason = (detailReason: string) => {
    if (!currentReasonItem) return;
    
    dispatch({
      type: 'UPDATE_RETURN_REASON',
      payload: {
        id: currentReasonItem.id,
        detailReason
      }
    });
    
    setIsReasonModalOpen(false);
    setMessage('반품 사유 상세 정보가 저장되었습니다.');
  };

  // 행 스타일 설정
  const getRowStyle = (item: ReturnItem, index: number, items: ReturnItem[]) => {
    // 이전 행과 주문번호가 같으면 배경색 변경
    if (index > 0 && items[index - 1].orderNumber === item.orderNumber) {
      return 'bg-gray-50';
    }
    return '';
  };

  // 불량 여부 확인
  const isDefective = (reason: string) => {
    return reason.includes('불량') || reason.includes('하자');
  };
  
  // 입고 완료된 반품 목록 다운로드 함수
  const handleDownloadCompletedExcel = () => {
    if (returnState.completedReturns.length === 0) {
      setMessage('다운로드할 입고 완료 데이터가 없습니다.');
      return;
    }
    
    try {
      const filename = `입고완료_반품_${new Date().toISOString().split('T')[0]}.xlsx`;
      generateExcel(returnState.completedReturns, filename);
      setMessage(`${returnState.completedReturns.length}개 항목이 ${filename} 파일로 저장되었습니다.`);
    } catch (error) {
      console.error('엑셀 생성 중 오류:', error);
      setMessage('엑셀 파일 생성 중 오류가 발생했습니다.');
    }
  };

  // Firebase에 데이터 저장
  const handleSaveToFirebase = async () => {
    try {
      setLoading(true);
      setMessage('서버에 데이터 저장 중...');
      
      const result = await updateReturns(
        [...returnState.pendingReturns, ...returnState.completedReturns], 
        returnState.products
      );
      
      if (Object.values(result).every(r => r.success !== false)) {
        setMessage('서버에 데이터가 성공적으로 저장되었습니다.');
        localStorage.setItem('lastUpdated', new Date().toISOString());
      } else {
        const failedCollections = Object.entries(result)
          .filter(([_, v]) => v.success === false)
          .map(([k, _]) => k)
          .join(', ');
        setMessage(`서버 저장 부분 실패 (${failedCollections}). 로컬에는 저장되었습니다.`);
      }
    } catch (error) {
      console.error('Firebase 저장 오류:', error);
      setMessage(`서버 저장 중 오류 발생: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
    }
  };

  // 입고완료된 반품목록을 메인 화면에 표시하기 위한 정렬된 데이터
  const recentCompletedReturns = useMemo(() => {
    if (!returnState.completedReturns || returnState.completedReturns.length === 0) {
      return [];
    }
    // 날짜 기준으로 최신순 정렬
    return [...returnState.completedReturns]
      .sort((a, b) => {
        const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, 10); // 최근 10개만 표시
  }, [returnState.completedReturns]);

  // 자체상품코드 클릭 처리를 위한 상태와 함수
  const [showProductMatchModal, setShowProductMatchModal] = useState(false);
  const [currentMatchItem, setCurrentMatchItem] = useState<ReturnItem | null>(null);
  
  // 상품 매칭 팝업 열기
  const handleProductMatchClick = (item: ReturnItem) => {
    setCurrentMatchItem(item);
    setShowProductMatchModal(true);
  };
  
  // 상품 매칭 팝업 닫기
  const handleCloseProductMatchModal = () => {
    setShowProductMatchModal(false);
    setCurrentMatchItem(null);
  };

  return (
    <div className="container mx-auto px-4 py-6 min-h-screen bg-gray-50">
      <header className="mb-6">
        <div className="flex flex-col sm:flex-row justify-between items-center mb-4">
          <h1 className="text-3xl font-bold text-gray-800 mb-2 sm:mb-0">반품 관리 시스템</h1>
          
          <div className="flex flex-wrap gap-2">
            <button
              onClick={testFirebaseConnection}
              className={`${buttonColors.testButton} text-white px-3 py-1 rounded text-sm`}
              disabled={loading}
            >
              서버 연결 테스트
            </button>
            
            <button
              onClick={() => settingsModalRef.current?.showModal()}
              className={`${buttonColors.settings} text-white px-3 py-1 rounded text-sm`}
            >
              설정
            </button>
            
            <button
              onClick={handleSaveToFirebase}
              className="bg-purple-500 hover:bg-purple-600 text-white px-3 py-1 rounded text-sm"
              disabled={loading}
            >
              서버 저장
            </button>
          </div>
        </div>
        
        {message && (
          <div className={`p-4 rounded-lg shadow-sm mb-4 transition-all duration-300 ${
            message.includes('오류') || message.includes('실패') 
              ? 'bg-gradient-to-r from-red-50 to-red-100 border-l-4 border-red-500 text-red-700' 
              : 'bg-gradient-to-r from-blue-50 to-blue-100 border-l-4 border-blue-500 text-blue-700'
          }`}>
            <div className="flex items-center">
              {message.includes('오류') || message.includes('실패') ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <span className="font-medium">{message}</span>
            </div>
          </div>
        )}
        
        <div className="flex flex-wrap gap-4 items-center justify-between mb-4">
          <div className="w-full sm:w-auto mb-2 sm:mb-0">
            <div className="grid grid-cols-3 gap-2 bg-white p-2 rounded-lg shadow-sm">
              <div className="text-center">
                <span className="text-lg font-semibold text-blue-600">{returnState.pendingReturns.length}</span>
                <p className="text-xs text-gray-500">입고전</p>
              </div>
              <div className="text-center">
                <span className="text-lg font-semibold text-green-600">{returnState.completedReturns.length}</span>
                <p className="text-xs text-gray-500">입고완료</p>
              </div>
              <div className="text-center">
                <span className="text-lg font-semibold text-purple-600">{returnState.products.length}</span>
                <p className="text-xs text-gray-500">상품데이터</p>
              </div>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => productModalRef.current?.showModal()}
              className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded-full text-sm disabled:opacity-50 flex items-center"
              disabled={loading || returnState.products.length === 0}
            >
              <span className="mr-1">상품목록</span>
              <span className="bg-white text-green-600 rounded-full w-5 h-5 flex items-center justify-center text-xs">
                {returnState.products.length}
              </span>
            </button>
            
            <button
              onClick={() => pendingModalRef.current?.showModal()}
              className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-full text-sm disabled:opacity-50 flex items-center"
              disabled={loading || returnState.pendingReturns.length === 0}
            >
              <span className="mr-1">입고전</span>
              <span className="bg-white text-blue-600 rounded-full w-5 h-5 flex items-center justify-center text-xs">
                {returnState.pendingReturns.length}
              </span>
            </button>
            
            <button
              onClick={handleDownloadCompletedExcel}
              className="bg-purple-500 hover:bg-purple-600 text-white px-3 py-1 rounded-full text-sm disabled:opacity-50"
              disabled={loading || returnState.completedReturns.length === 0}
            >
              입고완료 다운로드
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                <path d="M5.5 13a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 13H5.5z" />
                <path d="M9 13h2v5l-3.5-3.5L11 11v2z" />
              </svg>
              상품 데이터 업로드
            </h2>
            <input
              type="file"
              ref={productFileRef}
              className="hidden"
              accept=".xlsx,.xls"
              onChange={(e) => handleFileUpload(e, 'products')}
              disabled={loading}
            />
            <button
              onClick={() => productFileRef.current?.click()}
              className="bg-gradient-to-r from-green-400 to-green-600 text-white px-4 py-3 rounded-lg w-full transition-transform transform hover:scale-105 flex items-center justify-center"
              disabled={loading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              상품 엑셀 업로드
            </button>
          </div>
          
          <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                <path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z" />
                <path fillRule="evenodd" d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
              반품 데이터 업로드
            </h2>
            <input
              type="file"
              ref={returnFileRef}
              className="hidden"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFileUpload(e, 'returns')}
              disabled={loading}
            />
            <button
              onClick={() => returnFileRef.current?.click()}
              className="bg-gradient-to-r from-blue-400 to-blue-600 text-white px-4 py-3 rounded-lg w-full transition-transform transform hover:scale-105 flex items-center justify-center"
              disabled={loading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              반품 엑셀 업로드
            </button>
          </div>
        </div>
        
        {loading && (
          <div className="flex items-center justify-center space-x-2 p-4 mt-4 bg-white rounded-lg shadow-md">
            <div className="relative">
              <div className="w-12 h-12 rounded-full absolute border-4 border-gray-200"></div>
              <div className="w-12 h-12 rounded-full animate-spin absolute border-4 border-blue-500 border-t-transparent"></div>
            </div>
            <div className="text-gray-700">
              <div className="font-semibold text-lg">처리 중...</div>
              <div className="text-sm text-gray-500">잠시만 기다려주세요</div>
            </div>
          </div>
        )}
      </header>
      
      {returnState.pendingReturns.length > 0 && (
        <div className="bg-white p-4 rounded-lg shadow-md mb-6">
          <div className="flex flex-col sm:flex-row justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800 flex items-center mb-2 sm:mb-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              입고전 반품 목록
            </h2>
            <div>
              <button
                onClick={handleProcessSelected}
                className="bg-gradient-to-r from-blue-500 to-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50 transform transition-transform hover:scale-105 flex items-center"
                disabled={selectedItems.length === 0 || loading}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                선택 항목 입고처리 ({selectedItems.length}개)
              </button>
            </div>
          </div>
          
          <div className="shadow-md overflow-hidden border border-slate-200 rounded-lg mb-4">
            <div className="bg-gradient-to-r from-blue-500 to-blue-700 py-2 px-4 flex justify-between items-center">
              <h3 className="text-sm font-semibold text-white">처리 대기중 ({returnState.pendingReturns.length})</h3>
              
              {/* 상품 매칭 전체 버튼 추가 */}
              {returnState.pendingReturns.filter(item => !item.barcode).length > 0 && (
                <button 
                  className="px-2 py-1 text-xs bg-white text-blue-700 rounded-md hover:bg-blue-50 transition-colors flex items-center"
                  onClick={() => {
                    // 미매칭 상품 찾기
                    const unmatchedItems = returnState.pendingReturns.filter(item => !item.barcode);
                    console.log(`🔍 ${unmatchedItems.length}개 상품 일괄 매칭 시작`);
                    
                    // 매칭 시도 및 결과 수집
                    let matchedCount = 0;
                    let failedCount = 0;
                    
                    unmatchedItems.forEach(item => {
                      const matchedItem = matchProductData(item, returnState.products);
                      
                      if (matchedItem.barcode) {
                        // 매칭 성공
                        matchedCount++;
                        dispatch({
                          type: 'UPDATE_RETURN_ITEM',
                          payload: matchedItem
                        });
                      } else {
                        // 매칭 실패
                        failedCount++;
                      }
                    });
                    
                    // 결과 메시지 표시
                    if (matchedCount > 0) {
                      setMessage(`총 ${unmatchedItems.length}개 상품 중 ${matchedCount}개 매칭 성공, ${failedCount}개 실패`);
                    } else {
                      setMessage(`매칭 실패: 모든 상품(${unmatchedItems.length}개)을 매칭할 수 없습니다.`);
                    }
                  }}
                >
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                  </svg>
                  전체 매칭
                </button>
              )}
            </div>
          </div>
          
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 bg-white">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <input
                      type="checkbox"
                      checked={selectAll}
                      onChange={handleSelectAll}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 rounded"
                    />
                  </th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">고객명</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">주문번호</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">상품명</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">옵션명</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">수량</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">반품사유</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">바코드</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">송장번호</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">입고</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {returnState.pendingReturns.map((item, index) => (
                  <tr key={item.id} className={`${getRowStyle(item, index, returnState.pendingReturns)} hover:bg-gray-50 transition-colors`}>
                    <td className="px-2 py-3 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={selectedItems.includes(index)}
                        onChange={() => handleCheckboxChange(index)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 rounded"
                      />
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{item.customerName}</div>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap hidden sm:table-cell">
                      <div className="text-sm text-gray-500">{item.orderNumber}</div>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap">
                      {item.barcode ? (
                        <div className="text-sm text-gray-900 font-medium flex items-center">
                          <span className="mr-1">{item.purchaseName || item.productName}</span>
                          {item.matchType && (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              item.matchSimilarity === 1 ? 'bg-green-100 text-green-800' :
                              item.matchSimilarity && item.matchSimilarity >= 0.7 ? 'bg-blue-100 text-blue-800' : 
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {item.matchSimilarity === 1 ? '정확' : 
                               item.matchSimilarity && item.matchSimilarity >= 0.7 ? '유사' : '부분'}
                            </span>
                          )}
                        </div>
                      ) : (
                        <button 
                          className="px-2 py-1 bg-yellow-100 text-yellow-800 hover:bg-yellow-200 rounded-md text-sm transition-colors" 
                          onClick={() => {
                            // 바코드 매칭 시도
                            const matchedItem = matchProductData(item, returnState.products);
                            
                            if (matchedItem.barcode !== item.barcode) {
                              // 매칭 성공한 경우 업데이트
                              dispatch({
                                type: 'UPDATE_RETURN_ITEM',
                                payload: matchedItem
                              });
                              setMessage(`'${item.productName}' 상품이 매칭되었습니다.`);
                            } else {
                              setMessage(`'${item.productName}' 상품을 찾을 수 없습니다.`);
                            }
                          }}
                        >
                          {item.productName}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap hidden md:table-cell">
                      <div className="text-sm text-gray-500">{item.optionName}</div>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-900 font-medium">{item.quantity}</div>
                    </td>
                    <td className={`px-2 py-3 whitespace-nowrap ${isDefective(item.returnReason) ? 'text-red-500 font-semibold' : ''}`}>
                      <button 
                        className={`px-2 py-1 rounded-md text-sm ${isDefective(item.returnReason) ? 'bg-red-100 hover:bg-red-200' : 'text-gray-700'}`}
                        onClick={() => handleReturnReasonClick(item)}
                      >
                        {item.returnReason}
                        {item.detailReason && <span className="ml-1">✓</span>}
                      </button>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap hidden lg:table-cell">
                      <div className="text-sm text-gray-500 font-mono">{item.barcode || '-'}</div>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap hidden md:table-cell">
                      <div className="text-sm text-gray-500">{item.returnTrackingNumber}</div>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap">
                      <button 
                        className="p-1 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
                        onClick={() => handleProcessSingle(index)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* 메인 화면에 입고완료 반품목록 추가 */}
      <div className="mt-10">
        <h2 className="text-xl font-bold mb-4">최근 입고완료 항목</h2>
        {recentCompletedReturns.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border px-4 py-2">고객명</th>
                  <th className="border px-4 py-2">주문번호</th>
                  <th className="border px-4 py-2">상품명</th>
                  <th className="border px-4 py-2">옵션</th>
                  <th className="border px-4 py-2">수량</th>
                  <th className="border px-4 py-2">반품사유</th>
                  <th className="border px-4 py-2">반품송장번호</th>
                  <th className="border px-4 py-2">자체상품코드</th>
                  <th className="border px-4 py-2">바코드</th>
                </tr>
              </thead>
              <tbody>
                {recentCompletedReturns.map((item, index) => (
                  <tr key={item.id || index} className="hover:bg-gray-50">
                    <td className="border px-4 py-2">{item.customerName}</td>
                    <td className="border px-4 py-2">{item.orderNumber}</td>
                    <td className="border px-4 py-2">{item.productName}</td>
                    <td className="border px-4 py-2">{item.optionName}</td>
                    <td className="border px-4 py-2 text-center">{item.quantity}</td>
                    <td className="border px-4 py-2">{item.returnReason}</td>
                    <td className="border px-4 py-2">{item.returnTrackingNumber}</td>
                    <td className="border px-4 py-2">
                      {item.zigzagProductCode && item.zigzagProductCode !== '-' 
                        ? item.zigzagProductCode 
                        : <button 
                            onClick={() => handleProductMatchClick(item)}
                            className="text-blue-500 hover:underline"
                          >
                            {item.productName.substring(0, 15)}...
                          </button>
                      }
                    </td>
                    <td className="border px-4 py-2">{item.barcode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500">입고완료된 항목이 없습니다.</p>
        )}
      </div>
      
      {/* 상품 매칭 모달 */}
      {showProductMatchModal && currentMatchItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" 
          onClick={handleCloseProductMatchModal}>
          <div className="bg-white p-6 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-auto" 
            onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold mb-4">상품 매칭</h3>
            <p className="mb-4">
              <strong>상품명:</strong> {currentMatchItem.productName}<br />
              <strong>옵션:</strong> {currentMatchItem.optionName}
            </p>
            
            <div className="max-h-[50vh] overflow-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border px-2 py-1">상품명</th>
                    <th className="border px-2 py-1">자체상품코드</th>
                    <th className="border px-2 py-1">바코드</th>
                    <th className="border px-2 py-1">선택</th>
                  </tr>
                </thead>
                <tbody>
                  {returnState.products.slice(0, 100).map((product, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="border px-2 py-1">{product.productName}</td>
                      <td className="border px-2 py-1">{product.zigzagProductCode}</td>
                      <td className="border px-2 py-1">{product.barcode}</td>
                      <td className="border px-2 py-1 text-center">
                        <button
                          className="bg-blue-500 text-white px-2 py-1 rounded text-sm"
                          onClick={() => {
                            // 여기에 매칭 처리 로직 추가
                            handleCloseProductMatchModal();
                          }}
                        >
                          선택
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="mt-4 flex justify-end">
              <button
                className="bg-gray-300 text-gray-800 px-4 py-2 rounded mr-2"
                onClick={handleCloseProductMatchModal}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 상품 데이터 모달 */}
      <dialog ref={productModalRef} className="w-full max-w-4xl p-0 rounded-lg shadow-xl backdrop:bg-gray-800/50 backdrop:backdrop-blur-sm" onClick={(e) => {
        // 모달 바깥 영역 클릭 시 닫기
        if (e.target === e.currentTarget) {
          productModalRef.current?.close();
        }
      }}>
        <div className="flex flex-col h-full">
          <div className="flex justify-between items-center p-4 border-b bg-gradient-to-r from-green-500 to-green-600 text-white">
            <h3 className="text-xl font-bold flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              상품 데이터 ({returnState.products.length}개)
            </h3>
            <button
              onClick={() => productModalRef.current?.close()}
              className="text-white hover:bg-white/20 p-1 rounded-full transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-4">
            <div className="border rounded-lg overflow-hidden bg-white">
              <div className="max-h-[70vh] overflow-auto">
                {returnState.products.length > 0 ? (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0 z-10">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">바코드</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">상품명</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">사입상품명</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">옵션명</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">자체상품코드</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {returnState.products.map((product) => (
                        <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap font-mono text-sm text-gray-500">{product.barcode}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{product.productName}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{product.purchaseName}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden sm:table-cell">{product.optionName}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden md:table-cell">{product.zigzagProductCode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <p className="text-gray-500 text-lg mb-2">등록된 상품이 없습니다</p>
                    <p className="text-gray-400 text-sm">상품 엑셀 파일을 업로드해주세요</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </dialog>
      
      {/* 입고전 목록 모달 */}
      <dialog ref={pendingModalRef} className="w-full max-w-4xl p-0 rounded-lg shadow-xl backdrop:bg-gray-800/50 backdrop:backdrop-blur-sm" onClick={(e) => {
        // 모달 바깥 영역 클릭 시 닫기
        if (e.target === e.currentTarget) {
          pendingModalRef.current?.close();
        }
      }}>
        <div className="flex flex-col h-full">
          <div className="flex justify-between items-center p-4 border-b bg-gradient-to-r from-blue-500 to-blue-600 text-white">
            <h3 className="text-xl font-bold flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              입고전 목록 ({returnState.pendingReturns.length}개)
            </h3>
            <div className="flex space-x-2">
              <button
                onClick={handleProcessSelected}
                className="bg-white text-blue-600 px-4 py-1 rounded-full text-sm flex items-center disabled:opacity-50 hover:bg-blue-50 transition-colors"
                disabled={selectedItems.length === 0}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                선택 처리 ({selectedItems.length}개)
              </button>
              <button
                onClick={() => pendingModalRef.current?.close()}
                className="text-white hover:bg-white/20 p-1 rounded-full transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="p-4">
            <div className="border rounded-lg overflow-hidden bg-white">
              <div className="max-h-[70vh] overflow-auto">
                {returnState.pendingReturns.length > 0 ? (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0 z-10">
                      <tr>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          <input
                            type="checkbox"
                            checked={selectAll}
                            onChange={handleSelectAll}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 rounded"
                          />
                        </th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">고객명</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">주문번호</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">상품명</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">옵션명</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">수량</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">반품사유</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">바코드</th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">입고</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {returnState.pendingReturns.map((item, index) => (
                        <tr key={item.id} className={`${getRowStyle(item, index, returnState.pendingReturns)} hover:bg-gray-50 transition-colors`}>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={selectedItems.includes(index)}
                              onChange={() => handleCheckboxChange(index)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 rounded"
                            />
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">{item.customerName}</td>
                          <td className="px-2 py-3 whitespace-nowrap">{item.orderNumber}</td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            {item.barcode ? (
                              <div className="text-sm text-gray-900 font-medium flex items-center">
                                <span className="mr-1">{item.purchaseName || item.productName}</span>
                                {item.matchType && (
                                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                                    item.matchSimilarity === 1 ? 'bg-green-100 text-green-800' :
                                    item.matchSimilarity && item.matchSimilarity >= 0.7 ? 'bg-blue-100 text-blue-800' : 
                                    'bg-yellow-100 text-yellow-800'
                                  }`}>
                                    {item.matchSimilarity === 1 ? '정확' : 
                                     item.matchSimilarity && item.matchSimilarity >= 0.7 ? '유사' : '부분'}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <button 
                                className="px-2 py-1 bg-yellow-100 text-yellow-800 hover:bg-yellow-200 rounded-md text-sm transition-colors" 
                                onClick={() => {
                                  // 바코드 매칭 시도
                                  const matchedItem = matchProductData(item, returnState.products);
                                  
                                  if (matchedItem.barcode !== item.barcode) {
                                    // 매칭 성공한 경우 업데이트
                                    dispatch({
                                      type: 'UPDATE_RETURN_ITEM',
                                      payload: matchedItem
                                    });
                                    setMessage(`'${item.productName}' 상품이 매칭되었습니다.`);
                                  } else {
                                    setMessage(`'${item.productName}' 상품을 찾을 수 없습니다.`);
                                  }
                                }}
                              >
                                {item.productName}
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap hidden md:table-cell">
                            <div className="text-sm text-gray-500">{item.optionName}</div>
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <div className="text-sm text-gray-900 font-medium">{item.quantity}</div>
                          </td>
                          <td className={`px-2 py-3 whitespace-nowrap ${isDefective(item.returnReason) ? 'text-red-500 font-semibold' : ''}`}>
                            <button 
                              className={`px-2 py-1 rounded text-sm ${isDefective(item.returnReason) ? 'bg-red-100 hover:bg-red-200' : 'text-gray-700'}`}
                              onClick={() => handleReturnReasonClick(item)}
                            >
                              {item.returnReason}
                              {item.detailReason && <span className="ml-1">✓</span>}
                            </button>
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap hidden lg:table-cell">
                            <div className="text-sm text-gray-500 font-mono">{item.barcode || '-'}</div>
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <button 
                              className="p-1 bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
                              onClick={() => handleProcessSingle(index)}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <p className="text-gray-500 text-lg mb-2">입고전 상품이 없습니다</p>
                    <p className="text-gray-400 text-sm">반품 엑셀 파일을 업로드해주세요</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </dialog>
      
      {/* 반품 사유 상세 모달 */}
      <ReturnReasonModal
        isOpen={isReasonModalOpen}
        onClose={() => setIsReasonModalOpen(false)}
        onSave={handleSaveDetailReason}
        returnItem={currentReasonItem}
        detailReason={detailReason}
        setDetailReason={setDetailReason}
      />
    </div>
  );
}