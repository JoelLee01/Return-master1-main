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
    if (!reason || typeof reason !== 'string') return false;
    return reason && reason.includes && (reason.includes('불량') || reason.includes('하자'));
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

  // 입고완료된 반품목록을 메인 화면에 표시하기 위한 정렬된 데이터
  const sortedCompletedReturns = useMemo(() => {
    if (!returnState.completedReturns || returnState.completedReturns.length === 0) {
      return [];
    }
    // 날짜 기준으로 최신순 정렬
    return [...returnState.completedReturns]
      .sort((a, b) => {
        const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return dateB - dateA;
      });
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
    
    if (lowerReason && lowerReason.includes && (lowerReason.includes('변심') || lowerReason.includes('단순'))) {
      return '단순변심';
    }
    
    if (lowerReason && lowerReason.includes && (lowerReason.includes('파손') || lowerReason.includes('불량'))) {
      return '파손 및 불량';
    }
    
    if (lowerReason && lowerReason.includes && lowerReason.includes('잘못') && lowerReason.includes('주문')) {
      return '주문실수';
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
        status: 'COMPLETED',
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
    const foundItem = returnState.pendingReturns.find(
      item => item.returnTrackingNumber === trackingSearch.trim()
    );
    
    if (foundItem) {
      setTrackingSearchResult(foundItem);
      setMessage('송장번호로 반품 항목을 찾았습니다.');
    } else {
      setTrackingSearchResult(null);
      setMessage('해당 송장번호를 가진 반품 항목을 찾을 수 없습니다.');
    }
  };
  
  // 송장번호로 입고 처리 함수
  const handleReceiveByTracking = () => {
    if (!trackingSearchResult) return;
    
    // 입고 처리 로직
    const completedItem: ReturnItem = {
      ...trackingSearchResult,
      status: 'COMPLETED',
      completedAt: new Date()
    };
    
    // 대기 목록에서 제거
    dispatch({ 
      type: 'REMOVE_PENDING_RETURN', 
      payload: { id: trackingSearchResult.id } 
    });
    
    // 완료 목록에 추가
    dispatch({
      type: 'ADD_COMPLETED_RETURN',
      payload: completedItem
    });
    
    // 로컬 스토리지 업데이트
    saveLocalData(returnState);
    
    setMessage(`${completedItem.productName} 상품이 입고완료 처리되었습니다.`);
    setTrackingSearch('');
    setTrackingSearchResult(null);
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
          />
          <button
            className={`px-4 py-2 text-white rounded ${buttonColors.trackingButton}`}
            onClick={handleTrackingSearch}
            disabled={loading || !trackingSearch.trim()}
          >
            송장번호 검색
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
          <button
            className={`px-3 py-1 text-white rounded ${buttonColors.downloadButton}`}
            onClick={handleDownloadCompletedExcel}
            disabled={loading || returnState.completedReturns.length === 0}
          >
            목록 다운로드
          </button>
        </div>
        
        {returnState.completedReturns.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse border border-gray-300">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-2 py-2 border-x border-gray-300">
                    <input 
                      type="checkbox" 
                      checked={selectAllCompleted}
                      onChange={handleSelectAllCompleted}
                    />
                  </th>
                  <th className="px-2 py-2 border-x border-gray-300">순번</th>
                  <th className="px-2 py-2 border-x border-gray-300">주문번호</th>
                  <th className="px-2 py-2 border-x border-gray-300">고객명</th>
                  <th className="px-2 py-2 border-x border-gray-300">상품명</th>
                  <th className="px-2 py-2 border-x border-gray-300">옵션</th>
                  <th className="px-2 py-2 border-x border-gray-300">수량</th>
                  <th className="px-2 py-2 border-x border-gray-300">반품사유</th>
                  <th className="px-2 py-2 border-x border-gray-300">바코드</th>
                  <th className="px-2 py-2 border-x border-gray-300">사입명</th>
                  <th className="px-2 py-2 border-x border-gray-300">반품송장</th>
                </tr>
              </thead>
              <tbody>
                {sortedCompletedReturns.map((item, index) => (
                  <tr key={item.id} className="border-t border-gray-300 hover:bg-gray-50">
                    <td className="px-2 py-2 border-x border-gray-300">
                      <input 
                        type="checkbox" 
                        checked={selectedCompletedItems.includes(index)}
                        onChange={() => handleCompletedCheckboxChange(index)}
                      />
                    </td>
                    <td className="px-2 py-2 border-x border-gray-300">{index + 1}</td>
                    <td className="px-2 py-2 border-x border-gray-300">{item.orderNumber}</td>
                    <td className="px-2 py-2 border-x border-gray-300">{item.customerName}</td>
                    <td className="px-2 py-2 border-x border-gray-300">{item.productName}</td>
                    <td className="px-2 py-2 border-x border-gray-300">{item.optionName}</td>
                    <td className="px-2 py-2 border-x border-gray-300">{item.quantity}</td>
                    <td className="px-2 py-2 border-x border-gray-300">{item.returnReason}</td>
                    <td className="px-2 py-2 border-x border-gray-300">{item.barcode || '-'}</td>
                    <td className="px-2 py-2 border-x border-gray-300">{item.purchaseName || '-'}</td>
                    <td className="px-2 py-2 border-x border-gray-300">{item.returnTrackingNumber || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
      <dialog ref={pendingModalRef} className="modal w-11/12 max-w-5xl p-0 rounded-lg shadow-xl">
        <div className="modal-box bg-white p-6">
          <h3 className="font-bold text-lg mb-4 flex justify-between items-center">
            <span>입고전 반품 목록</span>
            <button onClick={() => pendingModalRef.current?.close()} className="btn btn-sm btn-circle">✕</button>
          </h3>
          
          {returnState.pendingReturns && returnState.pendingReturns.length > 0 ? (
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="min-w-full border-collapse border border-gray-300">
                <thead className="sticky top-0 bg-white">
                  <tr className="bg-gray-100">
                    <th className="px-2 py-2 border-x border-gray-300">
                      <input 
                        type="checkbox" 
                        checked={selectAll}
                        onChange={handleSelectAll}
                      />
                    </th>
                    <th className="px-2 py-2 border-x border-gray-300">고객명</th>
                    <th className="px-2 py-2 border-x border-gray-300">주문번호</th>
                    <th className="px-2 py-2 border-x border-gray-300">사입상품명</th>
                    <th className="px-2 py-2 border-x border-gray-300">옵션명</th>
                    <th className="px-2 py-2 border-x border-gray-300">수량</th>
                    <th className="px-2 py-2 border-x border-gray-300">반품사유</th>
                    <th className="px-2 py-2 border-x border-gray-300">바코드번호</th>
                    <th className="px-2 py-2 border-x border-gray-300">반품송장번호</th>
                    <th className="px-2 py-2 border-x border-gray-300">송장입력</th>
                  </tr>
                </thead>
                <tbody>
                  {returnState.pendingReturns.map((item, index) => (
                    <tr key={item.id} className="border-t border-gray-300 hover:bg-gray-50">
                      <td className="px-2 py-2 border-x border-gray-300">
                        <input 
                          type="checkbox" 
                          checked={selectedItems.includes(index)}
                          onChange={() => handleCheckboxChange(index)}
                        />
                      </td>
                      <td className="px-2 py-2 border-x border-gray-300">{item.customerName}</td>
                      <td className="px-2 py-2 border-x border-gray-300">{item.orderNumber}</td>
                      <td className="px-2 py-2 border-x border-gray-300">
                        {item.purchaseName || item.productName}
                      </td>
                      <td className="px-2 py-2 border-x border-gray-300">{item.optionName}</td>
                      <td className="px-2 py-2 border-x border-gray-300">{item.quantity}</td>
                      <td className="px-2 py-2 border-x border-gray-300">
                        <div className={`${isDefective(item.returnReason) ? 'text-red-500' : ''}`}>
                          {item.returnReason}
                        </div>
                      </td>
                      <td className="px-2 py-2 border-x border-gray-300">
                        {item.barcode ? (
                          <span className="font-mono">{item.barcode}</span>
                        ) : (
                          <button 
                            className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs"
                            onClick={() => handleProductMatchClick(item)}
                          >
                            매칭
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-2 border-x border-gray-300">
                        {item.returnTrackingNumber || '-'}
                      </td>
                      <td className="px-2 py-2 border-x border-gray-300">
                        <button
                          className="px-2 py-1 bg-indigo-500 hover:bg-indigo-600 text-white rounded text-xs"
                          onClick={() => handleTrackingNumberClick(item)}
                        >
                          송장입력
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>대기 중인 반품이 없습니다.</p>
          )}
          
          <div className="modal-action mt-6">
            {selectedItems.length > 0 && (
              <button 
                className="btn btn-success"
                onClick={handleProcessSelected}
              >
                선택항목 입고처리 ({selectedItems.length}개)
              </button>
            )}
            <button className="btn" onClick={() => pendingModalRef.current?.close()}>닫기</button>
          </div>
        </div>
      </dialog>
      
      {/* 상품 데이터 모달 */}
      <dialog ref={productModalRef} className="modal w-11/12 max-w-5xl p-0 rounded-lg shadow-xl">
        <div className="modal-box bg-white p-6">
          <h3 className="font-bold text-lg mb-4 flex justify-between items-center">
            <span>상품 데이터 목록</span>
            <button onClick={() => productModalRef.current?.close()} className="btn btn-sm btn-circle">✕</button>
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
            <button className="btn" onClick={() => productModalRef.current?.close()}>닫기</button>
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
        />
      )}
      
      {/* 반품사유 상세 모달 */}
      {isReasonModalOpen && currentReasonItem && (
        <ReturnReasonModal
          isOpen={isReasonModalOpen}
          onClose={() => setIsReasonModalOpen(false)}
          returnItem={currentReasonItem}
          detailReason={currentDetailReason || ''}
          onSave={handleSaveDetailReason}
          setDetailReason={setCurrentDetailReason}
        />
      )}
    </main>
  );
}