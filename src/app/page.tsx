'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ReturnItem, ReturnState, ProductInfo } from '@/types/returns';
import { parseProductExcel, parseReturnExcel } from '@/utils/excel';
import { updateReturns, fetchReturns } from '@/firebase/firestore';
import * as XLSX from 'xlsx';
import { db, app } from '@/firebase/config';
import { collection, getDocs, query, limit } from 'firebase/firestore';

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
  const commonWords = words1.filter(word => words2.some(w => w.includes(word) || word.includes(w)));
  
  // 공통 키워드가 없으면 유사하지 않음
  if (commonWords.length === 0) return false;
  
  // 공통 키워드가 전체 키워드의 25% 이상이면 유사하다고 판단 (임계값 낮춤)
  const totalUniqueWords = new Set([...words1, ...words2]).size;
  return commonWords.length / totalUniqueWords >= 0.25;
}

// 상품 데이터와 반품 데이터 매칭 함수
function matchProductData(returnItem: ReturnItem, products: ProductInfo[]): ReturnItem {
  try {
    // 이미 바코드가 있으면 그대로 반환
    if (returnItem.barcode) {
      console.log(`이미 바코드 있음: ${returnItem.barcode}`);
      return returnItem;
    }
    
    if (!returnItem.productName) {
      console.log(`상품명이 없음, 매칭 불가`);
      return returnItem;
    }
    
    console.log(`매칭 시작: ${returnItem.productName}`);
    
    // 1. 바코드 정확 매칭 시도 (가장 높은 우선순위)
    if (returnItem.barcode) {
      const exactBarcodeMatch = products.find(p => p.barcode === returnItem.barcode);
      if (exactBarcodeMatch) {
        console.log(`바코드 정확 매칭 성공: ${returnItem.barcode}`);
        return {
          ...returnItem,
          purchaseName: exactBarcodeMatch.purchaseName || exactBarcodeMatch.productName,
          barcode: exactBarcodeMatch.barcode,
          optionName: returnItem.optionName // 원래 옵션명 유지
        };
      }
    }
    
    // 2. 자체상품코드 정확 매칭 시도 (두 번째 우선순위)
    if (returnItem.zigzagProductCode && returnItem.zigzagProductCode !== '-') {
      const exactZigzagMatch = products.find(p => 
        p.zigzagProductCode && p.zigzagProductCode === returnItem.zigzagProductCode
      );
      
      if (exactZigzagMatch) {
        console.log(`자체상품코드 정확 매칭 성공: ${returnItem.zigzagProductCode}`);
        return {
          ...returnItem,
          productName: returnItem.productName || exactZigzagMatch.productName,
          purchaseName: exactZigzagMatch.purchaseName || exactZigzagMatch.productName,
          barcode: exactZigzagMatch.barcode,
          optionName: returnItem.optionName // 원래 옵션명 유지
        };
      }
    }
    
    // 3. 상품명 완전일치 시도 (정확도 높음)
    const exactNameMatch = products.find(p => 
      p.productName && p.productName.toLowerCase().trim() === returnItem.productName.toLowerCase().trim()
    );
    
    if (exactNameMatch) {
      console.log(`상품명 완전일치 매칭 성공: ${returnItem.productName}`);
      return {
        ...returnItem,
        purchaseName: exactNameMatch.purchaseName || exactNameMatch.productName,
        barcode: exactNameMatch.barcode,
        optionName: returnItem.optionName // 원래 옵션명 유지
      };
    }
    
    // 4. 상품명과 사입상품명 간의 유사도 매칭 시도
    let bestMatchByName: ProductInfo | null = null;
    let highestSimilarityByName = 0;
    
    for (const product of products) {
      if (product.purchaseName && returnItem.productName) {
        const similarity = stringSimilarity(returnItem.productName, product.purchaseName);
        
        // 유사도가 0.55 이상이고 키워드 검증도 통과하는 경우만 매칭 (임계값 낮춤)
        if (similarity > highestSimilarityByName && similarity >= 0.55 && 
            validateKeywordSimilarity(returnItem.productName, product.purchaseName)) {
          highestSimilarityByName = similarity;
          bestMatchByName = product;
        }
      }
    }
    
    if (bestMatchByName) {
      console.log(`상품명-사입상품명 매칭 성공: 유사도 ${highestSimilarityByName.toFixed(2)}`);
      
      // 옵션명 매칭 시도 (상품명 매칭이 성공한 경우)
      if (returnItem.optionName && bestMatchByName.optionName) {
        // 같은 상품 중에서 옵션명이 가장 유사한 항목 찾기
        let bestOptionMatch = bestMatchByName;
        let highestOptionSimilarity = stringSimilarity(returnItem.optionName, bestMatchByName.optionName);
        
        // 같은 상품명을 가진 다른 상품들 중에서 옵션명이 더 유사한 것이 있는지 확인
        const sameProducts = products.filter(p => 
          p.purchaseName === bestMatchByName?.purchaseName || 
          p.productName === bestMatchByName?.productName
        );
        
        for (const product of sameProducts) {
          if (product.optionName) {
            const optionSimilarity = stringSimilarity(returnItem.optionName, product.optionName);
            if (optionSimilarity > highestOptionSimilarity && optionSimilarity >= 0.5) {
              highestOptionSimilarity = optionSimilarity;
              bestOptionMatch = product;
            }
          }
        }
        
        if (bestOptionMatch !== bestMatchByName && highestOptionSimilarity >= 0.5) {
          console.log(`옵션명 매칭 개선: 유사도 ${highestOptionSimilarity.toFixed(2)}`);
          return {
            ...returnItem,
            purchaseName: bestOptionMatch.purchaseName || bestOptionMatch.productName,
            barcode: bestOptionMatch.barcode,
            optionName: returnItem.optionName // 원래 옵션명 유지
          };
        }
      }
      
      return {
        ...returnItem,
        purchaseName: bestMatchByName.purchaseName || bestMatchByName.productName,
        barcode: bestMatchByName.barcode,
        optionName: returnItem.optionName // 원래 옵션명 유지
      };
    }
    
    // 5. 상품명과 옵션명으로 유사도 매칭 (기존 방식)
    let bestMatch: ProductInfo | null = null;
    let highestSimilarity = 0;
    
    // 유사도 임계값을 단계적으로 낮추면서 매칭 시도 (더 높은 임계값으로 시작)
    const similarityThresholds = [0.8, 0.7, 0.6, 0.5, 0.45];
    
    for (const threshold of similarityThresholds) {
      for (const product of products) {
        // 상품명 유사도
        const productNameSimilarity = stringSimilarity(returnItem.productName, product.productName || '');
        // 옵션명 유사도
        const optionNameSimilarity = stringSimilarity(returnItem.optionName || '', product.optionName || '');
        
        // 가중치를 적용한 종합 유사도 (상품명 70%, 옵션명 30%)
        const combinedSimilarity = (productNameSimilarity * 0.7) + (optionNameSimilarity * 0.3);
        
        if (combinedSimilarity > highestSimilarity && combinedSimilarity >= threshold) {
          // 키워드 검증 추가
          if (validateKeywordSimilarity(returnItem.productName, product.productName || '')) {
            highestSimilarity = combinedSimilarity;
            bestMatch = product;
          }
        }
      }
      
      // 현재 임계값에서 매칭된 결과가 있으면 더 낮은 임계값은 시도하지 않음
      if (bestMatch) {
        console.log(`종합 유사도 매칭 성공: 유사도 ${highestSimilarity.toFixed(2)} (임계값: ${threshold})`);
        break;
      }
    }
    
    if (bestMatch) {
      return {
        ...returnItem,
        purchaseName: bestMatch.purchaseName || bestMatch.productName,
        barcode: bestMatch.barcode,
        optionName: returnItem.optionName // 원래 옵션명 유지
      };
    }
    
    // 6. 제목에 포함 여부 검사 (마지막 시도)
    const containsMatch = products.find(p => 
      p.productName && returnItem.productName &&
      (p.productName.toLowerCase().includes(returnItem.productName.toLowerCase()) ||
       returnItem.productName.toLowerCase().includes(p.productName.toLowerCase()))
    );
    
    if (containsMatch) {
      console.log(`포함 관계 매칭 성공: ${returnItem.productName}`);
      return {
        ...returnItem,
        purchaseName: containsMatch.purchaseName || containsMatch.productName,
        barcode: containsMatch.barcode,
        optionName: returnItem.optionName // 원래 옵션명 유지
      };
    }
    
    // 매칭 실패 시 원본 반환
    console.log(`매칭 실패: ${returnItem.productName}`);
    return returnItem;
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
  const [returnState, setReturnState] = useState<ReturnState>({
    pendingReturns: [],
    completedReturns: [],
    products: []
  });
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [localData, setLocalData] = useState<boolean>(false);
  
  // 색상 설정 관련 상태
  const [buttonColors, setButtonColors] = useState({
    testButton: 'bg-purple-500 hover:bg-purple-600',
    uploadProducts: 'bg-green-500 hover:bg-green-600',
    viewPending: 'bg-blue-500 hover:bg-blue-600',
    settings: 'bg-gray-500 hover:bg-gray-600'
  });
  
  // 모달 관련 상태
  const productModalRef = useRef<HTMLDialogElement>(null);
  const pendingModalRef = useRef<HTMLDialogElement>(null);
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
    setIsLoading(true);
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
        setReturnState(data);
        localStorage.setItem('returnData', JSON.stringify(data));
        localStorage.setItem('lastUpdated', new Date().toISOString());
        setLocalData(false);
        setMessage('데이터를 성공적으로 불러왔습니다.');
      } else {
        setMessage('데이터가 없습니다. 엑셀 파일을 업로드해주세요.');
      }
    } catch (error: any) {
      handleFirebaseError(error);
    } finally {
      setIsLoading(false);
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
        setReturnState(parsed);
        setLocalData(true);
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
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, type: 'products' | 'returns') => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 파일 크기 체크 (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setMessage('파일 크기가 10MB를 초과합니다.');
      return;
    }
        
    try {
      setIsLoading(true);
      setMessage('파일을 처리중입니다...');
      setUploadProgress(0);

      // 파일 이름과 크기 로깅
      safeConsoleError(`파일 업로드 시작: ${file.name}, 크기: ${(file.size / 1024).toFixed(2)}KB, 타입: ${file.type}`);

      // 엑셀 데이터 처리
      const data = await processExcelData(file, type);

      if (data.length === 0) {
        setMessage('처리할 데이터가 없습니다. 파일을 확인해주세요.');
        setIsLoading(false);
        return;
      }

      // 현재 상태 복사
      const updatedState = {...returnState};
      
      // 데이터 타입에 따라 즉시 상태 업데이트
      if (type === 'products') {
        updatedState.products = [
          ...(updatedState.products || []),
          ...(data as ProductInfo[])
        ];
      } else { // returns
        const returnItems = data as ReturnItem[];
        
        // 반품 데이터에 상품 매칭 시도
        const matchedItems = returnItems.map(item => 
          matchProductData(item, updatedState.products || [])
        );
        
        updatedState.pendingReturns = [
          ...(updatedState.pendingReturns || []),
          ...matchedItems.map(item => ({
            ...item,
            status: 'PENDING' as const,
            createdAt: new Date().toISOString()
          }))
        ];
      }
      
      // UI 즉시 업데이트 및 로컬 저장
      setReturnState(updatedState);
      saveLocalData(updatedState);
      
      try {
        // API 대신 직접 Firebase에 저장
        safeConsoleError(`${data.length}개 항목 Firebase에 직접 저장 시작`);
        setMessage(`${data.length}개 항목 처리 중... (0%)`);
        
        // 데이터 청크 분할 (더 작은 단위로)
        const chunkSize = 5; // 청크 크기를 더 작게 조정
        const chunks = splitIntoChunks(data, chunkSize);
        const totalChunks = chunks.length;
        
        safeConsoleError(`데이터를 ${totalChunks}개 청크로 분할하여 처리`);
        
        let processedChunks = 0;
        
        // 실패한 청크를 재시도하기 위한 배열
        const failedChunks: {index: number, chunk: any[]}[] = [];
        
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const progress = Math.round(((i + 1) / chunks.length) * 100);
          
          safeConsoleError(`청크 ${i+1}/${chunks.length} 처리 중 (${chunk.length}개 항목)`);
          setMessage(`청크 ${i+1}/${chunks.length} 처리 중... (${progress}%)`);
          setUploadProgress(progress);
          
          try {
            // 방어적인 통신 처리 - 타임아웃 추가
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30초 타임아웃
            
            // Firebase에 직접 데이터 저장
            const response = await fetch('/api/returns', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                type,
                data: chunk
              }),
              signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            // 응답 확인
            if (!response.ok) {
              // 텍스트로 응답을 먼저 받아서 오류 메시지 확인
              const errorText = await response.text();
              console.error(`서버 응답 오류 (${response.status}):`, errorText);
              
              // 재시도를 위해 실패한 청크 추가
              failedChunks.push({index: i, chunk});
              throw new Error(`서버 오류: ${response.status} ${response.statusText}`);
            }
            
            // 응답 텍스트를 가져온 후 JSON 파싱 시도
            const responseText = await response.text();
            let responseData;
            
            try {
              // JSON 파싱 시도
              responseData = JSON.parse(responseText);
            } catch (parseError) {
              console.error('응답 파싱 오류:', parseError, '원본 응답:', responseText);
              throw new Error('서버 오류: 응답을 파싱할 수 없습니다.');
            }
            
            safeConsoleError(`청크 ${i+1}/${chunks.length} 처리 완료`);
            processedChunks++;
          } catch (chunkError) {
            // 오류 확인 - AbortError인 경우 타임아웃
            if (chunkError instanceof Error && chunkError.name === 'AbortError') {
              safeConsoleError(`청크 ${i+1}/${chunks.length} 처리 타임아웃`);
              setMessage(`주의: 청크 ${i+1}/${chunks.length} 처리 시간 초과, 재시도 예정... (${progress}%)`);
              
              // 타임아웃된 청크를 재시도 목록에 추가
              failedChunks.push({index: i, chunk});
            } else {
              safeConsoleError(`청크 ${i+1}/${chunks.length} 처리 오류:`, chunkError);
              setMessage(`주의: 청크 ${i+1}/${chunks.length} 처리 중 오류 발생, 계속 진행 중... (${progress}%)`);
              
              // 오류가 발생한 청크도 재시도 목록에 추가
              if (!failedChunks.some(fc => fc.index === i)) {
                failedChunks.push({index: i, chunk});
              }
            }
          }
          
          // 청크 사이 처리 지연 추가 (서버 부하 방지)
          if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        // 실패한 청크 재시도 (최대 1회)
        if (failedChunks.length > 0) {
          setMessage(`${failedChunks.length}개의 실패한 청크 재시도 중...`);
          safeConsoleError(`${failedChunks.length}개의 실패한 청크 재시도 중...`);
          
          for (let i = 0; i < failedChunks.length; i++) {
            const {index, chunk} = failedChunks[i];
            const progress = Math.round(((i + 1) / failedChunks.length) * 100);
            
            safeConsoleError(`재시도: 청크 ${index+1}/${chunks.length} 처리 중 (${chunk.length}개 항목)`);
            setMessage(`재시도: 청크 ${index+1}/${chunks.length} 처리 중... (${progress}%)`);
            
            try {
              // 로컬 스토리지에만 저장하고 서버에는 저장 시도하지 않음
              processedChunks++;
              safeConsoleError(`청크 ${index+1}/${chunks.length} 로컬 저장 성공`);
            } catch (retryError) {
              safeConsoleError(`청크 ${index+1}/${chunks.length} 재시도 실패:`, retryError);
            }
            
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        
        if (processedChunks === chunks.length) {
          setMessage(`${data.length}개 항목이 성공적으로 처리되었습니다.`);
        } else {
          setMessage(`${processedChunks}/${chunks.length} 청크 처리 완료. 일부 항목은 저장되지 않았을 수 있습니다.`);
        }
        
        // 완료 후 데이터 새로고침
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          const refreshedData = await fetchReturns();
          if (refreshedData) {
            setReturnState(refreshedData);
            saveLocalData(refreshedData);
          }
        } catch (refreshError) {
          safeConsoleError('데이터 갱신 오류:', refreshError);
          // 이미 로컬에 저장했으므로 오류 표시만
        }
        
      } catch (fbError) {
        safeConsoleError('데이터 저장 오류:', fbError);
        setMessage(`데이터 저장 중 오류 발생: ${fbError instanceof Error ? fbError.message : '알 수 없는 오류'}`);
        setMessage('서버에 연결할 수 없습니다. 로컬에 저장된 데이터만 업데이트되었습니다.');
      }
    } catch (error) {
      handleError(error, '파일 업로드');
    } finally {
      setIsLoading(false);
    }
  };

  // Firebase 연결 테스트 함수
  const testFirebaseConnection = async () => {
    try {
      setIsLoading(true);
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
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-4 bg-gray-100">
      <header className="bg-white p-4 rounded-lg shadow-md mb-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">반품 관리 시스템</h1>
          
          {/* 설정 버튼 */}
          <button
            onClick={() => settingsModalRef.current?.showModal()}
            className={`text-white px-4 py-2 rounded ${buttonColors.settings}`}
            disabled={isLoading}
          >
            ⚙️ 설정
          </button>
                </div>
        
        <div className="flex justify-between items-center">
          <div>
            <p className="text-gray-600">입고전: {returnState.pendingReturns?.length || 0}개</p>
            <p className="text-gray-600">입고완료: {returnState.completedReturns?.length || 0}개</p>
            <p className="text-gray-600">상품 데이터: {returnState.products?.length || 0}개</p>
            {localData && (
              <p className="text-amber-600 font-semibold">※ 오프라인 모드: 로컬에 저장된 데이터를 표시합니다.</p>
            )}
        </div>

          {/* Firebase 테스트 버튼 추가 */}
          <div>
                                <button 
              onClick={testFirebaseConnection}
              className={`text-white px-4 py-2 rounded disabled:opacity-50 ${buttonColors.testButton}`}
              disabled={isLoading}
                                >
              Firebase 연결 테스트
                                </button>
                </div>
                </div>
        {message && (
          <div className="mt-4 p-2 bg-blue-100 text-blue-800 rounded">
            {message}
          </div>
        )}
        {isLoading && (
          <div className="mt-4 p-2 bg-yellow-100 text-yellow-800 rounded flex items-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-800 mr-2"></div>
            {uploadProgress > 0 ? `처리중... ${uploadProgress}%` : '데이터 로딩 중...'}
          </div>
        )}
      </header>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-white p-4 rounded-lg shadow-md">
          <h2 className="text-lg font-semibold mb-4">상품 리스트 업로드</h2>
          <input
            type="file"
            className="block w-full mb-4"
            accept=".xlsx,.xls"
            onChange={(e) => handleFileUpload(e, 'products')}
                  disabled={isLoading}
          />
                  <button
            className={`text-white px-4 py-2 rounded disabled:opacity-50 ${buttonColors.uploadProducts}`}
            onClick={() => productModalRef.current?.showModal()}
            disabled={isLoading || returnState.products.length === 0}
                  >
            상품 데이터 확인 ({returnState.products.length}개)
                  </button>
              </div>
        
        <div className="bg-white p-4 rounded-lg shadow-md">
          <h2 className="text-lg font-semibold mb-4">반품 엑셀/CSV 파일 업로드</h2>
                      <input
            type="file"
            className="block w-full mb-4"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => handleFileUpload(e, 'returns')}
            disabled={isLoading}
          />
          <button 
            className={`text-white px-4 py-2 rounded disabled:opacity-50 ${buttonColors.viewPending}`}
            onClick={() => pendingModalRef.current?.showModal()}
            disabled={isLoading || returnState.pendingReturns.length === 0}
          >
            입고전 목록보기 ({returnState.pendingReturns.length}개)
          </button>
                            </div>
            </div>

      {/* 상품 데이터 모달 */}
      <dialog ref={productModalRef} className="w-full max-w-4xl p-4 rounded-lg shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">상품 데이터</h3>
                  <button
            onClick={() => productModalRef.current?.close()}
            className="text-gray-500 hover:text-gray-700"
                  >
                  닫기
                  </button>
                </div>
        <div className="max-h-[70vh] overflow-auto">
          {returnState.products.length > 0 ? (
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">바코드</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">상품명</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">사입상품명</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">옵션명</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">자체상품코드</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                {returnState.products.map((product, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap">{product.barcode}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{product.productName}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{product.purchaseName}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{product.optionName}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{product.zigzagProductCode}</td>
                          </tr>
                ))}
                    </tbody>
                  </table>
              ) : (
            <p className="text-center text-gray-500">등록된 상품이 없습니다.</p>
            )}
          </div>
        </dialog>

      {/* 입고전 목록 모달 */}
      <dialog ref={pendingModalRef} className="w-full max-w-4xl p-4 rounded-lg shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">입고전 목록</h3>
                    <button
            onClick={() => pendingModalRef.current?.close()}
            className="text-gray-500 hover:text-gray-700"
          >
            닫기
                    </button>
                  </div>
        <div className="max-h-[70vh] overflow-auto">
          {returnState.pendingReturns.length > 0 ? (
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">고객명</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">주문번호</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">상품명</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">옵션명</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">수량</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">반품사유</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">송장번호</th>
                      </tr>
                    </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                {returnState.pendingReturns.map((item, index) => (
                      <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap">{item.customerName}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{item.orderNumber}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{item.productName}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{item.optionName}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{item.quantity}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{item.returnReason}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{item.returnTrackingNumber}</td>
                      </tr>
                      ))}
                    </tbody>
                  </table>
              ) : (
            <p className="text-center text-gray-500">입고전 상품이 없습니다.</p>
              )}
          </div>
        </dialog>

      {/* 설정 모달 */}
      <dialog ref={settingsModalRef} className="w-full max-w-lg p-4 rounded-lg shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">시스템 설정</h3>
                <button
            onClick={() => settingsModalRef.current?.close()}
            className="text-gray-500 hover:text-gray-700"
          >
            닫기
                </button>
              </div>
        
        <div className="space-y-6">
          <h4 className="text-lg font-medium">버튼 색상 설정</h4>
          
                <div className="space-y-4">
            <div className="flex flex-col space-y-2">
              <label className="text-sm font-medium">Firebase 연결 테스트 버튼</label>
              <div className="flex space-x-2">
                {['purple', 'blue', 'green', 'red', 'yellow', 'indigo', 'pink'].map((color) => (
                  <button
                    key={`test-${color}`}
                    onClick={() => handleColorChange('testButton', `bg-${color}-500`)}
                    className={`w-8 h-8 rounded bg-${color}-500 border-2 ${buttonColors.testButton.includes(`bg-${color}-500`) ? 'border-black' : 'border-transparent'}`}
                    aria-label={`${color} 색상`}
                  />
                ))}
            </div>
        </div>
            
            <div className="flex flex-col space-y-2">
              <label className="text-sm font-medium">상품 데이터 확인 버튼</label>
              <div className="flex space-x-2">
                {['purple', 'blue', 'green', 'red', 'yellow', 'indigo', 'pink'].map((color) => (
                  <button
                    key={`products-${color}`}
                    onClick={() => handleColorChange('uploadProducts', `bg-${color}-500`)}
                    className={`w-8 h-8 rounded bg-${color}-500 border-2 ${buttonColors.uploadProducts.includes(`bg-${color}-500`) ? 'border-black' : 'border-transparent'}`}
                    aria-label={`${color} 색상`}
                  />
                ))}
      </div>
            </div>
            
            <div className="flex flex-col space-y-2">
              <label className="text-sm font-medium">입고전 목록보기 버튼</label>
              <div className="flex space-x-2">
                {['purple', 'blue', 'green', 'red', 'yellow', 'indigo', 'pink'].map((color) => (
                  <button
                    key={`pending-${color}`}
                    onClick={() => handleColorChange('viewPending', `bg-${color}-500`)}
                    className={`w-8 h-8 rounded bg-${color}-500 border-2 ${buttonColors.viewPending.includes(`bg-${color}-500`) ? 'border-black' : 'border-transparent'}`}
                    aria-label={`${color} 색상`}
                  />
                ))}
                  </div>
          </div>
            
            <div className="flex flex-col space-y-2">
              <label className="text-sm font-medium">설정 버튼</label>
              <div className="flex space-x-2">
                {['purple', 'blue', 'green', 'red', 'yellow', 'indigo', 'pink', 'gray'].map((color) => (
                  <button
                    key={`settings-${color}`}
                    onClick={() => handleColorChange('settings', `bg-${color}-500`)}
                    className={`w-8 h-8 rounded bg-${color}-500 border-2 ${buttonColors.settings.includes(`bg-${color}-500`) ? 'border-black' : 'border-transparent'}`}
                    aria-label={`${color} 색상`}
                  />
                ))}
        </div>
            </div>
            </div>
          </div>
        </dialog>
      </div>
  );
}