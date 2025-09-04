'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ReturnItem, ReturnState, ProductInfo } from '@/types/returns';
import { parseProductExcel, parseReturnExcel, generateExcel, generateCompletedReturnsExcel, simplifyOptionName } from '@/utils/excel';
import { updateReturns, fetchReturns } from '@/firebase/firestore';
import * as XLSX from 'xlsx';
import { db, app } from '@/firebase/config';
import { collection, getDocs, query, limit } from 'firebase/firestore';
import { useReturnState } from '@/hooks/useReturnState';
import { ReturnReasonModal } from '@/components/ReturnReasonModal';
import TrackingNumberModal from '@/components/TrackingNumberModal';
import MatchProductModal from '@/components/MatchProductModal';
import PendingReturnsModal from '@/components/PendingReturnsModal';
import ManualRematchModal from '@/components/ManualRematchModal';
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

// 핵심 키워드 추출 함수 - 일반적인 키워드를 제거하고 구체적인 키워드만 추출
function extractCoreKeywords(productName: string): string[] {
  if (!productName) return [];
  
  const text = productName.toLowerCase().trim();
  
  // 제거할 일반적인 키워드들 (모든 상품에서 공통으로 사용되는 키워드)
  const commonKeywords = [
    '여름', '원피스', '상의', '하의', '의류', '옷', '패션', '쇼핑', '온라인',
    '빅사이즈', '사이즈', '컬러', '색상', '색', '무료배송', '배송', '할인',
    '신상', '신제품', '인기', '베스트', '추천', '특가', '세일', 'sale'
  ];
  
  // 구체적인 키워드들 (상품의 특징을 나타내는 키워드)
  const specificKeywords = [
    '스판', '차르르', '편안한', '롱', '숏', '미니', '맥시', '롱기장', '숏기장',
    '쿨소재', '시원한', '통풍', '흡수', '속건', '드라이', '쿨링', '냉감',
    '린넨', '면', '폴리에스터', '나일론', '스판덱스', '레이온', '비스코스',
    '프릴', '레이스', '자수', '프린트', '스트라이프', '도트', '체크', '플라워',
    '넥라인', '라운드넥', '브이넥', '오프숄더', '원숄더', '터틀넥', '하이넥',
    '슬리브', '반팔', '긴팔', '무지', '민소매', '나시', '크롭', '하이웨이스트',
    '플레어', 'A라인', 'H라인', '오버핏', '타이트', '루즈', '슬림', '와이드',
    '마마', 'ops', '블리', '프', '차르르', '편안한', '편안', '편안함'
  ];
  
  // 텍스트에서 구체적인 키워드만 추출
  const foundKeywords = specificKeywords.filter(keyword => 
    text.includes(keyword)
  );
  
  // 일반적인 키워드가 포함되어 있으면 가중치를 낮춤
  const hasCommonKeywords = commonKeywords.some(keyword => 
    text.includes(keyword)
  );
  
  console.log(`🔍 키워드 추출: "${productName}" → [${foundKeywords.join(', ')}] ${hasCommonKeywords ? '(일반키워드 포함)' : '(구체적 키워드만)'}`);
  
  return foundKeywords;
}

// 개선된 문자열 유사도 계산 함수 - 핵심 키워드 기반
function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  const text1 = str1.toLowerCase().trim();
  const text2 = str2.toLowerCase().trim();
  
  if (text1 === text2) return 1.0;
  
  // 1단계: 개선된 키워드 기반 매칭 (순서와 문맥 고려)
  const keywords1 = extractCoreKeywords(str1);
  const keywords2 = extractCoreKeywords(str2);
  
  if (keywords1.length > 0 && keywords2.length > 0) {
    // 공통 키워드 찾기
    const commonKeywords = keywords1.filter(kw => keywords2.includes(kw));
    
    if (commonKeywords.length > 0) {
      // 1-1. 키워드 개수 기반 점수 계산 (가장 높은 가중치)
      const countScore = calculateKeywordCountScore(str1, str2, commonKeywords);
      
      // 1-2. 키워드 정확성 점수 계산 (공통 키워드의 정확한 매칭)
      const accuracyScore = calculateKeywordAccuracyScore(str1, str2, commonKeywords);
      
      // 1-3. 키워드 순서 기반 매칭 점수 계산 (낮은 가중치)
      const orderScore = calculateKeywordOrderScore(str1, str2, commonKeywords);
      
      // 1-4. 키워드 밀도 기반 점수 계산
      const densityScore = calculateKeywordDensityScore(str1, str2, commonKeywords);
      
      // 최종 키워드 유사도 = (개수점수 * 0.5) + (정확성점수 * 0.3) + (순서점수 * 0.1) + (밀도점수 * 0.1)
      const keywordSimilarity = (countScore * 0.5) + (accuracyScore * 0.3) + (orderScore * 0.1) + (densityScore * 0.1);
      
      console.log(`🎯 키워드 매칭 분석: "${str1}" vs "${str2}"`);
      console.log(`   공통키워드: [${commonKeywords.join(', ')}] (${commonKeywords.length}개)`);
      console.log(`   개수점수: ${countScore.toFixed(2)}, 정확성점수: ${accuracyScore.toFixed(2)}, 순서점수: ${orderScore.toFixed(2)}, 밀도점수: ${densityScore.toFixed(2)}`);
      console.log(`   최종 키워드 유사도: ${keywordSimilarity.toFixed(2)}`);
      
      // 키워드 유사도가 높으면 높은 점수 반환
      if (keywordSimilarity > 0.6) {
        return Math.min(0.95, keywordSimilarity + 0.2); // 최대 0.95점
      }
    }
  }
  
  // 2단계: 기존 Levenshtein 거리 계산 (fallback)
  const longer = text1.length > text2.length ? text1 : text2;
  const shorter = text1.length > text2.length ? text2 : text1;
  
  if (longer.length === 0) return 1.0;
  
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
  
  const distance = levenshteinDistance(longer, shorter);
  const basicSimilarity = (longer.length - distance) / longer.length;
  
  // 일반적인 키워드가 많으면 가중치를 낮춤
  const hasCommonKeywords1 = ['여름', '원피스', '상의', '하의'].some(kw => text1.includes(kw));
  const hasCommonKeywords2 = ['여름', '원피스', '상의', '하의'].some(kw => text2.includes(kw));
  
  if (hasCommonKeywords1 && hasCommonKeywords2) {
    return basicSimilarity * 0.7; // 일반 키워드 매칭은 가중치 감소
  }
  
  return basicSimilarity;
}

// 키워드 개수 기반 점수 계산 (가장 높은 가중치)
function calculateKeywordCountScore(str1: string, str2: string, commonKeywords: string[]): number {
  const keywords1 = extractCoreKeywords(str1);
  const keywords2 = extractCoreKeywords(str2);
  
  // 공통 키워드 개수가 많을수록 높은 점수
  const maxKeywords = Math.max(keywords1.length, keywords2.length);
  const commonCount = commonKeywords.length;
  
  if (maxKeywords === 0) return 0;
  
  // 공통 키워드 비율 계산
  const ratio = commonCount / maxKeywords;
  
  // 키워드 개수가 많을수록 가중치 증가
  const countBonus = Math.min(0.2, commonCount * 0.05); // 최대 0.2 보너스
  
  return Math.min(1.0, ratio + countBonus);
}

// 키워드 정확성 점수 계산
function calculateKeywordAccuracyScore(str1: string, str2: string, commonKeywords: string[]): number {
  const text1 = str1.toLowerCase();
  const text2 = str2.toLowerCase();
  
  let totalAccuracy = 0;
  let validKeywords = 0;
  
  for (const keyword of commonKeywords) {
    // 각 키워드가 두 텍스트에서 정확히 일치하는지 확인
    const matches1 = (text1.match(new RegExp(keyword, 'g')) || []).length;
    const matches2 = (text2.match(new RegExp(keyword, 'g')) || []).length;
    
    // 키워드가 정확히 같은 횟수로 나타나면 높은 점수
    if (matches1 === matches2) {
      totalAccuracy += 1.0;
    } else {
      // 차이가 적을수록 높은 점수
      const diff = Math.abs(matches1 - matches2);
      const maxMatches = Math.max(matches1, matches2);
      totalAccuracy += maxMatches > 0 ? (maxMatches - diff) / maxMatches : 0;
    }
    validKeywords++;
  }
  
  return validKeywords > 0 ? totalAccuracy / validKeywords : 0;
}

// 키워드 순서 기반 매칭 점수 계산 (낮은 가중치)
function calculateKeywordOrderScore(str1: string, str2: string, commonKeywords: string[]): number {
  const text1 = str1.toLowerCase();
  const text2 = str2.toLowerCase();
  
  // 각 키워드의 위치를 찾아서 순서 점수 계산
  const positions1 = commonKeywords.map(kw => text1.indexOf(kw)).filter(pos => pos !== -1);
  const positions2 = commonKeywords.map(kw => text2.indexOf(kw)).filter(pos => pos !== -1);
  
  if (positions1.length === 0 || positions2.length === 0) return 0;
  
  // 키워드 순서의 상대적 위치 비교
  let orderMatches = 0;
  for (let i = 0; i < Math.min(positions1.length, positions2.length) - 1; i++) {
    const relativePos1 = positions1[i + 1] - positions1[i];
    const relativePos2 = positions2[i + 1] - positions2[i];
    
    // 상대적 위치가 비슷하면 점수 증가
    if (Math.abs(relativePos1 - relativePos2) < 5) {
      orderMatches++;
    }
  }
  
  return positions1.length > 1 ? orderMatches / (positions1.length - 1) : 1.0;
}

// 키워드 밀도 기반 점수 계산
function calculateKeywordDensityScore(str1: string, str2: string, commonKeywords: string[]): number {
  const text1 = str1.toLowerCase();
  const text2 = str2.toLowerCase();
  
  // 각 텍스트에서 키워드가 차지하는 비율 계산
  const keywordLength1 = commonKeywords.reduce((sum, kw) => sum + (text1.match(new RegExp(kw, 'g')) || []).length * kw.length, 0);
  const keywordLength2 = commonKeywords.reduce((sum, kw) => sum + (text2.match(new RegExp(kw, 'g')) || []).length * kw.length, 0);
  
  const density1 = keywordLength1 / text1.length;
  const density2 = keywordLength2 / text2.length;
  
  // 밀도 차이가 적을수록 높은 점수
  return 1 - Math.abs(density1 - density2);
}


// 기본 문자열 유사도 계산 (간단한 버전)
function calculateBasicStringSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0;
  
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1.0;
  
  // 간단한 편집 거리 계산
  let distance = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (s1[i] !== s2[i]) distance++;
  }
  distance += Math.abs(s1.length - s2.length);
  
  return (longer.length - distance) / longer.length;
}

