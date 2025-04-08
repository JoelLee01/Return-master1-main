'use client';

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUpload } from "@/components/file-upload";
import * as XLSX from 'xlsx';
import { ReturnItem, ReturnState, ProductInfo } from '@/types/returns';
import { parseProductExcel, downloadCellmateCSV } from '@/utils/excel';

// 문자열 유사도 계산 함수 (Levenshtein 거리 기반)
function stringSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();
  
  const len1 = s1.length;
  const len2 = s2.length;
  
  // 길이 차이가 너무 크면 유사도 낮음 (더 엄격한 기준 적용)
  if (Math.abs(len1 - len2) > Math.min(len1, len2) * 0.3) {
    return 0;
  }
  
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

// 키워드 기반 유사도 검증 함수 (추가)
function validateKeywordSimilarity(s1: string, s2: string): boolean {
  if (!s1 || !s2) return false;
  
  // 문자열을 소문자로 변환하고 특수문자 제거
  const clean1 = s1.toLowerCase().replace(/[^\w\s가-힣]/g, ' ').replace(/\s+/g, ' ').trim();
  const clean2 = s2.toLowerCase().replace(/[^\w\s가-힣]/g, ' ').replace(/\s+/g, ' ').trim();
  
  // 각 문자열에서 주요 키워드 추출 (2글자 이상인 단어만)
  const words1 = clean1.split(' ').filter(word => word.length >= 2);
  const words2 = clean2.split(' ').filter(word => word.length >= 2);
  
  // 공통 키워드 찾기
  const commonWords = words1.filter(word => words2.some(w => w.includes(word) || word.includes(w)));
  
  // 공통 키워드가 없으면 유사하지 않음
  if (commonWords.length === 0) return false;
  
  // 공통 키워드가 전체 키워드의 30% 이상이면 유사하다고 판단
  const totalUniqueWords = new Set([...words1, ...words2]).size;
  return commonWords.length / totalUniqueWords >= 0.3;
}

