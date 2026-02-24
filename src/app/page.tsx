'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ReturnItem, ReturnState, ProductInfo, SmartStoreProductInfo } from '@/types/returns';
import { parseProductExcel, parseReturnExcel, generateExcel, generateCompletedReturnsExcel, simplifyOptionName, parseSmartStoreExcel } from '@/utils/excel';
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
import { matchProductData, simplifyReturnReason } from '../utils/excel';
import { matchProductWithSmartStoreCode, doubleCheckBarcodeWithOption } from '@/utils/smartstore';
import { optionMatchScoreByGroups } from '@/utils/optionMatching';
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
  
  // 구체적인 키워드들 (상품의 특징을 나타내는 키워드) - 플리츠/니트 등 사입상품명 구분용
  const specificKeywords = [
    '스판', '차르르', '편안한', '롱', '숏', '미니', '맥시', '롱기장', '숏기장',
    '쿨소재', '시원한', '통풍', '흡수', '속건', '드라이', '쿨링', '냉감',
    '린넨', '면', '폴리에스터', '나일론', '스판덱스', '레이온', '비스코스',
    '프릴', '레이스', '자수', '프린트', '스트라이프', '도트', '체크', '플라워',
    '플리츠', '니트', '골지',
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
  
  // console.log(`🔍 키워드 추출: "${productName}" → [${foundKeywords.join(', ')}] ${hasCommonKeywords ? '(일반키워드 포함)' : '(구체적 키워드만)'}`);
  
  return foundKeywords;
}

