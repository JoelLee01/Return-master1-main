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
import TrackingNumberModal from '@/components/TrackingNumberModal';
import MatchProductModal from '@/components/MatchProductModal';
import { matchProductData } from '../utils/excel';
import { utils, read } from 'xlsx';

// 전역 오류 처리기 재정의를 방지하는 원본 콘솔 메서드 보존
const originalConsoleError = console.error;
const safeConsoleError = (...args: any[]) => {
  try {
    originalConsoleError(...args);
  } catch (e) {
    // 오류가 발생해도 앱 실행에 영향을 주지 않도록 함
  }
};

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

export default function Home() {
  const { returnState, dispatch } = useReturnState();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  // ReturnState를 위한 setter 함수 추가
  const setReturnState = (newState: ReturnState | ((prev: ReturnState) => ReturnState)) => {
    if (typeof newState === 'function') {
      dispatch({ type: 'SET_RETURNS', payload: newState(returnState) });
    } else {
      dispatch({ type: 'SET_RETURNS', payload: newState });
    }
  };
  const returnFileRef = useRef<HTMLInputElement>(null);
  const productFileRef = useRef<HTMLInputElement>(null);
  const pendingModalRef = useRef<HTMLDialogElement>(null);
  const productModalRef = useRef<HTMLDialogElement>(null);
  const settingsModalRef = useRef<HTMLDialogElement>(null);
  
  // 반품 사유 관련 상태
  const [isReasonModalOpen, setIsReasonModalOpen] = useState(false);
  const [currentReasonItem, setCurrentReasonItem] = useState<ReturnItem | null>(null);
  const [currentDetailReason, setCurrentDetailReason] = useState('');
  
  // 선택 항목 관련 상태
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  
  // 선택된 입고완료 항목 상태 추가
  const [selectedCompletedItems, setSelectedCompletedItems] = useState<number[]>([]);
  const [selectAllCompleted, setSelectAllCompleted] = useState(false);
  const [lastSelectedCompletedIndex, setLastSelectedCompletedIndex] = useState<number | null>(null);
  
  // 송장번호 입력 상태 추가
  const [showTrackingInput, setShowTrackingInput] = useState(false);
  const [currentTrackingItem, setCurrentTrackingItem] = useState<ReturnItem | null>(null);
  
  // 색상 설정 관련 상태
  const [buttonColors, setButtonColors] = useState({
    testButton: 'bg-blue-500 hover:bg-blue-600',
    firebaseButton: 'bg-indigo-500 hover:bg-indigo-600',
    productButton: 'bg-green-500 hover:bg-green-600',
    returnButton: 'bg-blue-500 hover:bg-blue-600',
    productListButton: 'bg-purple-500 hover:bg-purple-600',
    pendingButton: 'bg-yellow-500 hover:bg-yellow-600',
    downloadButton: 'bg-teal-500 hover:bg-teal-600',
    trackingButton: 'bg-blue-500 hover:bg-blue-600'
  });
  
  // 상품 매칭 관련 상태
  const [showProductMatchModal, setShowProductMatchModal] = useState(false);
  const [currentMatchItem, setCurrentMatchItem] = useState<ReturnItem | null>(null);
  
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

  // 컴포넌트 마운트 시 데이터 로딩 및 자동 매칭
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
      
      if (type === 'returns') {
        setMessage('반품 엑셀 파일을 처리 중입니다...');
        
        // 파일 이름에서 타입 추정 (스마트스토어 or 지그재그)
        const isSmartStore = files[0].name.toLowerCase().includes('스마트') || 
                             files[0].name.toLowerCase().includes('smartstore') ||
                             files[0].name.toLowerCase().includes('스토어');
        
        console.log(`반품 파일 업로드: ${files[0].name} (${isSmartStore ? '스마트스토어' : '지그재그'} 형식)`);
        
        // 엑셀 파싱
        const returnItems = await parseReturnExcel(files[0]);
        
        if (returnItems.length > 0) {
          console.log(`엑셀에서 ${returnItems.length}개 반품 항목을 불러왔습니다. 중복 검사를 시작합니다.`);
          
          // 중복 제거 로직 - 지그재그 및 스마트스토어 공통 로직
          // 1. 기본 키 (고객명_주문번호_상품명_옵션명_송장번호) 기준 중복 체크
          const existingKeys = new Set([
            // 1순위: 입고완료 목록의 키 (입고완료목록 우선)
            ...returnState.completedReturns.map(item => 
              `${item.customerName}_${item.orderNumber}_${item.purchaseName || item.productName}_${item.optionName}_${item.returnTrackingNumber}`
            ),
            // 2순위: 대기 목록의 키
            ...returnState.pendingReturns.map(item => 
              `${item.customerName}_${item.orderNumber}_${item.purchaseName || item.productName}_${item.optionName}_${item.returnTrackingNumber}`
            )
          ]);
          
          // 2. 자체상품코드 + 옵션명 기준 중복 체크를 위한 맵
          const productCodeOptionMap = new Map<string, boolean>();
          // 입고완료 목록에서 자체상품코드+옵션명 조합 수집 (입고완료 우선)
          returnState.completedReturns.forEach(item => {
            if (item.customProductCode && item.optionName) {
              const codeKey = `${item.customProductCode.toLowerCase().trim()}_${item.optionName.toLowerCase().trim()}`;
              productCodeOptionMap.set(codeKey, true);
            }
            if (item.zigzagProductCode && item.optionName) {
              const zigzagKey = `${item.zigzagProductCode.toLowerCase().trim()}_${item.optionName.toLowerCase().trim()}`;
              productCodeOptionMap.set(zigzagKey, true);
            }
          });
          // 대기 목록에서 자체상품코드+옵션명 조합 수집
          returnState.pendingReturns.forEach(item => {
            if (item.customProductCode && item.optionName) {
              const codeKey = `${item.customProductCode.toLowerCase().trim()}_${item.optionName.toLowerCase().trim()}`;
              productCodeOptionMap.set(codeKey, true);
            }
            if (item.zigzagProductCode && item.optionName) {
              const zigzagKey = `${item.zigzagProductCode.toLowerCase().trim()}_${item.optionName.toLowerCase().trim()}`;
              productCodeOptionMap.set(zigzagKey, true);
            }
          });
          
          console.log(`기존 데이터: ${existingKeys.size}개 항목, ${productCodeOptionMap.size}개 자체상품코드+옵션명 조합`);
          
          // 중복되지 않은 항목만 필터링 (두 기준 모두 적용)
          const duplicatesBasic: ReturnItem[] = [];
          const duplicatesCode: ReturnItem[] = [];
          const uniqueReturns = returnItems.filter(item => {
            // 1. 기본 키 기준 중복 체크
            const basicKey = `${item.customerName}_${item.orderNumber}_${item.purchaseName || item.productName}_${item.optionName}_${item.returnTrackingNumber}`;
            const isBasicDuplicate = existingKeys.has(basicKey);
            
            // 2. 자체상품코드 + 옵션명 기준 중복 체크
            let isCodeDuplicate = false;
            if (item.customProductCode && item.optionName) {
              const codeKey = `${item.customProductCode.toLowerCase().trim()}_${item.optionName.toLowerCase().trim()}`;
              isCodeDuplicate = productCodeOptionMap.has(codeKey);
            }
            if (!isCodeDuplicate && item.zigzagProductCode && item.optionName) {
              const zigzagKey = `${item.zigzagProductCode.toLowerCase().trim()}_${item.optionName.toLowerCase().trim()}`;
              isCodeDuplicate = productCodeOptionMap.has(zigzagKey);
            }
            
            // 중복된 항목 로깅
            if (isBasicDuplicate) {
              duplicatesBasic.push(item);
            }
            if (isCodeDuplicate && !isBasicDuplicate) {
              duplicatesCode.push(item);
            }
            
            // 두 기준 모두 통과해야 중복이 아님
            return !isBasicDuplicate && !isCodeDuplicate;
          });
          
          console.log(`중복 제거 결과: 총 ${returnItems.length}개 중 ${duplicatesBasic.length}개 기본중복, ${duplicatesCode.length}개 코드중복, ${uniqueReturns.length}개 고유항목`);
          
          // 자체상품코드 매칭 및 바코드 설정 전처리 - 자동 매칭 로직 개선
          const processedReturns = uniqueReturns.map(item => {
            // 자체상품코드 있는 항목은 상품 목록과 매칭하여 바코드 설정
            if ((item.customProductCode && item.customProductCode !== '-') || 
                (item.zigzagProductCode && item.zigzagProductCode !== '-')) {
              
              // 매칭 시도 - 자체상품코드와 옵션명 기준으로 우선 매칭
              const matchedItem = matchProductData(item, returnState.products);
              
              if (matchedItem.barcode && matchedItem.barcode !== '-') {
                console.log(`✅ 업로드 단계 매칭 성공: ${item.customProductCode || item.zigzagProductCode} → 바코드: ${matchedItem.barcode}`);
                // 매칭 성공 시 바코드 및 관련 정보 설정
                return {
                  ...item,
                  barcode: matchedItem.barcode,
                  purchaseName: matchedItem.purchaseName || item.purchaseName || item.productName,
                  matchType: matchedItem.matchType || (isSmartStore ? 'smartstore_match' : 'zigzag_match'),
                  matchSimilarity: matchedItem.matchSimilarity || 1.0
                };
              } else {
                console.log(`❌ 업로드 단계 매칭 실패: ${item.customProductCode || item.zigzagProductCode}`);
              }
            }
            return item;
          });
          
          // 매칭 결과 통계
          const matchedCount = processedReturns.filter(item => item.barcode && item.barcode !== '-').length;
          
          console.log(`총 ${uniqueReturns.length}개 항목 중 ${matchedCount}개 항목이 자체상품코드 기준으로 매칭되었습니다.`);
          
          if (processedReturns.length === 0) {
            setMessage(`모든 항목(${returnItems.length}개)이 이미 존재하여 추가되지 않았습니다.`);
            setLoading(false);
            e.target.value = '';
            return;
          }
          
          dispatch({ type: 'ADD_RETURNS', payload: processedReturns });
          setMessage(`${isSmartStore ? '[스마트스토어]' : '[지그재그]'} ${processedReturns.length}개의 고유한 반품 항목이 추가되었습니다. (중복 ${returnItems.length - processedReturns.length}개 제외, 매칭 ${matchedCount}개 성공)`);
          
          // 매칭되지 않은 항목에 대해 추가 매칭 시도
          const unmatchedItems = processedReturns.filter(item => !item.barcode || item.barcode === '-');
          
          if (unmatchedItems.length > 0 && returnState.products.length > 0) {
            console.log(`🔍 추가 매칭: ${unmatchedItems.length}개 미매칭 항목에 대해 매칭 시도...`);
            
            // 매칭 시도 및 결과 수집
            let secondMatchCount = 0;
            
            // 각 미매칭 항목에 대해 유사도 기반 매칭 시도
            unmatchedItems.forEach(item => {
              // 사입상품명 기준 유사도 매칭 시도
              const matchedItem = matchProductData(item, returnState.products);
              
              if (matchedItem.barcode && matchedItem.barcode !== '-') {
                // 매칭 성공
                secondMatchCount++;
                console.log(`✅ 추가 매칭 성공: ${item.productName} → ${matchedItem.purchaseName} (바코드: ${matchedItem.barcode})`);
                
                dispatch({
                  type: 'UPDATE_RETURN_ITEM',
                  payload: matchedItem
                });
              }
            });
            
            if (secondMatchCount > 0) {
              setMessage(`${isSmartStore ? '[스마트스토어]' : '[지그재그]'} ${processedReturns.length}개 항목 추가됨. 바코드 매칭: ${matchedCount+secondMatchCount}개 성공 (업로드 시: ${matchedCount}개, 추가 매칭: ${secondMatchCount}개)`);
            }
          }
        } else {
          setMessage('처리할 데이터가 없습니다. 파일을 확인해주세요.');
        }
      } else if (type === 'products') {
        setMessage('상품 파일을 처리 중입니다...');
        
        const products = await parseProductExcel(files[0]);
        if (products.length > 0) {
          // 중복 검사를 위한 기존 상품 바코드/상품코드 맵 생성
          const existingBarcodes = new Set(returnState.products.map(p => p.barcode));
          const existingCodes = new Set(
            returnState.products
              .filter(p => p.customProductCode || p.zigzagProductCode)
              .map(p => (p.customProductCode || p.zigzagProductCode).toLowerCase().trim())
          );
          
          // 중복이 아닌 상품만 추가
          const uniqueProducts = products.filter(product => {
            // 바코드 기준 중복 체크
            if (product.barcode && existingBarcodes.has(product.barcode)) {
              console.log(`중복 상품 제외 (바코드): ${product.barcode}`);
              return false;
            }
            
            // 상품코드 기준 중복 체크 (자체상품코드 또는 지그재그코드)
            const productCode = (product.customProductCode || product.zigzagProductCode || '').toLowerCase().trim();
            if (productCode && existingCodes.has(productCode)) {
              console.log(`중복 상품 제외 (상품코드): ${productCode}`);
              return false;
            }
            
            return true;
          });
          
          console.log(`총 ${products.length}개 상품 중 ${uniqueProducts.length}개 고유 상품 추가 (중복 ${products.length - uniqueProducts.length}개 제외)`);
          
          if (uniqueProducts.length === 0) {
            setMessage(`모든 항목(${products.length}개)이 이미 존재하여 추가되지 않았습니다.`);
            setLoading(false);
            e.target.value = '';
            return;
          }
          
          dispatch({ type: 'ADD_PRODUCTS', payload: uniqueProducts });
          
          // 상품 데이터 추가 후 자동으로 매칭 시도 (보류 중인 반품 항목에 대해)
          if (returnState.pendingReturns && returnState.pendingReturns.length > 0) {
            console.log('상품 데이터 추가 후 자동 매칭 실행');
            
            // 미매칭 상품 찾기
            const unmatchedItems = returnState.pendingReturns.filter(item => !item.barcode || item.barcode === '-');
            console.log(`🔍 ${unmatchedItems.length}개 반품 상품 자동 매칭 시작`);
            
            if (unmatchedItems.length > 0) {
              // 매칭 시도 및 결과 수집
              let matchedCount = 0;
              let failedCount = 0;
              
              // 각 반품 항목에 대해 매칭 시도 - 향상된 매칭 로직 사용
              unmatchedItems.forEach(item => {
                // 새로 추가한 상품만 대상으로 매칭 시도
                const matchedItem = matchProductData(item, uniqueProducts);
                
                if (matchedItem.barcode && matchedItem.barcode !== '-') {
                  // 매칭 성공
                  matchedCount++;
                  console.log(`✅ 매칭 성공: ${item.productName || item.purchaseName} → ${matchedItem.purchaseName} (바코드: ${matchedItem.barcode})`);
                  
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
                setMessage(`${uniqueProducts.length}개 상품이 추가되었습니다. 자동 매칭 결과: ${matchedCount}개 성공, ${failedCount}개 실패`);
              } else {
                setMessage(`${uniqueProducts.length}개 상품이 추가되었습니다. 상품 매칭에 실패했습니다.`);
              }
            } else {
              setMessage(`${uniqueProducts.length}개 상품이 추가되었습니다.`);
            }
          } else {
            setMessage(`${uniqueProducts.length}개 상품이 추가되었습니다.`);
          }
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

  return (
    <main className="min-h-screen p-4 md:p-6">
      <h1 className="text-2xl font-bold mb-6">반품 관리 시스템</h1>
      
      {/* 상태 메시지 표시 */}
      {message && (
        <div className="mb-4 p-3 bg-blue-100 text-blue-800 rounded">
          {message}
        </div>
      )}
      
      {/* 버튼 영역 */}
      <div className="mt-4 space-x-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        {/* 버튼 그룹 */}
        <label
          className={`px-4 py-2 text-white rounded text-center cursor-pointer ${buttonColors.returnButton}`}
          htmlFor="returnFile"
        >
          반품 업로드 (지그재그/스마트스토어)
          <input
            type="file"
            id="returnFile"
            accept=".xlsx,.xls"
            onChange={(e) => handleFileUpload(e, 'returns')}
            ref={returnFileRef}
            className="hidden"
            disabled={loading}
          />
        </label>
        <label
          className={`px-4 py-2 text-white rounded text-center cursor-pointer ${buttonColors.productButton}`}
          htmlFor="productFile"
        >
          상품 업로드
          <input
            type="file"
            id="productFile"
            accept=".xlsx,.xls"
            onChange={(e) => handleFileUpload(e, 'products')}
            ref={productFileRef}
            className="hidden"
            disabled={loading}
          />
        </label>
        <button
          className={`px-4 py-2 text-white rounded ${buttonColors.firebaseButton}`}
          onClick={handleSaveToFirebase}
          disabled={loading}
        >
          Firebase 저장
        </button>
        <button
          className={`px-4 py-2 text-white rounded ${buttonColors.testButton}`}
          onClick={testFirebaseConnection}
          disabled={loading}
        >
          서버연결 테스트
        </button>
      </div>
      
      {/* 로딩 표시 */}
      {loading && (
        <div className="flex justify-center items-center my-4">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
          <span className="ml-2">처리 중...</span>
        </div>
      )}
      
      {/* 반품송장번호로 입고 영역 */}
      <div className="mb-6 p-4 border rounded-lg shadow-sm bg-white">
        <h2 className="text-xl font-semibold mb-4">반품송장번호로 입고</h2>
        
        <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-2">
          <input
            type="text"
            placeholder="반품송장번호 입력 후 Enter 또는 입고 버튼 클릭"
            className="flex-1 px-4 py-2 border border-gray-300 rounded"
            value={trackingSearch}
            onChange={(e) => setTrackingSearch(e.target.value)}
            onKeyDown={handleTrackingKeyDown}
          />
          <button
            className={`px-4 py-2 text-white rounded ${buttonColors.trackingButton}`}
            onClick={handleReceiveByTracking}
            disabled={loading || !trackingSearch.trim()}
          >
            입고
          </button>
        </div>
        
        {/* 검색 결과 영역은 삭제하고 입고 처리 후 메시지로 대체 */}
      </div>
      
      {/* 입고완료 반품 목록 */}
      <div className="p-4 border rounded-lg shadow-sm bg-white">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">입고완료 반품 목록</h2>
          <div className="flex space-x-2">
            <button
              className={`px-3 py-1 text-white rounded ${buttonColors.downloadButton}`}
              onClick={handleDownloadCompletedExcel}
              disabled={loading || returnState.completedReturns.length === 0}
            >
              목록 다운로드
            </button>
          </div>
        </div>
        
        {/* 검색 영역 */}
        <div className="flex flex-col md:flex-row mb-4 space-y-2 md:space-y-0 md:space-x-2">
          <input
            type="text"
            placeholder="고객명 또는 주문번호로 검색"
            className="flex-1 px-4 py-2 border border-gray-300 rounded"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
            onClick={handleSearch}
          >
            검색
          </button>
          {isSearching && (
            <button
              className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded"
              onClick={handleCancelSearch}
            >
              검색 취소
            </button>
          )}
        </div>
        
        {/* 날짜 이동 UI */}
        {!isSearching && availableDates.length > 0 && (
          <div className="flex items-center justify-center mb-4 p-2 bg-gray-100 rounded-md">
            <button 
              className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded-l-md"
              onClick={() => handleDateNavigation('prev')}
            >
              &lt;
            </button>
            <div className="mx-3 font-medium">
              {currentDate && new Date(currentDate).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
              })}
            </div>
            <button 
              className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded-r-md"
              onClick={() => handleDateNavigation('next')}
            >
              &gt;
            </button>
          </div>
        )}
        
        {/* 새로고침 버튼 */}
        <div className="flex justify-end mb-4">
          <button 
            className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded flex items-center gap-1"
            onClick={handleRefresh}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            새로고침
          </button>
        </div>
        
        {/* 검색 결과 또는 전체 목록 표시 */}
        {returnState.completedReturns.length > 0 ? (
          <div className="space-y-6">
            {/* 검색 결과 표시 */}
            {isSearching && groupedSearchResults.length > 0 && (
              groupedSearchResults.map(({ date, items }) => (
                <div key={date} id={`date-group-${date}`} className="border border-gray-200 rounded-md overflow-hidden">
                  <div className="bg-gray-100 px-4 py-2 font-medium flex items-center justify-between">
                    <div className="flex items-center">
                      {new Date(date).toLocaleDateString('ko-KR', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric',
                        weekday: 'long'
                      })}
                      <span className="ml-2 text-gray-600 text-sm">({items.length}개)</span>
                    </div>
                    {selectedCompletedItems.length > 0 && (
                      <button 
                        className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded"
                        onClick={handleRevertSelectedCompleted}
                      >
                        되돌리기 ({selectedCompletedItems.length})
                      </button>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <CompletedItemsTable items={items} />
                  </div>
                </div>
              ))
            )}

            {/* 현재 날짜 데이터 표시 */}
            {!isSearching && currentDate && (
              <div className="border border-gray-200 rounded-md overflow-hidden">
                <div className="bg-gray-100 px-4 py-2 font-medium flex items-center justify-between">
                  <div className="flex items-center">
                    {new Date(currentDate).toLocaleDateString('ko-KR', { 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric',
                      weekday: 'long'
                    })}
                    <span className="ml-2 text-gray-600 text-sm">({currentDateItems.length}개)</span>
                  </div>
                  {selectedCompletedItems.length > 0 && (
                    <button 
                      className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded"
                      onClick={handleRevertSelectedCompleted}
                    >
                      되돌리기 ({selectedCompletedItems.length})
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <CompletedItemsTable items={currentDateItems} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <p>입고완료된 반품이 없습니다.</p>
        )}
      </div>
      
      {/* 송장번호 입력 모달 */}
      {showTrackingInput && currentTrackingItem && (
        <TrackingNumberModal
          isOpen={showTrackingInput}
          onClose={handleCancelTrackingInput}
          returnItem={currentTrackingItem}
          onSave={handleSaveTrackingNumber}
          zIndex={1000 + modalLevel}
        />
      )}
      
      {/* 입고전 반품 목록 모달 */}
      <dialog 
        ref={pendingModalRef} 
        className="modal w-11/12 max-w-5xl p-0 rounded-lg shadow-xl popup-layer" 
        onClick={handleOutsideClick}
        id="pendingModal"
      >
        <div className="modal-box bg-white p-6">
          <h3 className="font-bold text-lg mb-4 flex justify-between items-center">
            <span>입고전 반품 목록</span>
            <button onClick={() => closeModal(pendingModalRef)} className="btn btn-sm btn-circle">✕</button>
          </h3>
          
          {returnState.pendingReturns && returnState.pendingReturns.length > 0 ? (
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-10 py-2">
                      <input
                        type="checkbox"
                        checked={selectAll}
                        onChange={(e) => {
                          setSelectAll(e.target.checked);
                          if (e.target.checked) {
                            setSelectedItems([...Array(returnState.pendingReturns.length).keys()]);
                          } else {
                            setSelectedItems([]);
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                    <th className="py-2">번호</th>
                    <th className="py-2">고객명</th>
                    <th className="py-2">주문번호</th>
                    <th className="py-2">상품명</th>
                    <th className="py-2">옵션명</th>
                    <th className="py-2">수량</th>
                    <th className="py-2 px-1 min-w-[150px]">반품사유</th>
                    <th className="py-2">송장번호</th>
                    <th className="py-2">바코드</th>
                    <th className="py-2">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {returnState.pendingReturns.map((item, index) => {
                    const isSelected = selectedItems.includes(index);
                    return (
                      <tr key={index} className={isSelected ? 'bg-blue-50' : ''}>
                        <td className="py-2 pl-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              handleCheckboxChange(index, e);
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="py-2">{index + 1}</td>
                        <td className="py-2">{item.customerName}</td>
                        <td className="py-2">{item.orderNumber}</td>
                        <td className="py-2">{getPurchaseNameString(item)}</td>
                        <td className="py-2">{item.optionName}</td>
                        <td className="py-2">{item.quantity}</td>
                        <td className={`py-2 px-1 whitespace-normal break-words ${isDefectReason(item.returnReason) ? 'text-red-600 font-medium' : ''}`} style={{ maxWidth: '250px', minWidth: '150px', whiteSpace: 'normal', wordWrap: 'break-word' }}>
                          {getReturnReasonDisplay(item)}
                        </td>
                        <td className="py-2">{item.returnTrackingNumber || '-'}</td>
                        <td className="py-2">{item.barcode || '-'}</td>
                        <td className="py-2 space-x-1">
                          <button
                            onClick={() => handleReceive(item)}
                            className="bg-green-500 hover:bg-green-600 text-white text-xs px-2 py-1 rounded"
                          >
                            입고
                          </button>
                          <button
                            onClick={() => handleProductMatch(item)}
                            className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-2 py-1 rounded"
                          >
                            매칭
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>대기 중인 반품이 없습니다.</p>
          )}
          
          <div className="modal-action mt-6 flex flex-wrap gap-2 justify-end">
            <button 
              className="btn btn-primary bg-blue-500 hover:bg-blue-600 text-white" 
              onClick={handleRefresh}
            >
              새로고침
            </button>
            {selectedItems.length > 0 && (
              <>
                <button 
                  className="btn btn-success bg-green-500 hover:bg-green-600 text-white"
                  onClick={handleProcessSelected}
                >
                  선택항목 입고처리 ({selectedItems.length}개)
                </button>
                <button 
                  className="btn btn-error bg-red-500 hover:bg-red-600 text-white"
                  onClick={handleDeleteSelected}
                >
                  선택항목 삭제 ({selectedItems.length}개)
                </button>
              </>
            )}
            <button className="btn bg-gray-500 hover:bg-gray-600 text-white" onClick={() => closeModal(pendingModalRef)}>닫기</button>
          </div>
        </div>
      </dialog>
      
      {/* 상품 데이터 모달 */}
      <dialog 
        ref={productModalRef} 
        className="modal w-11/12 max-w-5xl p-0 rounded-lg shadow-xl"
        onClick={handleOutsideClick}
        id="productModal"
      >
        <div className="modal-box bg-white p-6">
          <h3 className="font-bold text-lg mb-4 flex justify-between items-center">
            <span>상품 데이터 목록</span>
            <button onClick={() => closeModal(productModalRef)} className="btn btn-sm btn-circle">✕</button>
          </h3>
          
          <div className="mb-4 flex justify-end">
            <button
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded"
              onClick={handleDeleteAllProducts}
              disabled={!returnState.products || returnState.products.length === 0}
            >
              전체 삭제
            </button>
          </div>
          
          {returnState.products && returnState.products.length > 0 ? (
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="min-w-full bg-white border border-gray-200 text-sm mt-4">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-10 py-2">
                      <input
                        type="checkbox"
                        checked={selectAllCompleted}
                        onChange={(e) => {
                          setSelectAllCompleted(e.target.checked);
                          if (e.target.checked) {
                            setSelectedCompletedItems([...Array(currentDateItems.length).keys()]);
                          } else {
                            setSelectedCompletedItems([]);
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                    <th className="py-2">번호</th>
                    <th className="py-2">고객명</th>
                    <th className="py-2">주문번호</th>
                    <th className="py-2">상품명</th>
                    <th className="py-2">옵션명</th>
                    <th className="py-2">수량</th>
                    <th className="py-2 px-1 min-w-[150px]">반품사유</th>
                    <th className="py-2">송장번호</th>
                    <th className="py-2">바코드</th>
                    <th className="py-2">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {currentDateItems.map((item, index) => {
                    const isSelected = selectedCompletedItems.includes(index);
                    return (
                      <tr key={index} className={isSelected ? 'bg-blue-50' : ''}>
                        <td className="py-2 pl-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              handleCompletedCheckboxChange(index, e);
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="py-2">{index + 1}</td>
                        <td className="py-2">{item.customerName}</td>
                        <td className="py-2">{item.orderNumber}</td>
                        <td className="py-2">{getPurchaseNameString(item)}</td>
                        <td className="py-2">{item.optionName}</td>
                        <td className="py-2">{item.quantity}</td>
                        <td className={`py-2 px-1 whitespace-normal break-words ${isDefectReason(item.returnReason) ? 'text-red-600 font-medium' : ''}`} style={{ maxWidth: '250px', minWidth: '150px', whiteSpace: 'normal', wordWrap: 'break-word' }}>
                          {getReturnReasonDisplay(item)}
                        </td>
                        <td className="py-2">{item.returnTrackingNumber || '-'}</td>
                        <td className="py-2">{item.barcode || '-'}</td>
                        <td className="py-2 space-x-1">
                          <button
                            onClick={() => handleProductMatch(item)}
                            className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-2 py-1 rounded"
                          >
                            매칭
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>상품 데이터가 없습니다.</p>
          )}
          
          <div className="modal-action mt-6">
            <button className="btn" onClick={() => closeModal(productModalRef)}>닫기</button>
          </div>
        </div>
      </dialog>
      
      {/* 상품 매칭 모달 */}
      {showProductMatchModal && currentMatchItem && (
        <MatchProductModal
          isOpen={showProductMatchModal}
          onClose={handleCloseProductMatchModal}
          returnItem={currentMatchItem}
          products={returnState.products || []}
          onMatch={handleProductMatch}
          zIndex={1000 + modalLevel}
        />
      )}
      
      {/* 반품사유 상세 모달 */}
      {isReasonModalOpen && currentReasonItem && (
        <ReturnReasonModal
          isOpen={isReasonModalOpen}
          onClose={() => {
            setIsReasonModalOpen(false);
            setModalLevel(prev => Math.max(0, prev - 10));
          }}
          returnItem={currentReasonItem}
          detailReason={currentDetailReason || ''}
          onSave={handleSaveDetailReason}
          setDetailReason={setCurrentDetailReason}
          zIndex={1000 + modalLevel}
        />
      )}
    </main>
  );
}