// 상품 데이터와 반품 데이터 매칭 함수
function matchProductData(returnItem: ReturnItem, products: ProductInfo[]): ReturnItem {
  // 이미 바코드가 있으면 그대로 반환
  if (returnItem.barcode) {
    console.log(`이미 바코드 있음: ${returnItem.barcode}`);
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
  
  // 3. 상품명과 사입상품명 간의 유사도 매칭 시도
  let bestMatchByName: ProductInfo | null = null;
  let highestSimilarityByName = 0;
  
  for (const product of products) {
    if (product.purchaseName && returnItem.productName) {
      const similarity = stringSimilarity(returnItem.productName, product.purchaseName);
      
      // 유사도가 0.6 이상이고 키워드 검증도 통과하는 경우만 매칭
      if (similarity > highestSimilarityByName && similarity >= 0.6 && 
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
  
  // 4. 자체상품코드와 사입상품명 간의 유사도 매칭 시도
  if (returnItem.zigzagProductCode && returnItem.zigzagProductCode !== '-') {
    let bestMatchByCode: ProductInfo | null = null;
    let highestSimilarityByCode = 0;
    
    for (const product of products) {
      if (product.purchaseName && returnItem.zigzagProductCode) {
        // 자체상품코드와 사입상품명 비교
        const similarity = stringSimilarity(returnItem.zigzagProductCode, product.purchaseName);
        
        // 유사도가 0.4 이상인 경우만 매칭 (더 엄격한 기준 적용)
        if (similarity > highestSimilarityByCode && similarity >= 0.4) {
          highestSimilarityByCode = similarity;
          bestMatchByCode = product;
        }
      }
    }
    
    if (bestMatchByCode) {
      console.log(`자체상품코드-사입상품명 매칭 성공: 유사도 ${highestSimilarityByCode.toFixed(2)}`);
      
      // 옵션명 매칭 시도 (자체상품코드 매칭이 성공한 경우)
      if (returnItem.optionName && bestMatchByCode.optionName) {
        // 같은 상품 중에서 옵션명이 가장 유사한 항목 찾기
        let bestOptionMatch = bestMatchByCode;
        let highestOptionSimilarity = stringSimilarity(returnItem.optionName, bestMatchByCode.optionName);
        
        // 같은 상품명을 가진 다른 상품들 중에서 옵션명이 더 유사한 것이 있는지 확인
        const sameProducts = products.filter(p => 
          p.purchaseName === bestMatchByCode?.purchaseName || 
          p.productName === bestMatchByCode?.productName
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
        
        if (bestOptionMatch !== bestMatchByCode && highestOptionSimilarity >= 0.5) {
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
        purchaseName: bestMatchByCode.purchaseName || bestMatchByCode.productName,
        barcode: bestMatchByCode.barcode,
        optionName: returnItem.optionName // 원래 옵션명 유지
      };
    }
  }
  
  // 5. 상품명과 옵션명으로 유사도 매칭 (기존 방식)
  let bestMatch: ProductInfo | null = null;
  let highestSimilarity = 0;
  
  // 유사도 임계값을 단계적으로 낮추면서 매칭 시도 (더 높은 임계값으로 시작)
  const similarityThresholds = [0.9, 0.8, 0.7, 0.6, 0.5];
  
  for (const threshold of similarityThresholds) {
    for (const product of products) {
      // 상품명 유사도
      const productNameSimilarity = stringSimilarity(returnItem.productName, product.productName);
      // 옵션명 유사도
      const optionNameSimilarity = stringSimilarity(returnItem.optionName, product.optionName);
      
      // 가중치를 적용한 종합 유사도 (상품명 70%, 옵션명 30%)
      const combinedSimilarity = (productNameSimilarity * 0.7) + (optionNameSimilarity * 0.3);
      
      if (combinedSimilarity > highestSimilarity && combinedSimilarity >= threshold) {
        // 키워드 검증 추가
        if (validateKeywordSimilarity(returnItem.productName, product.productName)) {
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
  
  // 매칭 실패 시 원본 반환
  console.log(`매칭 실패: ${returnItem.productName}`);
  return returnItem;
}

// 엑셀 헤더 행 찾기 함수
function findHeaderRowIndex(data: any[][]): number {
  // 주문번호, 상품명, 옵션 등의 키워드가 포함된 행을 찾음
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    
    // 헤더로 판단할 수 있는 키워드들
    const headerKeywords = ['주문번호', '상품명', '옵션', '반품사유'];
    
    // 현재 행에 헤더 키워드가 몇 개 포함되어 있는지 확인
    const keywordCount = headerKeywords.reduce((count, keyword) => {
      const hasKeyword = row.some((cell: any) => 
        typeof cell === 'string' && cell.includes(keyword)
      );
      return hasKeyword ? count + 1 : count;
    }, 0);
    
    // 2개 이상의 키워드가 포함되어 있으면 헤더 행으로 판단
    if (keywordCount >= 2) {
      return i;
    }
  }
  
  return -1; // 헤더 행을 찾지 못한 경우
}

// 옵션명 단순화 함수
function simplifyOptionName(optionName: string): string {
  if (!optionName) return '';
  
  // 불필요한 텍스트 제거
  let cleanedOption = optionName
    .replace(/\([^)]*\)/g, '') // 괄호와 괄호 안의 내용 제거
    .replace(/\[[^\]]*\]/g, '') // 대괄호와 대괄호 안의 내용 제거
    .replace(/색상(?:\s*)?:(?:\s*)?/gi, '') // '색상:' 제거
    .replace(/색상선택(?:\s*)?:(?:\s*)?/gi, '') // '색상선택:' 제거
    .replace(/사이즈(?:\s*)?:(?:\s*)?/gi, '') // '사이즈:' 제거
    .replace(/\/FREE/gi, '') // '/FREE' 제거
    .replace(/FREE/gi, '') // 'FREE' 제거
    .replace(/one size/gi, '') // 'one size' 제거
    .replace(/\s*\/\s*/g, '/') // 슬래시 주변 공백 제거
    .replace(/\s+/g, ' ') // 연속된 공백을 하나로 줄임
    .trim();
  
  // 색상과 사이즈 정보 추출
  let color = '';
  let size = '';
  
  // 색상 추출 (기본 색상 목록)
  const colorKeywords = ['블랙', '화이트', '네이비', '그레이', '베이지', '레드', '블루', '그린', '옐로우', '퍼플', '핑크'];
  for (const keyword of colorKeywords) {
    if (cleanedOption.includes(keyword)) {
      color = keyword;
      break;
    }
  }
  
  // 사이즈 추출 (기본 사이즈 패턴)
  if (cleanedOption.match(/\b[SML]\b/i)) {
    const sizeLetterMatch = cleanedOption.match(/\b([SML])\b/i);
    if (sizeLetterMatch) {
      size = sizeLetterMatch[1].toUpperCase();
    }
  } else if (cleanedOption.match(/\b[SML]XL\b/i)) {
    const sizeLetterMatch = cleanedOption.match(/\b([SML]XL)\b/i);
    if (sizeLetterMatch) {
      size = sizeLetterMatch[1].toUpperCase();
    }
  } else if (cleanedOption.match(/\bXL\b/i)) {
    size = 'XL';
  } else if (cleanedOption.match(/\bXXL\b/i)) {
    size = 'XXL';
  } else if (cleanedOption.match(/\b[0-9]+\b/)) {
    // 숫자만 있는 경우 (예: 95, 100 등)
    const numMatch = cleanedOption.match(/\b([0-9]+)\b/);
    if (numMatch) {
      size = numMatch[1];
    }
  }
  
  // 결과 조합
  if (color && size) {
    return `${color}/${size}`;
  } else if (color) {
    return color;
  } else if (size) {
    return size;
  }
  
  // 추출 실패 시 정리된 옵션명 반환
  return cleanedOption;
}

// 반품 사유 단순화 함수
function simplifyReturnReason(reason: string): string {
  if (!reason) return reason;
  
  // 반품 사유 단순화
  let simplified = reason;
  
  // "단순,변심" 관련 텍스트는 "단순 변심"으로 통일
  if (simplified.includes('변심') || simplified.includes('단순')) {
    return '단순 변심';
  }
  
  // "파손,불량" 관련 텍스트는 "파손 및 불량"으로 통일
  if (simplified.includes('파손') || simplified.includes('불량')) {
    return '파손 및 불량';
  }
  
  // "잘못 주문"을 "[주문실수]"로 변경
  if (simplified.includes('잘못') && simplified.includes('주문')) {
    return '주문실수';
  }
  
  return simplified;
}

// 반품 데이터 파싱 함수 내부에서 반품 사유 단순화 적용
function parseReturnExcel(file: File): Promise<ReturnItem[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        // 헤더 행 찾기
        const headerRowIndex = findHeaderRowIndex(jsonData);
        if (headerRowIndex === -1) {
          reject(new Error('헤더 행을 찾을 수 없습니다.'));
          return;
        }

        const headers = jsonData[headerRowIndex];
        const returnItems: ReturnItem[] = [];

        // 헤더 인덱스 찾기 - 정확한 열 이름 매칭
        const orderNumberIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && 
          header.includes('주문번호') && 
          !header.includes('상품주문번호')
        );
        
        // 상품주문번호는 주문번호가 없을 때만 사용
        const productOrderNumberIndex = orderNumberIndex === -1 ? 
          headers.findIndex((header: string) => 
            typeof header === 'string' && 
            header.includes('상품주문번호')
          ) : -1;
        
        // 실제 사용할 주문번호 인덱스
        const actualOrderNumberIndex = orderNumberIndex !== -1 ? orderNumberIndex : productOrderNumberIndex;
        
        const productNameIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && 
          header.includes('상품명')
        );
        const optionNameIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && 
          header.includes('옵션')
        );
        const returnReasonIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && 
          header.includes('반품사유')
        );
        const zigzagProductCodeIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && 
          header.includes('자체상품코드')
        );
        const customerNameIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && 
          (header.includes('고객명') || header.includes('구매자명'))
        );
        const quantityIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && 
          header.includes('수량')
        );
        const trackingNumberIndex = headers.findIndex((header: string) => 
          typeof header === 'string' && 
          header.includes('송장번호')
        );

        console.log('엑셀 헤더 정보:', {
          주문번호: orderNumberIndex,
          상품주문번호: productOrderNumberIndex,
          실제사용주문번호: actualOrderNumberIndex,
          상품명: productNameIndex,
          옵션명: optionNameIndex,
          반품사유: returnReasonIndex,
          자체상품코드: zigzagProductCodeIndex,
          고객명: customerNameIndex,
          수량: quantityIndex,
          송장번호: trackingNumberIndex
        });

        // 데이터 행 처리
        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0 || !row[actualOrderNumberIndex]) continue;

          const orderNumber = row[actualOrderNumberIndex]?.toString() || '';
          const productName = row[productNameIndex]?.toString() || '';
          const optionName = row[optionNameIndex]?.toString() || '';
          const returnReason = row[returnReasonIndex]?.toString() || '';
          const zigzagProductCode = zigzagProductCodeIndex >= 0 ? (row[zigzagProductCodeIndex]?.toString() || '-') : '-';
          const customerName = customerNameIndex >= 0 ? (row[customerNameIndex]?.toString() || '') : '';
          
          // 수량 처리 - 'N'이 아닌 숫자만 추출
          let quantity = 1; // 기본값은 숫자 1
          if (quantityIndex >= 0) {
            const rawQuantity = row[quantityIndex]?.toString() || '1';
            // 숫자만 추출
            const numericQuantity = rawQuantity.replace(/[^0-9]/g, '');
            quantity = numericQuantity ? parseInt(numericQuantity, 10) : 1; // 숫자가 없으면 기본값 1 사용
          }
          
          const returnTrackingNumber = trackingNumberIndex >= 0 ? (row[trackingNumberIndex]?.toString() || '') : '';

          // 반품 사유 단순화 적용
          const simplifiedReason = simplifyReturnReason(returnReason);

          returnItems.push({
            orderNumber,
            productName,
            optionName: simplifyOptionName(optionName),
            returnReason: simplifiedReason, // 단순화된 반품 사유 사용
            zigzagProductCode,
            purchaseName: '',
            barcode: '',
            detailReason: '',
            customerName,
            quantity,
            returnTrackingNumber,
            status: 'PENDING'
          });
        }

        resolve(returnItems);
    } catch (error) {
        console.error('엑셀 파싱 오류:', error);
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}