// 개선된 문자열 유사도 계산 함수 - 핵심 키워드 기반
function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  const text1 = str1.toLowerCase().trim();
  const text2 = str2.toLowerCase().trim();
  
  if (text1 === text2) return 1.0;
  
  // 계절 키워드만 다른 경우 처리 (계절 키워드 제거 후 비교)
  const seasonKeywords = ['봄', '여름', '가을', '겨울', 'spring', 'summer', 'autumn', 'winter'];
  let text1WithoutSeason = text1;
  let text2WithoutSeason = text2;
  
  seasonKeywords.forEach(season => {
    text1WithoutSeason = text1WithoutSeason.replace(new RegExp(`\\b${season}\\b`, 'g'), '').trim();
    text2WithoutSeason = text2WithoutSeason.replace(new RegExp(`\\b${season}\\b`, 'g'), '').trim();
  });
  
  // 계절 키워드 제거 후 완전 일치하면 높은 유사도 반환
  if (text1WithoutSeason === text2WithoutSeason && text1WithoutSeason.length > 0) {
    // console.log(`✅ 계절 키워드만 다른 완전 일치: "${text1}" vs "${text2}"`);
    return 0.95; // 계절만 다르면 0.95 유사도
  }
  
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
      
      // 소재 키워드 불일치 체크 (중요한 차별화 요소)
      const materialKeywords = ['니트', '골지', '바스락', '린넨', '코튼', '실크', '데님', '가죽'];
      const materials1 = materialKeywords.filter(material => text1.includes(material));
      const materials2 = materialKeywords.filter(material => text2.includes(material));
      
      const hasMaterialConflict = materials1.length > 0 && materials2.length > 0 && 
        !materials1.some(m => materials2.includes(m));
      
      // 최종 키워드 유사도 = (개수점수 * 0.3) + (정확성점수 * 0.4) + (순서점수 * 0.2) + (밀도점수 * 0.1)
      let keywordSimilarity = (countScore * 0.3) + (accuracyScore * 0.4) + (orderScore * 0.2) + (densityScore * 0.1);
      
      // 소재 불일치 시 감점
      if (hasMaterialConflict) {
        keywordSimilarity -= 0.2;
        // console.log(`❌ 소재 키워드 불일치: [${materials1.join(', ')}] vs [${materials2.join(', ')}] - 유사도 감점`);
      }
      
      // 최종 유사도는 0 이상으로 제한
      keywordSimilarity = Math.max(0, keywordSimilarity);
      
      // console.log(`🎯 키워드 매칭 분석: "${str1}" vs "${str2}"`);
      // console.log(`   공통키워드: [${commonKeywords.join(', ')}] (${commonKeywords.length}개)`);
      // console.log(`   개수점수: ${countScore.toFixed(2)}, 정확성점수: ${accuracyScore.toFixed(2)}, 순서점수: ${orderScore.toFixed(2)}, 밀도점수: ${densityScore.toFixed(2)}`);
      // console.log(`   최종 키워드 유사도: ${keywordSimilarity.toFixed(2)}`);
      
      // 키워드 유사도가 높으면 높은 점수 반환 (임계값 상향 조정)
      if (keywordSimilarity > 0.7) {
        return Math.min(0.95, keywordSimilarity + 0.1); // 최대 0.95점
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
  const { state: returnState, dispatch } = useReturnState();
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
  
  // 스마트스토어 상품 데이터 상태 추가
  const [smartStoreProducts, setSmartStoreProducts] = useState<SmartStoreProductInfo[]>([]);
  const [smartStoreLoading, setSmartStoreLoading] = useState(false);
  
  // 통합 상품목록 모달 탭 상태
  const [productListTab, setProductListTab] = useState<'smartstore' | 'cellmate'>('smartstore');
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
                enabled: false, // 바코드번호 특별 형식 비활성화
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
      const smartStoreProducts = loadCompressedData('smartStoreProducts');
      const lastUpdated = localStorage.getItem('lastUpdated');

      // 스마트스토어 상품 데이터 설정
      if (smartStoreProducts.length > 0) {
        setSmartStoreProducts(smartStoreProducts);
      }

      // 불러온 데이터가 있다면 상태 업데이트
      if (pendingReturns.length > 0 || completedReturns.length > 0 || products.length > 0) {
        // 기존 데이터의 반품사유도 단순화 적용
        const simplifiedPendingReturns = pendingReturns.map(item => ({
          ...item,
          returnReason: simplifyReturnReason(item.returnReason)
        }));
        
        const simplifiedCompletedReturns = completedReturns.map(item => ({
          ...item,
          returnReason: simplifyReturnReason(item.returnReason)
        }));
        
        const returnData: ReturnState = {
          pendingReturns: simplifiedPendingReturns,
          completedReturns: simplifiedCompletedReturns,
          products
        };
        
        dispatch({ type: 'SET_RETURNS', payload: returnData });
        setMessage(`마지막 업데이트: ${new Date(lastUpdated || '').toLocaleString()}`);
        
        // 모든 바코드가 있는 항목에 대해 더블체크 실행
        if (products.length > 0 && pendingReturns.length > 0) {
          console.log('🔄 모든 바코드 항목 더블체크 시작...');
          
          const itemsWithBarcode = pendingReturns.filter(item => item.barcode && item.barcode !== '-');
          console.log(`📦 바코드가 있는 항목 ${itemsWithBarcode.length}개에 대해 더블체크 실행`);
          
          let updatedCount = 0;
          const doubleCheckedReturns = pendingReturns.map(item => {
            // 바코드가 있고 옵션명이 있는 경우만 더블체크
            if (item.barcode && item.barcode !== '-' && item.optionName && item.optionName.trim() !== '') {
              const doubleChecked = doubleCheckBarcodeWithOption(item, products);
              
              // 바코드가 변경되었으면 업데이트
              if (doubleChecked.barcode !== item.barcode) {
                updatedCount++;
                console.log(`✅ 더블체크로 바코드 변경: ${item.optionName} - ${item.barcode} → ${doubleChecked.barcode}`);
                return doubleChecked;
              }
            }
            return item;
          });
          
          if (updatedCount > 0) {
            dispatch({
              type: 'SET_RETURNS',
              payload: {
                ...returnData,
                pendingReturns: doubleCheckedReturns
              }
            });
            
            setMessage(`마지막 업데이트: ${new Date(lastUpdated || '').toLocaleString()} | 더블체크: ${updatedCount}개 바코드 수정`);
            console.log(`✅ 더블체크 완료: ${updatedCount}개 바코드 수정`);
          }
          
          // 스마트스토어 상품이 있고, 매칭되지 않은 반품이 있다면 자동 매칭 적용
          if (smartStoreProducts.length > 0) {
            const unmatchedItems = doubleCheckedReturns.filter(item => !item.barcode || item.barcode === '-');
            
            if (unmatchedItems.length > 0) {
              console.log(`📦 매칭되지 않은 반품 ${unmatchedItems.length}개에 스마트스토어 매칭 적용`);
              
              const matchedItems = unmatchedItems.map(item => {
                const matched = matchProductWithSmartStoreCode(item, smartStoreProducts, products);
                
                // 바코드가 매칭된 경우 더블체크 실행
                if (matched.barcode && matched.barcode !== '-') {
                  return doubleCheckBarcodeWithOption(matched, products);
                }
                
                return matched;
              });
              
              const updatedPendingReturns = doubleCheckedReturns.map(item => {
                const matched = matchedItems.find(matched => matched.id === item.id);
                return matched || item;
              });
              
              // 매칭된 항목이 있다면 상태 업데이트
              const hasNewMatches = matchedItems.some((matched, index) => {
                const originalItem = unmatchedItems[index];
                return matched.barcode && matched.barcode !== '-' && matched.barcode !== originalItem.barcode;
              });
              
              if (hasNewMatches) {
                dispatch({
                  type: 'SET_RETURNS',
                  payload: {
                    ...returnData,
                    pendingReturns: updatedPendingReturns
                  }
                });
                
                const newMatchCount = matchedItems.filter((matched, index) => {
                  const originalItem = unmatchedItems[index];
                  return matched.barcode && matched.barcode !== '-' && matched.barcode !== originalItem.barcode;
                }).length;
                
                setMessage(`마지막 업데이트: ${new Date(lastUpdated || '').toLocaleString()} | 더블체크: ${updatedCount}개 수정 | 스마트스토어 매칭: ${newMatchCount}개 추가`);
                console.log(`✅ 스마트스토어 자동 매칭 완료: ${newMatchCount}개 추가 매칭`);
              }
            }
          }
        }
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
            enabled: false,
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
            console.log(`초기화 시 바코드 CSS 변수 설정: --barcode-format-${cssKey} = ${value}`);
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
    
    // CSS 변수 적용 확인
    const appliedValue = root.style.getPropertyValue(`--barcode-format-${cssKey}`);
    console.log(`CSS 변수 적용 확인: --barcode-format-${cssKey} = ${appliedValue}`);
    
    // 바코드 필드 요소들에 직접 스타일 적용 (강제 적용)
    const barcodeFields = document.querySelectorAll('.barcode-field');
    console.log(`발견된 바코드 필드 수: ${barcodeFields.length}`);
    
    barcodeFields.forEach((field, index) => {
      const fieldElement = field as HTMLElement;
      if (key === 'mainCodeSize') {
        const mainCode = fieldElement.querySelector('.main-code') as HTMLElement;
        if (mainCode) {
          mainCode.style.setProperty('font-size', `${value}rem`, 'important');
          console.log(`바코드 필드 ${index + 1} 메인 코드 크기 적용: ${value}rem`);
        }
      } else if (key === 'subInfoSize') {
        const subInfo = fieldElement.querySelector('.sub-info') as HTMLElement;
        if (subInfo) {
          subInfo.style.setProperty('font-size', `${value}rem`, 'important');
          console.log(`바코드 필드 ${index + 1} 서브 정보 크기 적용: ${value}rem`);
        }
      } else if (key === 'lineHeight') {
        fieldElement.style.setProperty('line-height', value.toString(), 'important');
        console.log(`바코드 필드 ${index + 1} 줄 간격 적용: ${value}`);
      }
    });
    
    // 모든 바코드 필드에 전체 설정 적용 (강제 업데이트)
    setTimeout(() => {
      const allBarcodeFields = document.querySelectorAll('.barcode-field');
      allBarcodeFields.forEach((field, index) => {
        const fieldElement = field as HTMLElement;
        const mainCode = fieldElement.querySelector('.main-code') as HTMLElement;
        const subInfo = fieldElement.querySelector('.sub-info') as HTMLElement;
        
        if (mainCode) {
          mainCode.style.setProperty('font-size', `${newSettings.barcodeFormat.mainCodeSize}rem`, 'important');
        }
        if (subInfo) {
          subInfo.style.setProperty('font-size', `${newSettings.barcodeFormat.subInfoSize}rem`, 'important');
        }
        fieldElement.style.setProperty('line-height', newSettings.barcodeFormat.lineHeight.toString(), 'important');
        
        console.log(`바코드 필드 ${index + 1} 전체 설정 적용 완료`);
      });
    }, 50);
    
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
            
            // 셀 너비에 맞는 적절한 폰트 크기 계산 (개선된 계산)
            // 기본 폰트 크기에서 시작하여 셀 너비에 맞게 조정
            const baseFontSize = 16; // 기본 16px
            const contentWidthRatio = cellWidth / (content.length * baseFontSize * 0.6); // 0.6은 평균 문자 너비 비율
            
            let newFontSize;
            if (contentWidthRatio < 1) {
              // 내용이 셀을 넘치는 경우 - 비율에 따라 축소
              newFontSize = baseFontSize * contentWidthRatio * 0.9; // 0.9는 여유 계수
            } else {
              // 내용이 셀에 맞는 경우 - 기본 크기 유지
              newFontSize = baseFontSize;
            }
            
            // 최소/최대 폰트 크기 범위 내로 제한
            newFontSize = Math.max(minFontSize, newFontSize);
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
          
          // 여러 반품 항목을 한 번에 추가하기 위해 현재 상태에 새 항목들을 추가
          const currentState = { pendingReturns: returnState.pendingReturns, completedReturns: returnState.completedReturns, products: returnState.products };
          const updatedPendingReturns = [...currentState.pendingReturns, ...processedReturns];
          dispatch({ type: 'SET_RETURNS', payload: { ...currentState, pendingReturns: updatedPendingReturns } });
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
                
                // 바코드가 매칭된 경우 더블체크 실행
                let finalItem = matchedItem;
                if (matchedItem.barcode && matchedItem.barcode !== '-') {
                  finalItem = doubleCheckBarcodeWithOption(matchedItem, returnState.products);
                }
                
                if (finalItem.barcode) {
                  // 매칭 성공
                  matchedCount++;
                  dispatch({
                    type: 'UPDATE_RETURN',
                    payload: finalItem
                  });
                } else {
                  // 매칭 실패
                  failedCount++;
                }
                
                return finalItem;
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
          // 여러 상품을 한 번에 추가하기 위해 현재 상품 목록에 새 상품들을 추가
          const currentProducts = returnState.products || [];
          const updatedProducts = [...currentProducts, ...products];
          dispatch({ type: 'SET_PRODUCTS', payload: updatedProducts });
          
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
              
              // 바코드가 매칭된 경우 더블체크 실행
              let finalItem = matchedItem;
              if (matchedItem.barcode && matchedItem.barcode !== '-') {
                finalItem = doubleCheckBarcodeWithOption(matchedItem, products);
              }
              
              if (finalItem.barcode) {
                // 매칭 성공
                matchedCount++;
                dispatch({
                  type: 'UPDATE_RETURN',
                  payload: finalItem
                });
              } else {
                // 매칭 실패
                failedCount++;
              }
              
              return finalItem;
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
        // 이미 바코드가 있는 경우 더블체크만 수행
        if (item.barcode && item.barcode !== '-') {
          return doubleCheckBarcodeWithOption(item, returnState.products);
        }
        // 매칭 수행
        const matchedItem = matchProductByZigzagCode(item, returnState.products);
        // 바코드가 매칭된 경우 더블체크 실행
        if (matchedItem.barcode && matchedItem.barcode !== '-') {
          return doubleCheckBarcodeWithOption(matchedItem, returnState.products);
        }
        return matchedItem;
      });
    }
    
    // 입고 처리 - 선택된 항목들을 완료 상태로 변경
    // 오늘 날짜의 00시로 설정 (날짜별 그룹화를 위해)
    const today = new Date();
    const midnightToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    const completedItems = itemsToProcess.map(item => ({
      ...item,
      status: 'COMPLETED' as const,
      completedAt: midnightToday
    }));
    
    const updatedPendingReturns = returnState.pendingReturns.filter(item => 
      !itemsToProcess.some(processed => processed.id === item.id)
    );
    const updatedCompletedReturns = [...returnState.completedReturns, ...completedItems];
    
    dispatch({ type: 'SET_RETURNS', payload: { 
      pendingReturns: updatedPendingReturns, 
      completedReturns: updatedCompletedReturns, 
      products: returnState.products 
    }});
    
    // 로컬 스토리지 업데이트 (분리 저장)
    localStorage.setItem('pendingReturns', JSON.stringify(updatedPendingReturns));
    localStorage.setItem('completedReturns', JSON.stringify(updatedCompletedReturns));
    localStorage.setItem('lastUpdated', new Date().toISOString());
    
    // 날짜 목록 업데이트 및 오늘 날짜로 이동
    const todayDateKey = midnightToday.toLocaleDateString('ko-KR');
    const newAvailableDates = Array.from(new Set([...availableDates, todayDateKey]))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    
    console.log(`📅 [입고 처리] 오늘 날짜: "${todayDateKey}", 현재 선택 날짜: "${currentDate}"`);
    console.log(`📅 [입고 처리] 날짜 목록 업데이트:`, newAvailableDates);
    
    if (newAvailableDates.length !== availableDates.length || !availableDates.includes(todayDateKey)) {
      setAvailableDates(newAvailableDates);
      console.log(`📅 [입고 처리] 날짜 목록 업데이트 완료`);
    }
    
    // 오늘 날짜로 이동 (없으면 추가하고 선택)
    if (currentDate !== todayDateKey) {
      console.log(`📅 [입고 처리] 현재 날짜를 오늘 날짜로 변경: "${currentDate}" → "${todayDateKey}"`);
      setCurrentDate(todayDateKey);
      const todayIndex = newAvailableDates.indexOf(todayDateKey);
      if (todayIndex >= 0) {
        setCurrentDateIndex(todayIndex);
        console.log(`📅 [입고 처리] 날짜 인덱스 설정: ${todayIndex}`);
      } else {
        // 오늘 날짜가 목록에 없으면 추가
        setCurrentDateIndex(0);
        console.log(`📅 [입고 처리] 오늘 날짜가 목록에 없어 인덱스 0으로 설정`);
      }
    }
    
    // 입고 처리된 항목 확인
    console.log(`📦 [입고 처리] 완료된 항목 확인:`, completedItems.map(item => ({
      id: item.id,
      completedAt: item.completedAt,
      dateString: item.completedAt ? new Date(item.completedAt).toLocaleDateString('ko-KR') : '없음'
    })));
    
    setSelectedItems([]);
    setSelectAll(false);
    setMessage(`${itemsToProcess.length}개 항목을 입고 처리했습니다.`);
  };

  // 단일 항목 입고 처리
  const handleProcessSingle = (index: number) => {
    // 항목 가져오기
    let itemToProcess = returnState.pendingReturns[index];
    
    // 제품 매칭 수행
    if (returnState.products.length > 0) {
      if (!itemToProcess.barcode || itemToProcess.barcode === '-') {
        // 매칭 수행
        itemToProcess = matchProductByZigzagCode(itemToProcess, returnState.products);
      }
      // 바코드가 있는 경우 더블체크 실행
      if (itemToProcess.barcode && itemToProcess.barcode !== '-') {
        itemToProcess = doubleCheckBarcodeWithOption(itemToProcess, returnState.products);
      }
    }
    
    // 입고 처리 - 단일 항목을 완료 상태로 변경
    // 오늘 날짜의 00시로 설정 (날짜별 그룹화를 위해)
    const today = new Date();
    const midnightToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    const completedItem = {
      ...itemToProcess,
      status: 'COMPLETED' as const,
      completedAt: midnightToday
    };
    
    const updatedPendingReturns = returnState.pendingReturns.filter(item => item.id !== itemToProcess.id);
    const updatedCompletedReturns = [...returnState.completedReturns, completedItem];
    
    dispatch({ type: 'SET_RETURNS', payload: { 
      pendingReturns: updatedPendingReturns, 
      completedReturns: updatedCompletedReturns, 
      products: returnState.products 
    }});
    
    // 로컬 스토리지 업데이트 (분리 저장)
    localStorage.setItem('pendingReturns', JSON.stringify(updatedPendingReturns));
    localStorage.setItem('completedReturns', JSON.stringify(updatedCompletedReturns));
    localStorage.setItem('lastUpdated', new Date().toISOString());
    
    // 날짜 목록 업데이트 및 오늘 날짜로 이동
    const todayDateKey = midnightToday.toLocaleDateString('ko-KR');
    const newAvailableDates = Array.from(new Set([...availableDates, todayDateKey]))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    
    console.log(`📅 [단일 입고 처리] 오늘 날짜: "${todayDateKey}", 현재 선택 날짜: "${currentDate}"`);
    console.log(`📅 [단일 입고 처리] 날짜 목록 업데이트:`, newAvailableDates);
    
    if (newAvailableDates.length !== availableDates.length || !availableDates.includes(todayDateKey)) {
      setAvailableDates(newAvailableDates);
      console.log(`📅 [단일 입고 처리] 날짜 목록 업데이트 완료`);
    }
    
    // 오늘 날짜로 이동 (없으면 추가하고 선택)
    if (currentDate !== todayDateKey) {
      console.log(`📅 [단일 입고 처리] 현재 날짜를 오늘 날짜로 변경: "${currentDate}" → "${todayDateKey}"`);
      setCurrentDate(todayDateKey);
      const todayIndex = newAvailableDates.indexOf(todayDateKey);
      if (todayIndex >= 0) {
        setCurrentDateIndex(todayIndex);
        console.log(`📅 [단일 입고 처리] 날짜 인덱스 설정: ${todayIndex}`);
      } else {
        // 오늘 날짜가 목록에 없으면 추가
        setCurrentDateIndex(0);
        console.log(`📅 [단일 입고 처리] 오늘 날짜가 목록에 없어 인덱스 0으로 설정`);
      }
    }
    
    // 입고 처리된 항목 확인
    console.log(`📦 [단일 입고 처리] 완료된 항목 확인:`, {
      id: completedItem.id,
      completedAt: completedItem.completedAt,
      dateString: completedItem.completedAt ? new Date(completedItem.completedAt).toLocaleDateString('ko-KR') : '없음'
    });
    
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
    
    // 전체 ReturnItem 객체를 찾아서 detailReason만 업데이트
    const updatedItem = {
      ...currentReasonItem,
      detailReason: detailReason.trim()
    };
    
    // 로컬 스토리지에도 저장
    const isCompleted = returnState.completedReturns.some(item => item.id === currentReasonItem.id);
    const isPending = returnState.pendingReturns.some(item => item.id === currentReasonItem.id);
    
    if (isCompleted) {
      const updatedCompletedReturns = returnState.completedReturns.map(item =>
        item.id === currentReasonItem.id ? updatedItem : item
      );
      localStorage.setItem('completedReturns', JSON.stringify(updatedCompletedReturns));
    }
    
    if (isPending) {
      const updatedPendingReturns = returnState.pendingReturns.map(item =>
        item.id === currentReasonItem.id ? updatedItem : item
      );
      localStorage.setItem('pendingReturns', JSON.stringify(updatedPendingReturns));
    }
    
    dispatch({
      type: 'UPDATE_RETURN',
      payload: updatedItem
    });
    
    // 모달 닫기 및 상태 업데이트
    setIsReasonModalOpen(false);
    setModalLevel(prev => Math.max(0, prev - 10));
    setMessage('반품 사유 상세 정보가 저장되었습니다.');
  }, [currentReasonItem, dispatch, returnState.completedReturns, returnState.pendingReturns]);

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

  // 반품사유 단순화는 utils/excel.ts의 simplifyReturnReason 함수를 사용

  // 전체 상품 데이터 삭제 함수
  const handleDeleteAllProducts = useCallback(() => {
    console.log('전체 삭제 버튼 클릭됨');
    console.log('현재 상품 수:', returnState.products?.length || 0);
    
    if (!returnState.products || returnState.products.length === 0) {
      setMessage('삭제할 상품 데이터가 없습니다.');
      return;
    }
    
    if (confirm(`정말로 모든 상품 데이터(${returnState.products.length}개)를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
      try {
        console.log('상품 삭제 시작');
        
        // 1. Redux 상태에서 상품 데이터 삭제
        dispatch({ type: 'SET_PRODUCTS', payload: [] });
        
        // 2. 로컬 스토리지에서 상품 데이터만 제거
        const currentData = JSON.parse(localStorage.getItem('returnData') || '{}');
        const updatedData = {
          ...currentData,
          products: []
        };
        
        // 3. 안전하게 저장
        try {
          const compressed = compressData(updatedData);
          localStorage.setItem('returnData', compressed);
          console.log('압축 저장 성공');
        } catch (error) {
          console.warn('압축 저장 실패, 일반 저장 시도:', error);
          localStorage.setItem('returnData', JSON.stringify(updatedData));
          console.log('일반 저장 성공');
        }
        
        // 4. 추가로 products 키도 직접 삭제
        localStorage.removeItem('products');
        console.log('products 키 직접 삭제 완료');
        
        // 5. 페이지 새로고침으로 완전한 상태 초기화
        setTimeout(() => {
          window.location.reload();
        }, 1000);
        
        setMessage(`모든 상품 데이터(${returnState.products.length}개)가 삭제되었습니다. 페이지를 새로고침합니다.`);
        console.log('상품 삭제 완료');
      } catch (error) {
        console.error('상품 데이터 삭제 중 오류:', error);
        setMessage('상품 데이터 삭제 중 오류가 발생했습니다.');
      }
    }
  }, [dispatch, returnState.products]);

  
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
      // 완료 항목 생성
      const completedItem: ReturnItem = {
        ...updatedItem,
        status: 'COMPLETED' as const,
        completedAt: new Date()
      };
      
      // 대기 목록에서 제거하고 완료 목록에 추가
      const updatedPendingReturns = returnState.pendingReturns.filter(item => item.id !== updatedItem.id);
      const updatedCompletedReturns = [...returnState.completedReturns, completedItem];
      dispatch({ 
        type: 'SET_RETURNS', 
        payload: { 
          pendingReturns: updatedPendingReturns, 
          completedReturns: updatedCompletedReturns, 
          products: returnState.products 
        } 
      });
      
      
      setMessage(`${completedItem.productName} 상품이 입고완료 처리되었습니다.`);
    } else {
      // 송장번호만 업데이트 - 대기 목록에서 해당 항목을 찾아서 업데이트
      const updatedPendingReturns = returnState.pendingReturns.map(item => 
        item.id === updatedItem.id ? updatedItem : item
      );
      dispatch({
        type: 'SET_RETURNS',
        payload: { 
          pendingReturns: updatedPendingReturns, 
          completedReturns: returnState.completedReturns, 
          products: returnState.products 
        }
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
    // 지그재그 반품에서 자체상품코드가 없는 경우 파란링크로 표시 (수동매칭 유도)
    if (isZigzagOrder(item.orderNumber) && (!item.customProductCode || item.customProductCode === '-' || item.customProductCode.trim() === '')) {
      return (
        <button
          className="text-blue-600 hover:text-blue-800 underline font-medium"
          onClick={() => handleOpenProductMatchModal(item)}
          title="자체상품코드 없음 - 수동매칭 필요"
        >
          {item.productName}
        </button>
      );
    }
    
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
    // 반품 엑셀에 상품코드(자체상품코드)가 있으면 → 셀메이트에서 해당 상품코드로 바로 특정 후 옵션 매칭 (1단계 상품명 유사도 불필요)
    // 지그재그 2209 등: 동일 코드 전부 후보로 두고 옵션(그룹)으로 1건 선택
    if (returnItem.customProductCode && returnItem.customProductCode !== '-' && returnItem.customProductCode.trim() !== '') {
      console.log(`🔍 자체상품코드 우선 매칭 시도: "${returnItem.customProductCode}"`);
      
      const customCodeCandidates = productList.filter(product => 
        product.customProductCode && 
        product.customProductCode.toLowerCase().trim() === returnItem.customProductCode!.toLowerCase().trim()
      );
      
      if (customCodeCandidates.length > 0) {
        let selectedProduct: ProductInfo;
        if (customCodeCandidates.length === 1) {
          selectedProduct = customCodeCandidates[0];
          console.log(`✅ 자체상품코드 후보 1건: [${selectedProduct.optionName}]`);
        } else {
          const returnOpt = returnItem.optionName?.trim() || '';
          const scored = customCodeCandidates.map(p => ({
            product: p,
            score: returnOpt ? optionMatchScoreByGroups(returnOpt, p.optionName || '') : 0
          }));
          scored.sort((a, b) => b.score - a.score);
          const best = scored[0];
          selectedProduct = best.score >= 50 ? best.product : customCodeCandidates[0];
          console.log(`✅ 자체상품코드 옵션 그룹 매칭: "${returnOpt}" → [${selectedProduct.optionName}] (점수 ${best.score})`);
        }
        const matched = {
          ...returnItem,
          barcode: selectedProduct.barcode,
          purchaseName: selectedProduct.purchaseName || selectedProduct.productName,
          zigzagProductCode: selectedProduct.zigzagProductCode || '',
          customProductCode: selectedProduct.customProductCode || '',
          matchType: "custom_code_priority",
          matchSimilarity: 1.0,
          matchedProductName: selectedProduct.productName,
          matchedProductOption: selectedProduct.optionName
        };
        return doubleCheckBarcodeWithOption(matched, productList);
      }
    }
    
    // 반품에 상품코드가 없을 때만: ①반품 상품명↔스마트스토어 상품명 매칭→상품코드 획득 ②상품코드로 셀메이트 특정 ③옵션 매칭→바코드 (상품코드 있으면 위 블록에서 이미 처리)
    if (smartStoreProducts.length > 0) {
      const smartStoreMatched = matchProductWithSmartStoreCode(returnItem, smartStoreProducts, productList);
      if (smartStoreMatched.barcode && smartStoreMatched.barcode !== '-') {
        console.log(`✅ 스마트스토어 3단계 매칭 성공: ${smartStoreMatched.productName}`);
        const doubleChecked = doubleCheckBarcodeWithOption(smartStoreMatched, productList);
        return doubleChecked;
      }
    }
    const updatedItem = { ...returnItem };
    
    // 0. 이미 바코드가 매칭된 경우 더블체크 실행
    if (returnItem.barcode && returnItem.barcode !== '-') {
      return doubleCheckBarcodeWithOption(returnItem, productList);
    }

    // 0.5단계: 계절 키워드만 다른 완전 동일 상품 우선 매칭
    const seasonKeywords = ['봄', '여름', '가을', '겨울', 'spring', 'summer', 'autumn', 'winter'];
    const returnProductName = returnItem.productName.toLowerCase().trim();
    let returnProductWithoutSeason = returnProductName;
    
    seasonKeywords.forEach(season => {
      returnProductWithoutSeason = returnProductWithoutSeason.replace(new RegExp(`\\b${season}\\b`, 'g'), '').trim();
    });
    
    console.log(`🔍 [matchProductByZigzagCode] 계절 키워드 제거 후: "${returnProductWithoutSeason}"`);
    
    // 계절 키워드만 다른 완전 동일 상품 찾기
    const exactSeasonMatch = productList.find(product => {
      if (!product.productName) return false;
      
      let productNameWithoutSeason = product.productName.toLowerCase().trim();
      seasonKeywords.forEach(season => {
        productNameWithoutSeason = productNameWithoutSeason.replace(new RegExp(`\\b${season}\\b`, 'g'), '').trim();
      });
      
      return productNameWithoutSeason === returnProductWithoutSeason && productNameWithoutSeason.length > 0;
    });
    
    if (exactSeasonMatch) {
      console.log(`✅ [matchProductByZigzagCode] 계절 키워드만 다른 완전 동일 상품 발견: "${exactSeasonMatch.productName}"`);
      updatedItem.barcode = exactSeasonMatch.barcode || '';
      updatedItem.customProductCode = exactSeasonMatch.customProductCode || exactSeasonMatch.zigzagProductCode || '';
      updatedItem.purchaseName = exactSeasonMatch.purchaseName || exactSeasonMatch.productName;
      updatedItem.zigzagProductCode = exactSeasonMatch.zigzagProductCode || '';
      updatedItem.matchType = '계절 키워드만 다른 완전 동일 상품';
      updatedItem.matchSimilarity = 0.95;
      updatedItem.matchedProductName = exactSeasonMatch.productName;
      updatedItem.matchedProductOption = exactSeasonMatch.optionName;
      // 계절 키워드 매칭 후에도 더블체크 실행
      return doubleCheckBarcodeWithOption(updatedItem, productList);
    }

    // 옵션명을 고려한 매칭을 위한 헬퍼 함수 - 완전히 새로운 접근 방식
    const findBestMatchWithOption = (candidates: ProductInfo[]): ProductInfo | null => {
      if (candidates.length === 0) {
        return null;
      }

      // 옵션명이 없는 경우 첫 번째 상품 반환
      if (!returnItem.optionName || returnItem.optionName.trim() === '') {
        console.log(`⚠️ 옵션명 없음, 첫 번째 상품 선택: ${candidates[0].productName}`);
        return candidates[0];
      }

      const returnOptionName = returnItem.optionName.toLowerCase().trim();
      console.log(`🔍 옵션명 매칭 시작: "${returnItem.optionName}" (후보 ${candidates.length}개)`);

      const returnSize = extractSizeFromOption(returnOptionName);

      // 모든 후보에 대해 매칭 점수 계산
      const scoredCandidates = candidates.map(product => {
        if (!product.optionName) {
          return { product, score: 0, reason: '옵션명 없음' };
        }

        const productOptionName = product.optionName.toLowerCase().trim();
        let score = 0;
        let reason = '';

        // 사이즈 불일치 시 0점 (블랙,M vs 블랙,XL 등 6808 이슈 방지)
        const productSize = extractSizeFromOption(productOptionName);
        if (returnSize && productSize && returnSize !== productSize) {
          score = 0;
          reason = `사이즈 불일치 (${returnSize} vs ${productSize})`;
          return { product, score, reason };
        }

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
            const similarity = stringSimilarity(returnOptionName, productOptionName);
            score = Math.round(similarity * 50); // 0-50점
            reason = `유사도 ${similarity.toFixed(2)}`;
          }
        }

        return { product, score, reason };
      });

      // 점수 순으로 정렬 (높은 점수 우선)
      scoredCandidates.sort((a, b) => b.score - a.score);

      console.log(`📊 옵션명 매칭 결과:`);
      scoredCandidates.forEach((item, index) => {
        console.log(`  ${index + 1}. ${item.product.optionName} (${item.reason}, 점수: ${item.score})`);
      });

      // 최고 점수 상품 선택 (점수가 30 이상인 경우만)
      const bestMatch = scoredCandidates[0];
      if (bestMatch.score >= 30) {
        console.log(`✅ 옵션명 매칭 성공: ${returnItem.optionName} → ${bestMatch.product.optionName} (${bestMatch.reason}, 점수: ${bestMatch.score})`);
        return bestMatch.product;
      } else {
        console.log(`❌ 옵션명 매칭 실패: 최고 점수 ${bestMatch.score} (임계값 30 미달)`);
        return null;
      }

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

    // 옵션에서 사이즈 추출 (M, L, XL, S, 1, 2, 3 등) - 블랙,M vs 블랙,XL 오매칭 방지
    const extractSizeFromOption = (optionText: string): string | null => {
      const lower = optionText.toLowerCase().replace(/\s/g, '');
      const sizePatterns = [/\b(xxl|xl|l|m|s)\b/, /\b(\d+)(?:기본|숏|롱)?\b/];
      for (const re of sizePatterns) {
        const m = lower.match(re);
        if (m) return m[1];
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

    // 연채원 607이 이미 매칭된 경우 다른 매칭 로직 건드리지 않음 (더블체크는 실행)
    if (updatedItem.barcode && updatedItem.barcode !== '-') {
      console.log(`✅ 연채원 607 특별 매칭 완료: ${updatedItem.barcode}`);
      return doubleCheckBarcodeWithOption(updatedItem, productList);
    }
    
    // 1. 자체상품코드(customProductCode) → 사입상품명(purchaseName) 매칭 (최우선)
    if (returnItem.customProductCode && returnItem.customProductCode !== '-') {
      console.log(`🔍 [지그재그 매칭] 자체상품코드 "${returnItem.customProductCode}" → 사입상품명 매칭 시도...`);
      
      // 단계 1: 자체상품코드와 사입상품명이 일치하는 상품 찾기
      const purchaseNameMatches = productList.filter(product => {
        if (!product.purchaseName || typeof product.purchaseName !== 'string') {
          return false;
        }
        
        const purchaseNameLower = product.purchaseName.toLowerCase().trim();
        const customCodeLower = returnItem.customProductCode!.toLowerCase().trim();
        
        // 정확 일치 또는 포함 관계 확인
        return purchaseNameLower === customCodeLower || 
               purchaseNameLower.includes(customCodeLower) || 
               customCodeLower.includes(purchaseNameLower);
      });
      
      console.log(`📦 [지그재그 매칭] 자체상품코드 "${returnItem.customProductCode}"와 매칭되는 사입상품명: ${purchaseNameMatches.length}개`);
      
      if (purchaseNameMatches.length > 0) {
        // 사입상품명 완전 일치 우선 (버터 → 깜장콩 버터, 버터니트ops 아님)
        const customCodeLower = returnItem.customProductCode!.toLowerCase().trim();
        const returnNameLower = (returnItem.productName || '').toLowerCase().trim();
        purchaseNameMatches.sort((a, b) => {
          const aName = (a.purchaseName || '').toLowerCase().trim();
          const bName = (b.purchaseName || '').toLowerCase().trim();
          const aExact = aName === customCodeLower || aName === returnNameLower;
          const bExact = bName === customCodeLower || bName === returnNameLower;
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;
          return aName.length - bName.length; // 동점이면 짧은(더 구체적인) 사입상품명 우선
        });
        // 단계 2: 매칭된 상품들 중에서 옵션명 매칭
        console.log(`🔍 [지그재그 매칭] 옵션명 매칭 시작: "${returnItem.optionName}" (후보 ${purchaseNameMatches.length}개)`);
        
        const bestOptionMatch = findBestMatchWithOption(purchaseNameMatches);
        
        if (bestOptionMatch) {
          console.log(`✅ [지그재그 매칭] 자체상품코드 → 사입상품명 → 옵션명 매칭 성공: "${returnItem.customProductCode}" → "${bestOptionMatch.purchaseName}" [${bestOptionMatch.optionName}]`);
          
          updatedItem.barcode = bestOptionMatch.barcode || '';
          updatedItem.purchaseName = bestOptionMatch.purchaseName || bestOptionMatch.productName;
          updatedItem.zigzagProductCode = bestOptionMatch.zigzagProductCode || '';
          updatedItem.customProductCode = bestOptionMatch.customProductCode || bestOptionMatch.zigzagProductCode || '';
          updatedItem.matchType = "zigzag_customcode_purchasename_option";
          updatedItem.matchSimilarity = 1.0;
          updatedItem.matchedProductName = bestOptionMatch.productName;
          updatedItem.matchedProductOption = bestOptionMatch.optionName;
          
          // 더블체크로 최종 확인
          return doubleCheckBarcodeWithOption(updatedItem, productList);
        } else {
          console.log(`⚠️ [지그재그 매칭] 사입상품명 매칭 성공했지만 옵션명 매칭 실패: "${returnItem.optionName}"`);
        }
      }
      
      // 사입상품명 매칭 실패 시 유사도 매칭 시도
      console.log(`🔍 [지그재그 매칭] 사입상품명 정확 매칭 실패, 유사도 매칭 시도...`);
      
      let bestSimilarityMatch: { product: ProductInfo, similarity: number } | null = null;
      const returnCustomCode = returnItem.customProductCode.toLowerCase().trim();
      
      for (const product of productList) {
        if (product.purchaseName && typeof product.purchaseName === 'string') {
          const purchaseNameLower = product.purchaseName.toLowerCase().trim();
          
          // 포함 관계 (높은 우선순위)
          if (purchaseNameLower.includes(returnCustomCode) || returnCustomCode.includes(purchaseNameLower)) {
            if (!bestSimilarityMatch || 0.95 > (bestSimilarityMatch.similarity || 0)) {
              bestSimilarityMatch = { product, similarity: 0.95 };
              console.log(`📌 [지그재그 매칭] 포함관계 발견: "${returnCustomCode}" ↔ "${purchaseNameLower}"`);
            }
          } 
          // 유사도 계산
          else {
            const similarity = stringSimilarity(returnCustomCode, purchaseNameLower);
            if (similarity > 0.7 && (!bestSimilarityMatch || similarity > bestSimilarityMatch.similarity)) {
              bestSimilarityMatch = { product, similarity };
              console.log(`📊 [지그재그 매칭] 유사도 매칭 (${similarity.toFixed(2)}): "${returnCustomCode}" ↔ "${purchaseNameLower}"`);
            }
          }
        }
      }
      
      // 유사도 매칭 결과가 있으면 옵션명 매칭 후 반환
      if (bestSimilarityMatch && bestSimilarityMatch.similarity > 0.7) {
        // 옵션명 매칭 시도
        const optionMatched = findBestMatchWithOption([bestSimilarityMatch.product]);
        
        if (optionMatched) {
          console.log(`✅ [지그재그 매칭] 유사도 매칭 성공 (유사도: ${bestSimilarityMatch.similarity.toFixed(2)}) + 옵션명 매칭`);
          
          updatedItem.barcode = optionMatched.barcode || '';
          updatedItem.purchaseName = optionMatched.purchaseName || optionMatched.productName;
          updatedItem.zigzagProductCode = optionMatched.zigzagProductCode || '';
          updatedItem.customProductCode = optionMatched.customProductCode || optionMatched.zigzagProductCode || '';
          updatedItem.matchType = "zigzag_customcode_purchasename_similarity_option";
          updatedItem.matchSimilarity = bestSimilarityMatch.similarity;
          updatedItem.matchedProductName = optionMatched.productName;
          updatedItem.matchedProductOption = optionMatched.optionName;
          
          // 더블체크로 최종 확인
          return doubleCheckBarcodeWithOption(updatedItem, productList);
        }
      }
      
      console.log(`❌ [지그재그 매칭] 자체상품코드 "${returnItem.customProductCode}" → 사입상품명 매칭 실패`);
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
      
      // 부분 일치 검색 (상품명 포함 관계) - 너무 짧은 문자열(예: '원피스'만)로 인한 오매칭 방지
      const MIN_PARTIAL_LENGTH = 6;
      const partialMatchesRaw = productList.filter(
        (product) => 
          (product.productName && returnItem.productName && 
            (product.productName.toLowerCase().includes(returnItem.productName.toLowerCase()) ||
             returnItem.productName.toLowerCase().includes(product.productName.toLowerCase()))) ||
          (product.purchaseName && returnItem.productName &&
            (product.purchaseName.toLowerCase().includes(returnItem.productName.toLowerCase()) ||
             returnItem.productName.toLowerCase().includes(product.purchaseName.toLowerCase())))
      );
      const partialMatches = partialMatchesRaw.filter((product) => {
        const r = (returnItem.productName || '').trim();
        const pName = (product.productName || '').trim();
        const pPurchase = (product.purchaseName || '').trim();
        const rL = r.toLowerCase(), pnL = pName.toLowerCase(), ppL = pPurchase.toLowerCase();
        if (rL.includes(pnL) && pName.length < MIN_PARTIAL_LENGTH) return false;
        if (pnL.includes(rL) && r.length < MIN_PARTIAL_LENGTH) return false;
        if (rL.includes(ppL) && pPurchase.length < MIN_PARTIAL_LENGTH) return false;
        if (ppL.includes(rL) && r.length < MIN_PARTIAL_LENGTH) return false;
        return true;
      });
      
      if (partialMatches.length > 0) {
        // 사입상품명/상품명 완전 일치 우선, 그 다음 짧은(구체적인) 이름 우선 (버터 → 버터, 버터니트ops 아님)
        const returnNameLower = (returnItem.productName || '').toLowerCase().trim();
        partialMatches.sort((a, b) => {
          const aName = (a.purchaseName || a.productName || '').toLowerCase().trim();
          const bName = (b.purchaseName || b.productName || '').toLowerCase().trim();
          const aExact = aName === returnNameLower;
          const bExact = bName === returnNameLower;
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;
          return aName.length - bName.length;
        });
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
        // 반품 상품명의 구체 키워드(플리츠, 골지, 니트 등)가 사입상품명에 있으면 가산점 → 로레플리츠 vs 플레어나시 오매칭 방지
        const distinctiveKeywords = ['플리츠', '골지', '니트', 'a라인', '맥시', '롱', '플레어', '나시'];
        const returnNameLower = (returnItem.productName || '').toLowerCase();
        const returnHasKeyword = (kw: string) => returnNameLower.includes(kw);
        for (const m of similarityMatches) {
          const nameLower = ((m.product.purchaseName || m.product.productName) || '').toLowerCase();
          let bonus = 0;
          for (const kw of distinctiveKeywords) {
            if (returnHasKeyword(kw) && nameLower.includes(kw)) bonus += 0.08;
          }
          (m as { product: ProductInfo; similarity: number; score?: number }).score = m.similarity + Math.min(bonus, 0.25);
        }
        similarityMatches.sort((a, b) => ((b as { score?: number }).score ?? b.similarity) - ((a as { score?: number }).score ?? a.similarity));
        
        const topCandidates = similarityMatches
          .filter((match, i) => {
            const score = (match as { score?: number }).score ?? match.similarity;
            const topScore = (similarityMatches[0] as { score?: number }).score ?? similarityMatches[0].similarity;
            return score >= topScore - 0.15;
          })
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
    
    // 매칭이 완료된 경우 (바코드가 있는 경우) 더블체크 실행
    if (updatedItem.barcode && updatedItem.barcode !== '-') {
      return doubleCheckBarcodeWithOption(updatedItem, productList);
    }
    
    return updatedItem;
  }



  // 새로고침 함수에 자체상품코드 매칭 및 중복 제거 로직 개선
  const handleRefresh = () => {
    // 기존 데이터 로딩
    setLoading(true);
    setMessage('데이터를 새로고침 중입니다...');
    
    // 🔧 수정: 로컬 스토리지에서 최신 데이터를 먼저 불러오기
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
    
    // 로컬 스토리지에서 최신 데이터 불러오기
    const storedPendingReturns = loadCompressedData('pendingReturns');
    const storedCompletedReturns = loadCompressedData('completedReturns');
    const storedProducts = loadCompressedData('products');
    const storedSmartStoreProducts = loadCompressedData('smartStoreProducts');
    
    // 🔧 변수 스코프 문제 해결을 위해 상단에서 선언
    let totalRemovedCount = 0;
    let cleanPendingReturns = storedPendingReturns;
    let cleanCompletedReturns = storedCompletedReturns;
    
    // 스마트스토어 상품 데이터 설정
    if (storedSmartStoreProducts.length > 0) {
      setSmartStoreProducts(storedSmartStoreProducts);
    }
    
    // 🔧 로드한 데이터를 여기서 상태에 넣지 않음. 중복제거·매칭 후 최종 결과만 한 번 dispatch하여
    // 자동 저장(useEffect 1초 디바운스)이 잘못된 바코드(XL 등)로 덮어쓰는 일이 없도록 함.
    
    // 🔧 단순화된 중복 제거 로직 - 안전장치 강화
    console.log(`새로고침 시작: 입고전 ${storedPendingReturns.length}개, 입고완료 ${storedCompletedReturns.length}개`);
    
    // 기본값 설정 (중복제거 없이 원본 데이터 유지)
    cleanPendingReturns = storedPendingReturns;
    cleanCompletedReturns = storedCompletedReturns;
    
    // 🔧 안전한 중복제거: 정말 명확한 중복만 제거
    if (storedPendingReturns.length > 0 || storedCompletedReturns.length > 0) {
      const allReturns = [...storedCompletedReturns, ...storedPendingReturns];
      const uniqueMap = new Map<string, ReturnItem>();
      
      allReturns.forEach(item => {
        // 🔧 매우 엄격한 중복 키: 고객명 + 주문번호 + 상품명 + 옵션명 + 송장번호
        const strictKey = `${item.customerName}_${item.orderNumber}_${item.purchaseName || item.productName}_${item.optionName}_${item.returnTrackingNumber || item.pickupTrackingNumber || ''}`;
        
        if (!uniqueMap.has(strictKey)) {
          uniqueMap.set(strictKey, item);
        } else {
          // 정말 동일한 항목인 경우에만 제거
          console.log(`중복 제거: ${strictKey}`);
          totalRemovedCount++;
        }
      });
      
      // 🔧 안전장치: 원본 데이터의 90% 이상이 유지되어야 함
      const totalOriginalCount = allReturns.length;
      const totalCleanCount = uniqueMap.size;
      const retentionRatio = totalCleanCount / totalOriginalCount;
      
      if (retentionRatio >= 0.9) {
        // 안전한 경우에만 중복제거 적용 (상태/저장은 아래 최종 dispatch에서 한 번만)
        const uniqueItems = Array.from(uniqueMap.values());
        cleanCompletedReturns = uniqueItems.filter(item => storedCompletedReturns.some(completed => completed.id === item.id));
        cleanPendingReturns = uniqueItems.filter(item => storedPendingReturns.some(pending => pending.id === item.id));
        
        console.log(`안전한 중복제거 적용: ${totalRemovedCount}개 제거 (유지율: ${(retentionRatio * 100).toFixed(1)}%)`);
      } else {
        console.warn(`⚠️ 중복제거 건너뛰기: 유지율이 너무 낮음 (${(retentionRatio * 100).toFixed(1)}%)`);
        totalRemovedCount = 0;
      }
    }
    
    // 🔧 수정: 중복제거 결과를 사용하여 매칭 수행
    let finalPendingReturns = storedPendingReturns;
    let finalCompletedReturns = storedCompletedReturns;
    
    // 중복제거가 수행된 경우 최종 데이터 사용
    if (totalRemovedCount > 0) {
      finalPendingReturns = cleanPendingReturns;
      finalCompletedReturns = cleanCompletedReturns;
    }
    
    // 자체상품코드 기준 매칭 시도 (최종 데이터 사용) - 새로고침 시 항상 재매칭 결과 반영
    // 상태·로컬 저장은 여기서 한 번만 하여, 2번째 새로고침부터 잘못된 바코드가 복원되지 않도록 함
    if (finalPendingReturns.length > 0 && storedProducts.length > 0) {
      const matchedReturns = finalPendingReturns.map(item => 
        matchProductByZigzagCode(item, storedProducts)
      );
      
      const matchedCount = matchedReturns.filter(item => item.barcode && item.barcode !== '-').length - 
                          finalPendingReturns.filter(item => item.barcode && item.barcode !== '-').length;
      
      dispatch({
        type: 'SET_RETURNS',
        payload: {
          pendingReturns: matchedReturns,
          completedReturns: finalCompletedReturns,
          products: storedProducts
        }
      });
      localStorage.setItem('pendingReturns', JSON.stringify(matchedReturns));
      localStorage.setItem('lastUpdated', new Date().toISOString());
      
      setMessage(matchedCount > 0 
        ? `새로고침 완료: ${matchedCount}개 상품이 자동 매칭되었습니다.` 
        : '새로고침 완료.');
    } else {
      // 매칭 생략 시에도 최종 데이터로 상태·저장 한 번만 (자동저장이 로드 데이터로 덮어쓰지 않도록)
      dispatch({
        type: 'SET_RETURNS',
        payload: {
          pendingReturns: finalPendingReturns,
          completedReturns: finalCompletedReturns,
          products: storedProducts
        }
      });
      localStorage.setItem('pendingReturns', JSON.stringify(finalPendingReturns));
      localStorage.setItem('lastUpdated', new Date().toISOString());
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
            <th className="col-return-reason px-1 py-1 text-center text-2xs font-medium text-gray-500 uppercase tracking-wider">반품사유</th>
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
                        handleCheckboxChange(itemIndex, (e.nativeEvent as MouseEvent).shiftKey);
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
                <td className="col-return-reason px-1 py-1 return-reason-cell">
                  <div 
                    className={`cursor-pointer ${isDefective(item.returnReason) ? 'text-red-500' : ''} return-reason-content`}
                    onClick={() => isDefective(item.returnReason) && handleReturnReasonClick(item)}
                  >
                    {getReturnReasonDisplay(item)}
                  </div>
                </td>
                <td className="col-tracking-number px-1 py-1">
                  <div className="font-mono text-sm whitespace-nowrap bg-blue-100 px-1 py-0.5 rounded text-center">
                    {group.trackingNumber === 'no-tracking' ? '-' : group.trackingNumber}
                  </div>
                </td>
                <td className="col-barcode px-1 py-1">
                  {tableSettings.barcodeFormat.enabled && item.barcode && item.barcode !== '-' ? (
                    <div 
                      className={`barcode-field ${tableSettings.barcodeFormat.enabled ? 'enabled' : ''}`}
                      style={{
                        lineHeight: `${tableSettings.barcodeFormat.lineHeight}`,
                        fontSize: `${tableSettings.barcodeFormat.mainCodeSize}rem`
                      }}
                    >
                      <div 
                        className="main-code"
                        style={{
                          fontSize: `${tableSettings.barcodeFormat.mainCodeSize}rem`,
                          lineHeight: '1.2'
                        }}
                      >
                        {item.barcode}
                      </div>
                      {(() => {
                        // 바코드로 상품 리스트에서 실제 상품 찾기
                        const actualProduct = returnState.products.find(product => 
                          product.barcode === item.barcode
                        );
                        if (actualProduct) {
                          return (
                            <div 
                              className="sub-info"
                              style={{
                                fontSize: `${tableSettings.barcodeFormat.subInfoSize}rem`,
                                lineHeight: '1.2'
                              }}
                            >
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
                        handleCompletedCheckboxChange(itemIndex, (e.nativeEvent as MouseEvent).shiftKey);
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
                  className="px-2 py-2 border-x border-gray-300 cursor-pointer col-return-reason text-center return-reason-cell"
                  onClick={() => isDefective(item.returnReason) && handleReturnReasonClick(item)}
                >
                  <div className="return-reason-content">
                    {getReturnReasonDisplay(item)}
                  </div>
                </td>
                <td className="px-2 py-2 border-x border-gray-300 col-tracking-number">
                  <div className="font-mono text-sm whitespace-nowrap bg-blue-100 px-2 py-1 rounded text-center">
                    {(() => {
                      // 수거송장번호 우선 표시
                      if (item.pickupTrackingNumber && item.pickupTrackingNumber !== '') {
                        return item.pickupTrackingNumber;
                      } else if (item.returnTrackingNumber && item.returnTrackingNumber !== '') {
                        return item.returnTrackingNumber;
                      } else {
                        return '-';
                      }
                    })()}
                  </div>
                </td>
                                <td className="px-2 py-2 border-x border-gray-300 col-barcode">
                  {tableSettings.barcodeFormat.enabled && item.barcode && item.barcode !== '-' ? (
                    <div 
                      className={`barcode-field ${tableSettings.barcodeFormat.enabled ? 'enabled' : ''}`}
                      style={{
                        lineHeight: `${tableSettings.barcodeFormat.lineHeight}`,
                        fontSize: `${tableSettings.barcodeFormat.mainCodeSize}rem`
                      }}
                    >
                      <div 
                        className="main-code"
                        style={{
                          fontSize: `${tableSettings.barcodeFormat.mainCodeSize}rem`,
                          lineHeight: '1.2'
                        }}
                      >
                        {item.barcode}
                      </div>
                      {(() => {
                        // 바코드로 상품 리스트에서 실제 상품 찾기
                        const actualProduct = returnState.products.find(product => 
                          product.barcode === item.barcode
                        );
                        if (actualProduct) {
                          return (
                            <div 
                              className="sub-info"
                              style={{
                                fontSize: `${tableSettings.barcodeFormat.subInfoSize}rem`,
                                lineHeight: '1.2'
                              }}
                            >
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
      // 날짜 형식을 일관되게 변환 (YYYY. MM. DD.)
      const dates = [...new Set(returnState.completedReturns
        .filter(item => item.completedAt)
        .map(item => {
          const date = new Date(item.completedAt!);
          return date.toLocaleDateString('ko-KR');
        })
      )].sort((a, b) => {
        // 날짜 문자열을 Date 객체로 변환하여 비교
        const dateA = new Date(a);
        const dateB = new Date(b);
        return dateB.getTime() - dateA.getTime();
      });
      
      // 날짜 목록이 변경된 경우에만 업데이트
      const datesChanged = JSON.stringify(dates) !== JSON.stringify(availableDates);
      if (datesChanged) {
        setAvailableDates(dates);
      }
      
      // 현재 날짜가 설정되어 있지 않을 때만 자동 설정 (사용자가 선택한 날짜는 유지)
      if (!currentDate) {
        const todayStr = new Date().toLocaleDateString('ko-KR');
        const targetDate = dates.includes(todayStr) ? todayStr : dates[0] || '';
        if (targetDate) {
          setCurrentDate(targetDate);
          const targetIndex = dates.indexOf(targetDate);
          setCurrentDateIndex(targetIndex >= 0 ? targetIndex : 0);
        }
      } else {
        // 현재 선택된 날짜가 여전히 유효한 날짜 목록에 있는지 확인하고 인덱스 업데이트
        const currentIndex = dates.indexOf(currentDate);
        if (currentIndex >= 0 && currentIndex !== currentDateIndex) {
          setCurrentDateIndex(currentIndex);
        }
      }
    } else if (returnState.completedReturns.length === 0 && availableDates.length > 0) {
      // 완료된 항목이 없으면 날짜 목록 초기화
      setAvailableDates([]);
      setCurrentDate('');
      setCurrentDateIndex(0);
    }
  }, [returnState.completedReturns, currentDate]);

  // 현재 표시할 완료된 반품 아이템
  const currentDateItems = useMemo(() => {
    if (!currentDate || isSearching) return [];
    
    return returnState.completedReturns.filter(item => {
      if (!item.completedAt) return false;
      // 날짜 형식을 일관되게 변환하여 비교
      const itemDate = new Date(item.completedAt).toLocaleDateString('ko-KR');
      return itemDate === currentDate;
    });
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
    let displayText = item.returnReason || '';
    
    // 상세 사유가 있으면 항상 추가 (파손 및 불량(상세사유) 형식)
    if (item.detailReason && item.detailReason.trim() !== '') {
      displayText += `(${item.detailReason})`;
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
        
        // 상태 업데이트 (Redux 스토어에 추가) - 여러 상품을 한 번에 추가
        const currentProducts = returnState.products || [];
        const updatedProducts = [...currentProducts, ...products];
        dispatch({ 
          type: 'SET_PRODUCTS', 
          payload: updatedProducts
        });
        
        // 로컬 스토리지에 분리해서 저장
        localStorage.setItem('products', JSON.stringify(updatedProducts));
        localStorage.setItem('lastUpdated', new Date().toISOString());
        
        // 자동 매칭 수행 (선택적)
        const unmatchedItems = returnState.pendingReturns.filter(item => !item.barcode);
        if (unmatchedItems.length > 0) {
          let matchedCount = 0;
          
          unmatchedItems.forEach(item => {
            const matchedItem = matchProductByZigzagCode(item, products);
            // 바코드가 매칭된 경우 더블체크 실행
            let finalItem = matchedItem;
            if (matchedItem.barcode && matchedItem.barcode !== '-') {
              finalItem = doubleCheckBarcodeWithOption(matchedItem, updatedProducts);
            }
            if (finalItem.barcode) {
              matchedCount++;
              dispatch({
                type: 'UPDATE_RETURN',
                payload: finalItem
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



  // 스마트스토어 파일 직접 업로드 핸들러
  const handleSmartStoreFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSmartStoreLoading(true);
    setMessage('스마트스토어 상품 데이터를 처리 중입니다...');

    try {
      // 엑셀 파일 파싱
      const products = await parseSmartStoreExcel(file);
      
      // 스마트스토어 상품 데이터 저장
      setSmartStoreProducts(products);
      localStorage.setItem('smartStoreProducts', JSON.stringify(products));
      
      // 기존 반품 데이터에 스마트스토어 매칭 적용
      const unmatchedItems = returnState.pendingReturns.filter(item => !item.barcode);
      if (unmatchedItems.length > 0) {
        const matchedItems = unmatchedItems.map(item => matchProductWithSmartStoreCode(item, products));
        const updatedPendingReturns = returnState.pendingReturns.map(item => {
          const matched = matchedItems.find(matched => matched.id === item.id);
          return matched || item;
        });
        
        dispatch({
          type: 'SET_RETURNS',
          payload: {
            ...returnState,
            pendingReturns: updatedPendingReturns
          }
        });
      }
      
      setMessage(`${products.length}개의 스마트스토어 상품이 업로드되었습니다.`);
      
    } catch (error) {
      console.error('스마트스토어 업로드 오류:', error);
      setMessage(`스마트스토어 업로드 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setSmartStoreLoading(false);
      e.target.value = ''; // 파일 입력 초기화
    }
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

  // 수거송장번호로 상품 입고 처리 개선 - 동일 수거송장번호 일괄 처리 및 수거송장번호 업데이트
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
    
    // 입고완료로 처리할 항목들 - 수거송장번호 업데이트 로직 추가
    const completedItems = matchingItems.map(item => {
      // 수거송장번호가 없고 반품송장번호만 있는 경우, 수거송장번호로 업데이트
      if (!item.pickupTrackingNumber && item.returnTrackingNumber === searchTerm) {
        return {
          ...item,
          pickupTrackingNumber: searchTerm, // 반품송장번호를 수거송장번호로 업데이트
          status: 'COMPLETED' as 'PENDING' | 'COMPLETED',
          completedAt: midnightToday
        };
      }
      
      return {
        ...item,
        status: 'COMPLETED' as 'PENDING' | 'COMPLETED',
        completedAt: midnightToday
      };
    });
    
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
    const newDateKey = midnightToday.toLocaleDateString('ko-KR');
    const newAvailableDates = Array.from(new Set([...availableDates, newDateKey]))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    
    if (newAvailableDates.length !== availableDates.length || !availableDates.includes(newDateKey)) {
      setAvailableDates(newAvailableDates);
    }
    
    if (newDateKey !== currentDate) {
      setCurrentDate(newDateKey);
      const newDateIndex = newAvailableDates.indexOf(newDateKey);
      if (newDateIndex >= 0) {
        setCurrentDateIndex(newDateIndex);
      } else {
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

  // 선택된 항목 재매칭 핸들러 - 오매칭된 항목도 바코드 초기화 후 자동 매칭 재실행 (이미 바코드 있으면 매칭이 스킵되므로 초기화 필요)
  const handleRematchSelected = () => {
    if (selectedItems.length === 0) {
      setMessage('재매칭할 항목을 선택해주세요.');
      return;
    }

    const selectedIds = new Set(
      selectedItems.map((i) => returnState.pendingReturns[i]?.id).filter(Boolean)
    );
    if (selectedIds.size === 0) return;

    const products = returnState.products || [];
    let rematchedCount = 0;
    const updatedPending = returnState.pendingReturns.map((item) => {
      if (!selectedIds.has(item.id)) return item;
      const resetItem: ReturnItem = {
        ...item,
        barcode: '',
        purchaseName: '',
        matchType: undefined,
        matchSimilarity: undefined,
        matchedProductName: undefined,
        matchedProductOption: undefined
      };
      const matched = matchProductByZigzagCode(resetItem, products);
      const afterDoubleCheck = matched.barcode && matched.barcode !== '-'
        ? doubleCheckBarcodeWithOption(matched, products)
        : matched;
      if (afterDoubleCheck.barcode && afterDoubleCheck.barcode !== '-') rematchedCount++;
      return afterDoubleCheck;
    });

    dispatch({
      type: 'SET_RETURNS',
      payload: { ...returnState, pendingReturns: updatedPending }
    });
    localStorage.setItem('pendingReturns', JSON.stringify(updatedPending));
    localStorage.setItem('lastUpdated', new Date().toISOString());
    setMessage(`재매칭 완료: ${selectedIds.size}개 중 ${rematchedCount}개 자동 매칭되었습니다.`);
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
        
        // 상태 업데이트 (Redux 스토어에 추가) - 여러 항목을 한 번에 추가
        const currentState = { pendingReturns: returnState.pendingReturns, completedReturns: returnState.completedReturns, products: returnState.products };
        const updatedPendingReturns = [...currentState.pendingReturns, ...processedReturns];
        dispatch({ 
          type: 'SET_RETURNS', 
          payload: { ...currentState, pendingReturns: updatedPendingReturns }
        });
        
        // 로컬 스토리지에 분리해서 저장
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
      <div className="text-sm text-gray-500 mb-2">test</div>
      <h1 className="text-4xl font-bold mb-6">반품 관리 시스템</h1>
      
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
          className="px-4 py-2 text-white rounded bg-purple-500 hover:bg-purple-600 cursor-pointer text-center"
          htmlFor="smartStoreFile"
        >
          스마트스토어 업로드
        </label>
        <input
          type="file"
          id="smartStoreFile"
          accept=".xlsx,.xls"
          onChange={handleSmartStoreFileUpload}
          className="hidden"
          disabled={loading}
        />
        
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
          onClick={() => {
            setProductListTab('smartstore');
            productModalRef.current?.showModal();
          }}
          disabled={loading}
        >
          상품 목록
        </button>
        
        <button
          className={`px-4 py-2 text-white rounded ${buttonColors.pendingButton}`}
                        onClick={() => {
                          setIsPendingModalOpen(true);
                          // 팝업이 열릴 때 오버플로우 감지 실행
                          setTimeout(() => {
                            if (tableSettings.autoTextSize.enabled) {
                              console.log('팝업 열림 - 오버플로우 감지 실행');
                              detectAndHandleOverflow();
                            }
                          }, 100);
                        }}
          disabled={loading}
        >
          입고전 ({returnState.pendingReturns.length})
        </button>
        
        {/* 표 크기 조정 버튼 숨김 - 설정 완료 */}
        {/* <button
          className="px-4 py-2 text-white rounded bg-orange-500 hover:bg-orange-600"
          onClick={() => setShowTableSizeSettings(true)}
          disabled={loading}
        >
          표 크기 조정
        </button> */}
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
      
      {/* 통합 상품 목록 모달 */}
      <dialog 
        ref={productModalRef} 
        className="modal w-11/12 max-w-5xl p-0 rounded-lg shadow-xl"
        onClick={handleOutsideClick}
        id="productModal"
      >
        <div className="modal-box bg-white p-6">
          <h3 className="font-bold text-lg mb-4 flex justify-between items-center">
            <span>상품 목록</span>
            <button onClick={() => productModalRef.current?.close()} className="btn btn-sm btn-circle">✕</button>
          </h3>
          
          {/* 탭 네비게이션 */}
          <div className="flex mb-4 border-b border-gray-200">
            <button
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                productListTab === 'smartstore'
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setProductListTab('smartstore')}
            >
              스마트스토어 ({smartStoreProducts.length})
            </button>
            <button
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                productListTab === 'cellmate'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setProductListTab('cellmate')}
            >
              셀메이트 ({returnState.products?.length || 0})
            </button>
          </div>
          
          {/* 탭 내용 */}
          {productListTab === 'smartstore' ? (
            // 스마트스토어 상품 목록
            <div>
              {smartStoreProducts.length > 0 ? (
                <div className="overflow-x-auto max-h-[70vh]">
                  <table className="min-w-full border-collapse border border-gray-300">
                    <thead className="sticky top-0 bg-white">
                      <tr className="bg-gray-100">
                        <th className="px-2 py-2 border-x border-gray-300">번호</th>
                        <th className="px-2 py-2 border-x border-gray-300">상품코드</th>
                        <th className="px-2 py-2 border-x border-gray-300">상품명</th>
                      </tr>
                    </thead>
                    <tbody>
                      {smartStoreProducts.map((item, index) => (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="px-2 py-2 border-x border-gray-300 text-center">{index + 1}</td>
                          <td className="px-2 py-2 border-x border-gray-300 font-mono text-sm">{item.productCode}</td>
                          <td className="px-2 py-2 border-x border-gray-300">{item.productName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>스마트스토어 상품 데이터가 없습니다.</p>
                  <p className="text-sm mt-2">스마트스토어 업로드 버튼을 통해 상품 데이터를 업로드하세요.</p>
                </div>
              )}
            </div>
          ) : (
            // 셀메이트 상품 목록
            <div>
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
                >
                  전체 삭제 ({returnState.products?.length || 0}개)
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
                        <th className="px-2 py-2 border-x border-gray-300 col-order-number">상품코드</th>
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
                          <td className="px-2 py-2 border-x border-gray-300 col-order-number font-mono">{item.customProductCode || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>셀메이트 상품 데이터가 없습니다.</p>
                  <p className="text-sm mt-2">상품 업로드 버튼을 통해 상품 데이터를 업로드하세요.</p>
                </div>
              )}
            </div>
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
                      메인 코드 크기 (rem)
                    </label>
                    <input
                      type="number"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={tableSettings.barcodeFormat.mainCodeSize}
                      onChange={(e) => handleBarcodeFormatChange('mainCodeSize', Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      서브 정보 크기 (rem)
                    </label>
                    <input
                      type="number"
                      min="0.3"
                      max="1.5"
                      step="0.1"
                      value={tableSettings.barcodeFormat.subInfoSize}
                      onChange={(e) => handleBarcodeFormatChange('subInfoSize', Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      줄 간격
                    </label>
                    <input
                      type="number"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={tableSettings.barcodeFormat.lineHeight}
                      onChange={(e) => handleBarcodeFormatChange('lineHeight', Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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