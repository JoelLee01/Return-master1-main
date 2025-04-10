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
  
  // 반품 사유 관련 상태
  const [isReasonModalOpen, setIsReasonModalOpen] = useState(false);
  const [currentReasonItem, setCurrentReasonItem] = useState<ReturnItem | null>(null);
  const [currentDetailReason, setCurrentDetailReason] = useState('');
  
  // 선택 항목 관련 상태
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  // 선택된 입고완료 항목 상태 추가
  const [selectedCompletedItems, setSelectedCompletedItems] = useState<number[]>([]);
  const [selectAllCompleted, setSelectAllCompleted] = useState(false);
  
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
      setMessage(`${type === 'returns' ? '반품' : '상품'} 파일을 처리 중입니다...`);
      
      if (type === 'returns') {
        const returns = await parseReturnExcel(files[0]);
        if (returns.length > 0) {
          dispatch({ type: 'ADD_RETURNS', payload: returns });
          setMessage(`${returns.length}개의 반품 항목이 추가되었습니다.`);
          
          // 반품 데이터 추가 후 자동으로 매칭 실행
          if (returnState.products && returnState.products.length > 0) {
            console.log('반품 데이터 추가 후 자동 매칭 실행');
            
            // 미매칭 상품 찾기
            const unmatchedItems = returns.filter(item => !item.barcode);
            console.log(`🔍 ${unmatchedItems.length}개 반품 상품 자동 매칭 시작`);
            
            if (unmatchedItems.length > 0) {
              setMessage(`${returns.length}개 반품 항목이 추가되었습니다. 상품 매칭을 시작합니다...`);
              
              // 매칭 시도 및 결과 수집
              let matchedCount = 0;
              let failedCount = 0;
              
              // 각 반품 항목에 대해 매칭 시도
              for (const item of unmatchedItems) {
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
              }
              
              // 결과 메시지 표시
              if (matchedCount > 0) {
                setMessage(`${returns.length}개 반품 항목이 추가되었습니다. 자동 매칭 결과: ${matchedCount}개 성공, ${failedCount}개 실패`);
              } else {
                setMessage(`${returns.length}개 반품 항목이 추가되었습니다. 상품 매칭에 실패했습니다.`);
              }
            }
          }
        } else {
          setMessage('처리할 데이터가 없습니다. 파일을 확인해주세요.');
        }
      } else {
        const products = await parseProductExcel(files[0]);
        if (products.length > 0) {
          dispatch({ type: 'ADD_PRODUCTS', payload: products });
          
          // 상품 데이터 추가 후 자동으로 매칭 시도 (보류 중인 반품 항목에 대해)
          if (returnState.pendingReturns && returnState.pendingReturns.length > 0) {
            console.log('상품 데이터 추가 후 자동 매칭 실행');
            
            // 미매칭 상품 찾기
            const unmatchedItems = returnState.pendingReturns.filter(item => !item.barcode);
            console.log(`🔍 ${unmatchedItems.length}개 반품 상품 자동 매칭 시작`);
            
            // 매칭 시도 및 결과 수집
            let matchedCount = 0;
            let failedCount = 0;
            
            // 각 반품 항목에 대해 매칭 시도
            for (const item of unmatchedItems) {
              const matchedItem = matchProductData(item, products);
              
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
            }
            
            // 결과 메시지 표시
            if (matchedCount > 0) {
              setMessage(`${products.length}개 상품이 추가되었습니다. 자동 매칭 결과: ${matchedCount}개 성공, ${failedCount}개 실패`);
            } else {
              setMessage(`${products.length}개 상품이 추가되었습니다. 상품 매칭에 실패했습니다.`);
            }
          } else {
            setMessage(`${products.length}개 상품이 추가되었습니다.`);
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
    setCurrentDetailReason(item.detailReason || '');
    setIsReasonModalOpen(true);
    // modalLevel 증가
    setModalLevel(prev => prev + 1);
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
    // modalLevel 감소
    setModalLevel(prev => Math.max(0, prev - 1));
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
    if (returnState.completedReturns.length === 0) {
      setMessage('다운로드할 입고 완료 데이터가 없습니다.');
      return;
    }
    
    try {
      // 간소화된 데이터 준비 - 바코드번호와 수량만 포함
      const simplifiedData = returnState.completedReturns.map(item => ({
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
      
      setMessage(`${simplifiedData.length}개 항목이 ${filename} 파일로 저장되었습니다.`);
    } catch (error) {
      console.error('엑셀 생성 중 오류:', error);
      setMessage('엑셀 파일 생성 중 오류가 발생했습니다.');
    }
  };

  // 자체상품코드 클릭 처리를 위한 상태와 함수
  const [showProductMatchModal, setShowProductMatchModal] = useState(false);
  const [currentMatchItem, setCurrentMatchItem] = useState<ReturnItem | null>(null);
  
  // 상품 매칭 팝업 열기
  const handleProductMatchClick = (item: ReturnItem) => {
    setCurrentMatchItem(item);
    setShowProductMatchModal(true);
    // modalLevel 증가
    setModalLevel(prev => prev + 1);
  };
  
  // 상품 매칭 팝업 닫기
  const handleCloseProductMatchModal = () => {
    setShowProductMatchModal(false);
    setCurrentMatchItem(null);
    // modalLevel 감소
    setModalLevel(prev => Math.max(0, prev - 1));
  };

  // 입고완료 선택 항목 핸들러
  const handleCompletedCheckboxChange = (index: number) => {
    setSelectedCompletedItems(prev => {
      if (prev.includes(index)) {
        return prev.filter(i => i !== index);
      } else {
        return [...prev, index];
      }
    });
  };

  // 입고완료 전체 선택 핸들러
  const handleSelectAllCompleted = () => {
    if (selectAllCompleted) {
      setSelectedCompletedItems([]);
    } else {
      setSelectedCompletedItems(returnState.completedReturns.map((_, index) => index));
    }
    setSelectAllCompleted(!selectAllCompleted);
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
  }, [currentTrackingItem, dispatch, returnState, saveLocalData]);
  
  // 입력창 닫기 핸들러
  const handleCancelTrackingInput = useCallback(() => {
    setShowTrackingInput(false);
    setCurrentTrackingItem(null);
  }, []);

  // 상품 엑셀 업로드 처리 함수
  const handleProductFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) {
      return;
    }
    
    setLoading(true);
    setMessage('상품 데이터 파일을 처리 중입니다...');
    
    try {
      const file = e.target.files[0];
      console.log(`상품 데이터 파일 업로드: ${file.name}`);
      
      // 엑셀 파일 파싱
      const newProducts = await parseProductExcel(file);
      console.log(`${newProducts.length}개의 상품 데이터가 파싱되었습니다.`);
      
      if (newProducts.length === 0) {
        setMessage('파싱된 상품 데이터가 없습니다. 파일 형식을 확인해주세요.');
        setLoading(false);
        return;
      }
      
      // 기존 상품 데이터와 중복 방지 처리
      let updatedProducts = [...newProducts];
      
      if (returnState.products && returnState.products.length > 0) {
        // 바코드를 키로 하는 맵 생성
        const existingBarcodeMap = new Map<string, ProductInfo>();
        returnState.products.forEach(product => {
          if (product.barcode) {
            existingBarcodeMap.set(product.barcode, product);
          }
        });
        
        // 중복되지 않는 항목만 추가
        const nonDuplicates = newProducts.filter(product => {
          return !existingBarcodeMap.has(product.barcode);
        });
        
        // 중복 제거된 목록과 기존 목록 합치기
        updatedProducts = [...returnState.products, ...nonDuplicates];
        
        console.log(`기존 상품 ${returnState.products.length}개, 새 상품 ${newProducts.length}개, 중복 제외 ${nonDuplicates.length}개 추가됨`);
      }
      
      // 상태 업데이트
      dispatch({
        type: 'SET_PRODUCTS',
        payload: updatedProducts
      });
      
      // 로컬 스토리지 업데이트
      const updatedData: ReturnState = {
        ...returnState,
        products: updatedProducts
      };
      saveLocalData(updatedData);
      
      setMessage(`상품 데이터 ${updatedProducts.length}개가 로드되었습니다. (${newProducts.length}개 파싱됨, ${newProducts.length - (updatedProducts.length - (returnState.products?.length || 0))}개 중복 제외)`);
    } catch (error) {
      console.error('상품 데이터 업로드 오류:', error);
      setMessage(`상품 데이터 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
      // 파일 입력 초기화
      if (productFileRef.current) {
        productFileRef.current.value = '';
      }
    }
  };

  // 상품 매칭 처리 함수
  const handleProductMatch = (returnItem: ReturnItem, product: ProductInfo) => {
    // 매칭 성공 시 처리
    const updatedItem: ReturnItem = {
      ...returnItem,
      barcode: product.barcode,
      purchaseName: product.purchaseName || product.productName,
      zigzagProductCode: product.zigzagProductCode || '',
      matchType: '수동 매칭',
      matchSimilarity: 1
    };
    
    dispatch({
      type: 'UPDATE_PENDING_RETURN',
      payload: updatedItem
    });
    
    setMessage(`'${returnItem.productName}' 상품이 '${product.productName}'(으)로 매칭되었습니다.`);
    setShowProductMatchModal(false);
    setCurrentMatchItem(null);
  };

  // 송장번호 검색 상태
  const [trackingSearch, setTrackingSearch] = useState('');
  const [trackingSearchResult, setTrackingSearchResult] = useState<ReturnItem | null>(null);
  
  // 송장번호 검색 함수
  const handleTrackingSearch = () => {
    if (!trackingSearch.trim()) return;
    
    // 입고전 목록에서 송장번호로 검색
    const foundItems = returnState.pendingReturns.filter(
      item => item.returnTrackingNumber === trackingSearch.trim()
    );
    
    if (foundItems.length > 0) {
      // 첫 번째 항목만 표시하되, 전체 개수도 알려줌
      setTrackingSearchResult(foundItems[0]);
      setMessage(`송장번호로 ${foundItems.length}개의 반품 항목을 찾았습니다.`);
    } else {
      setTrackingSearchResult(null);
      setMessage('해당 송장번호를 가진 반품 항목을 찾을 수 없습니다.');
    }
  };
  
  // 송장번호로 입고 처리 함수
  const handleReceiveByTracking = () => {
    if (!trackingSearch.trim()) return;
    
    // 동일 송장번호를 가진 모든 항목 검색
    const itemsToProcess = returnState.pendingReturns.filter(
      item => item.returnTrackingNumber === trackingSearch.trim()
    );
    
    if (itemsToProcess.length === 0) {
      setMessage('입고 처리할 반품 항목이 없습니다.');
      return;
    }
    
    // 모든 항목 입고 처리
    const completedItems = itemsToProcess.map(item => ({
      ...item,
      status: 'COMPLETED' as const,
      completedAt: new Date()
    }));
    
    // 대기 목록에서 제거
    itemsToProcess.forEach(item => {
      dispatch({ 
        type: 'REMOVE_PENDING_RETURN', 
        payload: { id: item.id } 
      });
    });
    
    // 완료 목록에 추가
    completedItems.forEach(item => {
      dispatch({
        type: 'ADD_COMPLETED_RETURN',
        payload: item
      });
    });
    
    // 로컬 스토리지 업데이트
    saveLocalData(returnState);
    
    setMessage(`${itemsToProcess.length}개 반품 항목이 입고완료 처리되었습니다.`);
    setTrackingSearch('');
    setTrackingSearchResult(null);
  };
  
  // 송장번호 입력 필드 Enter 키 핸들러
  const handleTrackingKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleReceiveByTracking();
    }
  };

  // 반품 엑셀 파일 업로드 처리
  const handleReturnFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) {
      return;
    }
    
    setLoading(true);
    setMessage('반품 데이터 파일을 처리 중입니다...');
    
    try {
      const file = e.target.files[0];
      console.log(`반품 데이터 파일 업로드: ${file.name}`);
      
      // 엑셀 파일 파싱
      const returns = await parseReturnExcel(file);
      console.log(`${returns.length}개의 반품 데이터가 파싱되었습니다.`);
      
      if (returns.length === 0) {
        setMessage('파싱된 반품 데이터가 없습니다. 파일 형식을 확인해주세요.');
        setLoading(false);
        return;
      }
      
      // 반품 데이터 업데이트
      dispatch({
        type: 'ADD_RETURNS',
        payload: returns
      });
      
      // 로컬 스토리지 업데이트
      const updatedData: ReturnState = {
        ...returnState,
        pendingReturns: returnState.pendingReturns.concat(returns)
      };
      saveLocalData(updatedData);
      
      setMessage(`반품 데이터 ${returns.length}개가 로드되었습니다.`);
      
      // 상품 데이터가 있으면 자동 매칭 시작
      if (returnState.products && returnState.products.length > 0) {
        setMessage(`${returns.length}개의 반품 데이터 자동 매칭 중...`);
        setLoading(true);
        
        // 약간의 지연 후 매칭 시작 (UI 업데이트를 위해)
        setTimeout(() => {
          try {
            // 매칭 시작
            const matchedReturns = [...returns]; // 원본 배열 복사
            
            // 각 항목별 매칭 시도
            for (let i = 0; i < matchedReturns.length; i++) {
              if (!matchedReturns[i].barcode) { // 미매칭 항목만 매칭 시도
                matchedReturns[i] = matchProductData(matchedReturns[i], returnState.products || []);
              }
            }
            
            // 매칭된 항목들을 하나씩 업데이트
            for (const item of matchedReturns) {
              if (item.barcode) {
                dispatch({
                  type: 'UPDATE_RETURN_ITEM',
                  payload: item
                });
              }
            }
            
            // 로컬 스토리지 업데이트
            const currentState = {
              ...returnState,
              // pendingReturns 최신 상태 확인
              pendingReturns: returnState.pendingReturns.map(item => {
                // 매칭된 항목이 있으면 그것으로 대체
                const matchedItem = matchedReturns.find(r => r.id === item.id);
                return matchedItem || item;
              })
            };
            saveLocalData(currentState);
            
            // 매칭된 항목 수 계산
            const matchedCount = matchedReturns.filter(item => item.barcode).length;
            
            setMessage(`반품 데이터 ${returns.length}개 중 ${matchedCount}개가 자동 매칭되었습니다.`);
          } catch (error) {
            console.error('자동 매칭 중 오류 발생:', error);
            setMessage(`자동 매칭 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
          } finally {
            setLoading(false);
          }
        }, 100);
      }
    } catch (error) {
      console.error('반품 데이터 업로드 오류:', error);
      setMessage(`반품 데이터 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
      
      // 파일 입력 초기화
      if (returnFileRef.current) {
        returnFileRef.current.value = '';
      }
    }
  };

  // Firebase에 데이터 저장
  const handleSaveToFirebase = async () => {
    try {
      setLoading(true);
      setMessage('Firebase에 데이터를 저장 중입니다...');
      
      // 모든 반품 데이터 준비 (대기 중 + 완료된 항목)
      const allReturns = [...returnState.pendingReturns, ...returnState.completedReturns];
      
      // 반품 아이템과 제품 정보가 있는지 확인
      if (allReturns.length === 0 && returnState.products.length === 0) {
        throw new Error('저장할 데이터가 없습니다.');
      }
      
      // 데이터 형식 확인 - ID 필드가 있는지 검사하고 필요시 추가
      const validatedReturns = allReturns.map(item => {
        if (!item.id) {
          // ID가 없는 경우 생성 (주문번호_상품명 형식으로)
          const generatedId = `${item.orderNumber}_${item.productName}`.replace(/[\/\.\#\$\[\]]/g, '_');
          return { ...item, id: generatedId };
        }
        return item;
      });
      
      // 로깅 추가 - 저장 전 처리된 데이터 확인
      console.log(`Firebase에 저장할 데이터: ${validatedReturns.length}개 반품, ${returnState.products.length}개 상품`);
      
      const result = await updateReturns(validatedReturns, returnState.products);
      
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
      setMessage(`Firebase 저장 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
    }
  };

  // 선택한 항목들 삭제 처리
  const handleDeleteSelected = () => {
    if (selectedItems.length === 0) return;
    
    if (window.confirm(`선택한 ${selectedItems.length}개 항목을 삭제하시겠습니까?`)) {
      const itemsToDelete = selectedItems.map(index => returnState.pendingReturns[index]);
      
      // 각 항목을 개별적으로 삭제
      itemsToDelete.forEach(item => {
        dispatch({ 
          type: 'REMOVE_PENDING_RETURN', 
          payload: { id: item.id } 
        });
      });
      
      setSelectedItems([]);
      setSelectAll(false);
      setMessage(`${itemsToDelete.length}개 항목이 삭제되었습니다.`);
    }
  };

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
    // 자체상품코드가 있는 경우 우선 표시
    if (item.zigzagProductCode && item.zigzagProductCode !== '-') {
      return (
        <span className="font-medium">{item.zigzagProductCode}</span>
      );
    }
    
    // 자체상품코드가 없는 경우 상품명을 클릭 가능한 버튼으로 표시
    return (
      <button
        className="text-blue-600 hover:text-blue-800 underline"
        onClick={() => handleProductMatchClick(item)}
      >
        {item.purchaseName || item.productName}
      </button>
    );
  };

  // 새로고침 버튼 기능 추가
  const handleRefresh = () => {
    // 기존 데이터를 다시 로딩하고, 최신 로직 적용
    if (returnState.pendingReturns.length > 0) {
      setLoading(true);
      setMessage('데이터를 새로고침 중입니다...');
      
      // 반품 사유 간소화 적용
      const updatedReturns = returnState.pendingReturns.map(item => ({
        ...item,
        returnReason: simplifyReturnReason(item.returnReason)
      }));
      
      // 자체상품코드로 매칭 재시도
      const matchedReturns = updatedReturns.map(item => {
        if (!item.barcode && item.zigzagProductCode && item.zigzagProductCode !== '-') {
          // 자체상품코드로 매칭 시도
          const exactMatch = returnState.products.find(p => 
            p.zigzagProductCode && 
            p.zigzagProductCode === item.zigzagProductCode
          );
          
          if (exactMatch) {
            return {
              ...item,
              barcode: exactMatch.barcode,
              purchaseName: exactMatch.purchaseName || exactMatch.productName
            };
          }
        }
        return item;
      });
      
      // 상태 업데이트
      dispatch({
        type: 'SET_RETURNS',
        payload: {
          ...returnState,
          pendingReturns: matchedReturns
        }
      });
      
      setTimeout(() => {
        setLoading(false);
        setMessage('데이터가 새로고침 되었습니다.');
      }, 500);
    } else {
      setMessage('새로고침할 대기 중인 반품 데이터가 없습니다.');
    }
  };

  // 날짜 이동 함수 구현
  const handleDateNavigation = (currentDate: string, direction: 'prev' | 'next') => {
    // 날짜 순서로 정렬된 완료된 반품 날짜 목록 얻기
    const allDates = groupedCompletedReturns.map(group => group.date);
    const currentIndex = allDates.findIndex(date => date === currentDate);
    
    if (currentIndex === -1) {
      setMessage('날짜 정보를 찾을 수 없습니다.');
      return;
    }
    
    let targetIndex: number;
    if (direction === 'prev') {
      // 이전 날짜로 이동 (더 이상 이전이 없으면 첫 날짜로)
      targetIndex = currentIndex === allDates.length - 1 ? 0 : currentIndex + 1;
    } else {
      // 다음 날짜로 이동 (더 이상 다음이 없으면 마지막 날짜로)
      targetIndex = currentIndex === 0 ? allDates.length - 1 : currentIndex - 1;
    }
    
    const targetDate = allDates[targetIndex];
    // 해당 날짜 부분으로 부드럽게 스크롤
    const targetElement = document.getElementById(`date-group-${targetDate}`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    setMessage(`${new Date(targetDate).toLocaleDateString('ko-KR')} 날짜의 데이터로 이동했습니다.`);
  };

  // 모달 z-index 관리를 위한 상태 추가
  const [modalLevel, setModalLevel] = useState(0);

  const [modalStack, setModalStack] = useState<string[]>([]);

  const openModal = (modalId: string) => {
    setModalStack(prev => [...prev, modalId]);
    const modal = document.getElementById(modalId) as HTMLDialogElement;
    if (modal) modal.showModal();
  };

  const closeModal = (modalId: string | React.RefObject<HTMLDialogElement>) => {
    if (typeof modalId === 'string') {
      setModalStack(prev => prev.filter(id => id !== modalId));
      const modal = document.getElementById(modalId) as HTMLDialogElement;
      if (modal) modal.close();
    } else if (modalId.current) {
      modalId.current.close();
    }
  };

  // 모달 스타일 컴포넌트
  const Modal = ({ id, children, className = '' }: { id: string, children: React.ReactNode, className?: string }) => {
    const zIndex = modalStack.indexOf(id) * 10 + 10;
    
    return (
      <div 
        className={`fixed inset-0 flex items-center justify-center z-${zIndex} bg-black bg-opacity-50`}
        style={{ zIndex }}
      >
        <div className={`bg-white p-4 rounded-lg w-full max-w-6xl max-h-[90vh] overflow-auto ${className}`}>
          {children}
        </div>
      </div>
    );
  };

  // 기존 모달 호출 부분 수정
  const openPendingModal = () => {
    openModal('pendingModal');
  };

  const openCompletedModal = () => {
    openModal('completedModal');
  };

  const closePendingModal = () => {
    closeModal('pendingModal');
    setSelectedItems([]);
  };

  const closeCompletedModal = () => {
    closeModal('completedModal');
    setSelectedCompletedItems([]);
    setSelectAllCompleted(false);
  };

  // 외부 클릭 감지 이벤트 핸들러
  const handleOutsideClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    // dialog 요소 자체가 클릭되었는지 확인 (내부 콘텐츠가 아닌)
    if (e.target === e.currentTarget) {
      e.currentTarget.close();
      setModalLevel(prev => Math.max(0, prev - 1));
    }
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

  const handleRevertSelected = () => {
    if (selectedCompletedItems.length === 0) return;
    
    setLoading(true);
    
    // 선택한 항목 가져오기
    const selectedReturns = selectedCompletedItems.map(index => {
      const item = returnState.completedReturns[index];
      return {
        ...item,
        completedAt: undefined,
        status: 'PENDING' as const
      };
    });
    
    // 입고완료 목록에서 선택한 항목 제거
    const newCompletedReturns = returnState.completedReturns.filter((_, index) => 
      !selectedCompletedItems.includes(index)
    );
    
    // 서버에 데이터 전송
    updateData('UPDATE_RETURNS', {
      pendingReturns: [...returnState.pendingReturns, ...selectedReturns],
      completedReturns: newCompletedReturns
    })
    .then(() => {
      // 로컬 상태 업데이트
      setReturnState(prev => ({
        ...prev,
        pendingReturns: [...prev.pendingReturns, ...selectedReturns],
        completedReturns: newCompletedReturns
      }));
      
      setMessage(`${selectedCompletedItems.length}개의 항목이 입고전 목록으로 이동되었습니다.`);
      setSelectedCompletedItems([]);
      setSelectAllCompleted(false);
    })
    .catch(error => {
      console.error('되돌리기 처리 오류:', error);
      setMessage(`되돌리기 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    })
    .finally(() => {
      setLoading(false);
    });
  };

  // 서버에 데이터 업데이트 함수
  const updateData = async (action: string, data: any) => {
    try {
      // 상대 경로 사용 (클라이언트 측에서 실행될 때 자동으로 현재 호스트에 상대적인 경로로 해석됨)
      const response = await fetch('/api/returns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          data
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '응답을 파싱할 수 없습니다.' }));
        throw new Error(`서버 오류: ${errorData.error || response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('데이터 업데이트 오류:', error);
      throw error;
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
            placeholder="반품송장번호 입력"
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
        
        {trackingSearchResult && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded">
            <p><span className="font-semibold">반품이 확인되었습니다:</span> {trackingSearchResult.productName}</p>
            <p><span className="font-semibold">주문번호:</span> {trackingSearchResult.orderNumber}</p>
            <p><span className="font-semibold">고객명:</span> {trackingSearchResult.customerName}</p>
            <div className="mt-2 flex justify-end">
              <button
                className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                onClick={handleReceiveByTracking}
              >
                입고 처리
              </button>
            </div>
          </div>
        )}
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
        {!isSearching && groupedCompletedReturns.length > 0 && (
          <div className="flex items-center justify-center mb-4 p-2 bg-gray-100 rounded-md">
            <button 
              className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded-l-md"
              onClick={() => {
                if (groupedCompletedReturns.length > 0) {
                  const currentDate = groupedCompletedReturns[0].date;
                  handleDateNavigation(currentDate, 'prev');
                }
              }}
            >
              &lt;
            </button>
            <div className="mx-3 font-medium">
              {groupedCompletedReturns.length > 0 && new Date(groupedCompletedReturns[0].date).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
              })}
            </div>
            <button 
              className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded-r-md"
              onClick={() => {
                if (groupedCompletedReturns.length > 0) {
                  const currentDate = groupedCompletedReturns[0].date;
                  handleDateNavigation(currentDate, 'next');
                }
              }}
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
            {/* 날짜 이동 버튼 영역 */}
            <div className="flex flex-wrap gap-2 p-2 bg-white rounded-md">
              {(isSearching ? groupedSearchResults : groupedCompletedReturns).map(({ date }) => (
                <button
                  key={date}
                  onClick={() => {
                    const element = document.getElementById(`date-group-${date}`);
                    if (element) {
                      element.scrollIntoView({ behavior: 'smooth' });
                    }
                  }}
                  className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-full transition"
                >
                  {date}
                </button>
              ))}
            </div>
            
            {(isSearching ? groupedSearchResults : groupedCompletedReturns).map(({ date, items }) => (
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
                  <div className="flex items-center space-x-2">
                    <button 
                      className="text-gray-700 hover:text-blue-600 px-2 py-1"
                      onClick={() => handleDateNavigation(date, 'prev')}
                    >
                      <span className="text-sm">◀ 이전</span>
                    </button>
                    <button
                      className="text-gray-700 hover:text-blue-600 px-2 py-1"
                      onClick={() => handleDateNavigation(date, 'next')}
                    >
                      <span className="text-sm">다음 ▶</span>
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
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
                        <th className="px-2 py-2 border-x border-gray-300">순번</th>
                        <th className="px-2 py-2 border-x border-gray-300">고객명</th>
                        <th className="px-2 py-2 border-x border-gray-300">사입상품명</th>
                        <th className="px-2 py-2 border-x border-gray-300">옵션명</th>
                        <th className="px-2 py-2 border-x border-gray-300">수량</th>
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
                              onChange={() => handleCompletedCheckboxChange(index)}
                            />
                          </td>
                          <td className="px-2 py-2 border-x border-gray-300">{index + 1}</td>
                          <td className="px-2 py-2 border-x border-gray-300">{item.customerName}</td>
                          <td className="px-2 py-2 border-x border-gray-300">{item.purchaseName || item.productName}</td>
                          <td className="px-2 py-2 border-x border-gray-300">{item.optionName}</td>
                          <td className="px-2 py-2 border-x border-gray-300">{item.quantity}</td>
                          <td 
                            className="px-2 py-2 border-x border-gray-300 truncate cursor-pointer"
                            onClick={() => isDefective(item.returnReason) && handleReturnReasonClick(item)}
                          >
                            {getReturnReasonDisplay(item)}
                          </td>
                          <td className="px-2 py-2 border-x border-gray-300">{item.returnTrackingNumber || '-'}</td>
                          <td className="px-2 py-2 border-x border-gray-300 font-mono">{item.barcode || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
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
        />
      )}
      
      {/* 입고전 반품 목록 모달 */}
      <dialog 
        ref={pendingModalRef} 
        className="modal w-11/12 max-w-5xl p-0 rounded-lg shadow-xl" 
        onClick={handleOutsideClick}
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">선택</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">번호</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">고객명</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/4">상품명</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">옵션</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">수량</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">반품사유</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">송장번호</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/6">바코드번호</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {returnState.pendingReturns.map((item, index) => (
                    <tr key={item.id} className={getRowStyle(item, index, returnState.pendingReturns)}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedItems.includes(index)}
                          onChange={() => handleCheckboxChange(index)}
                        />
                      </td>
                      <td className="px-4 py-3">{index + 1}</td>
                      <td className="px-4 py-3">{item.customerName}</td>
                      <td className="px-4 py-3">
                        <div className="whitespace-normal break-words">{item.purchaseName || item.productName}</div>
                      </td>
                      <td className="px-4 py-3">{item.optionName}</td>
                      <td className="px-4 py-3">{item.quantity}</td>
                      <td className="px-4 py-3">
                        <div 
                          className={`cursor-pointer ${isDefective(item.returnReason) ? 'text-red-500' : ''}`}
                          onClick={() => isDefective(item.returnReason) && handleReturnReasonClick(item)}
                        >
                          {simplifyReturnReason(item.returnReason)}
                        </div>
                      </td>
                      <td className="px-4 py-3">{item.returnTrackingNumber || '-'}</td>
                      <td className="px-4 py-3 font-mono whitespace-nowrap overflow-hidden text-ellipsis">{item.barcode || '-'}</td>
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
        <div className={`fixed inset-0 z-[${1000 + modalLevel}]`} style={{ zIndex: 1000 + modalLevel }}>
          <MatchProductModal
            isOpen={showProductMatchModal}
            onClose={handleCloseProductMatchModal}
            returnItem={currentMatchItem}
            products={returnState.products || []}
            onMatch={handleProductMatch}
          />
        </div>
      )}
      
      {/* 반품사유 상세 모달 */}
      {isReasonModalOpen && currentReasonItem && (
        <div className={`fixed inset-0 z-[${1000 + modalLevel}]`} style={{ zIndex: 1000 + modalLevel }}>
          <ReturnReasonModal
            isOpen={isReasonModalOpen}
            onClose={() => {
              setIsReasonModalOpen(false);
              setModalLevel(prev => Math.max(0, prev - 1));
            }}
            returnItem={currentReasonItem}
            detailReason={currentDetailReason || ''}
            onSave={handleSaveDetailReason}
            setDetailReason={setCurrentDetailReason}
          />
        </div>
      )}
    </main>
  );
}