// 기존 stringSimilarity 함수는 calculateSimilarity로 대체됨
function stringSimilarity(s1: string, s2: string): number {
  // 새로운 calculateSimilarity 함수를 사용하도록 리다이렉트
  return calculateSimilarity(s1, s2);
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
  const refreshButtonRef = useRef<HTMLButtonElement>(null);
  
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
  
  // 입고전 모달 상태
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  
  // 수동 재매칭 모달 상태
  const [isManualRematchModalOpen, setIsManualRematchModalOpen] = useState(false);
  
  // 날짜 변경 모달 상태
  const [isDateChangeModalOpen, setIsDateChangeModalOpen] = useState(false);
  const [selectedDateForChange, setSelectedDateForChange] = useState<string>('');
  
  // 표 및 텍스트 크기 조정 상태
  const [showTableSizeSettings, setShowTableSizeSettings] = useState(false);
              const [tableSettings, setTableSettings] = useState({
              // 입고전 반품목록 팝업 설정 (고정값)
              popupWidth: 85, // 팝업 너비 (vw) - 고정
              popupHeight: 84.5, // 팝업 높이 (vh) - 고정
              popupTableFontSize: 1, // 입고전 반품목록 테이블 폰트 크기 (rem) - 고정
              popupBarcodeFontSize: 0.7, // 입고전 반품목록 바코드 정보 폰트 크기 (rem) - 고정
              popupCellPadding: 0.5, // 입고전 반품목록 셀 패딩 (rem) - 고정
              popupLineHeight: 1, // 입고전 반품목록 줄 높이 - 고정

              // 메인 화면 테이블 설정 (고정값)
              mainTableFontSize: 1, // 메인 화면 테이블 폰트 크기 (rem) - 고정
              mainBarcodeFontSize: 0.7, // 메인 화면 바코드 정보 폰트 크기 (rem) - 고정
              mainCellPadding: 0.5, // 메인 화면 셀 패딩 (rem) - 고정
              mainLineHeight: 1.1, // 메인 화면 줄 높이 - 고정

              // 컬럼 정렬 설정 (고정값)
              columnAlignment: {
                customerName: 'center', // 고객명 정렬 (left, center, right) - 고정
                orderNumber: 'center', // 주문번호 정렬 - 고정
                productName: 'left', // 상품명 정렬 - 고정
                optionName: 'center', // 옵션명 정렬 - 고정
                quantity: 'center', // 수량 정렬 - 고정
                returnReason: 'center', // 반품사유 정렬 - 고정
                trackingNumber: 'center', // 송장번호 정렬 - 고정
                barcode: 'left', // 바코드 정렬 - 고정
                actions: 'center' // 액션 버튼 정렬 - 고정
              },

              // 컬럼 너비 설정 (px) - 고정값
              columnWidths: {
                customerName: 80, // 고객명 너비 - 고정
                orderNumber: 125, // 주문번호 너비 - 고정
                productName: 140, // 상품명 너비 - 고정
                optionName: 115, // 옵션명 너비 - 고정
                quantity: 30, // 수량 너비 - 고정
                returnReason: 80, // 반품사유 너비 - 고정
                trackingNumber: 120, // 송장번호 너비 - 고정
                barcode: 120, // 바코드 너비 - 고정
                mainBarcode: 130, // 메인화면 바코드 너비 - 고정 (10px 증가)
                actions: 30 // 액션 버튼 너비 - 고정
              },

              // 자동 텍스트 크기 조정 설정
              autoTextSize: {
                enabled: true, // 자동 텍스트 크기 조정 활성화
                minFontSize: 0.6, // 최소 폰트 크기 (rem)
                maxFontSize: 1.2, // 최대 폰트 크기 (rem)
                adjustForOverflow: true // 오버플로우 방지
              },

              // 바코드번호 필드 특별 형식 설정
              barcodeFormat: {
                enabled: true, // 바코드번호 특별 형식 활성화
                mainCodeSize: 1.1, // 메인 코드 크기 (rem) - B-10235520009
                subInfoSize: 0.7, // 서브 정보 크기 (rem) - (895 라이트그레이, 3사이즈)
                lineHeight: 1.1 // 줄 간격
              }
            });
  
  // 아이템 선택 핸들러
  const handleItemSelect = (item: ReturnItem, checked: boolean) => {
    const itemIndex = returnState.pendingReturns.findIndex(i => i.id === item.id);
    if (checked) {
      setSelectedItems(prev => [...prev, itemIndex]);
    } else {
      setSelectedItems(prev => prev.filter(idx => idx !== itemIndex));
    }
  };
  
  // 오류 포착 핸들러
  const handleError = useCallback((error: any, context: string) => {
    safeConsoleError(`[${context}] 오류:`, error);
    setMessage(`${context} 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    return null;
  }, []);
  
  // 로컬 스토리지에서 데이터 로드
  const loadLocalData = () => {
    try {
      // 기존의 큰 returnData 정리 (할당량 초과 방지)
      if (localStorage.getItem('returnData')) {
        console.log('기존 returnData 정리 중...');
        localStorage.removeItem('returnData');
      }
      
      // 압축된 데이터 불러오기 및 해제
      const loadCompressedData = (key: string) => {
        const data = localStorage.getItem(key);
        if (!data) return [];
        
        try {
          // 압축된 데이터인지 확인 (간단한 체크)
          if (data.includes('"pN"') || data.includes('"oN"') || data.includes('"cN"')) {
            return decompressData(data);
          } else {
            return JSON.parse(data);
          }
        } catch (error) {
          console.error(`${key} 데이터 로드 오류:`, error);
          return [];
        }
      };
      
      // 나눠서 저장된 데이터 불러오기
      const pendingReturns = loadCompressedData('pendingReturns');
      const completedReturns = loadCompressedData('completedReturns');
      const products = loadCompressedData('products');
      const lastUpdated = localStorage.getItem('lastUpdated');

      // 불러온 데이터가 있다면 상태 업데이트
      if (pendingReturns.length > 0 || completedReturns.length > 0 || products.length > 0) {
        const returnData: ReturnState = {
          pendingReturns,
          completedReturns,
          products
        };
        
        dispatch({ type: 'SET_RETURNS', payload: returnData });
        setMessage(`마지막 업데이트: ${new Date(lastUpdated || '').toLocaleString()}`);
      }
    } catch (error) {
      console.error('로컬 데이터 로드 오류:', error);
      setMessage('로컬 데이터를 불러오는 중 오류가 발생했습니다.');
    }
  };
  
  // 데이터 압축 함수
  const compressData = (data: any): string => {
    try {
      const jsonString = JSON.stringify(data);
      // 간단한 압축: 반복되는 키 줄이기
      return jsonString
        .replace(/("productName")/g, '"pN"')
        .replace(/("optionName")/g, '"oN"')
        .replace(/("customerName")/g, '"cN"')
        .replace(/("returnReason")/g, '"rR"')
        .replace(/("barcode")/g, '"bc"')
        .replace(/("quantity")/g, '"qty"')
        .replace(/("zigzagProductCode")/g, '"zpc"')
        .replace(/("purchaseName")/g, '"pnm"');
    } catch (error) {
      console.error('데이터 압축 오류:', error);
      return JSON.stringify(data);
    }
  };

  // 데이터 압축 해제 함수
  const decompressData = (compressedString: string): any => {
    try {
      const decompressed = compressedString
        .replace(/("pN")/g, '"productName"')
        .replace(/("oN")/g, '"optionName"')
        .replace(/("cN")/g, '"customerName"')
        .replace(/("rR")/g, '"returnReason"')
        .replace(/("bc")/g, '"barcode"')
        .replace(/("qty")/g, '"quantity"')
        .replace(/("zpc")/g, '"zigzagProductCode"')
        .replace(/("pnm")/g, '"purchaseName"');
      return JSON.parse(decompressed);
    } catch (error) {
      console.error('데이터 압축 해제 오류:', error);
      return JSON.parse(compressedString);
    }
  };

  // 로컬 스토리지 크기 제한을 고려하여 데이터 저장
  const saveLocalData = (data: ReturnState) => {
    try {
      // 우선순위에 따라 저장 (중요도 순)
      const saveWithFallback = (key: string, value: any) => {
        try {
          const compressed = compressData(value);
          localStorage.setItem(key, compressed);
          return true;
        } catch (error: any) {
          if (error.name === 'QuotaExceededError') {
            console.warn(`${key} 저장 실패 - 할당량 초과, 데이터 크기 줄이기 시도`);
            
            // 데이터 크기 줄이기
            if (Array.isArray(value) && value.length > 100) {
              // 최근 100개만 저장
              const reduced = value.slice(-100);
              try {
                const compressedReduced = compressData(reduced);
                localStorage.setItem(key, compressedReduced);
                console.log(`${key} 데이터 크기 축소 저장 성공 (${value.length} -> ${reduced.length})`);
                return true;
              } catch (retryError) {
                console.error(`${key} 축소 저장도 실패:`, retryError);
                return false;
              }
            }
            return false;
          }
          throw error;
        }
      };

      // 중요도 순서로 저장
      const pendingSuccess = saveWithFallback('pendingReturns', data.pendingReturns || []);
      const completedSuccess = saveWithFallback('completedReturns', data.completedReturns || []);
      const productsSuccess = saveWithFallback('products', data.products || []);
      
      localStorage.setItem('lastUpdated', new Date().toISOString());
      
      if (!pendingSuccess || !completedSuccess || !productsSuccess) {
        setMessage('일부 데이터가 크기 제한으로 인해 축소 저장되었습니다.');
      }
      
      return true;
    } catch (error) {
      console.error('로컬 스토리지 저장 오류:', error);
      setMessage('데이터 저장 중 오류가 발생했습니다. 브라우저 저장공간을 확인해주세요.');
      return false;
    }
  };
  
  // 로컬 데이터 자동 저장 함수 (Firebase 대신)
  const autoSaveLocalData = useCallback(() => {
    try {
      // 현재 상태를 로컬 스토리지에 자동 저장
      saveLocalData(returnState);
      console.log('로컬 데이터 자동 저장 완료');
    } catch (error) {
      console.error('자동 저장 실패:', error);
    }
  }, [returnState]);

  // 데이터 변경시 자동 저장 (Firebase 대신 로컬 저장소 사용)
  useEffect(() => {
    // 데이터가 있을 때만 자동 저장 (초기 로드 시 제외)
    if (returnState.pendingReturns.length > 0 || 
        returnState.completedReturns.length > 0 || 
        returnState.products.length > 0) {
      
      // 디바운스를 위한 타이머
      const timer = setTimeout(() => {
        autoSaveLocalData();
      }, 1000); // 1초 후 저장
      
      return () => clearTimeout(timer);
    }
  }, [returnState, autoSaveLocalData]);

  // 스토리지 정리 함수
  const clearStorageIfNeeded = () => {
    try {
      // 로컬 스토리지 사용량 체크 (대략적)
      let totalSize = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          totalSize += localStorage[key].length;
        }
      }
      
      // 5MB 이상이면 정리 (브라우저 기본 한도의 절반)
      if (totalSize > 5 * 1024 * 1024) {
        console.log('로컬 스토리지 용량 정리 시작...');
        
        // 불필요한 키들 삭제
        const keysToRemove = ['returnData', 'returnData_backup'];
        keysToRemove.forEach(key => {
          if (localStorage.getItem(key)) {
            localStorage.removeItem(key);
            console.log(`${key} 삭제됨`);
          }
        });
        
        setMessage('로컬 스토리지 정리 완료');
      }
    } catch (error) {
      console.error('스토리지 정리 오류:', error);
    }
  };

  // useEffect에서 데이터 로드 - Firebase 의존성 제거
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // 스토리지 정리
      clearStorageIfNeeded();
      
      // 로컬 데이터만 로드 (Firebase 제거)
      loadLocalData();
      
      // 초기 메시지 설정
      if (!localStorage.getItem('pendingReturns') && !localStorage.getItem('completedReturns')) {
        setMessage('로컬 저장소에서 데이터를 불러왔습니다. 엑셀 파일을 업로드하여 시작하세요.');
      }
    }
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
  
  // 표 설정 저장
  useEffect(() => {
    // 로컬 스토리지에서 표 설정 로드
    const savedTableSettings = localStorage.getItem('tableSettings');
    if (savedTableSettings) {
      try {
        const parsedSettings = JSON.parse(savedTableSettings);
        
        // 기본값과 병합하여 누락된 속성 보완
        const mergedSettings = {
          // 기본값
          popupWidth: 81,
          popupHeight: 67.5,
          popupTableFontSize: 1,
          popupBarcodeFontSize: 0.7,
          popupCellPadding: 0.5,
          popupLineHeight: 1.2,
          mainTableFontSize: 1,
          mainBarcodeFontSize: 0.7,
          mainCellPadding: 0.75,
          mainLineHeight: 1.2,
          columnAlignment: {
            customerName: 'center',
            orderNumber: 'center',
            productName: 'left',
            optionName: 'center',
            quantity: 'center',
            returnReason: 'center',
            trackingNumber: 'center',
            barcode: 'left',
            actions: 'center'
          },
          columnWidths: {
            customerName: 120,
            orderNumber: 100,
            productName: 200,
            optionName: 120,
            quantity: 30, // 최소 PX를 30으로 조정
            returnReason: 80, // 최소 PX를 80으로 조정
            trackingNumber: 120,
            barcode: 180,
            actions: 30 // 최소 PX를 30으로 조정
          },
          autoTextSize: {
            enabled: true,
            minFontSize: 0.6,
            maxFontSize: 1.2,
            adjustForOverflow: true
          },
          barcodeFormat: {
            enabled: true,
            mainCodeSize: 1.1,
            subInfoSize: 0.7,
            lineHeight: 1.1
          },
          // 저장된 설정으로 덮어쓰기
          ...parsedSettings
        };
        
        setTableSettings(mergedSettings);
        
        // 로드된 설정을 즉시 CSS에 적용
        const root = document.documentElement;
        
        // 입고전 반품목록 팝업 설정
        root.style.setProperty('--popup-width', `${mergedSettings.popupWidth}vw`);
        root.style.setProperty('--popup-height', `${mergedSettings.popupHeight}vh`);
        root.style.setProperty('--popup-table-font-size', `${mergedSettings.popupTableFontSize}rem`);
        root.style.setProperty('--popup-barcode-font-size', `${mergedSettings.popupBarcodeFontSize}rem`);
        root.style.setProperty('--popup-cell-padding', `${mergedSettings.popupCellPadding}rem`);
        root.style.setProperty('--popup-line-height', mergedSettings.popupLineHeight.toString());

        // 메인 화면 테이블 설정
        root.style.setProperty('--main-table-font-size', `${mergedSettings.mainTableFontSize}rem`);
        root.style.setProperty('--main-barcode-font-size', `${mergedSettings.mainBarcodeFontSize}rem`);
        root.style.setProperty('--main-cell-padding', `${mergedSettings.mainCellPadding}rem`);
        root.style.setProperty('--main-line-height', mergedSettings.mainLineHeight.toString());

        // 컬럼 정렬 설정
        if (mergedSettings.columnAlignment) {
          Object.entries(mergedSettings.columnAlignment).forEach(([column, alignment]) => {
            root.style.setProperty(`--column-${column}-alignment`, alignment as string);
          });
        }

        // 컬럼 너비 설정
        if (mergedSettings.columnWidths) {
          Object.entries(mergedSettings.columnWidths).forEach(([column, width]) => {
            root.style.setProperty(`--column-${column}-width`, `${width}px`);
          });
          
          // 메인화면 바코드 너비 별도 설정
          if (mergedSettings.columnWidths.mainBarcode) {
            root.style.setProperty('--column-main-barcode-width', `${mergedSettings.columnWidths.mainBarcode}px`);
          }
        }

        // 자동 텍스트 크기 설정
        if (mergedSettings.autoTextSize) {
          Object.entries(mergedSettings.autoTextSize).forEach(([key, value]) => {
            const cssKey = key === 'enabled' ? 'enabled' : 
                          key === 'minFontSize' ? 'minFontSize' :
                          key === 'maxFontSize' ? 'maxFontSize' :
                          key === 'adjustForOverflow' ? 'adjustForOverflow' : key;
            root.style.setProperty(`--auto-text-size-${cssKey}`, String(value));
          });
        }

        // 바코드번호 형식 설정
        if (mergedSettings.barcodeFormat) {
          Object.entries(mergedSettings.barcodeFormat).forEach(([key, value]) => {
            const cssKey = key === 'enabled' ? 'enabled' : 
                          key === 'mainCodeSize' ? 'mainCodeSize' :
                          key === 'subInfoSize' ? 'subInfoSize' :
                          key === 'lineHeight' ? 'lineHeight' : key;
            root.style.setProperty(`--barcode-format-${cssKey}`, String(value));
          });
        }
        
        // 설정 로드 후 오버플로우 감지 실행
        console.log('설정 로드 완료 - 오버플로우 감지 실행 예정');
        setTimeout(() => {
          console.log('설정 로드 후 오버플로우 감지 실행 중...');
          if (mergedSettings.autoTextSize.enabled) {
            detectAndHandleOverflow();
          }
        }, 200);
      } catch (e) {
        console.error('표 설정 로드 오류:', e);
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
  
  // 표 설정 변경 핸들러
  const handleTableSettingChange = (key: string, value: number) => {
    const newSettings = { ...tableSettings };
    
    // 중첩된 객체의 속성을 업데이트
    if (key.includes('.')) {
      const [parentKey, childKey] = key.split('.');
      if (newSettings[parentKey as keyof typeof tableSettings] && 
          typeof newSettings[parentKey as keyof typeof tableSettings] === 'object') {
        (newSettings[parentKey as keyof typeof tableSettings] as any)[childKey] = value;
      }
    } else {
      // 최상위 속성 업데이트
      (newSettings as any)[key] = value;
    }
    
    setTableSettings(newSettings);
    localStorage.setItem('tableSettings', JSON.stringify(newSettings));
    
    // CSS 변수 즉시 적용
    const root = document.documentElement;
    
    // CSS 변수명 매핑
    const cssVariableMap: { [key: string]: string } = {
      popupWidth: '--popup-width',
      popupHeight: '--popup-height',
      popupTableFontSize: '--popup-table-font-size',
      popupBarcodeFontSize: '--popup-barcode-font-size',
      popupCellPadding: '--popup-cell-padding',
      popupLineHeight: '--popup-line-height',
      mainTableFontSize: '--main-table-font-size',
      mainBarcodeFontSize: '--main-barcode-font-size',
      mainCellPadding: '--main-cell-padding',
      mainLineHeight: '--main-line-height'
    };
    
    const cssVarName = cssVariableMap[key];
    if (cssVarName) {
      let unit = '';
      if (key.includes('FontSize') || key.includes('Padding')) {
        unit = 'rem';
      } else if (key.includes('Width') && key !== 'popupWidth') {
        unit = 'px';
      } else if (key.includes('Height')) {
        unit = 'vh';
      } else if (key === 'popupWidth') {
        unit = 'vw';
      }
      root.style.setProperty(cssVarName, `${value}${unit}`);
    }
    
    // autoTextSize와 barcodeFormat 속성도 처리
    if (key.startsWith('autoTextSize.') || key.startsWith('barcodeFormat.')) {
      const [parentKey, childKey] = key.split('.');
      if (newSettings[parentKey as keyof typeof tableSettings] && 
          typeof newSettings[parentKey as keyof typeof tableSettings] === 'object') {
        const parentObj = newSettings[parentKey as keyof typeof tableSettings] as any;
        if (parentObj[childKey] !== undefined) {
          const cssKey = parentKey === 'autoTextSize' ? 
            (childKey === 'enabled' ? 'enabled' : 
             childKey === 'minFontSize' ? 'minFontSize' :
             childKey === 'maxFontSize' ? 'maxFontSize' :
             childKey === 'adjustForOverflow' ? 'adjustForOverflow' : childKey) :
            (childKey === 'enabled' ? 'enabled' : 
             childKey === 'mainCodeSize' ? 'mainCodeSize' :
             childKey === 'subInfoSize' ? 'subInfoSize' :
             childKey === 'lineHeight' ? 'lineHeight' : childKey);
          root.style.setProperty(`--${parentKey}-${cssKey}`, String(parentObj[childKey]));
        }
      }
    }
    
    // 설정 변경 후 오버플로우 감지 실행
    if (tableSettings.autoTextSize.enabled) {
      setTimeout(detectAndHandleOverflow, 100);
    }
  };

  // 컬럼 정렬 변경 핸들러
  const handleColumnAlignmentChange = (column: string, alignment: 'left' | 'center' | 'right') => {
    const newSettings = { ...tableSettings };
    newSettings.columnAlignment[column as keyof typeof tableSettings.columnAlignment] = alignment;
    setTableSettings(newSettings);
    localStorage.setItem('tableSettings', JSON.stringify(newSettings));
    
    // CSS 변수 즉시 적용
    const root = document.documentElement;
    root.style.setProperty(`--column-${column}-alignment`, alignment);
  };

  // 컬럼 너비 변경 핸들러
  const handleColumnWidthChange = (column: string, width: number) => {
    const newSettings = { ...tableSettings };
    newSettings.columnWidths[column as keyof typeof tableSettings.columnWidths] = width;
    setTableSettings(newSettings);
    localStorage.setItem('tableSettings', JSON.stringify(newSettings));
    
    // CSS 변수 즉시 적용
    const root = document.documentElement;
    root.style.setProperty(`--column-${column}-width`, `${width}px`);
    
    // 너비 변경 후 오버플로우 감지 실행
    if (tableSettings.autoTextSize.enabled) {
      setTimeout(detectAndHandleOverflow, 100);
    }
  };

  // 자동 텍스트 크기 설정 변경 핸들러
  const handleAutoTextSizeChange = (key: string, value: any) => {
    console.log(`자동 텍스트 크기 설정 변경: ${key} = ${value}`);
    
    const newSettings = { ...tableSettings };
    if (key === 'enabled' || key === 'adjustForOverflow') {
      newSettings.autoTextSize[key] = value as boolean;
    } else {
      newSettings.autoTextSize[key] = value as number;
    }
    setTableSettings(newSettings);
    localStorage.setItem('tableSettings', JSON.stringify(newSettings));
    
    // CSS 변수명 매핑
    const cssKey = key === 'enabled' ? 'enabled' : 
                  key === 'minFontSize' ? 'minFontSize' :
                  key === 'maxFontSize' ? 'maxFontSize' :
                  key === 'adjustForOverflow' ? 'adjustForOverflow' : key;
    
    // CSS 변수 즉시 적용
    const root = document.documentElement;
    root.style.setProperty(`--auto-text-size-${cssKey}`, value.toString());
    console.log(`CSS 변수 설정: --auto-text-size-${cssKey} = ${value}`);
    
    // 설정 변경 후 오버플로우 감지 실행 (모든 변경에 대해)
    console.log('오버플로우 감지 실행 예정...');
    setTimeout(() => {
      console.log('오버플로우 감지 실행 중...');
      detectAndHandleOverflow();
    }, 100);
  };

  // 바코드번호 형식 설정 변경 핸들러
  const handleBarcodeFormatChange = (key: string, value: any) => {
    console.log(`바코드 형식 설정 변경: ${key} = ${value}`);
    
    const newSettings = { ...tableSettings };
    if (key === 'enabled') {
      newSettings.barcodeFormat[key] = value as boolean;
    } else {
      newSettings.barcodeFormat[key] = value as number;
    }
    setTableSettings(newSettings);
    localStorage.setItem('tableSettings', JSON.stringify(newSettings));
    
    // CSS 변수명 매핑
    const cssKey = key === 'enabled' ? 'enabled' : 
                  key === 'mainCodeSize' ? 'mainCodeSize' :
                  key === 'subInfoSize' ? 'subInfoSize' :
                  key === 'lineHeight' ? 'lineHeight' : key;
    
    // CSS 변수 즉시 적용
    const root = document.documentElement;
    root.style.setProperty(`--barcode-format-${cssKey}`, value.toString());
    console.log(`CSS 변수 설정: --barcode-format-${cssKey} = ${value}`);
    
    // 설정 변경 후 오버플로우 감지 실행 (모든 변경에 대해)
    console.log('바코드 형식 변경으로 오버플로우 감지 실행 예정...');
    setTimeout(() => {
      console.log('바코드 형식 변경으로 오버플로우 감지 실행 중...');
      detectAndHandleOverflow();
    }, 100);
  };

  // 자동 텍스트 크기 조정을 위한 오버플로우 감지 함수
  const detectAndHandleOverflow = useCallback(() => {
    console.log('=== 오버플로우 감지 함수 호출 ===');
    console.log('현재 설정 상태:', {
      enabled: tableSettings.autoTextSize.enabled,
      adjustForOverflow: tableSettings.autoTextSize.adjustForOverflow,
      minFontSize: tableSettings.autoTextSize.minFontSize,
      maxFontSize: tableSettings.autoTextSize.maxFontSize
    });
    
    if (!tableSettings.autoTextSize.enabled) {
      console.log('자동 텍스트 크기 조정이 비활성화되어 있습니다.');
      return;
    }

    console.log('오버플로우 감지 시작...');
    const tables = document.querySelectorAll('.pending-returns-table, .main-table');
    console.log(`발견된 테이블 수: ${tables.length}`);
    
    let totalCells = 0;
    let overflowCells = 0;
    
    tables.forEach((table, tableIndex) => {
      const cells = table.querySelectorAll('td');
      console.log(`테이블 ${tableIndex + 1}: ${cells.length}개 셀 발견`);
      
      cells.forEach((cell, cellIndex) => {
        totalCells++;
        const cellElement = cell as HTMLElement;
        const content = cellElement.textContent || '';
        
        // 빈 내용이거나 공백만 있는 경우 스킵
        if (content.trim().length === 0) {
          cellElement.classList.remove('overflow-detected');
          cellElement.style.removeProperty('font-size');
          cellElement.style.removeProperty('line-height');
          cellElement.style.removeProperty('white-space');
          cellElement.style.removeProperty('word-break');
          cellElement.style.removeProperty('overflow');
          cellElement.style.removeProperty('text-overflow');
          // max-width는 제거하지 않음 (컬럼 너비 유지)
          return;
        }

        // 현재 스타일을 임시로 저장
        const originalFontSize = cellElement.style.fontSize;
        const originalLineHeight = cellElement.style.lineHeight;
        const originalWhiteSpace = cellElement.style.whiteSpace;
        const originalWordBreak = cellElement.style.wordBreak;
        const originalOverflow = cellElement.style.overflow;

        // 기본 스타일로 리셋하여 정확한 측정
        cellElement.style.fontSize = '';
        cellElement.style.lineHeight = '';
        cellElement.style.whiteSpace = '';
        cellElement.style.wordBreak = '';
        cellElement.style.overflow = '';

        // 강제로 리플로우하여 정확한 크기 측정
        cellElement.offsetHeight;

        const cellWidth = cellElement.offsetWidth;
        const contentWidth = cellElement.scrollWidth;
        
        // 디버깅 로그
        if (contentWidth > cellWidth) {
          console.log(`오버플로우 감지: "${content}" (너비: ${cellWidth}px, 내용: ${contentWidth}px)`);
        }
        
        // 내용이 셀 너비를 넘치는 경우
        if (contentWidth > cellWidth) {
          overflowCells++;
          // 오버플로우 감지 클래스 추가
          cellElement.classList.add('overflow-detected');
          
          // 자동 폰트 크기 조정
          if (tableSettings.autoTextSize.adjustForOverflow) {
            const minFontSize = tableSettings.autoTextSize.minFontSize * 16; // rem을 px로 변환
            const maxFontSize = tableSettings.autoTextSize.maxFontSize * 16; // rem을 px로 변환
            
            // 셀 너비에 맞는 적절한 폰트 크기 계산 (더 정확한 계산)
            const avgCharWidth = cellWidth / Math.max(content.length, 1);
            let newFontSize = Math.max(minFontSize, avgCharWidth * 1.1); // 1.1로 조정하여 더 정확하게
            newFontSize = Math.min(maxFontSize, newFontSize);
            
            console.log(`폰트 크기 조정: "${content}" → ${newFontSize}px (기본: 16px)`);
            
            // 폰트 크기 적용 및 CSS 오버라이드 (!important로 강제 적용)
            // 컬럼 너비는 유지하고 텍스트만 조정
            cellElement.style.setProperty('font-size', `${newFontSize}px`, 'important');
            cellElement.style.setProperty('line-height', '1.2', 'important');
            cellElement.style.setProperty('white-space', 'normal', 'important');
            cellElement.style.setProperty('word-break', 'break-word', 'important');
            cellElement.style.setProperty('overflow', 'visible', 'important');
            cellElement.style.setProperty('text-overflow', 'clip', 'important');
            // max-width는 설정하지 않음 (컬럼 너비 유지)
          }
        } else {
          // 오버플로우가 없는 경우 클래스 제거 및 기본 스타일 복원
          cellElement.classList.remove('overflow-detected');
          cellElement.style.removeProperty('font-size');
          cellElement.style.removeProperty('line-height');
          cellElement.style.removeProperty('white-space');
          cellElement.style.removeProperty('word-break');
          cellElement.style.removeProperty('overflow');
          cellElement.style.removeProperty('text-overflow');
          // max-width는 제거하지 않음 (컬럼 너비 유지)
        }
      });
    });
    
    console.log(`오버플로우 감지 완료: 총 ${totalCells}개 셀 중 ${overflowCells}개 오버플로우 감지`);
  }, [tableSettings.autoTextSize]);

  // 테이블 렌더링 후 오버플로우 감지 실행
  useEffect(() => {
    if (tableSettings.autoTextSize.enabled) {
      // DOM 업데이트 후 오버플로우 감지 (더 자주 실행)
      const timer = setTimeout(detectAndHandleOverflow, 50);
      
      // 추가로 약간의 지연 후 한 번 더 실행
      const timer2 = setTimeout(detectAndHandleOverflow, 200);
      
      return () => {
        clearTimeout(timer);
        clearTimeout(timer2);
      };
    }
  }, [returnState.pendingReturns, returnState.completedReturns, tableSettings.autoTextSize.enabled, detectAndHandleOverflow]);

  // 화면 크기 변경 시 오버플로우 감지 실행
  useEffect(() => {
    if (!tableSettings.autoTextSize.enabled) return;

    let resizeTimeout: NodeJS.Timeout;
    let intervalId: NodeJS.Timeout;
    
    const handleResize = () => {
      // 디바운싱: 연속된 resize 이벤트를 방지하고 100ms 후에 실행
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        detectAndHandleOverflow();
      }, 100);
    };

    // window resize 이벤트 리스너 추가
    window.addEventListener('resize', handleResize);
    
    // 주기적으로 overflow 체크 (5초마다)
    intervalId = setInterval(() => {
      detectAndHandleOverflow();
    }, 5000);
    
    // 컴포넌트 언마운트 시 이벤트 리스너 제거
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(resizeTimeout);
      clearInterval(intervalId);
    };
  }, [tableSettings.autoTextSize.enabled, detectAndHandleOverflow]);
  
  // 표 설정 적용 함수
              const applyTableSettings = () => {
              // CSS 변수로 설정 적용
              const root = document.documentElement;

              // 입고전 반품목록 팝업 설정
              root.style.setProperty('--popup-width', `${tableSettings.popupWidth}vw`);
              root.style.setProperty('--popup-height', `${tableSettings.popupHeight}vh`);
              root.style.setProperty('--popup-table-font-size', `${tableSettings.popupTableFontSize}rem`);
              root.style.setProperty('--popup-barcode-font-size', `${tableSettings.popupBarcodeFontSize}rem`);
              root.style.setProperty('--popup-cell-padding', `${tableSettings.popupCellPadding}rem`);
              root.style.setProperty('--popup-line-height', tableSettings.popupLineHeight.toString());

              // 메인 화면 테이블 설정
              root.style.setProperty('--main-table-font-size', `${tableSettings.mainTableFontSize}rem`);
              root.style.setProperty('--main-barcode-font-size', `${tableSettings.mainBarcodeFontSize}rem`);
              root.style.setProperty('--main-cell-padding', `${tableSettings.mainCellPadding}rem`);
              root.style.setProperty('--main-line-height', tableSettings.mainLineHeight.toString());

              // 컬럼 정렬 설정
              Object.entries(tableSettings.columnAlignment).forEach(([column, alignment]) => {
                root.style.setProperty(`--column-${column}-alignment`, alignment);
              });

              // 컬럼 너비 설정
              Object.entries(tableSettings.columnWidths).forEach(([column, width]) => {
                root.style.setProperty(`--column-${column}-width`, `${width}px`);
              });
              
              // 메인화면 바코드 너비 별도 설정
              if (tableSettings.columnWidths.mainBarcode) {
                root.style.setProperty('--column-main-barcode-width', `${tableSettings.columnWidths.mainBarcode}px`);
              }

              // 자동 텍스트 크기 설정
              Object.entries(tableSettings.autoTextSize).forEach(([key, value]) => {
                const cssKey = key === 'enabled' ? 'enabled' : 
                              key === 'minFontSize' ? 'minFontSize' :
                              key === 'maxFontSize' ? 'maxFontSize' :
                              key === 'adjustForOverflow' ? 'adjustForOverflow' : key;
                root.style.setProperty(`--auto-text-size-${cssKey}`, String(value));
              });

              // 바코드번호 형식 설정
              Object.entries(tableSettings.barcodeFormat).forEach(([key, value]) => {
                const cssKey = key === 'enabled' ? 'enabled' : 
                              key === 'mainCodeSize' ? 'mainCodeSize' :
                              key === 'subInfoSize' ? 'subInfoSize' :
                              key === 'lineHeight' ? 'lineHeight' : key;
                root.style.setProperty(`--barcode-format-${cssKey}`, String(value));
              });

              // 로컬 스토리지에 설정 저장
              localStorage.setItem('tableSettings', JSON.stringify(tableSettings));

              // 설정 적용 후 오버플로우 감지 실행
              console.log('설정 적용 버튼 클릭 - 오버플로우 감지 실행');
              if (tableSettings.autoTextSize.enabled) {
                console.log('자동 텍스트 크기 조정이 활성화되어 있음 - 오버플로우 감지 실행');
                setTimeout(() => {
                  console.log('설정 적용 후 오버플로우 감지 실행 중...');
                  detectAndHandleOverflow();
                }, 100);
              } else {
                console.log('자동 텍스트 크기 조정이 비활성화되어 있음');
              }

              setMessage('표 설정이 적용되었습니다. 설정을 저장했습니다.');
              setShowTableSizeSettings(false);
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
          // 강화된 중복 제거 시스템
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
          
          // 중복 검사 및 분류
          const duplicateItems: ReturnItem[] = [];
          const uniqueReturns = returns.filter(item => {
            const key = `${item.customerName}_${item.orderNumber}_${item.purchaseName || item.productName}_${item.optionName}_${item.returnTrackingNumber}`;
            if (existingKeys.has(key)) {
              duplicateItems.push(item);
              return false; // 중복 항목 제외
            }
            existingKeys.add(key); // 새로운 항목은 키에 추가 (파일 내 중복도 방지)
            return true;
          });
          
          // 자체상품코드가 있는 항목은 매칭을 위해 전처리
          const processedReturns = uniqueReturns.map(item => {
            // item을 any로 타입 단언
            const itemAsAny = item as any;
            
            // 자체상품코드를 이용한 매칭을 위한 전처리
            if (itemAsAny.customProductCode && itemAsAny.customProductCode !== '-') {
              console.log(`자체상품코드 ${itemAsAny.customProductCode}를 매칭에 활용`);
            }
            return item;
          });
          
          console.log(`총 ${returns.length}개 항목 중 ${processedReturns.length}개 고유 항목 추가`);
          
          if (processedReturns.length === 0) {
            setMessage(`모든 항목(${returns.length}개)이 이미 존재하여 추가되지 않았습니다.`);
            setLoading(false);
            e.target.value = '';
            return;
          }
          
          dispatch({ type: 'ADD_RETURNS', payload: processedReturns });
          setMessage(`${processedReturns.length}개의 고유한 반품 항목이 추가되었습니다. (중복 ${returns.length - processedReturns.length}개 제외)`);
          
          // 자동 처리 시스템 실행 (입고전 목록 새로고침 5번 포함)
          setTimeout(async () => {
            await autoProcessUploadedData(processedReturns);
            // 입고전 목록 새로고침 자동 실행 (5번)
            console.log('🚀 자동 새로고침 시작 - 5번 실행 예정');
            await autoRefreshPendingList();
          }, 500);
          
          // 반품 데이터 추가 후 자동으로 매칭 실행
          if (returnState.products && returnState.products.length > 0) {
            console.log('반품 데이터 추가 후 자동 매칭 실행');
            
            // 미매칭 상품 찾기
            const unmatchedItems = processedReturns.filter(item => !item.barcode);
            console.log(`🔍 ${unmatchedItems.length}개 반품 상품 자동 매칭 시작`);
            
            if (unmatchedItems.length > 0) {
              setMessage(`${processedReturns.length}개 반품 항목이 추가되었습니다. 상품 매칭을 시작합니다...`);
              
              // 매칭 시도 및 결과 수집
              let matchedCount = 0;
              let failedCount = 0;
              
              // 각 반품 항목에 대해 매칭 시도 - 우선 자체상품코드 기준 매칭
              const matchedItems = unmatchedItems.map(item => {
                const matchedItem = matchProductByZigzagCode(item, returnState.products);
                
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
                
                return matchedItem;
              });
              
              // 결과 메시지 표시
              if (matchedCount > 0) {
                setMessage(`${processedReturns.length}개 반품 항목이 추가되었습니다. 자동 매칭 결과: ${matchedCount}개 성공, ${failedCount}개 실패`);
              } else {
                setMessage(`${processedReturns.length}개 반품 항목이 추가되었습니다. 상품 매칭에 실패했습니다.`);
              }
            }
          }
        } else {
          setMessage('처리할 데이터가 없습니다. 파일을 확인해주세요.');
        }
      } else {
        // 상품 목록 처리
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
            
            // 각 반품 항목에 대해 매칭 시도 - 향상된 매칭 로직 사용
            const matchedItems = unmatchedItems.map(item => {
              const matchedItem = matchProductByZigzagCode(item, products);
              
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
              
              return matchedItem;
            });
            
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

  // 로컬 저장소 상태 확인 함수 (Firebase 대신)
  const checkLocalStorageStatus = () => {
    try {
      setLoading(true);
      setMessage('로컬 저장소 상태를 확인 중...');
      
      // 로컬 스토리지 데이터 확인
      const pendingData = localStorage.getItem('pendingReturns');
      const completedData = localStorage.getItem('completedReturns');
      const productsData = localStorage.getItem('products');
      const lastUpdated = localStorage.getItem('lastUpdated');
      
      const pendingCount = pendingData ? JSON.parse(pendingData).length : 0;
      const completedCount = completedData ? JSON.parse(completedData).length : 0;
      const productsCount = productsData ? JSON.parse(productsData).length : 0;
      
      // 로컬 스토리지 사용량 계산
      let totalSize = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          totalSize += localStorage[key].length;
        }
      }
      const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
      
      const statusMessage = `
        로컬 저장소 상태:
        • 입고전 반품: ${pendingCount}개
        • 입고완료 반품: ${completedCount}개  
        • 상품 데이터: ${productsCount}개
        • 저장소 사용량: ${sizeInMB}MB
        • 마지막 업데이트: ${lastUpdated ? new Date(lastUpdated).toLocaleString() : '없음'}
      `;
      
      setMessage(statusMessage);
      
      console.log('로컬 저장소 상태:', {
        pendingReturns: pendingCount,
        completedReturns: completedCount,
        products: productsCount,
        totalSizeMB: sizeInMB,
        lastUpdated
      });
      
    } catch (error) {
      setMessage(`로컬 저장소 확인 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      console.error('로컬 저장소 확인 실패:', error);
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
    
    // 선택된 항목들 가져오기
    let itemsToProcess = selectedItems.map(index => returnState.pendingReturns[index]);
    
    // 제품 매칭 수행 - 선택 항목에 대해서만 실행
    if (returnState.products.length > 0) {
      itemsToProcess = itemsToProcess.map(item => {
        // 이미 바코드가 있는 경우 매칭 스킵
        if (item.barcode && item.barcode !== '-') {
          return item;
        }
        // 매칭 수행
        const matchedItem = matchProductByZigzagCode(item, returnState.products);
        return matchedItem;
      });
    }
    
    // 입고 처리
    dispatch({ type: 'PROCESS_RETURNS', payload: itemsToProcess });
    setSelectedItems([]);
    setSelectAll(false);
    setMessage(`${itemsToProcess.length}개 항목을 입고 처리했습니다.`);
  };

  // 단일 항목 입고 처리
  const handleProcessSingle = (index: number) => {
    // 항목 가져오기
    let itemToProcess = returnState.pendingReturns[index];
    
    // 제품 매칭 수행
    if (returnState.products.length > 0 && (!itemToProcess.barcode || itemToProcess.barcode === '-')) {
      // 매칭 수행
      itemToProcess = matchProductByZigzagCode(itemToProcess, returnState.products);
    }
    
    // 입고 처리
    dispatch({ type: 'PROCESS_RETURNS', payload: [itemToProcess] });
    setSelectedItems(prev => prev.filter(i => i !== index));
    setMessage('1개 항목을 입고 처리했습니다.');
  };

  // 반품사유 클릭 처리
  const handleReturnReasonClick = (item: ReturnItem) => {
    // 데이터 미리 저장 - 필요한 상태만 업데이트
    setCurrentReasonItem(item);
    setCurrentDetailReason(item.detailReason || '');
    
    // 지연 없이 바로 모달 표시
    setIsReasonModalOpen(true);
    
    // z-index 증가 (다른 상태 업데이트와 함께)
    setModalLevel(prev => prev + 10);
  };

  // 반품사유 상세 정보 저장
  const handleSaveDetailReason = useCallback((detailReason: string) => {
    if (!currentReasonItem) return;
    
    // 단일 디스패치로 처리
    dispatch({
      type: 'UPDATE_RETURN_REASON',
      payload: {
        id: currentReasonItem.id,
        detailReason
      }
    });
    
    // 모달 닫기 및 상태 업데이트
    setIsReasonModalOpen(false);
    setModalLevel(prev => Math.max(0, prev - 10));
    setMessage('반품 사유 상세 정보가 저장되었습니다.');
  }, [currentReasonItem, dispatch]);

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
  
  // 입고 완료된 반품 목록 다운로드 함수 (새로운 형식)
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
      // 새로운 엑셀 다운로드 함수 사용
      generateCompletedReturnsExcel(dataToExport);
      
      // 메시지 수정: 현재 표시 중인 데이터에 대한 정보 추가
      let messagePrefix = '';
      if (isSearching) {
        messagePrefix = '검색 결과 ';
      } else if (currentDate) {
        messagePrefix = `${new Date(currentDate).toLocaleDateString('ko-KR')} 날짜의 `;
      }
      
      setMessage(`${messagePrefix}${dataToExport.length}개 항목이 엑셀 파일로 저장되었습니다.`);
    } catch (error) {
      console.error('엑셀 생성 중 오류:', error);
      setMessage('엑셀 파일 생성 중 오류가 발생했습니다.');
    }
  };

  // 목록 다운로드 함수 (이전 기능으로 되돌림)
  const handleDownloadListExcel = () => {
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
    // 위 조건 모두 아닐 경우 전체 데이터 사용
    else if (returnState.completedReturns.length > 0) {
      dataToExport = returnState.completedReturns;
    }
    
    if (dataToExport.length === 0) {
      setMessage('다운로드할 입고 완료 데이터가 없습니다.');
      return;
    }
    
    try {
      // 바코드가 있는 항목만 필터링 (입고 시스템 요구사항)
      const validItems = dataToExport.filter(item => item.barcode && item.barcode !== '-');
      
      if (validItems.length === 0) {
        setMessage('바코드가 있는 항목이 없어서 CSV 파일을 생성할 수 없습니다.');
        return;
      }
      
      // 입고잡기용 CSV 데이터 생성 (바코드번호, 입고수량만 필수)
      const csvData = validItems.map(item => ({
        바코드번호: item.barcode || '',
        입고수량: item.quantity || 1
      }));

      // CSV 헤더 (필수 필드만)
      const headers = ['바코드번호', '입고수량'];
      
      // CSV 문자열 생성 (개행 문자 제거 및 특수문자 처리)
      const csvContent = [
        headers.join(','),
        ...csvData.map(row => [
          row.바코드번호,
          row.입고수량
        ].join(','))
      ].join('\r\n'); // Windows 개행 문자 사용

      // CSV 파일 다운로드
      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `입고잡기용_${new Date().toISOString().split('T')[0]}.csv`);
      link.setAttribute('type', 'text/csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      // 메시지 수정: 현재 표시 중인 데이터에 대한 정보 추가
      let messagePrefix = '';
      if (isSearching) {
        messagePrefix = '검색 결과 ';
      } else if (currentDate) {
        messagePrefix = `${new Date(currentDate).toLocaleDateString('ko-KR')} 날짜의 `;
      }
      
      setMessage(`${messagePrefix}${validItems.length}개 항목이 입고잡기용 CSV 파일로 저장되었습니다. (바코드 미매칭 ${dataToExport.length - validItems.length}개 제외)`);
    } catch (error) {
      console.error('CSV 생성 중 오류:', error);
      setMessage('CSV 파일 생성 중 오류가 발생했습니다.');
    }
  };
  
  // 상품 매칭 팝업 열기
  const handleProductMatchClick = useCallback((item: ReturnItem) => {
    // 불필요한 계산 제거
    setCurrentMatchItem(item);
    
    // 지연 없이 바로 모달 표시
    setShowProductMatchModal(true);
    
    // z-index 증가 (다른 상태 업데이트와 함께)
    setModalLevel(prev => prev + 10);
  }, []);
  
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
    
    // "파손", "불량" → "파손 및 불량"로 텍스트 수정
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
        // 날짜만 추출 (시간 정보 제거)
        const date = new Date(item.completedAt);
        // 날짜의 00시 기준으로 그룹화 (연,월,일만 사용)
        const dateKey = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString().split('T')[0];
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
      if (!item.completedAt) return acc;
      
      // 날짜만 추출 (시간 정보 제거)
      const date = new Date(item.completedAt);
      // 날짜의 00시 기준으로 그룹화 (연,월,일만 사용)
      const dateKey = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toLocaleDateString();
      
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(item);
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
    // 바코드가 없는 경우 매칭 버튼 표시
    if (!item.barcode || item.barcode === '-') {
      return (
        <button
          className="text-blue-600 hover:text-blue-800 underline"
          onClick={() => handleOpenProductMatchModal(item)}
        >
          {item.productName}
        </button>
      );
    }
    
    // 매칭이 완료된 경우 - 사입상품명 우선 표시 (중요)
    if (item.purchaseName && item.purchaseName !== '-') {
      return <span>{item.purchaseName}</span>;
    }
    
    // 사입상품명이 없는 경우 상품명 표시
    return <span>{item.productName}</span>;
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

    // 옵션명을 고려한 매칭을 위한 헬퍼 함수 - 정밀도 향상
    const findBestMatchWithOption = (candidates: ProductInfo[]): ProductInfo | null => {
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
        console.log(`✅ 옵션명 정확 매칭: ${returnItem.optionName} → ${exactOptionMatch.optionName}`);
        return exactOptionMatch;
      }

      // 2단계: 색상 기반 매칭 (새로 추가) - "블랙,1사이즈"와 "블랙" 매칭
      console.log(`🔍 색상 기반 매칭 시도: "${returnItem.optionName}"`);
      
      // 반품 옵션명에서 색상 추출
      const returnColor = extractColorFromOption(returnOptionName);
      console.log(`추출된 색상: "${returnColor}"`);
      
      if (returnColor) {
        // 색상이 정확히 일치하는 상품 찾기
        const colorMatches = candidates.filter(product => {
          if (!product.optionName) return false;
          const productColor = extractColorFromOption(product.optionName.toLowerCase().trim());
          return productColor === returnColor;
        });
        
        if (colorMatches.length > 0) {
          console.log(`✅ 색상 기반 매칭 성공: ${returnColor} → ${colorMatches[0].optionName}`);
          return colorMatches[0];
        }
      }

      // 3단계: 콤마 기준 분리 매칭 (새로 추가) - "블랙,1사이즈"의 각 부분을 개별 매칭
      console.log(`🔍 콤마 기준 분리 매칭 시도: "${returnItem.optionName}"`);
      
      const returnParts = returnOptionName.split(',').map(part => part.trim()).filter(part => part.length > 0);
      console.log(`분리된 부분들: [${returnParts.join(', ')}]`);
      
      if (returnParts.length > 1) {
        let bestCommaMatch: ProductInfo | null = null;
        let highestCommaScore = 0;
        
        for (const product of candidates) {
          if (!product.optionName) continue;
          
          const productParts = product.optionName.toLowerCase().trim().split(',').map(part => part.trim()).filter(part => part.length > 0);
          
          // 각 부분이 매칭되는지 확인
          let matchedParts = 0;
          for (const returnPart of returnParts) {
            for (const productPart of productParts) {
              if (returnPart === productPart || 
                  returnPart.includes(productPart) || 
                  productPart.includes(returnPart)) {
                matchedParts++;
                break;
              }
            }
          }
          
          if (matchedParts > 0) {
            const score = matchedParts / Math.max(returnParts.length, productParts.length);
            console.log(`  - ${product.optionName}: ${matchedParts}/${returnParts.length} 부분 매칭, 점수: ${score.toFixed(2)}`);
            
            if (score > highestCommaScore && score >= 0.5) {
              highestCommaScore = score;
              bestCommaMatch = product;
            }
          }
        }
        
        if (bestCommaMatch) {
          console.log(`✅ 콤마 기준 분리 매칭 성공: ${returnItem.optionName} → ${bestCommaMatch.optionName} (점수: ${highestCommaScore.toFixed(2)})`);
          return bestCommaMatch;
        }
      }

      // 4단계: 레벤슈타인 거리 기반 유사도 매칭
      let bestOptionMatch: ProductInfo | null = null;
      let highestOptionSimilarity = 0.7; // 유사도 임계값

      for (const product of candidates) {
        if (product.optionName) {
          const similarity = stringSimilarity(
            returnOptionName,
            product.optionName.toLowerCase().trim()
          );
          
          if (similarity > highestOptionSimilarity) {
            highestOptionSimilarity = similarity;
            bestOptionMatch = product;
          }
        }
      }

      if (bestOptionMatch) {
        console.log(`✅ 옵션명 유사도 매칭: ${returnItem.optionName} → ${bestOptionMatch.optionName} (유사도: ${highestOptionSimilarity.toFixed(2)})`);
        return bestOptionMatch;
      }

      // 5단계: 부분 텍스트 매칭 (새로운 기능) - 공통 키워드 기반
      console.log(`🔍 옵션명 부분 매칭 시도: "${returnItem.optionName}"`);
      
      let bestPartialMatch: ProductInfo | null = null;
      let highestPartialScore = 0;

      // 반품 옵션명에서 키워드 추출 (구분자로 분리)
      const returnKeywords = extractOptionKeywords(returnOptionName);
      console.log(`반품 옵션 키워드: [${returnKeywords.join(', ')}]`);

      for (const product of candidates) {
        if (product.optionName) {
          const productOptionName = product.optionName.toLowerCase().trim();
          const productKeywords = extractOptionKeywords(productOptionName);
          
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
            // 매칭 점수 계산: (공통키워드수 / 전체키워드수) * 가중치
            const score = (commonKeywords.length / Math.max(returnKeywords.length, productKeywords.length)) * 0.8 + 
                         (commonKeywords.length / returnKeywords.length) * 0.2;
            
            console.log(`  - ${product.optionName}: 공통키워드 ${commonKeywords.length}개 [${commonKeywords.join(', ')}], 점수: ${score.toFixed(2)}`);
            
            if (score > highestPartialScore && score >= 0.4) { // 최소 40% 매칭으로 상향 조정
              highestPartialScore = score;
              bestPartialMatch = product;
              console.log(`    → 현재 최고 점수로 선택됨`);
            }
          } else {
            console.log(`  - ${product.optionName}: 공통키워드 없음`);
          }
        }
      }

      if (bestPartialMatch) {
        console.log(`✅ 옵션명 부분 매칭 성공: ${returnItem.optionName} → ${bestPartialMatch.optionName} (점수: ${highestPartialScore.toFixed(2)})`);
        return bestPartialMatch;
      }

      // 6단계: 매칭 실패 시 null 반환 (옵션명이 전혀 매칭되지 않음)
      console.log(`⚠️ 옵션명 매칭 실패, 매칭 불가: ${returnItem.optionName}`);
      return null;
    };

    // 옵션명에서 키워드 추출 헬퍼 함수
    const extractOptionKeywords = (optionText: string): string[] => {
      // 구분자로 분리: 콤마, 슬래시, 콜론, 대괄호 등
      const keywords = optionText
        .replace(/[\[\]]/g, '') // 대괄호 제거
        .split(/[,\/:\-\s]+/) // 구분자로 분리
        .map(keyword => keyword.trim())
        .filter(keyword => keyword.length > 0 && keyword !== '선택'); // 빈 문자열과 '선택' 제거
      
      return keywords;
    };

    // 색상 추출 헬퍼 함수
    const extractColorFromOption = (optionText: string): string | null => {
      // 기본 색상 목록
      const colorKeywords = [
        '블랙', '화이트', '네이비', '그레이', '베이지', '레드', '블루', '그린', 
        '옐로우', '퍼플', '핑크', '오렌지', '브라운', '카멜', '민트', '아이보리',
        '소라', '곤색', '연두', '다크그레이', '연핑크', '오트밀', '연겨자', '회색',
        '검정', '곤색', '아쿠아블루', '메란지', '라이트민트', '연핑크', '베이지'
      ];
      
      for (const color of colorKeywords) {
        if (optionText.includes(color.toLowerCase())) {
          return color.toLowerCase();
        }
      }
      
      return null;
    };

    // 특정 상품 강화 매칭 함수 (연채원 607 블랙,1사이즈 등)
    const findSpecificProductMatch = (returnItem: ReturnItem, candidates: ProductInfo[]): ProductInfo | null => {
      const returnName = returnItem.purchaseName?.toLowerCase() || '';
      const returnOption = returnItem.optionName?.toLowerCase() || '';
      
      // 연채원 607 관련 특별 매칭
      if (returnName.includes('연채원') && returnName.includes('607')) {
        console.log(`🔍 연채원 607 특별 매칭 시도: "${returnItem.purchaseName}" - "${returnItem.optionName}"`);
        
        // 블랙 색상이 포함된 경우
        if (returnOption.includes('블랙')) {
          // 바코드 B-10231420001과 정확히 매칭되는 상품 찾기
          const exactBarcodeMatch = candidates.find(product => 
            product.barcode === 'B-10231420001' || 
            product.customProductCode === 'B-10231420001'
          );
          
          if (exactBarcodeMatch) {
            console.log(`✅ 연채원 607 블랙 특별 매칭 성공: B-10231420001`);
            return exactBarcodeMatch;
          }
          
          // 블랙 색상이 포함된 상품들 중에서 선택
          const blackMatches = candidates.filter(product => 
            product.optionName && product.optionName.toLowerCase().includes('블랙')
          );
          
          if (blackMatches.length > 0) {
            console.log(`✅ 연채원 607 블랙 색상 매칭: ${blackMatches[0].optionName}`);
            return blackMatches[0];
          }
        }
      }
      
      return null;
    };
    


    // 0단계: 특정 상품 강화 매칭 (연채원 607 등) - 최우선 순위
    const returnName = returnItem.purchaseName?.toLowerCase() || '';
    const returnOption = returnItem.optionName?.toLowerCase() || '';
    
    // 연채원 607 관련 특별 매칭 (최우선 순위로 이동)
    if (returnName.includes('연채원') && returnName.includes('607')) {
      console.log(`🔍 연채원 607 특별 매칭 시도: "${returnItem.purchaseName}" - "${returnItem.optionName}"`);
      
      // 0단계: 블랙,1사이즈 특별 강화 매칭 (최우선)
      if (returnOption.includes('블랙') && returnOption.includes('1사이즈')) {
        console.log(`🔍 블랙,1사이즈 특별 강화 매칭 시도`);
        
        // 바코드 B-10231420001과 정확히 매칭되는 상품 찾기
        const exactBarcodeMatch = productList.find(product => 
          product.barcode === 'B-10231420001' || 
          product.customProductCode === 'B-10231420001'
        );
        
        if (exactBarcodeMatch) {
          console.log(`✅ 블랙,1사이즈 특별 바코드 매칭 성공: B-10231420001`);
          updatedItem.barcode = exactBarcodeMatch.barcode;
          updatedItem.purchaseName = exactBarcodeMatch.purchaseName || exactBarcodeMatch.productName;
          updatedItem.zigzagProductCode = exactBarcodeMatch.zigzagProductCode || '';
          updatedItem.matchType = "연채원607_블랙1사이즈_특별매칭";
          updatedItem.matchSimilarity = 1.0;
          updatedItem.matchedProductName = exactBarcodeMatch.productName;
          updatedItem.matchedProductOption = exactBarcodeMatch.optionName;
          return updatedItem;
        }
        
        // 블랙,1사이즈가 정확히 일치하는 상품 찾기
        const exactBlack1SizeMatch = productList.find(product => 
          product.optionName && 
          product.optionName.toLowerCase().trim() === '블랙,1사이즈' &&
          product.purchaseName && product.purchaseName.toLowerCase().includes('연채원') &&
          product.purchaseName.toLowerCase().includes('607')
        );
        
        if (exactBlack1SizeMatch) {
          console.log(`✅ 블랙,1사이즈 정확 매칭 성공: ${exactBlack1SizeMatch.barcode}`);
          updatedItem.barcode = exactBlack1SizeMatch.barcode;
          updatedItem.purchaseName = exactBlack1SizeMatch.purchaseName || exactBlack1SizeMatch.productName;
          updatedItem.zigzagProductCode = exactBlack1SizeMatch.zigzagProductCode || '';
          updatedItem.matchType = "연채원607_블랙1사이즈_정확매칭";
          updatedItem.matchSimilarity = 1.0;
          updatedItem.matchedProductName = exactBlack1SizeMatch.productName;
          updatedItem.matchedProductOption = exactBlack1SizeMatch.optionName;
          return updatedItem;
        }
      }
      
      // 1단계: 정확한 옵션명 매칭 (블랙,1사이즈)
      const exactOptionMatches = productList.filter(product => 
        product.optionName && 
        product.optionName.toLowerCase().trim() === returnOption.trim()
      );
      
      if (exactOptionMatches.length > 0) {
        console.log(`✅ 연채원 607 정확한 옵션명 매칭: "${returnOption}" → "${exactOptionMatches[0].optionName}"`);
        updatedItem.barcode = exactOptionMatches[0].barcode;
        updatedItem.purchaseName = exactOptionMatches[0].purchaseName || exactOptionMatches[0].productName;
        updatedItem.zigzagProductCode = exactOptionMatches[0].zigzagProductCode || '';
        updatedItem.matchType = "연채원607_정확옵션매칭";
        updatedItem.matchSimilarity = 1.0;
        updatedItem.matchedProductName = exactOptionMatches[0].productName;
        updatedItem.matchedProductOption = exactOptionMatches[0].optionName;
        return updatedItem;
      }
      
      // 2단계: 사입상품명 + 컬러 + 사이즈 순차 매칭
      const returnParts = returnOption.split(',').map(part => part.trim()).filter(part => part.length > 0);
      console.log(`분리된 옵션 부분: [${returnParts.join(', ')}]`);
      
      if (returnParts.length >= 2) {
        // 색상과 사이즈를 분리
        const colorPart = returnParts.find(part => 
          ['블랙', '화이트', '네이비', '그레이', '베이지', '레드', '블루', '그린'].includes(part)
        );
        const sizePart = returnParts.find(part => 
          part.includes('사이즈') || /^\d+$/.test(part) || /^[SMLX]+$/i.test(part)
        );
        
        console.log(`색상 부분: "${colorPart}", 사이즈 부분: "${sizePart}"`);
        
        // 2-1단계: 사입상품명이 "연채원 607"인 상품들만 필터링
        const yeonchae607Products = productList.filter(product => 
          product.purchaseName && product.purchaseName.toLowerCase().includes('연채원') && 
          product.purchaseName.toLowerCase().includes('607')
        );
        
        console.log(`연채원 607 사입상품명 상품들: ${yeonchae607Products.length}개`);
        
        if (yeonchae607Products.length > 0) {
          // 2-2단계: 색상이 블랙인 경우 블랙 상품들만 필터링
          if (colorPart === '블랙') {
            const blackProducts = yeonchae607Products.filter(product => 
              product.optionName && product.optionName.toLowerCase().includes('블랙')
            );
            
            console.log(`연채원 607 + 블랙 색상 상품들: ${blackProducts.length}개`);
            
            if (blackProducts.length > 0) {
              // 2-3단계: 사이즈도 매칭되는지 확인
              if (sizePart) {
                const blackAndSizeMatches = blackProducts.filter(product => 
                  product.optionName && product.optionName.toLowerCase().includes(sizePart.toLowerCase())
                );
                
                if (blackAndSizeMatches.length > 0) {
                  console.log(`✅ 연채원 607 + 블랙 + 사이즈 매칭: "${returnOption}" → "${blackAndSizeMatches[0].optionName}"`);
                  updatedItem.barcode = blackAndSizeMatches[0].barcode;
                  updatedItem.purchaseName = blackAndSizeMatches[0].purchaseName || blackAndSizeMatches[0].productName;
                  updatedItem.zigzagProductCode = blackAndSizeMatches[0].zigzagProductCode || '';
                  updatedItem.matchType = "연채원607_사입명색상사이즈매칭";
                  updatedItem.matchSimilarity = 0.98;
                  updatedItem.matchedProductName = blackAndSizeMatches[0].productName;
                  updatedItem.matchedProductOption = blackAndSizeMatches[0].optionName;
                  return updatedItem;
                }
              }
              
              // 사이즈 매칭이 안되면 블랙 색상만으로 매칭
              console.log(`✅ 연채원 607 + 블랙 색상 매칭: "${returnOption}" → "${blackProducts[0].optionName}"`);
              updatedItem.barcode = blackProducts[0].barcode;
              updatedItem.purchaseName = blackProducts[0].purchaseName || blackProducts[0].productName;
              updatedItem.zigzagProductCode = blackProducts[0].zigzagProductCode || '';
              updatedItem.matchType = "연채원607_사입명색상매칭";
              updatedItem.matchSimilarity = 0.95;
              updatedItem.matchedProductName = blackProducts[0].productName;
              updatedItem.matchedProductOption = blackProducts[0].optionName;
              return updatedItem;
            }
          }
          
          // 2-4단계: 색상 매칭이 안되면 연채원 607 상품들 중에서 옵션 부분 매칭
          let bestOptionMatch: ProductInfo | null = null;
          let highestScore = 0;
          
          for (const product of yeonchae607Products) {
            if (!product.optionName) continue;
            
            const productParts = product.optionName.toLowerCase().trim().split(',').map(part => part.trim()).filter(part => part.length > 0);
            
            // 각 부분이 정확히 매칭되는지 확인
            let matchedParts = 0;
            for (const returnPart of returnParts) {
              for (const productPart of productParts) {
                if (returnPart === productPart) {
                  matchedParts++;
                  break;
                }
              }
            }
            
            if (matchedParts > 0) {
              const score = matchedParts / Math.max(returnParts.length, productParts.length);
              console.log(`  - ${product.optionName}: ${matchedParts}/${returnParts.length} 정확 매칭, 점수: ${score.toFixed(2)}`);
              
              if (score > highestScore) {
                highestScore = score;
                bestOptionMatch = product;
              }
            }
          }
          
          if (bestOptionMatch && highestScore >= 0.5) {
            console.log(`✅ 연채원 607 + 옵션 부분 매칭: "${returnOption}" → "${bestOptionMatch.optionName}" (점수: ${highestScore.toFixed(2)})`);
            updatedItem.barcode = bestOptionMatch.barcode;
            updatedItem.purchaseName = bestOptionMatch.purchaseName || bestOptionMatch.productName;
            updatedItem.zigzagProductCode = bestOptionMatch.zigzagProductCode || '';
            updatedItem.matchType = "연채원607_사입명옵션매칭";
            updatedItem.matchSimilarity = highestScore;
            updatedItem.matchedProductName = bestOptionMatch.productName;
            updatedItem.matchedProductOption = bestOptionMatch.optionName;
            return updatedItem;
          }
        }
      }
      
      // 3단계: 바코드 B-10231420001 우선 매칭 (최후 수단)
      if (returnOption.includes('블랙')) {
        const exactBarcodeMatch = productList.find(product => 
          product.barcode === 'B-10231420001' || 
          product.customProductCode === 'B-10231420001'
        );
        
        if (exactBarcodeMatch) {
          console.log(`✅ 연채원 607 블랙 바코드 매칭: B-10231420001`);
          updatedItem.barcode = exactBarcodeMatch.barcode;
          updatedItem.purchaseName = exactBarcodeMatch.purchaseName || exactBarcodeMatch.productName;
          updatedItem.zigzagProductCode = exactBarcodeMatch.zigzagProductCode || '';
          updatedItem.matchType = "연채원607_바코드매칭";
          updatedItem.matchSimilarity = 0.8;
          updatedItem.matchedProductName = exactBarcodeMatch.productName;
          updatedItem.matchedProductOption = exactBarcodeMatch.optionName;
          return updatedItem;
        }
      }
    }

    // 연채원 607이 이미 매칭된 경우 다른 매칭 로직 건드리지 않음
    if (updatedItem.barcode && updatedItem.barcode !== '-') {
      console.log(`✅ 연채원 607 특별 매칭 완료: ${updatedItem.barcode}`);
      return updatedItem;
    }

    // 1. 자체상품코드(customProductCode)로 매칭 시도 - 최우선 순위
    if (returnItem.customProductCode && returnItem.customProductCode !== '-') {
      console.log(`🔍 자체상품코드 "${returnItem.customProductCode}"로 매칭 시도...`);
      
      // 자체상품코드로 정확 매칭되는 모든 후보 찾기
      const exactMatches = productList.filter(product => 
        // 자체상품코드와 직접 비교
        (product.customProductCode && 
         product.customProductCode.toLowerCase().trim() === returnItem.customProductCode!.toLowerCase().trim()) ||
        // 지그재그코드와 비교 (상품에 자체상품코드가 없는 경우)
        (product.zigzagProductCode && 
         product.zigzagProductCode.toLowerCase().trim() === returnItem.customProductCode!.toLowerCase().trim())
      );
      
      if (exactMatches.length > 0) {
        const bestMatch = findBestMatchWithOption(exactMatches);
        if (bestMatch) {
          console.log(`✅ 자체상품코드 정확 매칭 성공 (옵션 고려): ${returnItem.customProductCode} → ${bestMatch.purchaseName || bestMatch.productName} [${bestMatch.optionName}]`);
          updatedItem.barcode = bestMatch.barcode;
          updatedItem.purchaseName = bestMatch.purchaseName || bestMatch.productName;
          updatedItem.zigzagProductCode = bestMatch.zigzagProductCode || '';
          updatedItem.matchType = "custom_code_exact";
          updatedItem.matchSimilarity = 1.0;
          updatedItem.matchedProductName = bestMatch.productName;
          updatedItem.matchedProductOption = bestMatch.optionName;
          return updatedItem;
        } else {
          console.log(`❌ 자체상품코드 매칭 실패: 옵션명 매칭 불가 (${returnItem.optionName})`);
        }
      }
      
      // 유사도 매칭 시도 (지그재그 자체상품코드와 사입상품명 간)
      console.log(`🔍 자체상품코드 "${returnItem.customProductCode}"와 사입상품명 유사도 매칭 시도...`);
      
      let bestZigzagMatch: { product: ProductInfo, similarity: number, matchType: string } | null = null;
      const returnCustomCode = returnItem.customProductCode.toLowerCase().trim();
      
      for (const product of productList) {
        if (product.purchaseName && typeof product.purchaseName === 'string') {
          const purchaseNameLower = product.purchaseName.toLowerCase().trim();
          
          // 포함 관계 확인 (높은 우선순위)
          if (purchaseNameLower.includes(returnCustomCode) || returnCustomCode.includes(purchaseNameLower)) {
            const similarity = 0.95; // 포함 관계는 매우 높은 점수
            
            if (!bestZigzagMatch || similarity > bestZigzagMatch.similarity) {
              bestZigzagMatch = { 
                product, 
                similarity, 
                matchType: '자체상품코드-사입명 포함관계' 
              };
              console.log(`📌 포함관계 발견 (유사도: ${similarity.toFixed(2)}): "${returnCustomCode}" ↔ "${purchaseNameLower}"`);
            }
          } 
          // 레벤슈타인 거리 기반 유사도 계산
          else {
            const similarity = stringSimilarity(returnCustomCode, purchaseNameLower);
            
            // 임계값을 0.4로 낮춰서 더 많은 매칭 기회 제공
            if (similarity > 0.4 && (!bestZigzagMatch || similarity > bestZigzagMatch.similarity)) {
              bestZigzagMatch = { 
                product, 
                similarity, 
                matchType: '자체상품코드-사입명 유사도' 
              };
              console.log(`📊 유사도 매칭 (유사도: ${similarity.toFixed(2)}): "${returnCustomCode}" ↔ "${purchaseNameLower}"`);
            }
          }
        }
      }
      
      // 자체상품코드 기반 매칭 결과가 있으면 반환
      if (bestZigzagMatch && bestZigzagMatch.similarity > 0.5) {
        console.log(`✅ 자체상품코드 기반 매칭 성공 (${bestZigzagMatch.matchType}, 유사도: ${bestZigzagMatch.similarity.toFixed(2)})`);
        
        updatedItem.barcode = bestZigzagMatch.product.barcode;
        updatedItem.purchaseName = bestZigzagMatch.product.purchaseName || bestZigzagMatch.product.productName;
        updatedItem.zigzagProductCode = bestZigzagMatch.product.zigzagProductCode || returnItem.zigzagProductCode;
        updatedItem.customProductCode = bestZigzagMatch.product.customProductCode || bestZigzagMatch.product.zigzagProductCode || '';
        updatedItem.matchType = bestZigzagMatch.matchType;
        updatedItem.matchSimilarity = bestZigzagMatch.similarity;
        updatedItem.matchedProductName = bestZigzagMatch.product.productName;
        updatedItem.matchedProductOption = bestZigzagMatch.product.optionName;
        return updatedItem;
      }
      
      console.log(`❌ 자체상품코드 기반 매칭 실패: ${returnItem.customProductCode}`);
    }
    
    // 2. 사입상품명 매칭 시도
    if (returnItem.purchaseName && returnItem.purchaseName !== '-') {
      // 사입상품명으로 정확히 일치하는 모든 후보 찾기
      const purchaseNameMatches = productList.filter(product => 
        product.purchaseName && 
        product.purchaseName.toLowerCase().trim() === returnItem.purchaseName?.toLowerCase().trim()
      );
      
      if (purchaseNameMatches.length > 0) {
        const bestMatch = findBestMatchWithOption(purchaseNameMatches);
        if (bestMatch) {
          console.log(`✅ 사입상품명 매칭 성공 (옵션 고려): ${returnItem.purchaseName} → ${bestMatch.productName} [${bestMatch.optionName}]`);
          updatedItem.barcode = bestMatch.barcode;
          updatedItem.customProductCode = bestMatch.customProductCode || bestMatch.zigzagProductCode || '';
          updatedItem.zigzagProductCode = bestMatch.zigzagProductCode || '';
          updatedItem.matchType = "purchase_name_match";
          updatedItem.matchSimilarity = 1.0;
          updatedItem.matchedProductName = bestMatch.productName;
          updatedItem.matchedProductOption = bestMatch.optionName;
          return updatedItem;
        } else {
          console.log(`❌ 사입상품명 매칭 실패: 옵션명 매칭 불가 (${returnItem.optionName})`);
        }
      }
    }
    
    // 3. zigzagProductCode(자체상품코드)로 매칭 시도
    if (returnItem.zigzagProductCode && returnItem.zigzagProductCode !== '-') {
      console.log(`🔍 지그재그 상품코드 "${returnItem.zigzagProductCode}"로 매칭 시도...`);
      
      // 지그재그 상품코드로 정확 매칭되는 모든 후보 찾기
      const exactZigzagMatches = productList.filter(product => 
        product.zigzagProductCode && 
        product.zigzagProductCode.toLowerCase().trim() === returnItem.zigzagProductCode!.toLowerCase().trim()
      );
      
      if (exactZigzagMatches.length > 0) {
        const bestMatch = findBestMatchWithOption(exactZigzagMatches);
        if (bestMatch) {
          console.log(`✅ 지그재그 상품코드 정확 매칭 성공 (옵션 고려): ${returnItem.zigzagProductCode} → ${bestMatch.productName} [${bestMatch.optionName}]`);
          updatedItem.barcode = bestMatch.barcode;
          updatedItem.purchaseName = bestMatch.purchaseName || bestMatch.productName;
          updatedItem.customProductCode = bestMatch.customProductCode || '';
          updatedItem.matchType = "zigzag_code_exact";
          updatedItem.matchSimilarity = 1.0;
          updatedItem.matchedProductName = bestMatch.productName;
          updatedItem.matchedProductOption = bestMatch.optionName;
          return updatedItem;
        }
      }
      
      // 유사도 매칭 시도 (지그재그 코드와 사입상품명 간)
      console.log(`🔍 지그재그 코드 "${returnItem.zigzagProductCode}"와 사입상품명 유사도 매칭 시도...`);
      
      let bestZigzagSimilarMatch: { product: ProductInfo, similarity: number, matchType: string } | null = null;
      const returnZigzagCode = returnItem.zigzagProductCode.toLowerCase().trim();
      
      for (const product of productList) {
        if (product.purchaseName && typeof product.purchaseName === 'string') {
          const purchaseNameLower = product.purchaseName.toLowerCase().trim();
          
          // 포함 관계 확인
          if (purchaseNameLower.includes(returnZigzagCode) || returnZigzagCode.includes(purchaseNameLower)) {
            const similarity = 0.9; // 지그재그 코드 포함관계는 약간 낮은 점수
            
            if (!bestZigzagSimilarMatch || similarity > bestZigzagSimilarMatch.similarity) {
              bestZigzagSimilarMatch = { 
                product, 
                similarity, 
                matchType: '지그재그코드-사입명 포함관계' 
              };
              console.log(`📌 포함관계 발견 (유사도: ${similarity.toFixed(2)}): "${returnZigzagCode}" ↔ "${purchaseNameLower}"`);
            }
          } 
          // 유사도 계산
          else {
            const similarity = stringSimilarity(returnZigzagCode, purchaseNameLower);
            
            if (similarity > 0.4 && (!bestZigzagSimilarMatch || similarity > bestZigzagSimilarMatch.similarity)) {
              bestZigzagSimilarMatch = { 
                product, 
                similarity, 
                matchType: '지그재그코드-사입명 유사도' 
              };
              console.log(`📊 유사도 매칭 (유사도: ${similarity.toFixed(2)}): "${returnZigzagCode}" ↔ "${purchaseNameLower}"`);
            }
          }
        }
      }
      
      // 지그재그 코드 기반 매칭 결과가 있으면 반환
      if (bestZigzagSimilarMatch && bestZigzagSimilarMatch.similarity > 0.5) {
        console.log(`✅ 지그재그 코드 기반 매칭 성공 (${bestZigzagSimilarMatch.matchType}, 유사도: ${bestZigzagSimilarMatch.similarity.toFixed(2)})`);
        
        updatedItem.barcode = bestZigzagSimilarMatch.product.barcode;
        updatedItem.purchaseName = bestZigzagSimilarMatch.product.purchaseName || bestZigzagSimilarMatch.product.productName;
        updatedItem.customProductCode = bestZigzagSimilarMatch.product.customProductCode || bestZigzagSimilarMatch.product.zigzagProductCode || '';
        updatedItem.matchType = bestZigzagSimilarMatch.matchType;
        updatedItem.matchSimilarity = bestZigzagSimilarMatch.similarity;
        updatedItem.matchedProductName = bestZigzagSimilarMatch.product.productName;
        updatedItem.matchedProductOption = bestZigzagSimilarMatch.product.optionName;
        return updatedItem;
      }
      
      console.log(`❌ 지그재그 코드 기반 매칭 실패: ${returnItem.zigzagProductCode}`);
    }
    
    // 4. productName(상품명)으로 매칭 시도
    if (returnItem.productName) {
      console.log(`🔍 상품명 매칭 시작: "${returnItem.productName}"`);
      
      // 4-1. 완전히 일치하는 상품들 검색
      const exactMatches = productList.filter(product => 
        (product.productName && 
         product.productName.toLowerCase().trim() === returnItem.productName?.toLowerCase().trim()) ||
        (product.purchaseName && 
         product.purchaseName.toLowerCase().trim() === returnItem.productName?.toLowerCase().trim())
      );
      
      console.log(`📋 완전 일치 상품: ${exactMatches.length}개`);
      
      // 4-2. 키워드 기반 정확 매칭 (완전 일치가 없을 때)
      let keywordExactMatches: any[] = [];
      if (exactMatches.length === 0) {
        console.log(`🔍 키워드 기반 정확 매칭 시도...`);
        
        const returnKeywords = extractCoreKeywords(returnItem.productName);
        console.log(`   반품 상품 키워드: [${returnKeywords.join(', ')}]`);
        
        keywordExactMatches = productList.filter(product => {
          if (!product.productName && !product.purchaseName) return false;
          
          const productKeywords = extractCoreKeywords(product.productName || product.purchaseName || '');
          console.log(`   상품 "${product.productName || product.purchaseName}" 키워드: [${productKeywords.join(', ')}]`);
          
          // 키워드가 80% 이상 일치하면 정확 매칭으로 간주
          if (returnKeywords.length > 0 && productKeywords.length > 0) {
            const commonKeywords = returnKeywords.filter(kw => productKeywords.includes(kw));
            const similarity = commonKeywords.length / Math.max(returnKeywords.length, productKeywords.length);
            
            console.log(`   공통 키워드: [${commonKeywords.join(', ')}] (${commonKeywords.length}개)`);
            console.log(`   키워드 유사도: ${similarity.toFixed(2)}`);
            
            return similarity >= 0.8; // 80% 이상 일치
          }
          return false;
        });
        
        console.log(`📋 키워드 기반 정확 매칭: ${keywordExactMatches.length}개`);
      }
      
      // 정확 매칭 결과 처리
      const allExactMatches = exactMatches.length > 0 ? exactMatches : keywordExactMatches;
      
      if (allExactMatches.length > 0) {
        const bestMatch = findBestMatchWithOption(allExactMatches);
        if (bestMatch) {
          const matchType = exactMatches.length > 0 ? "name_exact" : "name_keyword_exact";
          console.log(`✅ 상품명 정확 매칭 성공 (${matchType}, 옵션 고려): ${returnItem.productName} → ${bestMatch.productName} [${bestMatch.optionName}]`);
          updatedItem.barcode = bestMatch.barcode;
          updatedItem.customProductCode = bestMatch.customProductCode || bestMatch.zigzagProductCode || '';
          updatedItem.purchaseName = bestMatch.purchaseName || bestMatch.productName;
          updatedItem.zigzagProductCode = bestMatch.zigzagProductCode || '';
          updatedItem.matchType = matchType;
          updatedItem.matchSimilarity = 1.0;
          updatedItem.matchedProductName = bestMatch.productName;
          updatedItem.matchedProductOption = bestMatch.optionName;
          return updatedItem;
        } else {
          console.log(`❌ 상품명 정확 매칭 실패: 옵션명 매칭 불가 (${returnItem.optionName})`);
        }
      }
      
      // 부분 일치 검색 (상품명 포함 관계)
      const partialMatches = productList.filter(
        (product) => 
          (product.productName && returnItem.productName && 
            (product.productName.toLowerCase().includes(returnItem.productName.toLowerCase()) ||
             returnItem.productName.toLowerCase().includes(product.productName.toLowerCase()))) ||
          (product.purchaseName && returnItem.productName &&
            (product.purchaseName.toLowerCase().includes(returnItem.productName.toLowerCase()) ||
             returnItem.productName.toLowerCase().includes(product.purchaseName.toLowerCase())))
      );
      
      if (partialMatches.length > 0) {
        const bestMatch = findBestMatchWithOption(partialMatches);
        if (bestMatch) {
          console.log(`✅ 상품명 부분 매칭 성공 (옵션 고려): ${returnItem.productName} → ${bestMatch.productName} [${bestMatch.optionName}]`);
          updatedItem.barcode = bestMatch.barcode;
          updatedItem.customProductCode = bestMatch.customProductCode || bestMatch.zigzagProductCode || '';
          updatedItem.purchaseName = bestMatch.purchaseName || bestMatch.productName;
          updatedItem.zigzagProductCode = bestMatch.zigzagProductCode || '';
          updatedItem.matchType = "name_partial";
          updatedItem.matchSimilarity = 0.8;
          updatedItem.matchedProductName = bestMatch.productName;
          updatedItem.matchedProductOption = bestMatch.optionName;
          return updatedItem;
        } else {
          console.log(`❌ 상품명 부분 매칭 실패: 옵션명 매칭 불가 (${returnItem.optionName})`);
        }
      }
      
      // 유사도 기반 매칭 - 핵심 키워드 기반으로 후보 수집 후 옵션명 고려
      const similarityMatches: {product: ProductInfo, similarity: number}[] = [];
      
      console.log(`🔍 유사도 매칭 시작: "${returnItem.productName}"`);
      
      for (const product of productList) {
        if (product.productName && returnItem.productName) {
          const similarity = calculateSimilarity(
            product.productName,
            returnItem.productName
          );
          
          // 임계값을 0.7로 높여서 더 정확한 매칭만 허용
          if (similarity > 0.7) {
            console.log(`📊 상품명 유사도: "${product.productName}" (${similarity.toFixed(2)})`);
            similarityMatches.push({ product, similarity });
          }
        }
        
        // 사입상품명으로도 유사도 검사
        if (product.purchaseName && returnItem.productName) {
          const similarity = calculateSimilarity(
            product.purchaseName,
            returnItem.productName
          );
          
          // 사입명은 더 높은 임계값 적용
          if (similarity > 0.75) {
            console.log(`📊 사입명 유사도: "${product.purchaseName}" (${similarity.toFixed(2)})`);
            similarityMatches.push({ product, similarity });
          }
        }
      }
      
      if (similarityMatches.length > 0) {
        // 유사도 순으로 정렬
        similarityMatches.sort((a, b) => b.similarity - a.similarity);
        
        // 상위 유사도 제품들 중에서 옵션명 고려하여 최적 매칭 찾기
        const topCandidates = similarityMatches
          .filter(match => match.similarity >= similarityMatches[0].similarity - 0.1) // 최고 유사도 대비 0.1 이내
          .map(match => match.product);
        
        const bestMatch = findBestMatchWithOption(topCandidates);
        if (bestMatch) {
          const matchInfo = similarityMatches.find(m => m.product === bestMatch);
          console.log(`✅ 상품명 유사도 매칭 성공 (옵션 고려): ${returnItem.productName} → ${bestMatch.productName} [${bestMatch.optionName}] (유사도: ${matchInfo?.similarity.toFixed(2)})`);
          updatedItem.barcode = bestMatch.barcode;
          updatedItem.customProductCode = bestMatch.customProductCode || bestMatch.zigzagProductCode || '';
          updatedItem.purchaseName = bestMatch.purchaseName || bestMatch.productName;
          updatedItem.zigzagProductCode = bestMatch.zigzagProductCode || '';
          updatedItem.matchType = "name_similarity";
          updatedItem.matchSimilarity = matchInfo?.similarity || 0.6;
          updatedItem.matchedProductName = bestMatch.productName;
          updatedItem.matchedProductOption = bestMatch.optionName;
          return updatedItem;
        } else {
          console.log(`❌ 상품명 유사도 매칭 실패: 옵션명 매칭 불가 (${returnItem.optionName})`);
        }
      }
    }
    
    // 매칭 실패
    console.log(`❌ 매칭 실패: ${returnItem.productName}`);
    updatedItem.matchType = "no_match";
    updatedItem.matchSimilarity = 0;
    return updatedItem;
  }



  // 새로고침 함수에 자체상품코드 매칭 및 중복 제거 로직 개선
  const handleRefresh = () => {
    // 기존 데이터 로딩
    setLoading(true);
    setMessage('데이터를 새로고침 중입니다...');
    
    // 전체 중복 제거 로직 - 입고완료(1순위) > 입고전(2순위)
    const allReturns = [
      ...returnState.completedReturns.map(item => ({ ...item, priority: 1 } as ReturnItem & { priority: number })), // 입고완료: 1순위
      ...returnState.pendingReturns.map(item => ({ ...item, priority: 2 } as ReturnItem & { priority: number }))    // 입고전: 2순위
    ];
    
    if (allReturns.length > 0) {
      const uniqueMap = new Map<string, ReturnItem & { priority: number }>();
      let totalRemovedCount = 0;
      
      // 우선순위 순으로 정렬 (입고완료가 먼저)
      allReturns.sort((a, b) => a.priority - b.priority);
      
      allReturns.forEach(item => {
        const key = `${item.customerName}_${item.orderNumber}_${item.purchaseName || item.productName}_${item.optionName}_${item.returnTrackingNumber}`;
        
        // 이미 존재하는 항목이 있으면 우선순위가 높은(숫자가 작은) 항목 유지
        if (uniqueMap.has(key)) {
          const existingItem = uniqueMap.get(key)!;
          if (item.priority < existingItem.priority) {
            // 현재 항목이 더 높은 우선순위 (입고완료)
            uniqueMap.set(key, item);
            console.log(`중복 항목 교체 (우선순위): ${key} - 입고완료 항목으로 교체`);
          } else {
            console.log(`중복 항목 제외 (낮은 우선순위): ${key}`);
          }
          totalRemovedCount++;
        } else {
          uniqueMap.set(key, item);
        }
      });
      
      // 우선순위별로 분리
      const uniqueItems = Array.from(uniqueMap.values());
      const uniqueCompletedReturns = uniqueItems.filter(item => item.priority === 1);
      const uniquePendingReturns = uniqueItems.filter(item => item.priority === 2);
      
      // priority 속성 제거
      const cleanCompletedReturns = uniqueCompletedReturns.map(({ priority, ...item }) => item);
      const cleanPendingReturns = uniquePendingReturns.map(({ priority, ...item }) => item);
      
      const completedRemovedCount = returnState.completedReturns.length - cleanCompletedReturns.length;
      const pendingRemovedCount = returnState.pendingReturns.length - cleanPendingReturns.length;
      
      // 중복 제거된 목록으로 업데이트
      if (totalRemovedCount > 0) {
        console.log(`전체 중복 제거: 총 ${totalRemovedCount}개 항목 제거됨 (입고완료: ${completedRemovedCount}개, 입고전: ${pendingRemovedCount}개)`);
        dispatch({
          type: 'SET_RETURNS',
          payload: {
            ...returnState,
            completedReturns: cleanCompletedReturns,
            pendingReturns: cleanPendingReturns
          }
        });
      }
    }
    
    // 자체상품코드 기준 매칭 시도
    if (returnState.pendingReturns.length > 0 && returnState.products.length > 0) {
      const matchedReturns = returnState.pendingReturns.map(item => 
        matchProductByZigzagCode(item, returnState.products)
      );
      
      // 매칭 결과가 있으면 상태 업데이트
      const matchedCount = matchedReturns.filter(item => item.barcode).length - 
                          returnState.pendingReturns.filter(item => item.barcode).length;
      
      if (matchedCount > 0) {
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
  
  // 개별 아이템으로 변환하는 함수 (그룹화 제거)
  const getIndividualItems = (items: ReturnItem[]) => {
    return items.map(item => ({
      trackingNumber: item.pickupTrackingNumber || item.returnTrackingNumber || 'no-tracking',
      items: [item],
      totalQuantity: item.quantity || 1,
      isGroup: false
    }));
  };



  // 자동 처리 함수 - 매칭 및 중복제거를 순차적으로 실행
  const autoProcessUploadedData = async (processedReturns: ReturnItem[]) => {
    try {
      // 1단계: 상품 매칭 실행
      setMessage('1단계: 상품 매칭을 실행 중입니다...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      dispatch({ type: 'MATCH_PRODUCTS' });
      console.log('🔄 1단계: 상품 매칭 완료');
      
      // 2단계: 중복 제거 재검사
      setMessage('2단계: 중복 데이터 검사를 실행 중입니다...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 최신 상태에서 중복 재검사
      const currentPendingReturns = returnState.pendingReturns;
      const uniqueKeys = new Set<string>();
      const finalUniqueReturns = currentPendingReturns.filter(item => {
        const key = `${item.customerName}_${item.orderNumber}_${item.purchaseName || item.productName}_${item.optionName}_${item.returnTrackingNumber}`;
        if (uniqueKeys.has(key)) {
          return false; // 중복 제거
        }
        uniqueKeys.add(key);
        return true;
      });
      
      if (finalUniqueReturns.length !== currentPendingReturns.length) {
        dispatch({
          type: 'SET_RETURNS',
          payload: {
            ...returnState,
            pendingReturns: finalUniqueReturns
          }
        });
        console.log(`🔄 2단계: 추가 중복 ${currentPendingReturns.length - finalUniqueReturns.length}개 제거 완료`);
      }
      
      // 완료 메시지
      setMessage(`✅ 자동 처리 완료: ${processedReturns.length}개 항목이 매칭 및 중복제거되었습니다.`);
      
    } catch (error) {
      console.error('자동 처리 오류:', error);
      setMessage('자동 처리 중 오류가 발생했습니다.');
    }
  };

  // 상품 데이터 새로고침 및 중복 제거 함수
  const handleRefreshProducts = () => {
    setLoading(true);
    setMessage('상품 데이터 중복 제거 중입니다...');
    
    try {
      const currentProducts = returnState.products || [];
      console.log(`상품 중복 제거 시작: ${currentProducts.length}개`);
      
      // 중복 제거를 위한 키 생성 (상품명 + 옵션명 + 바코드 조합)
      const uniqueKeys = new Set<string>();
      const uniqueProducts = currentProducts.filter(product => {
        const key = `${product.productName || ''}_${product.optionName || ''}_${product.barcode || ''}`;
        if (uniqueKeys.has(key)) {
          return false; // 중복 제거
        }
        uniqueKeys.add(key);
        return true;
      });
      
      const removedCount = currentProducts.length - uniqueProducts.length;
      
      if (removedCount > 0) {
        // 중복이 제거된 경우 상태 업데이트
        dispatch({
          type: 'SET_RETURNS',
          payload: {
            ...returnState,
            products: uniqueProducts
          }
        });
        
        // 로컬 스토리지도 업데이트
        localStorage.setItem('products', JSON.stringify(uniqueProducts));
        
        setMessage(`상품 중복 제거 완료: ${removedCount}개 중복 항목이 제거되었습니다.`);
        console.log(`상품 중복 제거 완료: ${currentProducts.length} → ${uniqueProducts.length} (${removedCount}개 제거)`);
      } else {
        setMessage('중복된 상품이 없습니다.');
        console.log('중복된 상품이 없음');
      }
      
    } catch (error) {
      console.error('상품 중복 제거 오류:', error);
      setMessage('상품 중복 제거 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 입고전 목록 자동 새로고침 함수 (버튼 자동 클릭 5번)
  const autoRefreshPendingList = async () => {
    try {
      console.log('🔄 입고전 목록 자동 새로고침 시작 - 버튼 자동 클릭 5번');
      
      const totalClicks = 5;
      
      for (let i = 1; i <= totalClicks; i++) {
        setMessage(`3단계: 입고전 목록 새로고침 (${i}/${totalClicks})...`);
        console.log(`🔄 ${i}번째 새로고침 버튼 클릭 시도`);
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
        if (refreshButtonRef.current) {
          console.log(`✅ ${i}번째 새로고침 버튼 클릭 성공`);
          // 여러 방법으로 클릭 시뮬레이션
          refreshButtonRef.current.click();
          
          // React 이벤트도 트리거
          const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
          });
          refreshButtonRef.current.dispatchEvent(clickEvent);
          
          // onClick 핸들러 직접 호출도 추가
          handleRefresh();
          
        } else {
          console.log(`⚠️ ${i}번째 시도 - 버튼 ref 없음, 함수 직접 호출`);
          handleRefresh();
        }
        
        // 각 클릭 사이에 충분한 대기 시간
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      
      // 최종 완료 메시지
      setMessage(`✅ 모든 자동 처리가 완료되었습니다. 새로고침 ${totalClicks}번 실행됨.`);
      console.log(`🎉 자동 새로고침 완료: 총 ${totalClicks}번 실행`);
      
    } catch (error) {
      console.error('자동 새로고침 오류:', error);
      setMessage('자동 새로고침 중 오류가 발생했습니다.');
    }
  };



  // 입고전 테이블 컴포넌트 - 개별 아이템 표시
  const PendingItemsTable = ({ items }: { items: ReturnItem[] }) => {
    const groupedItems = getIndividualItems(items);
    
    return (
      <table className={`pending-returns-table min-w-full divide-y divide-gray-200 ${tableSettings.autoTextSize.enabled ? 'auto-text-size-enabled' : ''}`}>
        <thead className="bg-gray-50">
          <tr>
            <th className="col-actions px-1 py-1 text-center text-2xs font-medium text-gray-500 uppercase tracking-wider">
              <input 
                type="checkbox" 
                checked={selectAll}
                onChange={handleSelectAll}
                className="w-4 h-4"
              />
            </th>
            <th className="col-customer-name px-1 py-1 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">고객명</th>
            <th className="col-order-number px-1 py-1 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">주문번호</th>
            <th className="col-product-name px-1 py-1 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">사입상품명</th>
            <th className="col-option-name px-1 py-1 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">옵션</th>
            <th className="col-quantity px-1 py-1 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">수량</th>
            <th className="col-return-reason px-1 py-1 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">반품사유</th>
            <th className="col-tracking-number px-1 py-1 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">수거송장번호</th>
            <th className="col-barcode px-1 py-1 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">바코드번호</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {groupedItems.map((group, groupIndex) => {
            const item = group.items[0];
            const itemIndex = items.findIndex(i => i.id === item.id);
            const isSelected = selectedItems.includes(itemIndex);
            
            return (
              <tr 
                key={item.id}
                className={`hover:bg-blue-50 ${getRowStyle(item, itemIndex, items)}`}
              >
                <td className="col-actions px-1 py-1">
                  <div className="flex justify-center items-center h-full">
                    <input 
                      type="checkbox" 
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedItems(prev => [...prev, itemIndex]);
                        } else {
                          setSelectedItems(prev => prev.filter(idx => idx !== itemIndex));
                        }
                      }}
                      className="w-4 h-4"
                    />
                  </div>
                </td>
                <td className="col-customer-name px-1 py-1 whitespace-nowrap overflow-hidden text-ellipsis max-w-[100px]">
                  {item.customerName}
                </td>
                <td className="col-order-number px-1 py-1 whitespace-nowrap overflow-hidden text-ellipsis">
                  {item.orderNumber}
                </td>
                <td className="col-product-name px-1 py-1">
                  <div className={!item.barcode ? "whitespace-normal break-words line-clamp-2" : "whitespace-nowrap overflow-hidden text-ellipsis"}>
                    {getPurchaseNameDisplay(item)}
                  </div>
                </td>
                <td className="col-option-name px-1 py-1 whitespace-nowrap overflow-hidden text-ellipsis">
                  {simplifyOptionName(item.optionName)}
                </td>
                <td className="col-quantity px-1 py-1 whitespace-nowrap text-center">
                  {item.quantity}
                </td>
                <td className="col-return-reason px-1 py-1">
                  <div 
                    className={`cursor-pointer ${isDefective(item.returnReason) ? 'text-red-500' : ''} whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]`}
                    onClick={() => isDefective(item.returnReason) && handleReturnReasonClick(item)}
                  >
                    {simplifyReturnReason(item.returnReason)}
                  </div>
                </td>
                <td className="col-tracking-number px-1 py-1">
                  <div className="font-mono text-sm whitespace-nowrap bg-blue-100 px-1 py-0.5 rounded text-center">
                    {group.trackingNumber === 'no-tracking' ? '-' : group.trackingNumber}
                  </div>
                </td>
                <td className="col-barcode px-1 py-1">
                  {tableSettings.barcodeFormat.enabled && item.barcode && item.barcode !== '-' ? (
                    <div className={`barcode-field ${tableSettings.barcodeFormat.enabled ? 'enabled' : ''}`}>
                      <div className="main-code">
                        {item.barcode}
                      </div>
                      {(() => {
                        // 바코드로 상품 리스트에서 실제 상품 찾기
                        const actualProduct = returnState.products.find(product => 
                          product.barcode === item.barcode
                        );
                        if (actualProduct) {
                          return (
                            <div className="sub-info">
                              ({actualProduct.purchaseName} {actualProduct.optionName})
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  ) : (
                    <div className="text-2xs">
                      <div className="font-mono font-semibold">{item.barcode || '-'}</div>
                      {item.barcode && item.barcode !== '-' && (
                        (() => {
                          // 바코드로 상품 리스트에서 실제 상품 찾기
                          const actualProduct = returnState.products.find(product => 
                            product.barcode === item.barcode
                          );
                          if (actualProduct) {
                            return (
                              <div className="main-barcode-info" 
                                   title={`${actualProduct.purchaseName} ${actualProduct.optionName}`}>
                                ({actualProduct.purchaseName} {actualProduct.optionName})
                              </div>
                            );
                          }
                          return null;
                        })()
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  // 입고완료 테이블 컴포넌트 - 개별 아이템 표시
  const CompletedItemsTable = ({ items }: { items: ReturnItem[] }) => {
    const groupedItems = getIndividualItems(items);
    
    return (
                    <table className={`min-w-full border-collapse main-table ${tableSettings.autoTextSize.enabled ? 'auto-text-size-enabled' : ''}`}>
        <thead>
          <tr className="bg-gray-50">
            <th className="px-2 py-2 border-x border-gray-300 text-center col-actions">
              <input 
                type="checkbox" 
                checked={selectAllCompleted}
                onChange={handleSelectAllCompleted}
                className="w-5 h-5"
              />
            </th>
            <th className="px-2 py-2 border-x border-gray-300 w-24 col-customer-name">고객명</th>
            <th className="px-2 py-2 border-x border-gray-300 col-order-number">주문번호</th>
            <th className="px-2 py-2 border-x border-gray-300 col-product-name">사입상품명</th>
            <th className="px-2 py-2 border-x border-gray-300 col-option-name">옵션명</th>
            <th className="px-2 py-2 border-x border-gray-300 w-12 col-quantity">수량</th>
            <th className="px-2 py-2 border-x border-gray-300 col-return-reason">반품사유</th>
            <th className="px-2 py-2 border-x border-gray-300 col-tracking-number">수거송장번호</th>
            <th className="px-2 py-2 border-x border-gray-300 col-barcode">바코드번호</th>
          </tr>
        </thead>
        <tbody>
          {groupedItems.map((group, groupIndex) => {
            const item = group.items[0];
            const itemIndex = items.findIndex(i => i.id === item.id);
            const isSelected = selectedCompletedItems.includes(itemIndex);
            
            return (
              <tr 
                key={item.id}
                className={`hover:bg-blue-50 ${isDefective(item.returnReason) ? 'text-red-500' : ''}`}
              >
                <td className="px-2 py-2 border-x border-gray-300 col-actions">
                  <div className="flex justify-center items-center h-full">
                    <input 
                      type="checkbox" 
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedCompletedItems(prev => [...prev, itemIndex]);
                        } else {
                          setSelectedCompletedItems(prev => prev.filter(idx => idx !== itemIndex));
                        }
                      }}
                      className="w-5 h-5"
                    />
                  </div>
                </td>
                <td className="px-2 py-2 border-x border-gray-300 whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px] col-customer-name">
                  {item.customerName}
                </td>
                <td className="px-2 py-2 border-x border-gray-300 whitespace-nowrap overflow-hidden text-ellipsis col-order-number">
                  {item.orderNumber}
                </td>
                <td className="px-2 py-2 border-x border-gray-300 col-product-name">
                  <div className={!item.barcode ? "whitespace-normal break-words line-clamp-2" : "whitespace-nowrap overflow-hidden text-ellipsis"}>
                    {getPurchaseNameDisplay(item)}
                  </div>
                </td>
                <td className="px-2 py-2 border-x border-gray-300 whitespace-nowrap overflow-hidden text-ellipsis col-option-name">
                  {simplifyOptionName(item.optionName)}
                </td>
                <td className="px-2 py-2 border-x border-gray-300 whitespace-nowrap text-center col-quantity">
                  {item.quantity}
                </td>
                <td 
                  className="px-2 py-2 border-x border-gray-300 whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px] cursor-pointer col-return-reason"
                  onClick={() => isDefective(item.returnReason) && handleReturnReasonClick(item)}
                >
                  {getReturnReasonDisplay(item)}
                </td>
                <td className="px-2 py-2 border-x border-gray-300 col-tracking-number">
                  <div className="font-mono text-sm whitespace-nowrap bg-blue-100 px-2 py-1 rounded text-center">
                    {group.trackingNumber === 'no-tracking' ? '-' : group.trackingNumber}
                  </div>
                </td>
                                <td className="px-2 py-2 border-x border-gray-300 col-barcode">
                  {tableSettings.barcodeFormat.enabled && item.barcode && item.barcode !== '-' ? (
                    <div className={`barcode-field ${tableSettings.barcodeFormat.enabled ? 'enabled' : ''}`}>
                      <div className="main-code">
                        {item.barcode}
                      </div>
                      {(() => {
                        // 바코드로 상품 리스트에서 실제 상품 찾기
                        const actualProduct = returnState.products.find(product => 
                          product.barcode === item.barcode
                        );
                        if (actualProduct) {
                          return (
                            <div className="sub-info">
                              ({actualProduct.purchaseName} {actualProduct.optionName})
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  ) : (
                    <div className="text-xs">
                      <div className="font-mono font-semibold">{item.barcode || '-'}</div>
                      {item.barcode && item.barcode !== '-' && (
                        (() => {
                          // 바코드로 상품 리스트에서 실제 상품 찾기
                          const actualProduct = returnState.products.find(product => 
                            product.barcode === item.barcode
                        );
                          if (actualProduct) {
                            return (
                              <div className="main-barcode-info" 
                                   title={`${actualProduct.purchaseName} ${actualProduct.optionName}`}>
                                ({actualProduct.purchaseName} {actualProduct.optionName})
                              </div>
                            );
                          }
                          return null;
                        })()
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  // 모달 z-index 관리를 위한 상태 추가
  const [modalLevel, setModalLevel] = useState(0);
  const [modalStack, setModalStack] = useState<string[]>([]);

  // 입고완료 날짜 관련 상태 추가
  const [currentDateIndex, setCurrentDateIndex] = useState(0);
  const [currentDate, setCurrentDate] = useState('');
  const [availableDates, setAvailableDates] = useState<string[]>([]);

  // 전역 z-index 관리 변수 - 더 높은 값으로 시작
  let globalZIndex = 10000;

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

  // 로컬 데이터 백업 함수 (Firebase 대신)
  const handleBackupData = () => {
    setLoading(true);
    setMessage('데이터를 백업 중입니다...');
    
    try {
      // 전체 데이터 수집
      const backupData = {
        pendingReturns: returnState.pendingReturns,
        completedReturns: returnState.completedReturns,
        products: returnState.products,
        exportDate: new Date().toISOString(),
        version: '1.0'
      };
      
      // JSON 파일로 다운로드
      const dataStr = JSON.stringify(backupData, null, 2);
      const dataBlob = new Blob([dataStr], {type: 'application/json'});
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `반품데이터_백업_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
      
      setMessage('데이터 백업이 완료되었습니다. 다운로드 폴더를 확인하세요.');
    } catch (error) {
      console.error('백업 오류:', error);
      setMessage('데이터 백업 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 데이터 복원 함수
  const handleRestoreData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setLoading(true);
    setMessage('백업 데이터를 복원 중입니다...');
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const backupData = JSON.parse(event.target?.result as string);
        
        // 데이터 유효성 검사
        if (!backupData.version || !backupData.exportDate) {
          throw new Error('유효하지 않은 백업 파일입니다.');
        }
        
        // 데이터 복원
        const restoredData: ReturnState = {
          pendingReturns: backupData.pendingReturns || [],
          completedReturns: backupData.completedReturns || [],
          products: backupData.products || []
        };
        
        // 상태 업데이트
        dispatch({ type: 'SET_RETURNS', payload: restoredData });
        
        // 로컬 스토리지 저장
        saveLocalData(restoredData);
        
        const exportDate = new Date(backupData.exportDate).toLocaleString();
        setMessage(`데이터 복원이 완료되었습니다. (백업 날짜: ${exportDate})`);
        
        console.log('데이터 복원 완료:', {
          pendingReturns: restoredData.pendingReturns.length,
          completedReturns: restoredData.completedReturns.length,
          products: restoredData.products.length,
          backupDate: exportDate
        });
        
      } catch (error) {
        console.error('복원 오류:', error);
        setMessage(`데이터 복원 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      } finally {
        setLoading(false);
        e.target.value = ''; // 파일 입력 초기화
      }
    };
    
    reader.onerror = () => {
      setMessage('파일을 읽는 중 오류가 발생했습니다.');
      setLoading(false);
      e.target.value = '';
    };
    
    reader.readAsText(file);
  };

  // 데이터 파일 업로드 핸들러 추가
  const handleProductFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    setLoading(true);
    setMessage('상품 데이터 파일을 처리 중입니다...');
    
    // 파일 처리 로직 구현
    parseProductExcel(file)
      .then(products => {
        if (products.length === 0) {
          setMessage('파일에서 유효한 상품 데이터를 찾을 수 없습니다.');
          return;
        }
        
        // 상태 업데이트 (Redux 스토어에 추가)
        dispatch({ 
          type: 'ADD_PRODUCTS', 
          payload: products
        });
        
        // 로컬 스토리지에 분리해서 저장
        const updatedProducts = [...returnState.products, ...products];
        localStorage.setItem('products', JSON.stringify(updatedProducts));
        localStorage.setItem('lastUpdated', new Date().toISOString());
        
        // 자동 매칭 수행 (선택적)
        const unmatchedItems = returnState.pendingReturns.filter(item => !item.barcode);
        if (unmatchedItems.length > 0) {
          let matchedCount = 0;
          
          unmatchedItems.forEach(item => {
            const matchedItem = matchProductByZigzagCode(item, products);
            if (matchedItem.barcode) {
              matchedCount++;
              dispatch({
                type: 'UPDATE_RETURN_ITEM',
                payload: matchedItem
              });
            }
          });
          
          if (matchedCount > 0) {
            setMessage(`${products.length}개 상품이 추가되었습니다. ${matchedCount}개 반품 항목이 자동 매칭되었습니다.`);
          } else {
            setMessage(`${products.length}개 상품이 추가되었습니다.`);
          }
        } else {
          setMessage(`${products.length}개 상품이 추가되었습니다.`);
        }
      })
      .catch(error => {
        console.error('상품 데이터 처리 오류:', error);
        setMessage(`상품 데이터 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        setLoading(false);
        e.target.value = ''; // 파일 입력 초기화
      });
  };

  // 송장 검색 관련 상태 및 함수
  const [trackingSearch, setTrackingSearch] = useState('');
  const [trackingSearchResult, setTrackingSearchResult] = useState<ReturnItem | null>(null);
  const [isTrackingNumberValid, setIsTrackingNumberValid] = useState<boolean | null>(null);

  // 수거송장번호 검색 이벤트 핸들러 개선 - Enter 키 입력 시 바로 입고 처리
  const handleTrackingKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (!trackingSearch.trim()) {
        setMessage('수거송장번호를 입력해주세요.');
        return;
      }
      
      // Enter 키 입력 시 바로 입고 처리 호출
      handleReceiveByTracking();
    }
  };

  // 수거송장번호로 상품 입고 처리 개선 - 동일 수거송장번호 일괄 처리
  const handleReceiveByTracking = () => {
    const searchTerm = trackingSearch.trim();
    if (!searchTerm) {
      setMessage('수거송장번호를 입력해주세요.');
      return;
    }
    
    // 동일한 수거송장번호를 가진 모든 항목 찾기 (수거송장번호 우선)
    const matchingItems = returnState.pendingReturns.filter(item => 
      (item.pickupTrackingNumber && item.pickupTrackingNumber === searchTerm) ||
      (item.returnTrackingNumber && item.returnTrackingNumber === searchTerm)
    );
    
    if (matchingItems.length === 0) {
      setMessage(`'${searchTerm}' 수거송장번호로 등록된 반품이 없습니다.`);
      setIsTrackingNumberValid(false);
      setTrackingSearch(''); // 입력 필드 초기화
      return;
    }
    
    // 유효한 수거송장번호임을 표시
    setIsTrackingNumberValid(true);
    
    setLoading(true);
    
    // 날짜를 00시 기준으로 설정 (년, 월, 일만 유지하고 시간은 00:00:00으로 설정)
    const today = new Date();
    const midnightToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    midnightToday.setHours(0, 0, 0, 0); // 명시적으로 0시 0분 0초 0밀리초로 설정
    
    // 입고완료로 처리할 항목들
    const completedItems = matchingItems.map(item => ({
      ...item,
      status: 'COMPLETED' as 'PENDING' | 'COMPLETED',
      completedAt: midnightToday
    }));
    
    // 입고완료 목록에 추가
    const updatedCompletedReturns = [
      ...completedItems,
      ...returnState.completedReturns
    ];
    
    // 대기 목록에서 제거 - 수거송장번호와 반품송장번호 모두 확인
    const updatedPendingReturns = returnState.pendingReturns.filter(item => 
      !((item.pickupTrackingNumber && item.pickupTrackingNumber === searchTerm) ||
        (item.returnTrackingNumber && item.returnTrackingNumber === searchTerm))
    );
    
    // 상태 업데이트 - 단일 디스패치로 모든 업데이트 수행
    dispatch({
      type: 'SET_RETURNS',
      payload: {
        ...returnState,
        pendingReturns: updatedPendingReturns,
        completedReturns: updatedCompletedReturns
      }
    });
    
    // 로컬 스토리지 업데이트 (분리 저장)
    localStorage.setItem('pendingReturns', JSON.stringify(updatedPendingReturns));
    localStorage.setItem('completedReturns', JSON.stringify(updatedCompletedReturns));
    localStorage.setItem('lastUpdated', new Date().toISOString());
    
    // 날짜 정보 업데이트 - 새 항목이 추가된 날짜를 현재 날짜로 설정
    const newDateKey = midnightToday.toLocaleDateString();
    if (newDateKey !== currentDate) {
      setCurrentDate(newDateKey);
      const newDateIndex = availableDates.indexOf(newDateKey);
      if (newDateIndex >= 0) {
        setCurrentDateIndex(newDateIndex);
      } else {
        // 새 날짜가 목록에 없으면 날짜 목록 갱신 필요
        const newDates = [newDateKey, ...availableDates];
        setAvailableDates(newDates);
        setCurrentDateIndex(0);
      }
    }
    
    setMessage(`'${searchTerm}' 수거송장번호로 ${completedItems.length}개 항목이 입고 처리되었습니다.`);
    setTrackingSearch(''); // 입력 필드 초기화
    setLoading(false);
  };

  // 수거송장번호 입력 취소 핸들러
  const handleCancelTrackingInput = () => {
    setTrackingSearch('');
    setTrackingSearchResult(null);
    setMessage('수거송장번호 입력이 취소되었습니다.');
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

  // 선택된 항목 재매칭 핸들러
  const handleRematchSelected = () => {
    if (selectedItems.length === 0) {
      setMessage('재매칭할 항목을 선택해주세요.');
      return;
    }

    setIsManualRematchModalOpen(true);
  };

  // 수동 재매칭 실행 핸들러
  const handleManualRematch = (itemId: string, newBarcode: string) => {
    // 선택된 아이템 찾기
    const selectedItem = returnState.pendingReturns.find(item => item.id === itemId);
    if (!selectedItem) return;

    // 새로운 바코드로 상품 정보 찾기
    const matchedProduct = returnState.products.find(product => product.barcode === newBarcode);
    if (!matchedProduct) return;

    // 아이템 업데이트
    const updatedItem: ReturnItem = {
      ...selectedItem,
      barcode: newBarcode,
      purchaseName: matchedProduct.purchaseName || matchedProduct.productName,
      zigzagProductCode: matchedProduct.zigzagProductCode || '',
      matchType: "수동재매칭",
      matchSimilarity: 1.0,
      matchedProductName: matchedProduct.productName,
      matchedProductOption: matchedProduct.optionName
    };

    // 상태 업데이트
    const updatedPendingReturns = returnState.pendingReturns.map(item => 
      item.id === itemId ? updatedItem : item
    );

    dispatch({
      type: 'SET_RETURNS',
      payload: {
        ...returnState,
        pendingReturns: updatedPendingReturns
      }
    });

    // 로컬 스토리지 업데이트
    localStorage.setItem('pendingReturns', JSON.stringify(updatedPendingReturns));
    localStorage.setItem('lastUpdated', new Date().toISOString());

    setMessage(`"${selectedItem.purchaseName}" 항목이 "${matchedProduct.productName}" (${newBarcode})로 재매칭되었습니다.`);
  };

  // 상품 매칭을 위한 상태 추가
  const [selectedProductForMatch, setSelectedProductForMatch] = useState<ReturnItem | null>(null);

  // 상품 매칭 모달 열기 핸들러
  const handleOpenProductMatchModal = (item: ReturnItem) => {
    // 상품 매칭 모달 열기
    setCurrentMatchItem(item);
    setSelectedProductForMatch(item);
    setShowProductMatchModal(true);
    // z-index 증가
    setModalLevel(prev => prev + 10);
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
    const updatedPendingReturns = [...returnState.pendingReturns, ...revertedItems];
    
    dispatch({
      type: 'SET_RETURNS',
      payload: {
        ...returnState,
        pendingReturns: updatedPendingReturns,
        completedReturns: newCompletedReturns
      }
    });
    
    // 로컬 스토리지 업데이트 (분리 저장)
    localStorage.setItem('pendingReturns', JSON.stringify(updatedPendingReturns));
    localStorage.setItem('completedReturns', JSON.stringify(newCompletedReturns));
    localStorage.setItem('lastUpdated', new Date().toISOString());
    
    setMessage(`${selectedCompletedItems.length}개의 항목이 입고전 목록으로 되돌아갔습니다.`);
    setSelectedCompletedItems([]);
    setSelectAllCompleted(false);
    setLoading(false);
  };

  // 입고완료 항목을 입고전으로 이동하여 재매칭 가능하게 만드는 함수
  const handleMoveToPendingForRematch = () => {
    if (selectedCompletedItems.length === 0) return;
    
    setLoading(true);
    
    // 선택된 항목들
    const selectedItems = selectedCompletedItems.map(index => currentDateItems[index]);
    
    // 입고전으로 이동할 항목들 (completedAt과 status 제거)
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
    
    // 입고전 목록에 추가
    const updatedPendingReturns = [...returnState.pendingReturns, ...revertedItems];
    
    // 상태 업데이트
    dispatch({
      type: 'SET_RETURNS',
      payload: {
        ...returnState,
        pendingReturns: updatedPendingReturns,
        completedReturns: newCompletedReturns
      }
    });
    
    // 로컬 스토리지 업데이트
    localStorage.setItem('pendingReturns', JSON.stringify(updatedPendingReturns));
    localStorage.setItem('completedReturns', JSON.stringify(newCompletedReturns));
    localStorage.setItem('lastUpdated', new Date().toISOString());
    
    setMessage(`${selectedCompletedItems.length}개의 항목이 입고전 목록으로 이동되어 재매칭이 가능합니다.`);
    setSelectedCompletedItems([]);
    setSelectAllCompleted(false);
    setLoading(false);
  };

  // 메인화면에서 재매칭 모달을 직접 열기 위한 함수
  const handleOpenRematchModal = () => {
    if (selectedCompletedItems.length === 0) {
      setMessage('재매칭할 항목을 선택해주세요.');
      return;
    }
    
    // 선택된 항목들
    const selectedItems = selectedCompletedItems.map(index => currentDateItems[index]);
    
    // 첫 번째 선택된 항목으로 재매칭 모달 열기
    setCurrentMatchItem(selectedItems[0]);
    setShowProductMatchModal(true);
    
    // 여러 항목이 선택된 경우 안내 메시지
    if (selectedCompletedItems.length > 1) {
      setMessage(`${selectedCompletedItems.length}개 항목이 선택되었습니다. 첫 번째 항목부터 재매칭을 진행합니다.`);
    }
  };

  // 날짜 변경 모달을 열기 위한 함수
  const handleOpenDateChangeModal = () => {
    if (selectedCompletedItems.length === 0) {
      setMessage('날짜를 변경할 항목을 선택해주세요.');
      return;
    }
    // 현재 날짜를 기본값으로 설정
    setSelectedDateForChange(new Date().toISOString().split('T')[0]);
    setIsDateChangeModalOpen(true);
  };

  // 날짜 변경 처리 함수
  const handleDateChange = (newDate: string) => {
    if (selectedCompletedItems.length === 0) return;
    
    setLoading(true);
    const selectedItems = selectedCompletedItems.map(index => currentDateItems[index]);
    
    // 선택된 항목들의 날짜를 변경 (completedAt 필드 사용)
    const updatedItems = selectedItems.map(item => ({
      ...item,
      completedAt: new Date(newDate)
    }));
    
    // completedReturns에서 해당 항목들 제거
    const newCompletedReturns = returnState.completedReturns.filter(item =>
      !selectedItems.some(selected =>
        selected.orderNumber === item.orderNumber &&
        selected.productName === item.productName &&
        selected.optionName === item.optionName &&
        selected.returnTrackingNumber === item.returnTrackingNumber
      )
    );
    
    // updatedItems를 completedReturns에 추가
    const finalCompletedReturns = [...newCompletedReturns, ...updatedItems];
    
    // 상태 업데이트
    dispatch({
      type: 'SET_RETURNS',
      payload: { ...returnState, completedReturns: finalCompletedReturns }
    });
    
    // 로컬 스토리지 업데이트
    localStorage.setItem('completedReturns', JSON.stringify(finalCompletedReturns));
    localStorage.setItem('lastUpdated', new Date().toISOString());
    
    setMessage(`${selectedCompletedItems.length}개 항목의 날짜가 ${new Date(newDate).toLocaleDateString('ko-KR')}로 변경되었습니다.`);
    setSelectedCompletedItems([]);
    setSelectAllCompleted(false);
    setIsDateChangeModalOpen(false);
    setLoading(false);
  };

  // 반품 데이터 업로드 핸들러
  const handleReturnFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    setLoading(true);
    setMessage('반품 데이터 파일을 처리 중입니다...');
    
    // 파일 처리 로직 구현
    parseReturnExcel(file)
      .then(returns => {
        if (returns.length === 0) {
          setMessage('파일에서 유효한 반품 데이터를 찾을 수 없습니다.');
          return;
        }
        
        // 반품사유 단순화 처리
        const processedReturns = returns.map(item => ({
          ...item,
          returnReason: simplifyReturnReason(item.returnReason)
        }));
        
        // 상태 업데이트 (Redux 스토어에 추가)
        dispatch({ 
          type: 'ADD_RETURNS', 
          payload: processedReturns
        });
        
        // 로컬 스토리지에 분리해서 저장
        const updatedPendingReturns = [...returnState.pendingReturns, ...processedReturns];
        localStorage.setItem('pendingReturns', JSON.stringify(updatedPendingReturns));
        localStorage.setItem('lastUpdated', new Date().toISOString());
        
        setMessage(`${processedReturns.length}개 반품 항목이 성공적으로 추가되었습니다.`);
      })
      .catch(error => {
        console.error('반품 데이터 처리 오류:', error);
        setMessage(`반품 데이터 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        setLoading(false);
        e.target.value = ''; // 파일 입력 초기화
      });
  };

  // 상품 매칭 처리 함수
  const handleProductMatch = (returnItem: ReturnItem, product: ProductInfo) => {
    setLoading(true);
    
    // 매칭된 상품 정보로 반품 아이템 업데이트
    const updatedItem = {
      ...returnItem,
      barcode: product.barcode,
      purchaseName: product.purchaseName || product.productName, // 사입상품명을 우선적으로 사용 (중요)
      zigzagProductCode: product.zigzagProductCode || '',
      customProductCode: product.customProductCode || '',
      matchType: 'manual',
      matchSimilarity: 1.0,
      matchedProductName: product.productName
    };
    
    console.log('매칭 완료:', {
      원래상품명: returnItem.productName,
      매칭된사입상품명: updatedItem.purchaseName,
      바코드: updatedItem.barcode
    });
    
    // 아이템이 pendingReturns에 있는지 확인
    const isInPending = returnState.pendingReturns.some(item => item.id === returnItem.id);
    
    if (isInPending) {
      // pendingReturns에서 업데이트
      const updatedPendingReturns = returnState.pendingReturns.map(item =>
        item.id === returnItem.id ? updatedItem : item
      );
      
      dispatch({
        type: 'SET_RETURNS',
        payload: {
          ...returnState,
          pendingReturns: updatedPendingReturns
        }
      });
      
      localStorage.setItem('pendingReturns', JSON.stringify(updatedPendingReturns));
    } else {
      // completedReturns에서 업데이트
      const updatedCompletedReturns = returnState.completedReturns.map(item =>
        item.id === returnItem.id ? updatedItem : item
      );
      
      dispatch({
        type: 'SET_RETURNS',
        payload: {
          ...returnState,
          completedReturns: updatedCompletedReturns
        }
      });
      
      localStorage.setItem('completedReturns', JSON.stringify(updatedCompletedReturns));
    }
    
    localStorage.setItem('lastUpdated', new Date().toISOString());
    
    // 모달 닫기
    setShowProductMatchModal(false);
    setLoading(false);
    
    // 완료된 항목에서 매칭한 경우 선택 해제
    if (!returnState.pendingReturns.some(item => item.id === returnItem.id)) {
      setSelectedCompletedItems([]);
      setSelectAllCompleted(false);
    }
    
    setMessage(`"${returnItem.productName}" 상품이 "${product.purchaseName || product.productName}"(으)로 매칭되었습니다.`);
  };

  return (
    <main className="min-h-screen p-4 md:p-6">
      
      {/* 상태 메시지 표시 */}
      {message && (
        <div className={`mb-4 p-3 rounded ${
          isTrackingNumberValid === false 
            ? 'bg-pink-100 text-red-800' 
            : isTrackingNumberValid === true 
            ? 'bg-green-100 text-green-800'
            : 'bg-blue-100 text-blue-800'
        }`}>
          {message}
        </div>
      )}
      
      {/* 버튼 영역 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-6">
        <button
          className={`px-4 py-2 text-white rounded ${buttonColors.testButton}`}
          onClick={checkLocalStorageStatus}
          disabled={loading}
        >
          저장소 상태 확인
        </button>
        
        <button
          className={`px-4 py-2 text-white rounded ${buttonColors.firebaseButton}`}
          onClick={handleBackupData}
          disabled={loading}
        >
          데이터 백업
        </button>
        
        <label
          className={`px-4 py-2 text-white rounded text-center cursor-pointer bg-purple-500 hover:bg-purple-600`}
          htmlFor="restoreFile"
        >
          데이터 복원
          <input
            type="file"
            id="restoreFile"
            accept=".json"
            onChange={handleRestoreData}
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
                        onClick={() => setIsPendingModalOpen(true)}
          disabled={loading}
        >
          입고전 ({returnState.pendingReturns.length})
        </button>
        
        <button
          className="px-4 py-2 text-white rounded bg-orange-500 hover:bg-orange-600"
          onClick={() => setShowTableSizeSettings(true)}
          disabled={loading}
        >
          표 크기 조정
        </button>
      </div>
      
      {/* 로딩 표시 */}
      {loading && (
        <div className="flex justify-center items-center my-4">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
          <span className="ml-2">처리 중...</span>
        </div>
      )}
      
      {/* 수거송장번호로 입고 영역 */}
      <div className="mb-6 p-4 border rounded-lg shadow-sm bg-white">
        <h2 className="text-xl font-semibold mb-4">수거송장번호로 입고</h2>
        
        <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-2">
          <input
            type="text"
            placeholder="수거송장번호 입력 후 Enter 또는 입고 버튼 클릭"
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
              onClick={handleDownloadListExcel}
              disabled={loading || returnState.completedReturns.length === 0}
            >
              목록 다운로드
            </button>
            <button
              className="px-3 py-1 text-white rounded bg-purple-500 hover:bg-purple-600"
              onClick={handleDownloadCompletedExcel}
              disabled={loading || returnState.completedReturns.length === 0}
            >
              셀 복사용 다운로드
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
                      <div className="flex space-x-2">
                        <button 
                          className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded"
                          onClick={handleRevertSelectedCompleted}
                        >
                          되돌리기 ({selectedCompletedItems.length})
                        </button>
                        <button 
                          className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded"
                          onClick={handleOpenRematchModal}
                        >
                          재매칭 ({selectedCompletedItems.length})
                        </button>
                        <button 
                          className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded"
                          onClick={handleOpenDateChangeModal}
                        >
                          날짜변경 ({selectedCompletedItems.length})
                        </button>
                      </div>
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
                      <div className="flex space-x-2">
                        <button 
                          className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded"
                          onClick={handleRevertSelectedCompleted}
                        >
                          되돌리기 ({selectedCompletedItems.length})
                        </button>
                        <button 
                          className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded"
                          onClick={handleOpenRematchModal}
                        >
                          재매칭 ({selectedCompletedItems.length})
                        </button>
                        <button 
                          className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded"
                          onClick={handleOpenDateChangeModal}
                        >
                          날짜변경 ({selectedCompletedItems.length})
                        </button>
                      </div>
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
      <PendingReturnsModal
        isOpen={isPendingModalOpen}
        onClose={() => {
          setIsPendingModalOpen(false);
          // 모달이 닫힐 때 선택된 아이템들 초기화
          setSelectedItems([]);
        }}
        items={returnState.pendingReturns}
        selectedItems={selectedItems}
        onRefresh={handleRefresh}
        onProcessSelected={handleProcessSelected}
        onDeleteSelected={handleDeleteSelected}
        onRematchSelected={handleRematchSelected}
        onItemSelect={handleItemSelect}
        PendingItemsTable={PendingItemsTable}
      />
      
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
            <button onClick={() => productModalRef.current?.close()} className="btn btn-sm btn-circle">✕</button>
          </h3>
          
          <div className="mb-4 flex justify-end gap-2">
            <button
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded flex items-center gap-1"
              onClick={handleRefreshProducts}
              disabled={!returnState.products || returnState.products.length === 0}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
              새로고침 (중복제거)
            </button>
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
              <table className={`min-w-full border-collapse border border-gray-300 main-table ${tableSettings.autoTextSize.enabled ? 'auto-text-size-enabled' : ''}`}>
                <thead className="sticky top-0 bg-white">
                  <tr className="bg-gray-100">
                    <th className="px-2 py-2 border-x border-gray-300 col-actions">번호</th>
                    <th className="px-2 py-2 border-x border-gray-300 col-product-name">사입상품명</th>
                    <th className="px-2 py-2 border-x border-gray-300 col-product-name">상품명</th>
                    <th className="px-2 py-2 border-x border-gray-300 col-option-name">옵션명</th>
                    <th className="px-2 py-2 border-x border-gray-300 col-barcode">바코드번호</th>
                    <th className="px-2 py-2 border-x border-gray-300 col-order-number">자체상품코드</th>
                  </tr>
                </thead>
                <tbody>
                  {returnState.products.map((item, index) => (
                    <tr key={item.id} className="border-t border-gray-300 hover:bg-gray-50">
                      <td className="px-2 py-2 border-x border-gray-300 col-actions">{index + 1}</td>
                      <td className="px-2 py-2 border-x border-gray-300 col-product-name">{item.purchaseName || '-'}</td>
                      <td className="px-2 py-2 border-x border-gray-300 col-product-name">{item.productName}</td>
                      <td className="px-2 py-2 border-x border-gray-300 col-option-name">{item.optionName || '-'}</td>
                      <td className="px-2 py-2 border-x border-gray-300 font-mono col-barcode">
                        {tableSettings.barcodeFormat.enabled && item.barcode && item.barcode.includes('(') ? (
                          <div className={`barcode-field ${tableSettings.barcodeFormat.enabled ? 'enabled' : ''}`}>
                            <div className="main-code">
                              {item.barcode.split('(')[0].trim()}
                            </div>
                            <div className="sub-info">
                              ({item.barcode.split('(')[1]}
                            </div>
                          </div>
                        ) : (
                          item.barcode
                        )}
                      </td>
                      <td className="px-2 py-2 border-x border-gray-300 col-order-number">{item.zigzagProductCode || '-'}</td>
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

      {/* 수동 재매칭 모달 */}
      <ManualRematchModal
        isOpen={isManualRematchModalOpen}
        onClose={() => {
          setIsManualRematchModalOpen(false);
          // 모달이 닫힐 때 선택된 아이템들 초기화
          setSelectedItems([]);
        }}
        selectedItems={selectedItems.map(index => returnState.pendingReturns[index]).filter(Boolean)}
        products={returnState.products || []}
        onRematch={handleManualRematch}
      />

      {/* 날짜 변경 모달 */}
      {isDateChangeModalOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          style={{ zIndex: 1000 + modalLevel }}
          onClick={() => setIsDateChangeModalOpen(false)}
        >
          <div 
            className="bg-white rounded-lg shadow-xl w-11/12 max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-lg mb-4 flex justify-between items-center">
              <span>날짜 변경</span>
              <button 
                onClick={() => setIsDateChangeModalOpen(false)} 
                className="text-gray-500 hover:text-gray-700 text-xl font-bold"
              >
                ✕
              </button>
            </h3>
            
            <div className="mb-4">
              <p className="text-gray-600 mb-4">
                선택된 {selectedCompletedItems.length}개 항목의 날짜를 변경할 수 있습니다.
              </p>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  새로운 날짜 선택
                </label>
                <input
                  type="date"
                  value={selectedDateForChange}
                  onChange={(e) => setSelectedDateForChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            
            <div className="flex justify-end space-x-2">
              <button 
                className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded"
                onClick={() => setIsDateChangeModalOpen(false)}
              >
                취소
              </button>
              <button 
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded"
                onClick={() => selectedDateForChange && handleDateChange(selectedDateForChange)}
                disabled={!selectedDateForChange}
              >
                날짜 변경
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 표 크기 조정 모달 */}
      {showTableSizeSettings && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          style={{ zIndex: 1000 + modalLevel }}
          onClick={() => setShowTableSizeSettings(false)}
        >
          <div 
            className="bg-white rounded-lg shadow-xl w-11/12 max-w-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-lg mb-4 flex justify-between items-center">
              <span>표 및 텍스트 크기 조정</span>
              <button 
                onClick={() => setShowTableSizeSettings(false)} 
                className="text-gray-500 hover:text-gray-700 text-xl font-bold"
              >
                ✕
              </button>
            </h3>
            
            <div className="space-y-6">
              {/* 자동 텍스트 크기 조정 설정 */}
              <div>
                <h4 className="font-semibold text-md mb-3 text-indigo-600">자동 텍스트 크기 조정</h4>
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      id="autoTextSizeEnabled"
                      checked={tableSettings.autoTextSize.enabled}
                      onChange={(e) => handleAutoTextSizeChange('enabled', e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="autoTextSizeEnabled" className="text-sm font-medium text-gray-700">
                      자동 텍스트 크기 조정 활성화
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      최소 폰트 크기: {tableSettings.autoTextSize.minFontSize}rem
                    </label>
                    <input
                      type="range"
                      min="0.3"
                      max="1.0"
                      step="0.1"
                      value={tableSettings.autoTextSize.minFontSize}
                      onChange={(e) => handleAutoTextSizeChange('minFontSize', Number(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      최대 폰트 크기: {tableSettings.autoTextSize.maxFontSize}rem
                    </label>
                    <input
                      type="range"
                      min="1.0"
                      max="2.0"
                      step="0.1"
                      value={tableSettings.autoTextSize.maxFontSize}
                      onChange={(e) => handleAutoTextSizeChange('maxFontSize', Number(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      id="adjustForOverflow"
                      checked={tableSettings.autoTextSize.adjustForOverflow}
                      onChange={(e) => handleAutoTextSizeChange('adjustForOverflow', e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="adjustForOverflow" className="text-sm font-medium text-gray-700">
                      오버플로우 방지
                    </label>
                  </div>
                </div>
              </div>

              {/* 바코드번호 필드 특별 형식 설정 */}
              <div>
                <h4 className="font-semibold text-md mb-3 text-teal-600">바코드번호 필드 형식</h4>
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      id="barcodeFormatEnabled"
                      checked={tableSettings.barcodeFormat.enabled}
                      onChange={(e) => handleBarcodeFormatChange('enabled', e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="barcodeFormatEnabled" className="text-sm font-medium text-gray-700">
                      바코드번호 특별 형식 활성화
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      메인 코드 크기: {tableSettings.barcodeFormat.mainCodeSize}rem
                    </label>
                    <input
                      type="range"
                      min="0.8"
                      max="1.5"
                      step="0.1"
                      value={tableSettings.barcodeFormat.mainCodeSize}
                      onChange={(e) => handleBarcodeFormatChange('mainCodeSize', Number(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      서브 정보 크기: {tableSettings.barcodeFormat.subInfoSize}rem
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="1.0"
                      step="0.1"
                      value={tableSettings.barcodeFormat.subInfoSize}
                      onChange={(e) => handleBarcodeFormatChange('subInfoSize', Number(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      줄 간격: {tableSettings.barcodeFormat.lineHeight}
                    </label>
                    <input
                      type="range"
                      min="0.8"
                      max="1.5"
                      step="0.1"
                      value={tableSettings.barcodeFormat.lineHeight}
                      onChange={(e) => handleBarcodeFormatChange('lineHeight', Number(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end space-x-2 mt-6">
              <button 
                className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded"
                onClick={() => setShowTableSizeSettings(false)}
              >
                취소
              </button>
              <button 
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
                onClick={applyTableSettings}
              >
                설정 적용
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}