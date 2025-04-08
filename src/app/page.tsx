'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ReturnItem, ReturnState, ProductInfo } from '@/types/returns';
import { parseProductExcel, parseReturnExcel } from '@/utils/excel';
import { updateReturns, fetchReturns } from '@/firebase/firestore';
import * as XLSX from 'xlsx';
import { db, app } from '@/firebase/config';
import { collection, getDocs, query, limit } from 'firebase/firestore';

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
        updatedState.pendingReturns = [
          ...(updatedState.pendingReturns || []),
          ...returnItems.map(item => ({
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
        const chunkSize = 10;
        const chunks = splitIntoChunks(data, chunkSize);
        const totalChunks = chunks.length;
        
        safeConsoleError(`데이터를 ${totalChunks}개 청크로 분할하여 처리`);
        
        let processedChunks = 0;
        
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const progress = Math.round(((i + 1) / chunks.length) * 100);
          
          safeConsoleError(`청크 ${i+1}/${chunks.length} 처리 중 (${chunk.length}개 항목)`);
          setMessage(`청크 ${i+1}/${chunks.length} 처리 중... (${progress}%)`);
          setUploadProgress(progress);
          
          try {
            // Firebase에 직접 데이터 저장
            await updateReturns({
              type,
              data: chunk
            });
            
            safeConsoleError(`청크 ${i+1}/${chunks.length} 처리 완료`);
            processedChunks++;
          } catch (chunkError) {
            safeConsoleError(`청크 ${i+1}/${chunks.length} 처리 오류:`, chunkError);
            setMessage(`주의: 청크 ${i+1}/${chunks.length} 처리 중 오류 발생, 계속 진행 중... (${progress}%)`);
            // 오류가 발생해도 계속 진행
          }
          
          // 청크 사이 처리 지연 추가 (서버 부하 방지)
          if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 800));
          }
        }
        
        if (processedChunks === totalChunks) {
          setMessage(`${data.length}개 항목이 성공적으로 처리되었습니다.`);
    } else {
          setMessage(`${processedChunks}/${totalChunks} 청크 처리 완료. 일부 항목은 저장되지 않았을 수 있습니다.`);
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
        safeConsoleError('Firebase 저장 오류:', fbError);
        setMessage(`Firebase 저장 중 오류 발생: ${fbError instanceof Error ? fbError.message : '알 수 없는 오류'}`);
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