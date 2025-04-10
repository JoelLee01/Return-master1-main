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

  // 파일 업로드 핸들러 개선 - 자체상품코드 우선 매칭 및 중복 제거 로직 강화
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'returns' | 'products') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      setLoading(true);
      setMessage(`${type === 'returns' ? '반품' : '상품'} 파일을 처리 중입니다...`);
      
      if (type === 'returns') {
        const returns = await parseReturnExcel(files[0]);
        if (returns.length > 0) {
          console.log(`엑셀에서 ${returns.length}개 반품 항목을 불러왔습니다. 중복 검사를 시작합니다.`);
          
          // 중복 제거 로직 강화 - 입고완료 목록과 대기 목록 중복 체크
          // 1. 기본 키 (고객명_주문번호_상품명_옵션명_송장번호) 기준 중복 체크
          const existingKeys = new Set([
            // 1순위: 입고완료 목록의 키
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
          // 입고완료 목록에서 자체상품코드+옵션명 조합 수집
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
          const uniqueReturns = returns.filter(item => {
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
          
          console.log(`중복 제거 결과: 총 ${returns.length}개 중 ${duplicatesBasic.length}개 기본중복, ${duplicatesCode.length}개 코드중복, ${uniqueReturns.length}개 고유항목`);
          
          // 자체상품코드 매칭 및 바코드 설정 전처리
          const processedReturns = uniqueReturns.map(item => {
            // 자체상품코드 있는 항목은 상품 목록과 매칭하여 바코드 설정
            if ((item.customProductCode && item.customProductCode !== '-') || 
                (item.zigzagProductCode && item.zigzagProductCode !== '-')) {
              
              // 매칭 시도 - 자체상품코드와 옵션명 기준으로 우선 매칭
              const matchedItem = matchProductByZigzagCode(item, returnState.products);
              
              if (matchedItem.barcode && matchedItem.barcode !== '-') {
                console.log(`✅ 업로드 단계 매칭 성공: ${item.customProductCode || item.zigzagProductCode} → 바코드: ${matchedItem.barcode}`);
                // 매칭 성공 시 바코드 및 관련 정보 설정
                return {
                  ...item,
                  barcode: matchedItem.barcode,
                  purchaseName: matchedItem.purchaseName || item.purchaseName || item.productName,
                  matchType: matchedItem.matchType || 'upload_match',
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
            setMessage(`모든 항목(${returns.length}개)이 이미 존재하여 추가되지 않았습니다.`);
            setLoading(false);
            e.target.value = '';
            return;
          }
          
          dispatch({ type: 'ADD_RETURNS', payload: processedReturns });
          setMessage(`${processedReturns.length}개의 고유한 반품 항목이 추가되었습니다. (중복 ${returns.length - processedReturns.length}개 제외, 매칭 ${matchedCount}개 성공)`);
          
          // 매칭되지 않은 항목에 대해 추가 매칭 시도
          const unmatchedItems = processedReturns.filter(item => !item.barcode || item.barcode === '-');
          
          if (unmatchedItems.length > 0 && returnState.products.length > 0) {
            console.log(`🔍 추가 매칭: ${unmatchedItems.length}개 미매칭 항목에 대해 매칭 시도...`);
            
            // 매칭 시도 및 결과 수집
            let secondMatchCount = 0;
            
            // 각 미매칭 항목에 대해 유사도 기반 매칭 시도
            unmatchedItems.forEach(item => {
              // 사입상품명 기준 유사도 매칭 시도
              const matchedItem = matchProductByZigzagCode(item, returnState.products);
              
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
              setMessage(`${processedReturns.length}개 항목 추가됨. 바코드 매칭: ${matchedCount+secondMatchCount}개 성공 (업로드 시: ${matchedCount}개, 추가 매칭: ${secondMatchCount}개)`);
            }
          }
        } else {
          setMessage('처리할 데이터가 없습니다. 파일을 확인해주세요.');
        }
      } else {
        // 상품 목록 처리
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
                const matchedItem = matchProductByZigzagCode(item, uniqueProducts);
                
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
  const handleCheckboxChange = (index: number, shiftKey?: boolean) => {
    // Shift 키 다중 선택 처리
    if (shiftKey && lastSelectedIndex !== null && lastSelectedIndex !== index) {
      const startIdx = Math.min(index, lastSelectedIndex);
      const endIdx = Math.max(index, lastSelectedIndex);
      const rangeIndices = Array.from(
        { length: endIdx - startIdx + 1 },
        (_, i) => startIdx + i
      );

      setSelectedItems(prev => {
        // 이미 선택된 항목들 유지
        const existing = [...prev];
        
        // 범위 내의 항목들 추가 (중복 방지)
        rangeIndices.forEach(idx => {
          if (!existing.includes(idx)) {
            existing.push(idx);
          }
        });

        return existing;
      });
    } else {
      // 일반 선택/해제 처리
      setSelectedItems(prev => {
        if (prev.includes(index)) {
          return prev.filter(i => i !== index);
        } else {
          return [...prev, index];
        }
      });
    }
    
    // 마지막 선택 항목 인덱스 업데이트
    setLastSelectedIndex(index);
  };

  // 전체 선택 기능
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedItems([]);
    } else {
      setSelectedItems(returnState.pendingReturns.map((_, index) => index));
    }
    setSelectAll(!selectAll);
    setLastSelectedIndex(null);
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
    setCurrentDetailReason(item.detailReason || '');
    setIsReasonModalOpen(true);
    // z-index 증가
    setModalLevel(prev => prev + 10);
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
    // z-index 감소
    setModalLevel(prev => Math.max(0, prev - 10));
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
    if (!reason || typeof reason !== 'string') return false;
    return reason.includes('불량') || reason.includes('하자') || reason.includes('파손');
  };
  
  // 입고 완료된 반품 목록 다운로드 함수
  const handleDownloadCompletedExcel = () => {
    // 현재 표시 중인 데이터 확인
    let dataToExport: ReturnItem[] = [];

    // 검색 결과가 있는 경우 검색 결과만 포함
    if (isSearching && searchResults.length > 0) {
      dataToExport = searchResults;
    } 
    // 아니면 현재 표시된 날짜의 데이터만 포함
    else if (currentDate && currentDateItems.length > 0) {
      dataToExport = currentDateItems;
    } 
    // 위 조건 모두 아닐 경우 전체 데이터 사용 (이전 동작 유지)
    else if (returnState.completedReturns.length > 0) {
      dataToExport = returnState.completedReturns;
    }
    
    if (dataToExport.length === 0) {
      setMessage('다운로드할 입고 완료 데이터가 없습니다.');
      return;
    }
    
    try {
      // 간소화된 데이터 준비 - 바코드번호와 수량만 포함
      const simplifiedData = dataToExport.map(item => ({
        바코드번호: item.barcode || '',
        입고수량: item.quantity || 1
      }));
      
      const filename = `입고완료_반품_${new Date().toISOString().split('T')[0]}.xlsx`;
      
      // XLSX 파일 생성
      const ws = XLSX.utils.json_to_sheet(simplifiedData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '입고완료목록');
      
      // 파일 다운로드
      XLSX.writeFile(wb, filename);
      
      // 메시지 수정: 현재 표시 중인 데이터에 대한 정보 추가
      let messagePrefix = '';
      if (isSearching) {
        messagePrefix = '검색 결과 ';
      } else if (currentDate) {
        messagePrefix = `${new Date(currentDate).toLocaleDateString('ko-KR')} 날짜의 `;
      }
      
      setMessage(`${messagePrefix}${simplifiedData.length}개 항목이 ${filename} 파일로 저장되었습니다.`);
    } catch (error) {
      console.error('엑셀 생성 중 오류:', error);
      setMessage('엑셀 파일 생성 중 오류가 발생했습니다.');
    }
  };

  // 상품 매칭 팝업 열기
  const handleProductMatchClick = (item: ReturnItem) => {
    handleProductMatch(item, undefined);
  };
  
  // 상품 매칭 팝업 닫기
  const handleCloseProductMatchModal = () => {
    setShowProductMatchModal(false);
    setCurrentMatchItem(null);
    // z-index 감소
    setModalLevel(prev => Math.max(0, prev - 10));
  };

  // 입고완료 선택 항목 핸들러
  const handleCompletedCheckboxChange = (index: number, shiftKey?: boolean) => {
    // Shift 키 다중 선택 처리
    if (shiftKey && lastSelectedCompletedIndex !== null && lastSelectedCompletedIndex !== index) {
      const startIdx = Math.min(index, lastSelectedCompletedIndex);
      const endIdx = Math.max(index, lastSelectedCompletedIndex);
      const rangeIndices = Array.from(
        { length: endIdx - startIdx + 1 },
        (_, i) => startIdx + i
      );

      setSelectedCompletedItems(prev => {
        // 이미 선택된 항목들 유지
        const existing = [...prev];
        
        // 범위 내의 항목들 추가 (중복 방지)
        rangeIndices.forEach(idx => {
          if (!existing.includes(idx)) {
            existing.push(idx);
          }
        });

        return existing;
      });
    } else {
      // 일반 선택/해제 처리
      setSelectedCompletedItems(prev => {
        if (prev.includes(index)) {
          return prev.filter(i => i !== index);
        } else {
          return [...prev, index];
        }
      });
    }
    
    // 마지막 선택 항목 인덱스 업데이트
    setLastSelectedCompletedIndex(index);
  };

  // 입고완료 전체 선택 핸들러
  const handleSelectAllCompleted = () => {
    if (selectAllCompleted) {
      setSelectedCompletedItems([]);
    } else {
      setSelectedCompletedItems(currentDateItems.map((_, index) => index));
    }
    setSelectAllCompleted(!selectAllCompleted);
    setLastSelectedCompletedIndex(null);
  };

  // 반품사유 자동 간소화 처리 함수
  const simplifyReturnReason = (reason: string): string => {
    if (!reason || typeof reason !== 'string') return '';
    
    const lowerReason = reason.toLowerCase();
    
    // "불실" → "단순변심"
    if (lowerReason.includes('불실') || lowerReason.includes('변심') || lowerReason.includes('단순')) {
      return '단순변심';
    }
    
    // "실못" → "주문실수"
    if (lowerReason.includes('실못') || (lowerReason.includes('잘못') && lowerReason.includes('주문'))) {
      return '주문실수';
    }
    
    // "파손", "불량" → "파손 및 불량"
    if (lowerReason.includes('파손') || lowerReason.includes('불량')) {
      return '파손 및 불량';
    }
    
    return reason;
  };

  // 전체 상품 데이터 삭제 함수
  const handleDeleteAllProducts = useCallback(() => {
    if (!returnState.products || returnState.products.length === 0) {
      setMessage('삭제할 상품 데이터가 없습니다.');
      return;
    }
    
    if (confirm('정말로 모든 상품 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      dispatch({ type: 'SET_PRODUCTS', payload: [] });
      
      // 로컬 스토리지 업데이트
      const updatedData: ReturnState = {
        ...returnState,
        products: []
      };
      saveLocalData(updatedData);
      
      setMessage('모든 상품 데이터가 삭제되었습니다.');
    }
  }, [returnState, dispatch, saveLocalData]);
  
  // 반품송장번호 입력 핸들러
  const handleTrackingNumberClick = useCallback((item: ReturnItem) => {
    setCurrentTrackingItem(item);
    setShowTrackingInput(true);
    // z-index 증가
    setModalLevel(prev => prev + 10);
  }, []);
  
  // 반품송장번호 저장 핸들러
  const handleSaveTrackingNumber = useCallback((trackingNumberInput: string) => {
    if (!currentTrackingItem) return;
    
    const updatedItem: ReturnItem = {
      ...currentTrackingItem,
      returnTrackingNumber: trackingNumberInput.trim()
    };
    
    // 송장번호가 입력되었으면 입고완료 처리
    if (trackingNumberInput.trim()) {
      // 대기 목록에서 제거
      dispatch({ 
        type: 'REMOVE_PENDING_RETURN', 
        payload: { id: updatedItem.id } 
      });
      
      // 완료 목록에 추가
      const completedItem: ReturnItem = {
        ...updatedItem,
        status: 'COMPLETED' as const,
        completedAt: new Date()
      };
      
      dispatch({
        type: 'ADD_COMPLETED_RETURN',
        payload: completedItem
      });
      
      setMessage(`${completedItem.productName} 상품이 입고완료 처리되었습니다.`);
    } else {
      // 송장번호만 업데이트
      dispatch({
        type: 'UPDATE_PENDING_RETURN',
        payload: updatedItem
      });
      
      setMessage('반품송장번호가 업데이트되었습니다.');
    }
    
    // 로컬 스토리지 업데이트
    saveLocalData(returnState);
    
    // 입력창 닫기
    setShowTrackingInput(false);
    setCurrentTrackingItem(null);
    // z-index 감소
    setModalLevel(prev => Math.max(0, prev - 10));
  }, [currentTrackingItem, dispatch, returnState, saveLocalData]);
  
  // 입고완료 반품 목록 검색 관련 상태 추가
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ReturnItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // 검색 처리 함수
  const handleSearch = () => {
    if (!searchQuery.trim()) {
      setIsSearching(false);
      setSearchResults([]);
      return;
    }

    const query = searchQuery.toLowerCase().trim();
    const results = returnState.completedReturns.filter(item => 
      (item.customerName && item.customerName.toLowerCase().includes(query)) || 
      (item.orderNumber && item.orderNumber.toLowerCase().includes(query))
    );

    setSearchResults(results);
    setIsSearching(true);
    
    if (results.length === 0) {
      setMessage('검색 결과가 없습니다.');
    } else {
      setMessage(`${results.length}개의 검색 결과를 찾았습니다.`);
    }
  };

  // 검색 취소 처리
  const handleCancelSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
  };

  // 날짜별 그룹화 함수
  const groupByDate = (items: ReturnItem[]) => {
    const groups: { [key: string]: ReturnItem[] } = {};
    
    items.forEach(item => {
      if (item.completedAt) {
        const dateKey = new Date(item.completedAt).toISOString().split('T')[0];
        if (!groups[dateKey]) {
          groups[dateKey] = [];
        }
        groups[dateKey].push(item);
      }
    });
    
    // 날짜순으로 정렬 (최신순)
    return Object.entries(groups)
      .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
      .map(([date, items]) => ({
        date,
        items
      }));
  };

  // 날짜별로 그룹화된 완료 데이터
  const groupedCompletedReturns = useMemo(() => {
    const groups = returnState.completedReturns.reduce((acc, item) => {
      const date = new Date(item.completedAt!).toLocaleDateString();
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(item);
      return acc;
    }, {} as Record<string, ReturnItem[]>);

    return Object.entries(groups)
      .map(([date, items]) => ({
        date,
        items: items.sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [returnState.completedReturns]);

  // 검색 결과 날짜별 그룹화
  const groupedSearchResults = useMemo(() => {
    if (!isSearching || searchResults.length === 0) {
      return [];
    }
    return groupByDate(searchResults);
  }, [isSearching, searchResults]);

  // 지그재그 반품 확인 함수
  const isZigzagOrder = (orderNumber: string): boolean => {
    return orderNumber.includes('Z');
  };

  // 사입상품명 또는 자체상품코드 표시 함수
  const getPurchaseNameDisplay = (item: ReturnItem) => {    
    // 사용자 정의 상품코드가 있는 경우 최우선 표시
    if (item.customProductCode && item.customProductCode !== '-') {
      return (
        <span className="font-medium text-green-600">{item.customProductCode}</span>
      );
    }
    
    // 자체상품코드가 있는 경우 다음 우선순위로 표시
    if (item.zigzagProductCode && item.zigzagProductCode !== '-') {
      return (
        <span className="font-medium">{item.zigzagProductCode}</span>
      );
    }
    
    // 자체상품코드가 없고 바코드도 없는 경우 상품명을 클릭 가능한 버튼으로 표시
    if (!item.barcode) {
      return (
        <button
          className="text-blue-600 hover:text-blue-800 underline"
          onClick={() => handleProductMatchClick(item)}
        >
          {item.purchaseName || item.productName}
        </button>
      );
    }
    
    // 일반 상품명 표시
    return <span>{item.purchaseName || item.productName}</span>;
  };

  // 매칭 로직 개선: 자체상품코드(customProductCode), zigzagProductCode, 상품명 순으로 매칭
  function matchProductByZigzagCode(
    returnItem: ReturnItem, 
    productList: ProductInfo[]
  ): ReturnItem {
    const updatedItem = { ...returnItem };
    
    // 0. 이미 바코드가 매칭된 경우 그대로 반환
    if (returnItem.barcode && returnItem.barcode !== '-') {
      return returnItem;
    }
    
    // 1. 자체상품코드(customProductCode)로 매칭 시도 - 최우선 순위
    if (returnItem.customProductCode && returnItem.customProductCode !== '-') {
      // 자체상품코드와 동일한 값을 가진 상품 검색 - 정확한 매칭
      const matchedByCustomCode = productList.find(product => 
        // 자체상품코드와 직접 비교 (대소문자 무시, 공백 제거)
        (product.customProductCode && 
         product.customProductCode.toLowerCase().trim() === returnItem.customProductCode!.toLowerCase().trim()) ||
        // 지그재그코드와 비교 (상품에 자체상품코드가 없는 경우) (대소문자 무시, 공백 제거)
        (product.zigzagProductCode && 
         product.zigzagProductCode.toLowerCase().trim() === returnItem.customProductCode!.toLowerCase().trim())
      );
      
      if (matchedByCustomCode) {
        console.log(`✅ 자체상품코드 매칭 성공: ${returnItem.customProductCode} → ${matchedByCustomCode.purchaseName || matchedByCustomCode.productName}`);
        updatedItem.barcode = matchedByCustomCode.barcode;
        updatedItem.purchaseName = matchedByCustomCode.purchaseName || matchedByCustomCode.productName;
        updatedItem.zigzagProductCode = matchedByCustomCode.zigzagProductCode || '';
        updatedItem.matchType = "custom_code_match";
        updatedItem.matchSimilarity = 1.0;
        updatedItem.matchedProductName = matchedByCustomCode.productName;
        return updatedItem;
      }
      
      // 부분 매칭 시도 (자체상품코드가 포함되는 경우)
      const partialMatchesByCustomCode = productList.filter(product => 
        (product.customProductCode && 
         (product.customProductCode.toLowerCase().includes(returnItem.customProductCode!.toLowerCase()) ||
          returnItem.customProductCode!.toLowerCase().includes(product.customProductCode.toLowerCase()))) ||
        (product.zigzagProductCode && 
         (product.zigzagProductCode.toLowerCase().includes(returnItem.customProductCode!.toLowerCase()) ||
          returnItem.customProductCode!.toLowerCase().includes(product.zigzagProductCode.toLowerCase())))
      );
      
      if (partialMatchesByCustomCode.length > 0) {
        // 가중치 기반 유사도로 최적 매칭 항목 찾기
        const bestMatches = partialMatchesByCustomCode.map(product => ({
          product,
          similarity: calculateWeightedSimilarity(returnItem, product)
        }));
        
        // 유사도 기준으로 정렬
        bestMatches.sort((a, b) => b.similarity - a.similarity);
        
        // 임계값(0.8) 이상인 최적 매칭 항목 선택
        const bestMatch = bestMatches[0];
        if (bestMatch && bestMatch.similarity >= 0.8) {
          console.log(`✅ 자체상품코드 유사도 매칭 성공: ${returnItem.customProductCode} → ${bestMatch.product.purchaseName || bestMatch.product.productName} (유사도: ${Math.round(bestMatch.similarity * 100)}%)`);
          updatedItem.barcode = bestMatch.product.barcode;
          updatedItem.purchaseName = bestMatch.product.purchaseName || bestMatch.product.productName;
          updatedItem.zigzagProductCode = bestMatch.product.zigzagProductCode || '';
          updatedItem.customProductCode = bestMatch.product.customProductCode || bestMatch.product.zigzagProductCode || '';
          updatedItem.matchType = "custom_code_weighted_match";
          updatedItem.matchSimilarity = bestMatch.similarity;
          updatedItem.matchedProductName = bestMatch.product.productName;
          return updatedItem;
        }
      }
    }
    
    // 2. zigzagProductCode(지그재그 상품코드)로 매칭 시도
    if (returnItem.zigzagProductCode && returnItem.zigzagProductCode !== '-') {
      // 정확 매칭 시도
      const matchedProduct = productList.find(product => 
        product.zigzagProductCode && 
        product.zigzagProductCode.toLowerCase().trim() === returnItem.zigzagProductCode!.toLowerCase().trim()
      );
      
      if (matchedProduct) {
        console.log(`✅ 지그재그코드 매칭 성공: ${returnItem.zigzagProductCode}`);
        updatedItem.barcode = matchedProduct.barcode;
        updatedItem.customProductCode = matchedProduct.customProductCode || matchedProduct.zigzagProductCode || '';
        updatedItem.purchaseName = matchedProduct.purchaseName || matchedProduct.productName;
        updatedItem.matchType = "zigzag_code";
        updatedItem.matchSimilarity = 1.0;
        updatedItem.matchedProductName = matchedProduct.productName;
        return updatedItem;
      }
      
      // 유사도 기반 매칭 시도
      const zigzagCodeMatches = productList.filter(product => 
        product.zigzagProductCode && returnItem.zigzagProductCode
      ).map(product => ({
        product,
        similarity: calculateWeightedSimilarity(returnItem, product)
      }));
      
      zigzagCodeMatches.sort((a, b) => b.similarity - a.similarity);
      
      const bestMatch = zigzagCodeMatches[0];
      if (bestMatch && bestMatch.similarity >= 0.8) {
        console.log(`✅ 지그재그코드 유사도 매칭 성공: ${returnItem.zigzagProductCode} → ${bestMatch.product.zigzagProductCode} (유사도: ${Math.round(bestMatch.similarity * 100)}%)`);
        updatedItem.barcode = bestMatch.product.barcode;
        updatedItem.customProductCode = bestMatch.product.customProductCode || bestMatch.product.zigzagProductCode || '';
        updatedItem.purchaseName = bestMatch.product.purchaseName || bestMatch.product.productName;
        updatedItem.matchType = "zigzag_code_weighted";
        updatedItem.matchSimilarity = bestMatch.similarity;
        updatedItem.matchedProductName = bestMatch.product.productName;
        return updatedItem;
      }
    }
    
    // 3. 사입상품명 매칭 시도
    if (returnItem.purchaseName && returnItem.purchaseName !== '-') {
      // 사입상품명으로 매칭 시도 - 정확 매칭
      const matchedByPurchaseName = productList.find(product => 
        // 사입상품명과 정확히 일치하는 경우
        (product.purchaseName && 
         product.purchaseName.toLowerCase().trim() === returnItem.purchaseName?.toLowerCase().trim())
      );
      
      if (matchedByPurchaseName) {
        console.log(`✅ 사입상품명 매칭 성공: ${returnItem.purchaseName} → ${matchedByPurchaseName.productName}`);
        updatedItem.barcode = matchedByPurchaseName.barcode;
        updatedItem.customProductCode = matchedByPurchaseName.customProductCode || matchedByPurchaseName.zigzagProductCode || '';
        updatedItem.zigzagProductCode = matchedByPurchaseName.zigzagProductCode || '';
        updatedItem.matchType = "purchase_name_match";
        updatedItem.matchSimilarity = 1.0;
        updatedItem.matchedProductName = matchedByPurchaseName.productName;
        return updatedItem;
      }
      
      // 유사도 기반 매칭 시도 (가중치 적용)
      const purchaseNameMatches = productList.filter(product => 
        product.purchaseName && returnItem.purchaseName
      ).map(product => ({
        product,
        similarity: calculateWeightedSimilarity(returnItem, product)
      }));
      
      purchaseNameMatches.sort((a, b) => b.similarity - a.similarity);
      
      const bestMatch = purchaseNameMatches[0];
      if (bestMatch && bestMatch.similarity >= 0.8) {
        console.log(`✅ 사입상품명 유사도 매칭 성공: ${returnItem.purchaseName} → ${bestMatch.product.purchaseName} (유사도: ${Math.round(bestMatch.similarity * 100)}%)`);
        updatedItem.barcode = bestMatch.product.barcode;
        updatedItem.customProductCode = bestMatch.product.customProductCode || bestMatch.product.zigzagProductCode || '';
        updatedItem.zigzagProductCode = bestMatch.product.zigzagProductCode || '';
        updatedItem.matchType = "purchase_name_weighted";
        updatedItem.matchSimilarity = bestMatch.similarity;
        updatedItem.matchedProductName = bestMatch.product.productName;
        return updatedItem;
      }
    }
  
    // 4. productName(상품명)으로 매칭 시도
    if (returnItem.productName) {
      // 정확히 일치하는 상품 검색
      const exactMatch = productList.find(product => 
        (product.productName && 
         product.productName.toLowerCase().trim() === returnItem.productName?.toLowerCase().trim()) ||
        (product.purchaseName && 
         product.purchaseName.toLowerCase().trim() === returnItem.productName?.toLowerCase().trim())
      );
      
      if (exactMatch) {
        console.log(`✅ 상품명 정확 매칭 성공: ${returnItem.productName}`);
        updatedItem.barcode = exactMatch.barcode;
        updatedItem.customProductCode = exactMatch.customProductCode || exactMatch.zigzagProductCode || '';
        updatedItem.purchaseName = exactMatch.purchaseName || exactMatch.productName;
        updatedItem.zigzagProductCode = exactMatch.zigzagProductCode || '';
        updatedItem.matchType = "name_exact";
        updatedItem.matchSimilarity = 1.0;
        updatedItem.matchedProductName = exactMatch.productName;
        return updatedItem;
      }
      
      // 유사도 기반 매칭 (가중치 적용)
      const productNameMatches = productList.filter(product => 
        product.productName || product.purchaseName
      ).map(product => ({
        product,
        similarity: calculateWeightedSimilarity(returnItem, product)
      }));
      
      productNameMatches.sort((a, b) => b.similarity - a.similarity);
      
      const bestMatch = productNameMatches[0];
      if (bestMatch && bestMatch.similarity >= 0.8) {
        console.log(`✅ 상품명 유사도 매칭 성공: ${returnItem.productName} → ${bestMatch.product.purchaseName || bestMatch.product.productName} (유사도: ${Math.round(bestMatch.similarity * 100)}%)`);
        updatedItem.barcode = bestMatch.product.barcode;
        updatedItem.customProductCode = bestMatch.product.customProductCode || bestMatch.product.zigzagProductCode || '';
        updatedItem.purchaseName = bestMatch.product.purchaseName || bestMatch.product.productName;
        updatedItem.zigzagProductCode = bestMatch.product.zigzagProductCode || '';
        updatedItem.matchType = "name_weighted";
        updatedItem.matchSimilarity = bestMatch.similarity;
        updatedItem.matchedProductName = bestMatch.product.productName;
        return updatedItem;
      }
    }
    
    // 매칭 실패 시 원래 항목 반환
    updatedItem.matchType = "no_match";
    updatedItem.matchSimilarity = 0;
    return updatedItem;
  }

  // 향상된 유사도 계산 함수 - 가중치 적용 (자체상품코드 40%, 사입상품명 40%, 옵션명 20%)
  function calculateWeightedSimilarity(
    returnItem: ReturnItem,
    product: ProductInfo
  ): number {
    // 기본 Levenshtein 유사도 계산
    const simpleSimilarity = (str1: string, str2: string): number => {
      if (!str1 && !str2) return 1.0; // 둘 다 비어있으면 완전 일치
      if (!str1 || !str2) return 0.0; // 둘 중 하나만 비어있으면 불일치

      const longer = str1.length > str2.length ? str1 : str2;
      const shorter = str1.length > str2.length ? str2 : str1;
      
      if (longer.length === 0) {
        return 1.0;
      }
      
      // Levenshtein 거리 계산
      const levenshteinDistance = (s1: string, s2: string) => {
        const costs: number[] = [];
        
        for (let i = 0; i <= s1.length; i++) {
          let lastValue = i;
          for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
              costs[j] = j;
            } else if (j > 0) {
              let newValue = costs[j - 1];
              if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
              }
              costs[j - 1] = lastValue;
              lastValue = newValue;
            }
          }
          if (i > 0) {
            costs[s2.length] = lastValue;
          }
        }
        return costs[s2.length];
      };
      
      const distance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
      return (longer.length - distance) / longer.length;
    };

    // 1. 자체상품코드 유사도 (가중치: 40%)
    const codeWeight = 0.4;
    let codeSimilarity = 0;
    
    if (returnItem.customProductCode && product.customProductCode) {
      codeSimilarity = simpleSimilarity(
        returnItem.customProductCode, 
        product.customProductCode
      );
    } else if (returnItem.customProductCode && product.zigzagProductCode) {
      codeSimilarity = simpleSimilarity(
        returnItem.customProductCode, 
        product.zigzagProductCode
      );
    } else if (returnItem.zigzagProductCode && product.zigzagProductCode) {
      codeSimilarity = simpleSimilarity(
        returnItem.zigzagProductCode, 
        product.zigzagProductCode
      );
    }
    
    // 2. 사입상품명 유사도 (가중치: 40%)
    const nameWeight = 0.4;
    let nameSimilarity = 0;
    
    if (returnItem.purchaseName && product.purchaseName) {
      nameSimilarity = simpleSimilarity(
        returnItem.purchaseName,
        product.purchaseName
      );
    } else if (returnItem.productName && product.purchaseName) {
      nameSimilarity = simpleSimilarity(
        returnItem.productName,
        product.purchaseName
      );
    } else if (returnItem.productName && product.productName) {
      nameSimilarity = simpleSimilarity(
        returnItem.productName,
        product.productName
      );
    }
    
    // 3. 옵션명 유사도 (가중치: 20%)
    const optionWeight = 0.2;
    let optionSimilarity = 0;
    
    if (returnItem.optionName && product.optionName) {
      optionSimilarity = simpleSimilarity(
        returnItem.optionName,
        product.optionName
      );
    }
    
    // 가중 평균으로 최종 유사도 계산
    const weightedSimilarity = 
      (codeSimilarity * codeWeight) + 
      (nameSimilarity * nameWeight) + 
      (optionSimilarity * optionWeight);
    
    console.log(`유사도 계산: 자체상품코드(${Math.round(codeSimilarity * 100)}%) x 40% + 사입상품명(${Math.round(nameSimilarity * 100)}%) x 40% + 옵션명(${Math.round(optionSimilarity * 100)}%) x 20% = ${Math.round(weightedSimilarity * 100)}%`);
    
    return weightedSimilarity;
  }

  // 기존 calculateSimilarity 함수는 유지 (기존 코드에서 사용 중인 부분이 있을 수 있음)
  function calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) {
      return 1.0;
    }
    
    // Levenshtein 거리 계산
    const levenshteinDistance = (s1: string, s2: string) => {
      const costs: number[] = [];
      
      for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
          if (i === 0) {
            costs[j] = j;
          } else if (j > 0) {
            let newValue = costs[j - 1];
            if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
              newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
            }
            costs[j - 1] = lastValue;
            lastValue = newValue;
          }
        }
        if (i > 0) {
          costs[s2.length] = lastValue;
        }
      }
      return costs[s2.length];
    };
    
    const distance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
    return (longer.length - distance) / longer.length;
  }

  // 새로고침 함수에 자체상품코드 매칭 및 중복 제거 로직 개선
  const handleRefresh = () => {
    // 기존 데이터 로딩
    setLoading(true);
    setMessage('데이터를 새로고침 중입니다...');
    
    // 중복 반품 항목 체크 및 제거 - 입고완료 목록과 대기 목록 포함
    if (returnState.pendingReturns.length > 0) {
      console.log('중복 항목 제거 및 매칭 시작');
      
      // 입고완료 목록의 키 셋 생성 (중복 체크용)
      const completedKeys = new Set(returnState.completedReturns.map(item => 
        `${item.customerName}_${item.orderNumber}_${item.purchaseName || item.productName}_${item.optionName}_${item.returnTrackingNumber}`
      ));
      
      // 자체상품코드+옵션명 기준 중복 체크 맵
      const productCodeMap = new Map<string, boolean>();
      returnState.completedReturns.forEach(item => {
        if (item.customProductCode && item.optionName) {
          const key = `${item.customProductCode}_${item.optionName}`;
          productCodeMap.set(key, true);
        }
      });
      
      console.log(`입고완료 목록에서 ${completedKeys.size}개 항목, ${productCodeMap.size}개 자체상품코드 조합 발견`);
      
      const uniqueMap = new Map<string, ReturnItem>();
      const duplicates: ReturnItem[] = [];
      
      // 대기 항목 처리 - 입고완료 목록에 없는 항목만 추가
      returnState.pendingReturns.forEach(item => {
        // 기본 중복 키 (고객명_주문번호_상품명_옵션명_송장번호)
        const key = `${item.customerName}_${item.orderNumber}_${item.purchaseName || item.productName}_${item.optionName}_${item.returnTrackingNumber}`;
        
        // 자체상품코드 + 옵션명 기준 중복 체크
        const productCodeKey = item.customProductCode && item.optionName ? 
          `${item.customProductCode}_${item.optionName}` : null;
        
        // 중복 체크 (입고완료 목록)
        if (completedKeys.has(key)) {
          console.log(`중복 항목 제외 (이미 입고완료): ${key}`);
          duplicates.push(item);
          return;
        }
        
        // 자체상품코드 + 옵션명 기준 중복 체크
        if (productCodeKey && productCodeMap.has(productCodeKey)) {
          console.log(`중복 항목 제외 (자체상품코드+옵션명): ${productCodeKey}`);
          duplicates.push(item);
          return;
        }
        
        // 중복 시 기존 항목 유지 (먼저 추가된 항목 우선)
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, item);
          // 자체상품코드 + 옵션명 기준 키도 등록
          if (productCodeKey) {
            productCodeMap.set(productCodeKey, true);
          }
        } else {
          console.log(`대기 목록 내 중복 항목 제외: ${key}`);
          duplicates.push(item);
        }
      });
      
      const uniquePendingReturns = Array.from(uniqueMap.values());
      const removedCount = returnState.pendingReturns.length - uniquePendingReturns.length;
      
      console.log(`중복 제거 결과: 원본 ${returnState.pendingReturns.length}개 항목 중 ${uniquePendingReturns.length}개 유지, ${removedCount}개 제거`);
      if (duplicates.length > 0) {
        console.log('제거된 중복 항목:', duplicates.map(item => 
          `${item.customerName}/${item.productName}/${item.customProductCode || '코드없음'}`
        ));
      }
      
      // 중복 제거된 목록으로 업데이트
      if (removedCount > 0) {
        dispatch({
          type: 'SET_RETURNS',
          payload: {
            ...returnState,
            pendingReturns: uniquePendingReturns
          }
        });
      }
    }
    
    // 자체상품코드 기준 매칭 시도
    if (returnState.pendingReturns.length > 0 && returnState.products.length > 0) {
      console.log(`=== 자체상품코드 및 바코드 매칭 시작 (${returnState.pendingReturns.length}개 항목) ===`);
      
      // 기존 매칭된 항목 수 계산
      const beforeMatchCount = returnState.pendingReturns.filter(item => item.barcode && item.barcode !== '-').length;
      console.log(`매칭 전: ${beforeMatchCount}개 항목 매칭됨, ${returnState.pendingReturns.length - beforeMatchCount}개 미매칭`);
      
      // 향상된 매칭 로직 적용
      const matchResults: {
        item: ReturnItem;
        matched: boolean;
        type: string;
        similarity: number;
      }[] = [];
      
      const matchedReturns = returnState.pendingReturns.map(item => {
        // 이미 바코드가 있으면 건너뜀
        if (item.barcode && item.barcode !== '-') {
          matchResults.push({
            item,
            matched: true,
            type: 'existing',
            similarity: 1.0
          });
          return item;
        }
        
        // 매칭 시도
        const matchedItem = matchProductByZigzagCode(item, returnState.products);
        
        // 매칭 결과 로그
        if (matchedItem.barcode && matchedItem.barcode !== '-') {
          console.log(`매칭 성공: ${item.productName || item.purchaseName} → ${matchedItem.purchaseName} (바코드: ${matchedItem.barcode}, 유사도: ${Math.round((matchedItem.matchSimilarity || 0) * 100)}%)`);
          matchResults.push({
            item: matchedItem,
            matched: true,
            type: matchedItem.matchType || 'unknown',
            similarity: matchedItem.matchSimilarity || 0
          });
        } else {
          console.log(`매칭 실패: ${item.productName || item.purchaseName}`);
          matchResults.push({
            item,
            matched: false,
            type: 'no_match',
            similarity: 0
          });
        }
        
        return matchedItem;
      });
      
      // 매칭 결과가 있으면 상태 업데이트
      const afterMatchCount = matchedReturns.filter(item => item.barcode && item.barcode !== '-').length;
      const matchedCount = afterMatchCount - beforeMatchCount;
      
      // 매칭 통계 출력
      const matchTypes = matchResults.reduce((acc, result) => {
        if (result.matched) {
          acc[result.type] = (acc[result.type] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);
      
      console.log('=== 매칭 결과 통계 ===');
      console.log(`총 항목: ${matchResults.length}개`);
      console.log(`매칭됨: ${afterMatchCount}개 (${matchedCount}개 신규 매칭)`);
      console.log(`미매칭: ${matchResults.length - afterMatchCount}개`);
      console.log('매칭 유형별 통계:');
      Object.entries(matchTypes).forEach(([type, count]) => {
        console.log(`- ${type}: ${count}개`);
      });
      
      if (matchedCount > 0) {
        console.log(`새로고침 결과: ${matchedCount}개 상품이 자동 매칭됨`);
        
        dispatch({
          type: 'SET_RETURNS',
          payload: {
            ...returnState,
            pendingReturns: matchedReturns
          }
        });
        
        setMessage(`새로고침 완료: ${matchedCount}개 상품이 자동 매칭되었습니다.`);
      } else {
        setMessage('새로고침 완료. 매칭할 상품이 없습니다.');
      }
    } else {
      setMessage('새로고침 완료.');
    }
    
    setTimeout(() => {
      setLoading(false);
    }, 500);
  };
  
  // 입고완료 테이블 컴포넌트
  const CompletedItemsTable = ({ items }: { items: ReturnItem[] }) => (
    <table className="min-w-full border-collapse">
      <thead>
        <tr className="bg-gray-50">
          <th className="px-2 py-2 border-x border-gray-300">
            <input 
              type="checkbox" 
              checked={selectAllCompleted}
              onChange={handleSelectAllCompleted}
            />
          </th>
          <th className="px-2 py-2 border-x border-gray-300 w-24">고객명</th>
          <th className="px-2 py-2 border-x border-gray-300">주문번호</th>
          <th className="px-2 py-2 border-x border-gray-300">사입상품명</th>
          <th className="px-2 py-2 border-x border-gray-300">옵션명</th>
          <th className="px-2 py-2 border-x border-gray-300 w-12">수량</th>
          <th className="px-2 py-2 border-x border-gray-300">반품사유</th>
          <th className="px-2 py-2 border-x border-gray-300">반품송장</th>
          <th className="px-2 py-2 border-x border-gray-300">바코드번호</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, index) => (
          <tr key={item.id} className={`border-t border-gray-300 hover:bg-gray-50 ${isDefective(item.returnReason) ? 'text-red-500' : ''}`}>
            <td className="px-2 py-2 border-x border-gray-300">
              <input 
                type="checkbox" 
                checked={selectedCompletedItems.includes(index)}
                onClick={(e: React.MouseEvent<HTMLInputElement>) => {
                  e.stopPropagation();
                  handleCompletedCheckboxChange(index, e.shiftKey);
                }}
                onChange={() => {}} // React 경고 방지용 빈 핸들러
              />
            </td>
            <td className="px-2 py-2 border-x border-gray-300 whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">
              {item.customerName}
            </td>
            <td className="px-2 py-2 border-x border-gray-300 whitespace-nowrap overflow-hidden text-ellipsis">
              {item.orderNumber}
            </td>
            <td className="px-2 py-2 border-x border-gray-300">
              <div className={!item.barcode ? "whitespace-normal break-words line-clamp-2" : "whitespace-nowrap overflow-hidden text-ellipsis"}>
                {getPurchaseNameDisplay(item)}
              </div>
            </td>
            <td className="px-2 py-2 border-x border-gray-300 whitespace-nowrap overflow-hidden text-ellipsis">
              {item.optionName}
            </td>
            <td className="px-2 py-2 border-x border-gray-300 whitespace-nowrap text-center">
              {item.quantity}
            </td>
            <td 
              className="px-2 py-2 border-x border-gray-300 whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px] cursor-pointer"
              onClick={() => isDefective(item.returnReason) && handleReturnReasonClick(item)}
            >
              {getReturnReasonDisplay(item)}
            </td>
            <td className="px-2 py-2 border-x border-gray-300">
              <span className="font-mono text-sm whitespace-nowrap">{item.returnTrackingNumber || '-'}</span>
            </td>
            <td className="px-2 py-2 border-x border-gray-300">
              <span className="font-mono text-sm whitespace-nowrap">{item.barcode || '-'}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  // 모달 z-index 관리를 위한 상태 추가
  const [modalLevel, setModalLevel] = useState(0);
  const [modalStack, setModalStack] = useState<string[]>([]);

  // 입고완료 날짜 관련 상태 추가
  const [currentDateIndex, setCurrentDateIndex] = useState(0);
  const [currentDate, setCurrentDate] = useState('');
  const [availableDates, setAvailableDates] = useState<string[]>([]);

  // 전역 z-index 관리 변수
  let globalZIndex = 9000;

  // 모달 스택 관리를 위한 함수 - z-index 문제 해결
  const openModal = (modalId: string) => {
    // 이미 열려있는 경우 최상위로 가져오기
    if (modalStack.includes(modalId)) {
      // 스택에서 해당 모달을 제거하고 맨 위로 이동
      setModalStack(prev => [...prev.filter(id => id !== modalId), modalId]);
      
      // 해당 모달에 z-index 재설정
      const modal = document.getElementById(modalId) as HTMLDialogElement;
      if (modal) {
        globalZIndex += 10;
        modal.style.zIndex = String(globalZIndex);
        console.log(`기존 모달 ${modalId} 최상위로 이동: z-index ${globalZIndex}`);
      }
      return;
    }
    
    // 새 모달 추가
    globalZIndex += 10;
    console.log(`모달 ${modalId} 열기: z-index ${globalZIndex} 적용`);
    
    setModalStack(prev => [...prev, modalId]);
    setModalLevel(prev => prev + 10);
    
    const modal = document.getElementById(modalId) as HTMLDialogElement;
    if (modal) {
      // z-index 설정 - 반드시 모달이 열리기 전에 설정해야 함
      modal.style.zIndex = String(globalZIndex);
      modal.style.position = 'fixed';
      
      // CSS 애니메이션 설정
      modal.style.transition = 'all 0.2s ease-in-out';
      modal.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.2)';
      
      // backdrop 스타일 설정 - backdrop이 모달 뒤에 오도록
      const backdropZIndex = globalZIndex - 1;
      modal.addEventListener('click', (e) => {
        const rect = modal.getBoundingClientRect();
        const isInDialog = (e.clientX >= rect.left && e.clientX <= rect.right &&
                          e.clientY >= rect.top && e.clientY <= rect.bottom);
        if (!isInDialog) {
          closeModal(modalId);
        }
      });
      
      // 모달 열기
      modal.showModal();
      
      // 모달이 열린 후에도 z-index 유지되는지 확인
      setTimeout(() => {
        if (modal && modal.open) {
          // 한번 더 확인
          if (modal.style.zIndex !== String(globalZIndex)) {
            modal.style.zIndex = String(globalZIndex);
            console.log(`모달 ${modalId} z-index 재적용: ${globalZIndex}`);
          }
        }
      }, 100);
      
      // 포커스 설정 강화
      setTimeout(() => {
        const focusableElement = modal.querySelector(
          'button, [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        ) as HTMLElement;
        
        if (focusableElement) {
          focusableElement.focus();
        } else {
          modal.focus();
        }
      }, 150);
    }
  };

  // 모달 닫기 함수 개선
  const closeModal = (modalId: string | React.RefObject<HTMLDialogElement>) => {
    if (typeof modalId === 'string') {
      setModalStack(prev => prev.filter(id => id !== modalId));
      const modal = document.getElementById(modalId) as HTMLDialogElement;
      if (modal) modal.close();
    } else if (modalId.current) {
      // ref를 사용하는 경우 modalId를 실제 ID로 변환하여 스택에서 제거
      const modalElement = modalId.current;
      const modalId2 = modalElement.id || '';
      setModalStack(prev => prev.filter(id => id !== modalId2));
      modalId.current.close();
    }
    setModalLevel(prev => Math.max(0, prev - 10));
    
    // 남아있는 최상위 모달을 앞으로 가져오기
    if (modalStack.length > 0) {
      const topModalId = modalStack[modalStack.length - 1];
      const topModal = document.getElementById(topModalId) as HTMLDialogElement;
      if (topModal) {
        globalZIndex += 5;
        topModal.style.zIndex = String(globalZIndex);
        console.log(`최상위 모달 ${topModalId}로 포커스 이동: z-index ${globalZIndex}`);
        topModal.focus();
      }
    }
  };

  // dialog 요소의 스타일 초기화를 위한 함수
  useEffect(() => {
    // 모달 스타일 적용
    const styleElement = document.createElement('style');
    styleElement.innerHTML = `
      dialog {
        position: fixed !important;
        margin: auto !important;
        border: none !important;
        border-radius: 0.5rem !important;
        padding: 1rem !important;
        background: white !important;
        max-width: 95vw !important;
        max-height: 90vh !important;
        overflow: auto !important;
      }
      dialog::backdrop {
        background-color: rgba(0, 0, 0, 0.4) !important;
      }
      .popup-layer {
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2) !important;
      }
    `;
    document.head.appendChild(styleElement);
    
    // 컴포넌트 언마운트 시 스타일 제거
    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  // 날짜 데이터 초기화
  useEffect(() => {
    if (returnState.completedReturns.length > 0) {
      const dates = [...new Set(returnState.completedReturns.map(item => 
        new Date(item.completedAt!).toLocaleDateString()
      ))].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      
      setAvailableDates(dates);
      setCurrentDate(dates[0] || '');
      setCurrentDateIndex(0);
    }
  }, [returnState.completedReturns]);

  // 현재 표시할 완료된 반품 아이템
  const currentDateItems = useMemo(() => {
    if (!currentDate || isSearching) return [];
    
    return returnState.completedReturns.filter(item => 
      new Date(item.completedAt!).toLocaleDateString() === currentDate
    );
  }, [returnState.completedReturns, currentDate, isSearching]);

  // 날짜 이동 함수 개선
  const navigateToDate = (direction: 'prev' | 'next') => {
    if (availableDates.length === 0) return;
    
    let newIndex: number;
    if (direction === 'prev' && currentDateIndex < availableDates.length - 1) {
      newIndex = currentDateIndex + 1;
    } else if (direction === 'next' && currentDateIndex > 0) {
      newIndex = currentDateIndex - 1;
    } else {
      // 범위를 벗어날 경우 순환
      newIndex = direction === 'prev' ? 0 : availableDates.length - 1;
    }
    
    setCurrentDateIndex(newIndex);
    setCurrentDate(availableDates[newIndex]);
    setMessage(`${new Date(availableDates[newIndex]).toLocaleDateString('ko-KR')} 날짜의 데이터로 이동했습니다.`);
  };

  // 날짜 이동 핸들러 수정
  const handleDateNavigation = (direction: 'prev' | 'next') => {
    navigateToDate(direction);
  };
  
  // 반품 사유와 상세 사유 표시를 위한 함수 추가
  const getReturnReasonDisplay = (item: ReturnItem): string => {
    // 기본 반품 사유
    let displayText = item.returnReason;
    
    // 상세 사유가 있고, 기본 반품 사유에 이미 포함되어 있지 않은 경우에만 추가
    if (item.detailReason && item.detailReason.trim() !== '') {
      // 반품 사유에 상세 사유가 이미 포함되어 있는지 확인
      if (!displayText.toLowerCase().includes(item.detailReason.toLowerCase())) {
        displayText += ` (${item.detailReason})`;
      }
    }
    
    return displayText;
  };

  // 모달 외부 클릭 처리 함수 추가
  const handleOutsideClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    const dialogDimensions = e.currentTarget.getBoundingClientRect();
    if (
      e.clientX < dialogDimensions.left ||
      e.clientX > dialogDimensions.right ||
      e.clientY < dialogDimensions.top ||
      e.clientY > dialogDimensions.bottom
    ) {
      e.currentTarget.close();
      // 모달 스택에서 제거
      const modalId = e.currentTarget.id;
      if (modalId) {
        setModalStack(prev => prev.filter(id => id !== modalId));
        setModalLevel(prev => Math.max(0, prev - 10));
      }
    }
  };

  // 매칭 상품 종류 표시를 위한 함수 (중복 정의 제거)
  const getPurchaseNameString = (item: ReturnItem): string => {
    // 이미 매칭된 값이 있으면 그 값 사용
    if (item.purchaseName) return item.purchaseName;
    
    // 없으면 상품명 사용
    return item.productName || '상품명 없음';
  };

  // Firebase 저장 함수 추가
  const handleSaveToFirebase = () => {
    setLoading(true);
    setMessage('Firebase에 데이터를 저장 중입니다...');
    
    // 저장 로직 구현 필요
    setTimeout(() => {
      setLoading(false);
      setMessage('Firebase에 데이터 저장이 완료되었습니다.');
    }, 1000);
  };

  // 데이터 파일 업로드 핸들러 추가
  const handleProductFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFileUpload(event, 'products');
  };

  const handleReturnFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFileUpload(event, 'returns');
  };

  // 송장 검색 관련 상태 및 함수
  const [trackingSearch, setTrackingSearch] = useState('');
  const [trackingSearchResult, setTrackingSearchResult] = useState<ReturnItem | null>(null);

  // 송장번호 검색 이벤트 핸들러 개선 - Enter 키 입력 시 바로 입고 처리
  const handleTrackingKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (!trackingSearch.trim()) {
        setMessage('송장번호를 입력해주세요.');
        return;
      }
      
      // Enter 키 입력 시 바로 입고 처리 호출
      handleReceiveByTracking();
    }
  };

  // 송장번호로 상품 입고 처리 개선 - 동일 송장번호 일괄 처리
  const handleReceiveByTracking = () => {
    const searchTerm = trackingSearch.trim();
    if (!searchTerm) {
      setMessage('송장번호를 입력해주세요.');
      return;
    }
    
    // 동일한 송장번호를 가진 모든 항목 찾기
    const matchingItems = returnState.pendingReturns.filter(item => 
      item.returnTrackingNumber === searchTerm
    );
    
    if (matchingItems.length === 0) {
      setMessage(`'${searchTerm}' 송장번호로 등록된 반품이 없습니다.`);
      setTrackingSearch(''); // 입력 필드 초기화
      setTrackingSearchResult(null);
      return;
    }
    
    setLoading(true);
    setMessage(`${matchingItems.length}개 상품 입고 처리 중입니다...`);
    
    // 현재 날짜의 자정(00:00:00)으로 설정하여 같은 날짜로 그룹화
    const today = new Date();
    const now = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    
    // 입고완료로 처리할 항목들
    const completedItems = matchingItems.map(item => ({
      ...item,
      status: 'COMPLETED' as 'PENDING' | 'COMPLETED',
      completedAt: now
    }));
    
    // 입고완료 목록에 추가
    const updatedCompletedReturns = [
      ...completedItems,
      ...returnState.completedReturns
    ];
    
    // 대기 목록에서 제거
    const updatedPendingReturns = returnState.pendingReturns.filter(
      item => item.returnTrackingNumber !== searchTerm
    );
    
    // 상태 업데이트
    dispatch({
      type: 'SET_RETURNS',
      payload: {
        ...returnState,
        pendingReturns: updatedPendingReturns,
        completedReturns: updatedCompletedReturns
      }
    });
    
    // 처리 완료 후 입력 필드 초기화 및 결과 메시지 표시
    setTimeout(() => {
      setLoading(false);
      setTrackingSearch(''); // 입력 필드 초기화
      setTrackingSearchResult(null);
      setMessage(`${matchingItems.length}개 상품이 입고 처리되었습니다. (송장번호: ${searchTerm})`);
    }, 500);
  };

  // 송장번호 입력 취소 핸들러
  const handleCancelTrackingInput = () => {
    setTrackingSearch('');
    setTrackingSearchResult(null);
    setMessage('송장번호 입력이 취소되었습니다.');
  };

  // 선택된 항목 삭제 핸들러
  const handleDeleteSelected = () => {
    if (selectedItems.length === 0) {
      setMessage('삭제할 항목을 선택해주세요.');
      return;
    }

    setLoading(true);
    setMessage(`${selectedItems.length}개 항목을 삭제 중입니다...`);
    
    // 삭제 로직 구현 필요
    setTimeout(() => {
      // 선택된 항목 제외한 목록으로 업데이트
      const updatedReturns = returnState.pendingReturns.filter((_, index) => !selectedItems.includes(index));
      
      dispatch({
        type: 'SET_RETURNS',
        payload: {
          ...returnState,
          pendingReturns: updatedReturns
        }
      });
      
      setSelectedItems([]);
      setLoading(false);
      setMessage(`${selectedItems.length}개 항목이 삭제되었습니다.`);
    }, 1000);
  };

  // 상품 매칭을 위한 상태 추가
  const [selectedProductForMatch, setSelectedProductForMatch] = useState<ReturnItem | null>(null);

  // 상품 매칭 핸들러
  const handleProductMatch = (returnItem: ReturnItem, product?: ProductInfo) => {
    if (product) {
      // 이미 product 객체가 전달된 경우 (매칭 모달에서 매칭 버튼 클릭 시)
      // 선택한 상품 정보로 해당 아이템 업데이트
      const updatedItem: ReturnItem = {
        ...returnItem,
        barcode: product.barcode,
        purchaseName: product.purchaseName || product.productName,
        zigzagProductCode: product.zigzagProductCode || '',
        customProductCode: product.customProductCode || product.zigzagProductCode || '',
        matchType: "manual_match",
        matchSimilarity: 1.0,
        matchedProductName: product.productName
      };
      
      // 상태 업데이트 (PENDING 항목 또는 COMPLETED 항목에 따라 처리)
      if (returnItem.status === 'PENDING') {
        dispatch({ 
          type: 'UPDATE_PENDING_RETURN', 
          payload: updatedItem 
        });
      } else if (returnItem.status === 'COMPLETED') {
        // completed 리스트의 아이템을 업데이트
        const updatedCompleted = returnState.completedReturns.map(item => 
          item.id === returnItem.id ? updatedItem : item
        );
        
        dispatch({ 
          type: 'SET_RETURNS', 
          payload: {
            ...returnState,
            completedReturns: updatedCompleted
          } 
        });
      }
      
      // 매칭 성공 메시지 표시
      setMessage(`'${returnItem.productName}' 상품이 '${product.purchaseName || product.productName}'와 매칭되었습니다.`);
      
      // 매칭 모달 닫기
      setShowProductMatchModal(false);
      setCurrentMatchItem(null);
    } else {
      // product 객체가 없는 경우 (상품 매칭 모달 열기)
      setCurrentMatchItem(returnItem);
      setShowProductMatchModal(true);
      // z-index 증가
      setModalLevel(prev => prev + 10);
    }
  };

  // 입고완료 항목을 입고전으로 되돌리는 함수
  const handleRevertSelectedCompleted = () => {
    if (selectedCompletedItems.length === 0) return;
    
    setLoading(true);
    
    // 선택된 항목들
    const selectedItems = selectedCompletedItems.map(index => currentDateItems[index]);
    
    // 입고전으로 되돌릴 항목들 (completedAt과 status 제거)
    const revertedItems = selectedItems.map(item => {
      const { completedAt, status, ...rest } = item;
      return {
        ...rest,
        status: 'PENDING' as const
      };
    });
    
    // 입고완료 목록에서 선택된 항목 제거
    const newCompletedReturns = returnState.completedReturns.filter(item => 
      !selectedItems.some(selected => 
        selected.orderNumber === item.orderNumber &&
        selected.productName === item.productName &&
        selected.optionName === item.optionName &&
        selected.returnTrackingNumber === item.returnTrackingNumber
      )
    );
    
    // 상태 업데이트
    dispatch({
      type: 'SET_RETURNS',
      payload: {
        ...returnState,
        pendingReturns: [...returnState.pendingReturns, ...revertedItems],
        completedReturns: newCompletedReturns
      }
    });
    
    setMessage(`${selectedCompletedItems.length}개의 항목이 입고전 목록으로 되돌아갔습니다.`);
    setSelectedCompletedItems([]);
    setSelectAllCompleted(false);
    setLoading(false);
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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-6">
        <button
          className={`px-4 py-2 text-white rounded ${buttonColors.testButton}`}
          onClick={testFirebaseConnection}
          disabled={loading}
        >
          서버 연결 테스트
        </button>
        
        <button
          className={`px-4 py-2 text-white rounded ${buttonColors.firebaseButton}`}
          onClick={handleSaveToFirebase}
          disabled={loading}
        >
          Firebase 저장
        </button>
        
        <label
          className={`px-4 py-2 text-white rounded text-center cursor-pointer ${buttonColors.productButton}`}
          htmlFor="productFile"
        >
          상품 업로드
          <input
            type="file"
            id="productFile"
            accept=".xlsx,.xls"
            onChange={handleProductFileUpload}
            ref={productFileRef}
            className="hidden"
            disabled={loading}
          />
        </label>
        
        <label
          className={`px-4 py-2 text-white rounded text-center cursor-pointer ${buttonColors.returnButton}`}
          htmlFor="returnFile"
        >
          반품 업로드
          <input
            type="file"
            id="returnFile"
            accept=".xlsx,.xls"
            onChange={handleReturnFileUpload}
            ref={returnFileRef}
            className="hidden"
            disabled={loading}
          />
        </label>
        
        <button
          className={`px-4 py-2 text-white rounded ${buttonColors.productListButton}`}
          onClick={() => productModalRef.current?.showModal()}
          disabled={loading}
        >
          상품 목록
        </button>
        
        <button
          className={`px-4 py-2 text-white rounded ${buttonColors.pendingButton}`}
          onClick={() => pendingModalRef.current?.showModal()}
          disabled={loading}
        >
          입고전 ({returnState.pendingReturns.length})
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
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">선택</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">고객명</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">주문번호</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">사입상품명</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">옵션</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">수량</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">반품사유</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">송장번호</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">바코드번호</th>
                    {/* <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">자체상품코드</th> */}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {returnState.pendingReturns.map((item, index) => (
                    <tr key={item.id} className={getRowStyle(item, index, returnState.pendingReturns)}>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selectedItems.includes(index)}
                          onClick={(e: React.MouseEvent<HTMLInputElement>) => {
                            e.stopPropagation();
                            handleCheckboxChange(index, e.shiftKey);
                          }}
                          onChange={() => {}} // React 경고 방지용 빈 핸들러
                          className="w-5 h-5"
                        />
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">
                        {item.customerName}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap overflow-hidden text-ellipsis">
                        {item.orderNumber}
                      </td>
                      <td className="px-2 py-2">
                        <div className={!item.barcode ? "whitespace-normal break-words line-clamp-2" : "whitespace-nowrap overflow-hidden text-ellipsis"}>
                          {getPurchaseNameDisplay(item)}
                        </div>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap overflow-hidden text-ellipsis">
                        {item.optionName}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-center">
                        {item.quantity}
                      </td>
                      <td className="px-2 py-2">
                        <div 
                          className={`cursor-pointer ${isDefective(item.returnReason) ? 'text-red-500' : ''} whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]`}
                          onClick={() => isDefective(item.returnReason) && handleReturnReasonClick(item)}
                        >
                          {simplifyReturnReason(item.returnReason)}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-mono text-sm whitespace-nowrap">
                          {item.returnTrackingNumber || '-'}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-mono text-sm whitespace-nowrap">
                          {item.barcode || '-'}
                        </span>
                      </td>
                      {/* <td className="px-2 py-2">
                        <span className="font-mono text-sm whitespace-nowrap">
                          {item.zigzagProductCode || '-'}
                        </span>
                      </td> */}
                    </tr>
                  ))}
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
              <table className="min-w-full border-collapse border border-gray-300">
                <thead className="sticky top-0 bg-white">
                  <tr className="bg-gray-100">
                    <th className="px-2 py-2 border-x border-gray-300">번호</th>
                    <th className="px-2 py-2 border-x border-gray-300">사입상품명</th>
                    <th className="px-2 py-2 border-x border-gray-300">상품명</th>
                    <th className="px-2 py-2 border-x border-gray-300">옵션명</th>
                    <th className="px-2 py-2 border-x border-gray-300">바코드번호</th>
                    <th className="px-2 py-2 border-x border-gray-300">자체상품코드</th>
                  </tr>
                </thead>
                <tbody>
                  {returnState.products.map((item, index) => (
                    <tr key={item.id} className="border-t border-gray-300 hover:bg-gray-50">
                      <td className="px-2 py-2 border-x border-gray-300">{index + 1}</td>
                      <td className="px-2 py-2 border-x border-gray-300">{item.purchaseName || '-'}</td>
                      <td className="px-2 py-2 border-x border-gray-300">{item.productName}</td>
                      <td className="px-2 py-2 border-x border-gray-300">{item.optionName || '-'}</td>
                      <td className="px-2 py-2 border-x border-gray-300 font-mono">{item.barcode}</td>
                      <td className="px-2 py-2 border-x border-gray-300">{item.zigzagProductCode || '-'}</td>
                    </tr>
                  ))}
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