export default function Home() {
  const [returnState, setReturnState] = useState<ReturnState>({
    pendingReturns: [],
    completedReturns: [],
    products: []
  });
  const [returnFile, setReturnFile] = useState<File | null>(null);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showProductData, setShowProductData] = useState(false);
  const [selectedCompletedItems, setSelectedCompletedItems] = useState<number[]>([]);
  const [selectAllCompleted, setSelectAllCompleted] = useState(false);
  const [currentDate, setCurrentDate] = useState<string>('');
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [currentDateIndex, setCurrentDateIndex] = useState(0);
  const [detailReason, setDetailReason] = useState<string>('');
  const [selectedReturnItem, setSelectedReturnItem] = useState<ReturnItem | null>(null);
  const [addedCounts, setAddedCounts] = useState<{
    pendingReturns: number;
    products: number;
  }>({ pendingReturns: 0, products: 0 });
  const [showAddedCounts, setShowAddedCounts] = useState(false);

  // 메시지 타이머 관리
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage('');
      }, 5000); // 5초 후 메시지 사라짐
      
      return () => clearTimeout(timer);
    }
  }, [message]);

  // 추가된 항목 수 표시 타이머 관리
  useEffect(() => {
    if (showAddedCounts) {
      const timer = setTimeout(() => {
        setShowAddedCounts(false);
      }, 3000); // 3초 후 추가된 항목 수 표시 사라짐
      
      return () => clearTimeout(timer);
    }
  }, [showAddedCounts]);

  // 데이터 가져오기 함수
  const fetchReturns = async () => {
    try {
      console.log('데이터 가져오기 시작');
      const response = await fetch('/api/returns');
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '응답을 파싱할 수 없습니다.' }));
        console.error('데이터 가져오기 오류:', response.status, errorData);
        throw new Error(`서버 오류: ${errorData.error || response.statusText}`);
      }
      
      const data = await response.json();
      console.log('데이터 가져오기 성공:', {
        pendingReturns: data.pendingReturns?.length || 0,
        completedReturns: data.completedReturns?.length || 0,
        products: data.products?.length || 0
      });
      
      // 중복 제거 처리
      const uniquePendingReturns = removeDuplicateReturns(data.pendingReturns);
      
      if (uniquePendingReturns.length !== data.pendingReturns.length) {
        // 중복이 있으면 서버에 업데이트
        await updateData('UPDATE_RETURNS', {
          pendingReturns: uniquePendingReturns,
          completedReturns: data.completedReturns
        });
        
        setMessage(`중복된 항목 ${data.pendingReturns.length - uniquePendingReturns.length}개가 제거되었습니다.`);
        
        // 업데이트된 데이터로 설정
        setReturnState({
          ...data,
          pendingReturns: uniquePendingReturns
        });
      } else {
      setReturnState(data);
      }
    } catch (error) {
      console.error('데이터 가져오기 실패:', error);
      setMessage(`데이터를 가져오는 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    }
  };

  // 중복 반품 항목 제거 함수
  const removeDuplicateReturns = (returns: ReturnItem[]): ReturnItem[] => {
    const uniqueMap = new Map<string, ReturnItem>();
    
    returns.forEach(item => {
      // 고유 키 생성 (주문번호, 상품명, 옵션명, 수량, 반품사유 조합)
      const key = `${item.orderNumber}-${item.productName}-${item.optionName}-${item.quantity}-${item.returnReason}`;
      
      // 이미 존재하는 항목이 없거나, 바코드가 있는 항목을 우선 저장
      if (!uniqueMap.has(key) || (!uniqueMap.get(key)?.barcode && item.barcode)) {
        uniqueMap.set(key, item);
      }
    });
    
    return Array.from(uniqueMap.values());
  };

  // 중복 상품 항목 제거 함수
  const removeDuplicateProducts = (products: ProductInfo[]): ProductInfo[] => {
    const uniqueMap = new Map<string, ProductInfo>();
    
    products.forEach(item => {
      // 바코드를 기준으로 중복 제거
      if (item.barcode && !uniqueMap.has(item.barcode)) {
        uniqueMap.set(item.barcode, item);
      }
    });
    
    return Array.from(uniqueMap.values());
  };

  // 컴포넌트 마운트 시 데이터 가져오기
  useEffect(() => {
    fetchReturns();
  }, []);

  // 데이터를 가져온 후 날짜 목록 설정
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

  // 반품 엑셀 파일 처리 함수
  const handleReturnFileChange = (file: File | null) => {
    setReturnFile(file);
    if (file) {
      setIsLoading(true);
      try {
        parseReturnExcel(file)
          .then(async (returns) => {
            // 상품 데이터와 매칭하여 사입상품명과 바코드 업데이트
            const matchedReturns = returns.map(item => matchProductData(item, returnState.products));
            
            // 기존 데이터와 새 데이터 병합
            const combinedReturns = [...returnState.pendingReturns, ...matchedReturns];
            
            // 중복 제거
            const uniqueReturns = removeDuplicateReturns(combinedReturns);
            
            // 추가된 항목 수 계산
            const addedCount = uniqueReturns.length - returnState.pendingReturns.length;
            
            // 서버에 데이터 전송
            await updateData('UPDATE_RETURNS', {
              pendingReturns: uniqueReturns,
              completedReturns: returnState.completedReturns
            });
            
            // 로컬 상태 업데이트
            setReturnState(prev => ({
              ...prev,
              pendingReturns: uniqueReturns
            }));
            
            // 추가된 항목 수 표시
            setAddedCounts(prev => ({
              ...prev,
              pendingReturns: addedCount
            }));
            setShowAddedCounts(true);
            
            setMessage(`${returns.length}개의 항목이 추가되었습니다. (중복 제외 실제 추가: ${addedCount}개)`);
          })
          .catch(error => {
            console.error('엑셀 파싱 오류:', error);
            setMessage(`엑셀 파싱 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
          })
          .finally(() => {
            setIsLoading(false);
            setReturnFile(null);
          });
      } catch (error) {
        console.error('파일 처리 오류:', error);
        setMessage(`파일 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        setIsLoading(false);
        setReturnFile(null);
      }
    }
  };

  // 상품 엑셀 파일 처리 함수
  const handleProductFileChange = (file: File | null) => {
    setProductFile(file);
    if (file) {
      setIsLoading(true);
      try {
        parseProductExcel(file)
          .then(async (products) => {
            // 기존 데이터와 새 데이터 병합
            const combinedProducts = [...returnState.products, ...products];
            
            // 중복 제거 (바코드 기준)
            const uniqueProducts = removeDuplicateProducts(combinedProducts);
            
            // 추가된 항목 수 계산
            const addedCount = uniqueProducts.length - returnState.products.length;
            
            // 서버에 데이터 전송
            await updateData('UPDATE_PRODUCTS', {
              products: uniqueProducts
            });
            
            // 로컬 상태 업데이트
            setReturnState(prev => ({
              ...prev,
              products: uniqueProducts
            }));
            
            // 추가된 항목 수 표시
            setAddedCounts(prev => ({
              ...prev,
              products: addedCount
            }));
            setShowAddedCounts(true);
            
            // 기존 반품 데이터에 바코드 정보 업데이트
            const updatedPendingReturns = returnState.pendingReturns.map(item => 
              matchProductData(item, uniqueProducts)
            );
            
            // 중복 제거
            const uniquePendingReturns = removeDuplicateReturns(updatedPendingReturns);
            
            // 서버에 업데이트된 반품 데이터 전송
            await updateData('UPDATE_RETURNS', {
              pendingReturns: uniquePendingReturns,
      completedReturns: returnState.completedReturns
    });
            
            // 로컬 상태 업데이트
            setReturnState(prev => ({
              ...prev,
              pendingReturns: uniquePendingReturns
            }));
            
            setMessage(`${products.length}개의 상품이 추가되었습니다. (중복 제외 실제 추가: ${addedCount}개)`);
          })
          .catch(error => {
            console.error('엑셀 파싱 오류:', error);
            setMessage(`엑셀 파싱 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
          })
          .finally(() => {
            setIsLoading(false);
            setProductFile(null);
          });
      } catch (error) {
        console.error('파일 처리 오류:', error);
        setMessage(`파일 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        setIsLoading(false);
        setProductFile(null);
      }
    }
  };

  // 입고 처리 함수
  const handleProcessReceipt = async () => {
    if (trackingNumber) {
      try {
        setIsLoading(true);
        
        // 해당 송장번호를 가진 모든 반품 찾기
        const pendingIndices = returnState.pendingReturns
          .map((item, index) => item.returnTrackingNumber === trackingNumber ? index : -1)
          .filter(index => index !== -1);
        
        if (pendingIndices.length === 0) {
          setMessage(`송장번호 ${trackingNumber}에 해당하는 반품을 찾을 수 없습니다.`);
          setIsLoading(false);
          return;
        }
        
        // 완료 처리할 항목들
        const completedItems = pendingIndices.map(index => ({
          ...returnState.pendingReturns[index],
        completedAt: new Date(),
        status: 'COMPLETED' as const
        }));

        // 서버에 데이터 전송
    await updateData('UPDATE_RETURNS', {
          pendingReturns: returnState.pendingReturns.filter((_, i) => !pendingIndices.includes(i)),
          completedReturns: [...returnState.completedReturns, ...completedItems]
        });
        
        // 로컬 상태 업데이트
        setReturnState(prev => ({
          ...prev,
          pendingReturns: prev.pendingReturns.filter((_, i) => !pendingIndices.includes(i)),
          completedReturns: [...prev.completedReturns, ...completedItems]
        }));
        
        // 성공 메시지 표시
        setMessage(`입고 처리 완료: ${trackingNumber} (${completedItems.length}개 항목)`);
        
        // 입력 필드 초기화
        setTrackingNumber('');
      } catch (error) {
        console.error('입고 처리 오류:', error);
        setMessage(`입고 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      } finally {
        setIsLoading(false);
      }
    }
  };

  // 입고전 목록 보기 함수
  const openPendingModal = () => {
    const modal = document.getElementById('pendingModal') as HTMLDialogElement;
    if (modal) modal.showModal();
  };

  // 입고완료 전체보기 함수
  const openCompletedModal = () => {
    const modal = document.getElementById('completedModal') as HTMLDialogElement;
    if (modal) modal.showModal();
  };

  // 상품 데이터 보기 함수
  const openProductModal = () => {
    const modal = document.getElementById('productModal') as HTMLDialogElement;
    if (modal) modal.showModal();
  };

  // 체크박스 선택 처리 함수
  const handleCheckboxChange = (index: number) => {
    setSelectedItems(prev => {
      if (prev.includes(index)) {
        return prev.filter(i => i !== index);
      } else {
        return [...prev, index];
      }
    });
  };

  // 전체 선택 처리 함수
  const handleSelectAll = () => {
    if (selectAll) {
    setSelectedItems([]);
    } else {
      setSelectedItems(returnState.pendingReturns.map((_, index) => index));
    }
    setSelectAll(!selectAll);
  };

  // 선택 항목 삭제 함수
  const handleDeleteSelected = () => {
    if (selectedItems.length === 0) return;
    
    const newPendingReturns = returnState.pendingReturns.filter((_, index) => 
      !selectedItems.includes(index)
    );
    
    // 서버에 데이터 전송
    updateData('UPDATE_RETURNS', {
      pendingReturns: newPendingReturns,
      completedReturns: returnState.completedReturns
    })
    .then(() => {
      // 로컬 상태 업데이트
      setReturnState(prev => ({
        ...prev,
        pendingReturns: newPendingReturns
      }));
      
      setMessage(`${selectedItems.length}개의 항목이 삭제되었습니다.`);
      setSelectedItems([]);
      setSelectAll(false);
    })
    .catch(error => {
      console.error('삭제 오류:', error);
      setMessage(`삭제 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    });
  };

  // 선택 항목 입고 처리 함수
  const handleProcessSelected = () => {
    if (selectedItems.length === 0) return;
    
    setIsLoading(true);
    
    // 선택한 항목 가져오기
    const selectedReturns = selectedItems.map(index => returnState.pendingReturns[index]);
    
    // 입고 처리할 항목에 completedAt 추가
    const completedReturns = selectedReturns.map(item => ({
          ...item,
        completedAt: new Date(),
        status: 'COMPLETED' as const
    }));
    
    // 입고전 목록에서 선택한 항목 제거
    const newPendingReturns = returnState.pendingReturns.filter((_, index) => 
      !selectedItems.includes(index)
    );
    
    // 서버에 데이터 전송
    updateData('UPDATE_RETURNS', {
      pendingReturns: newPendingReturns,
      completedReturns: [...returnState.completedReturns, ...completedReturns]
    })
    .then(() => {
      // 로컬 상태 업데이트
      setReturnState(prev => ({
        ...prev,
        pendingReturns: newPendingReturns,
        completedReturns: [...prev.completedReturns, ...completedReturns]
      }));
      
      setMessage(`${selectedItems.length}개의 항목이 입고 처리되었습니다.`);
      setSelectedItems([]);
      setSelectAll(false);
    })
    .catch(error => {
      console.error('입고 처리 오류:', error);
      setMessage(`입고 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    })
    .finally(() => {
      setIsLoading(false);
    });
  };

  // 데이터 새로고침 함수
  const handleRefresh = () => {
    setIsLoading(true);
    fetchReturns()
      .then(() => {
        // 새로고침 후 상태 업데이트
        setMessage('데이터가 새로고침되었습니다.');
        
        // 새로고침 시간 표시
        const refreshTime = new Date().toLocaleTimeString();
        setMessage(`데이터가 새로고침되었습니다. (${refreshTime})`);
      })
      .catch(error => {
        console.error('새로고침 오류:', error);
        setMessage(`새로고침 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  // 주문번호별로 그룹화하는 함수
  const groupByOrderNumber = (returns: ReturnItem[]) => {
    const groups: Record<string, ReturnItem[]> = {};
    
    returns.forEach(item => {
      // 고객명과 주문번호를 조합한 키 사용
      const key = `${item.customerName}-${item.orderNumber || 'unknown'}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
    });
    
    return groups;
  };

  const pendingReturnGroups = groupByOrderNumber(returnState.pendingReturns);
  const completedReturnsByDate = returnState.completedReturns.reduce((acc, item) => {
    const date = new Date(item.completedAt!).toLocaleDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(item);
    return acc;
  }, {} as Record<string, ReturnItem[]>);

  // 불량/파손 여부 확인 함수
  const isDefective = (reason: string) => {
    return reason.includes('불량') || reason.includes('파손');
  };

  // 완료된 항목 체크박스 선택 처리 함수
  const handleCompletedCheckboxChange = (index: number) => {
    setSelectedCompletedItems(prev => {
      if (prev.includes(index)) {
        return prev.filter(i => i !== index);
    } else {
        return [...prev, index];
      }
    });
  };

  // 완료된 항목 전체 선택 처리 함수
  const handleSelectAllCompleted = () => {
    if (selectAllCompleted) {
      setSelectedCompletedItems([]);
    } else {
      const currentDateItems = returnState.completedReturns
        .filter(item => new Date(item.completedAt!).toLocaleDateString() === currentDate)
        .map((_, index) => index);
      setSelectedCompletedItems(currentDateItems);
    }
    setSelectAllCompleted(!selectAllCompleted);
  };

  // 선택된 완료 항목 삭제 함수
  const handleDeleteSelectedCompleted = () => {
    if (selectedCompletedItems.length === 0) return;
    
    const newCompletedReturns = returnState.completedReturns.filter((_, index) => 
      !selectedCompletedItems.includes(index)
    );
    
    // 서버에 데이터 전송
    updateData('UPDATE_RETURNS', {
      pendingReturns: returnState.pendingReturns,
      completedReturns: newCompletedReturns
    })
    .then(() => {
      // 로컬 상태 업데이트
      setReturnState(prev => ({
        ...prev,
        completedReturns: newCompletedReturns
      }));
      
      setMessage(`${selectedCompletedItems.length}개의 완료 항목이 삭제되었습니다.`);
      setSelectedCompletedItems([]);
      setSelectAllCompleted(false);
    })
    .catch(error => {
      console.error('삭제 오류:', error);
      setMessage(`삭제 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    });
  };

  // 날짜 이동 함수
  const navigateDate = (direction: 'prev' | 'next') => {
    if (availableDates.length === 0) return;
    
    let newIndex = currentDateIndex;
    if (direction === 'prev' && currentDateIndex > 0) {
      newIndex = currentDateIndex - 1;
    } else if (direction === 'next' && currentDateIndex < availableDates.length - 1) {
      newIndex = currentDateIndex + 1;
    }
    
    setCurrentDateIndex(newIndex);
    setCurrentDate(availableDates[newIndex]);
  };

  // 상품 데이터 전체 삭제 함수
  const handleDeleteAllProducts = async () => {
    if (!confirm('모든 상품 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      return;
    }
    
    setIsLoading(true);
    
    try {
      // 서버에 데이터 전송
      await updateData('DELETE_ALL_PRODUCTS', {});
      
      // 로컬 상태 업데이트
      setReturnState(prev => ({
        ...prev,
        products: []
      }));
      
      setMessage('모든 상품 데이터가 삭제되었습니다.');
    } catch (error) {
      console.error('상품 데이터 삭제 오류:', error);
      setMessage(`상품 데이터 삭제 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 상세 반품사유 저장 함수
  const saveDetailReason = async () => {
    if (!selectedReturnItem || !detailReason) return;
    
    try {
      // 선택된 항목 찾기
      const index = returnState.completedReturns.findIndex(item => 
        item.orderNumber === selectedReturnItem.orderNumber &&
        item.productName === selectedReturnItem.productName &&
        item.optionName === selectedReturnItem.optionName &&
        item.returnTrackingNumber === selectedReturnItem.returnTrackingNumber
      );
      
      if (index === -1) {
        setMessage('해당 항목을 찾을 수 없습니다.');
        return;
      }
      
      // 상세 사유 추가
      const updatedItem = {
        ...returnState.completedReturns[index],
        detailReason: detailReason
      };
      
      const updatedCompletedReturns = [...returnState.completedReturns];
      updatedCompletedReturns[index] = updatedItem;
      
      // 서버에 데이터 전송
        await updateData('UPDATE_RETURNS', {
          pendingReturns: returnState.pendingReturns,
          completedReturns: updatedCompletedReturns
        });

      // 로컬 상태 업데이트
      setReturnState(prev => ({
        ...prev,
        completedReturns: updatedCompletedReturns
      }));
      
      setMessage('상세 반품사유가 저장되었습니다.');
      
      // 모달 닫기
      const modal = document.getElementById('detailReasonModal') as HTMLDialogElement;
      if (modal) modal.close();
      
      // 상태 초기화
      setSelectedReturnItem(null);
        setDetailReason('');
      } catch (error) {
      console.error('상세 사유 저장 오류:', error);
      setMessage(`상세 사유 저장 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    }
  };

  // 반품사유 클릭 핸들러
  const handleReturnReasonClick = (item: ReturnItem) => {
    // 불량/파손 항목만 처리
    if (!isDefective(item.returnReason)) return;
    
    setSelectedReturnItem(item);
    setDetailReason(item.detailReason || '');
    
    const modal = document.getElementById('detailReasonModal') as HTMLDialogElement;
    if (modal) modal.showModal();
  };

  // 현재 날짜 설정
  const today = new Date().toLocaleDateString();

  // 현재 날짜의 완료된 반품 목록
  const todayCompletedReturns = returnState.completedReturns.filter(
    item => new Date(item.completedAt!).toLocaleDateString() === today
  );

  // 현재 선택된 날짜의 완료된 반품 목록 (메인 화면용)
  const currentDateMainReturns = returnState.completedReturns.filter(
    item => new Date(item.completedAt!).toLocaleDateString() === currentDate
  );

  // 엑셀 다운로드 함수
  const handleDownloadExcel = () => {
    if (currentDateMainReturns.length === 0) {
      setMessage('다운로드할 데이터가 없습니다.');
      return;
    }
    
    try {
      // 엑셀 다운로드 함수 호출
      import('@/utils/excel').then(({ downloadCompletedReturnsExcel }) => {
        downloadCompletedReturnsExcel(currentDateMainReturns, currentDate);
        setMessage('엑셀 파일 다운로드가 완료되었습니다.');
      });
      } catch (error) {
      console.error('엑셀 다운로드 오류:', error);
      setMessage(`엑셀 다운로드 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    }
  };

  // 입고완료 목록 모달 닫기
  const closeCompletedModal = () => {
    const modal = document.getElementById('completedModal') as HTMLDialogElement;
    if (modal) modal.close();
    setSelectedCompletedItems([]);
    setSelectAllCompleted(false);
  };

  // 입고전 목록 모달 닫기
  const closePendingModal = () => {
    const modal = document.getElementById('pendingModal') as HTMLDialogElement;
    if (modal) modal.close();
    setSelectedItems([]);
    setSelectAll(false);
  };

  // 테이블 행 스타일 결정 함수 (입고전 목록용)
  const getRowStyle = (item: ReturnItem, index: number, items: ReturnItem[]) => {
    // 기본 스타일만 유지하고 그룹화 관련 코드 제거
    return `${selectedItems.includes(index) ? 'bg-blue-50' : ''} ${isDefective(item.returnReason) ? 'text-red-600' : ''}`;
  };

  // 테이블 행 스타일 결정 함수 (입고완료 목록용)
  const getCompletedRowStyle = (item: ReturnItem, items: ReturnItem[]) => {
    // 기본 스타일만 유지하고 그룹화 관련 코드 제거
    return isDefective(item.returnReason) ? 'text-red-600' : '';
  };

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">반품 관리 시스템</h1>
      
        {/* 파일 업로드 섹션 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl font-medium">반품 엑셀/CSV 파일 업로드</CardTitle>
            </CardHeader>
            <CardContent>
              <FileUpload 
                accept=".xlsx,.xls,.csv"
                onChange={handleReturnFileChange}
                label="엑셀파일 선택"
              />
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl font-medium">상품 리스트 업로드</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <FileUpload 
                  accept=".xlsx,.xls,.csv"
                  onChange={handleProductFileChange}
                  label="엑셀파일 선택"
                />
                <div className="flex gap-2">
                  <Button 
                    className="bg-green-500 hover:bg-green-600 text-white flex-1 w-2/3 text-lg"
              onClick={openProductModal}
            >
              상품 데이터 확인 ({returnState.products.length}개)
                    {showAddedCounts && addedCounts.products > 0 && (
                      <span className="ml-1 bg-yellow-400 text-black px-2 py-0.5 rounded-full text-sm">
                        +{addedCounts.products}
                      </span>
                    )}
                  </Button>
                </div>
                </div>
            </CardContent>
          </Card>
                </div>
        
        {/* 입고전 목록 및 반품송장번호 입력 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl font-medium">
                입고전 ({returnState.pendingReturns.length})
                {showAddedCounts && addedCounts.pendingReturns > 0 && (
                  <span className="ml-1 bg-yellow-400 text-black px-2 py-0.5 rounded-full text-sm">
                    +{addedCounts.pendingReturns}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button 
                className="bg-blue-500 hover:bg-blue-600 text-white w-full text-lg"
                onClick={openPendingModal}
              >
                목록 보기
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl font-medium">반품송장번호 입력</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  placeholder="반품송장번호 입력"
                  className="flex-1 text-lg h-12"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                />
                <Button
                  className="bg-green-500 hover:bg-green-600 text-white text-lg h-12"
                  onClick={handleProcessReceipt}
                  disabled={!trackingNumber || isLoading}
                >
                  입고 처리
                </Button>
                </div>
            </CardContent>
          </Card>
        </div>

        {/* 입고완료 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-medium">입고완료</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* 날짜 네비게이션 및 엑셀 다운로드 버튼 */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <Button 
                    className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 text-lg"
                    onClick={() => navigateDate('next')}
                    disabled={currentDateIndex === availableDates.length - 1}
                  >
                    &lt;
                  </Button>
                  <span className="font-medium text-lg">{currentDate}</span>
                  <Button 
                    className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 text-lg"
                    onClick={() => navigateDate('prev')}
                    disabled={currentDateIndex === 0}
                  >
                    &gt;
                  </Button>
                </div>
                
                <Button 
                  className="bg-green-500 hover:bg-green-600 text-white text-lg"
                  onClick={handleDownloadExcel}
                  disabled={currentDateMainReturns.length === 0}
                >
                  엑셀 다운로드
                </Button>
              </div>

              {/* 선택된 날짜의 입고완료 목록 */}
              {currentDateMainReturns.length > 0 ? (
                <div className="overflow-x-auto max-w-full">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">고객명</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">주문번호</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">사입상품명</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">옵션</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">수량</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">반품사유</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">송장번호</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">바코드</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {currentDateMainReturns.map((item, index) => {
                        const isDefectiveItem = isDefective(item.returnReason);
                        return (
                          <tr 
                            key={`today-${index}`}
                            className={getCompletedRowStyle(item, currentDateMainReturns)}
                          >
                            <td className="px-4 py-3 text-base">
                              <div className="whitespace-nowrap overflow-hidden text-ellipsis">{item.customerName}</div>
                            </td>
                            <td className="px-4 py-3 text-base">
                              <div className="whitespace-nowrap overflow-hidden text-ellipsis">{item.orderNumber}</div>
                            </td>
                            <td className="px-4 py-3 text-base">
                              <div className="line-clamp-2 overflow-hidden">
                                {item.zigzagProductCode && item.zigzagProductCode !== '-' ? 
                                  item.zigzagProductCode : 
                                  (item.purchaseName || item.productName)}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-base">
                              <div className="whitespace-nowrap overflow-hidden text-ellipsis">{simplifyOptionName(item.optionName)}</div>
                            </td>
                            <td className="px-4 py-3 text-base">
                              <div className="whitespace-nowrap">{item.quantity}</div>
                            </td>
                            <td className="px-4 py-3 text-base">
                              {isDefectiveItem ? (
                                <button 
                                  onClick={() => handleReturnReasonClick(item)}
                                  className="text-left hover:underline cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis"
                                >
                                  {simplifyReturnReason(item.returnReason)}
                                  {item.detailReason && (
                                    <span className="ml-1 text-gray-600">({item.detailReason})</span>
                                  )}
                                </button>
                              ) : (
                                <div className="whitespace-nowrap overflow-hidden text-ellipsis">{simplifyReturnReason(item.returnReason)}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-base">
                              <div className="whitespace-nowrap overflow-hidden text-ellipsis">{item.returnTrackingNumber}</div>
                            </td>
                            <td className="px-4 py-3 text-base">
                              <div className="whitespace-nowrap overflow-hidden text-ellipsis">{item.barcode || '-'}</div>
                            </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-center py-2 text-gray-500 text-lg">선택한 날짜에 입고완료된 항목이 없습니다.</p>
              )}
              
              <div className="flex justify-end">
                <Button 
                  className="bg-blue-500 hover:bg-blue-600 text-white text-lg"
                  onClick={openCompletedModal}
                >
                  전체보기
                </Button>
                </div>
              </div>
          </CardContent>
        </Card>

        {message && (
          <div className="fixed bottom-4 right-4 bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded shadow-md">
            {message}
          </div>
        )}
        
        {/* 입고전 목록 모달 */}
        <dialog id="pendingModal" className="fixed inset-0 m-auto p-6 rounded-lg shadow-lg bg-white w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] overflow-hidden">
          <div className="flex flex-col h-full">
            <div className="modal-header flex justify-between items-center mb-6 pb-3 border-b">
              <h3 className="text-2xl font-medium">입고전 목록</h3>
              <div className="flex items-center gap-3">
                <Button 
                  className="bg-blue-500 hover:bg-blue-600 text-white text-lg py-2 px-4"
                  onClick={handleRefresh}
                  disabled={isLoading}
                >
                  {isLoading ? '로딩 중...' : '새로고침'}
                </Button>
                {selectedItems.length > 0 && (
                  <>
                    <Button 
                      className="bg-green-500 hover:bg-green-600 text-white text-lg py-2 px-4"
                      onClick={handleProcessSelected}
                      disabled={isLoading}
                    >
                      선택 입고 처리 ({selectedItems.length})
                    </Button>
                    <Button 
                      className="bg-red-500 hover:bg-red-600 text-white text-lg py-2 px-4"
                      onClick={handleDeleteSelected}
                      disabled={isLoading}
                    >
                      선택 삭제 ({selectedItems.length})
                    </Button>
                  </>
                )}
                  <button
                  onClick={closePendingModal}
                  className="text-gray-500 hover:text-gray-700 text-2xl"
                  >
                  ✕
                  </button>
              </div>
            </div>
            <div className="modal-body flex-1 overflow-auto">
              {returnState.pendingReturns.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 w-[3%]">
                      <input
                        type="checkbox"
                            checked={selectAll}
                        onChange={handleSelectAll}
                            className="w-5 h-5"
                      />
                    </th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">고객명</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">주문번호</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">상품명</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">옵션</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">수량</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">송장번호</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">반품사유</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">바코드</th>
                  </tr>
                </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {returnState.pendingReturns.map((item, index) => (
                        <tr 
                          key={index}
                          className={getRowStyle(item, index, returnState.pendingReturns)}
                        >
                          <td className="px-4 py-3">
                            <input 
                              type="checkbox" 
                              checked={selectedItems.includes(index)}
                              onChange={() => handleCheckboxChange(index)}
                              className="w-5 h-5"
                            />
                          </td>
                          <td className="px-4 py-3 text-base">
                            <div className="whitespace-nowrap overflow-hidden text-ellipsis">{item.customerName}</div>
                          </td>
                          <td className="px-4 py-3 text-base">
                            <div className="whitespace-nowrap overflow-hidden text-ellipsis">{item.orderNumber}</div>
                          </td>
                          <td className="px-4 py-3 text-base">
                            <div className="line-clamp-2 overflow-hidden">
                              {item.zigzagProductCode && item.zigzagProductCode !== '-' ? 
                                item.zigzagProductCode : 
                                (item.purchaseName || item.productName)}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-base">
                            <div className="whitespace-nowrap overflow-hidden text-ellipsis">{simplifyOptionName(item.optionName)}</div>
                          </td>
                          <td className="px-4 py-3 text-base text-center">
                            <div>{item.quantity}</div>
                          </td>
                          <td className="px-4 py-3 text-base">
                            <div className="whitespace-nowrap overflow-hidden text-ellipsis">{item.returnTrackingNumber}</div>
                          </td>
                          <td className="px-4 py-3 text-base">
                            <div className="whitespace-nowrap overflow-hidden text-ellipsis">{simplifyReturnReason(item.returnReason)}</div>
                          </td>
                          <td className="px-4 py-3 text-base">
                            <div className="whitespace-nowrap overflow-hidden text-ellipsis">{item.barcode || '-'}</div>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
              ) : (
                <div className="text-center py-10">
                  <p className="text-gray-500 text-lg">입고전 항목이 없습니다.</p>
            </div>
              )}
          </div>
      </div>
        </dialog>
        
        {/* 입고완료 모달 */}
        <dialog id="completedModal" className="fixed inset-0 m-auto p-6 rounded-lg shadow-lg bg-white w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] overflow-hidden">
          <div className="flex flex-col h-full">
            <div className="modal-header flex justify-between items-center mb-6 pb-3 border-b">
              <div className="flex items-center gap-4">
                <h3 className="text-2xl font-medium">입고완료 목록</h3>
                <div className="flex items-center gap-3">
                  <Button 
                    className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 text-lg"
                    onClick={() => navigateDate('next')}
                    disabled={currentDateIndex === availableDates.length - 1}
                  >
                    &lt;
                  </Button>
                  <span className="font-medium text-lg">{currentDate}</span>
                  <Button 
                    className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 text-lg"
                    onClick={() => navigateDate('prev')}
                    disabled={currentDateIndex === 0}
                  >
                    &gt;
                  </Button>
        </div>
              </div>
              <div className="flex items-center gap-3">
                <Button 
                  className="bg-green-500 hover:bg-green-600 text-white text-lg"
                  onClick={handleDownloadExcel}
                  disabled={currentDateMainReturns.length === 0}
                >
                  엑셀 다운로드
                </Button>
                  <button
                  className="text-lg py-2 px-4 bg-gray-200 hover:bg-gray-300 rounded"
                  onClick={closeCompletedModal}
                >
                  닫기
                  </button>
                </div>
              </div>
            <div className="modal-body flex-1 overflow-auto">
              {currentDateMainReturns.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">고객명</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">상품명</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">옵션</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">수량</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">송장번호</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">반품사유</th>
                        <th className="px-4 py-3 text-left text-base font-medium text-gray-700">바코드</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {currentDateMainReturns.map((item, index) => {
                        const isDefectiveItem = isDefective(item.returnReason);
                        return (
                          <tr 
                            key={`completed-${index}`}
                            className={getCompletedRowStyle(item, currentDateMainReturns)}
                          >
                            <td className="px-4 py-3 text-base">
                              <div className="whitespace-nowrap overflow-hidden text-ellipsis">{item.customerName}</div>
                            </td>
                            <td className="px-4 py-3 text-base">
                              <div className="line-clamp-2 overflow-hidden">
                                {item.zigzagProductCode && item.zigzagProductCode !== '-' ? 
                                  item.zigzagProductCode : 
                                  (item.purchaseName || item.productName)}
            </div>
                            </td>
                            <td className="px-4 py-3 text-base">
                              <div className="whitespace-nowrap overflow-hidden text-ellipsis">{simplifyOptionName(item.optionName)}</div>
                            </td>
                            <td className="px-4 py-3 text-base text-center">
                              <div>{item.quantity}</div>
                            </td>
                            <td className="px-4 py-3 text-base">
                              <div className="whitespace-nowrap overflow-hidden text-ellipsis">{item.returnTrackingNumber}</div>
                            </td>
                            <td className="px-4 py-3 text-base">
                              {isDefectiveItem ? (
                    <button
                                  onClick={() => handleReturnReasonClick(item)}
                                  className="text-left hover:underline cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis"
                                >
                                  {simplifyReturnReason(item.returnReason)}
                                  {item.detailReason && (
                                    <span className="ml-1 text-gray-600">({item.detailReason})</span>
                                  )}
                    </button>
                              ) : (
                                <div className="whitespace-nowrap overflow-hidden text-ellipsis">{simplifyReturnReason(item.returnReason)}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-base">
                              <div className="whitespace-nowrap overflow-hidden text-ellipsis">{item.barcode || '-'}</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-10">
                  <p className="text-gray-500 text-lg">해당 날짜에 입고완료된 항목이 없습니다.</p>
              </div>
            )}
            </div>
          </div>
        </dialog>

        {/* 상품 데이터 모달 */}
        <dialog id="productModal" className="fixed inset-0 m-auto p-6 rounded-lg shadow-lg bg-white w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] overflow-auto">
          <div className="flex flex-col h-full">
            <div className="modal-header flex justify-between items-center mb-6 pb-3 border-b">
              <h3 className="text-2xl font-medium">상품 데이터 ({returnState.products.length}개)</h3>
              <div className="flex items-center gap-3">
                <Button 
                  className="bg-red-500 hover:bg-red-600 text-white text-lg py-2 px-4"
                  onClick={handleDeleteAllProducts}
                  disabled={isLoading || returnState.products.length === 0}
                >
                  전체 삭제
                </Button>
                    <button
                onClick={() => {
                  const modal = document.getElementById('productModal') as HTMLDialogElement;
                  if (modal) modal.close();
                }}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ✕
                    </button>
                  </div>
            </div>
            <div className="modal-body flex-1 overflow-auto">
              {returnState.products.length > 0 ? (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-4 text-left text-base font-medium text-gray-500 uppercase tracking-wider">상품명</th>
                      <th className="px-3 py-4 text-left text-base font-medium text-gray-500 uppercase tracking-wider">사입상품명</th>
                      <th className="px-3 py-4 text-left text-base font-medium text-gray-500 uppercase tracking-wider">옵션명</th>
                      <th className="px-3 py-4 text-left text-base font-medium text-gray-500 uppercase tracking-wider">바코드</th>
                      </tr>
                    </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {returnState.products.map((product, index) => (
                      <tr key={index}>
                        <td className="px-3 py-3 whitespace-nowrap text-base">
                          <div className="line-clamp-2 overflow-hidden">{product.productName}</div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-base">
                          <div className="whitespace-nowrap overflow-hidden text-ellipsis">{product.purchaseName}</div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-base">
                          <div className="whitespace-nowrap overflow-hidden text-ellipsis">{product.optionName}</div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-base">
                          <div className="whitespace-nowrap overflow-hidden text-ellipsis">{product.barcode}</div>
                        </td>
                      </tr>
                      ))}
                    </tbody>
                  </table>
              ) : (
                <p className="text-center py-4 text-gray-500 text-lg">상품 데이터가 없습니다.</p>
              )}
            </div>
          </div>
        </dialog>

        {/* 상세 반품사유 모달 */}
        <dialog id="detailReasonModal" className="fixed inset-0 m-auto p-6 rounded-lg shadow-lg bg-white w-[500px] max-w-[95vw] overflow-auto">
          <div className="flex flex-col">
            <div className="modal-header flex justify-between items-center mb-4 pb-2 border-b">
              <h3 className="text-xl font-medium">상세 반품사유 입력</h3>
                <button
                onClick={() => {
                  const modal = document.getElementById('detailReasonModal') as HTMLDialogElement;
                  if (modal) modal.close();
                  setSelectedReturnItem(null);
                  setDetailReason('');
                }}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ✕
                </button>
              </div>
            <div className="modal-body">
              {selectedReturnItem && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">상품명</p>
                    <p className="font-medium">{selectedReturnItem.productName}</p>
            </div>
                  <div>
                    <p className="text-sm text-gray-500">옵션명</p>
                    <p className="font-medium">{selectedReturnItem.optionName}</p>
        </div>
                  <div>
                    <p className="text-sm text-gray-500">반품사유</p>
                    <p className="font-medium text-red-600">{selectedReturnItem.returnReason}</p>
      </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      상세 사유
                    </label>
            <textarea
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={4}
              value={detailReason}
              onChange={(e) => setDetailReason(e.target.value)}
                      placeholder="상세 반품사유를 입력하세요"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      className="bg-blue-500 hover:bg-blue-600 text-white"
                      onClick={saveDetailReason}
                      disabled={!detailReason}
                    >
                      저장
                    </Button>
          </div>
        </div>
      )}
            </div>
          </div>
        </dialog>
      </div>
    </main>
  );
}
