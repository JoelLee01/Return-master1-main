import { ReturnItem, SmartStoreProductInfo, ProductInfo } from '@/types/returns';

// 새로운 3단계 매칭 시퀀스: 스마트스토어 → 상품코드 → 셀메이트 → 옵션명
export function matchProductWithSmartStoreCode(
  returnItem: ReturnItem, 
  smartStoreProducts: SmartStoreProductInfo[],
  cellmateProducts: ProductInfo[] = []
): ReturnItem {
  // 이미 바코드가 있으면 그대로 반환
  if (returnItem.barcode && returnItem.barcode !== '-') {
    console.log(`이미 매칭된 상품 (바코드: ${returnItem.barcode})`);
    return returnItem;
  }
  
  console.log(`\n[새로운 3단계 매칭 시작] 상품명: "${returnItem.productName}", 옵션명: "${returnItem.optionName}"`);
  console.log(`[스마트스토어 매칭 대상] 총 ${smartStoreProducts.length}개 상품 중에서 매칭 시도`);
  
  // 1단계: 스마트스토어 상품목록에서 동일한 상품을 찾는다 (상품명 기반)
  console.log(`🔍 1단계: 스마트스토어에서 상품명 "${returnItem.productName}" 매칭 시도...`);
  
  let smartStoreMatch: SmartStoreProductInfo | null = null;
  
  // 1-1: 정확한 상품명 매칭
  const exactNameMatch = smartStoreProducts.find(product => 
    product.productName.toLowerCase().trim() === returnItem.productName.toLowerCase().trim()
  );
  
  if (exactNameMatch) {
    smartStoreMatch = exactNameMatch;
    console.log(`✅ 스마트스토어 정확 매칭: "${exactNameMatch.productName}"`);
  } else {
    // 1-2: 유사도 매칭
    let bestMatch: { product: SmartStoreProductInfo, similarity: number } | null = null;
    const returnProductName = returnItem.productName.toLowerCase().trim();
    
    for (const product of smartStoreProducts) {
      const productName = product.productName.toLowerCase().trim();
      const similarity = calculateStringSimilarity(returnProductName, productName);
      
      if (similarity > 0.7 && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = { product, similarity };
        console.log(`📌 스마트스토어 유사도 매칭 (유사도: ${similarity.toFixed(2)}): "${returnProductName}" ↔ "${productName}"`);
      }
    }
    
    if (bestMatch) {
      smartStoreMatch = bestMatch.product;
      console.log(`✅ 스마트스토어 유사도 매칭 성공: "${bestMatch.product.productName}" (유사도: ${bestMatch.similarity.toFixed(2)})`);
    }
  }
  
  if (!smartStoreMatch) {
    console.log(`❌ 1단계 실패: 스마트스토어에서 상품을 찾을 수 없음`);
    return returnItem;
  }
  
  // 2단계: 해당 상품의 상품코드를 가지고, 셀메이트 상품목록에서 동일한 상품을 찾는다
  console.log(`🔍 2단계: 상품코드 "${smartStoreMatch.productCode}"로 셀메이트 상품목록에서 매칭 시도...`);
  
  if (cellmateProducts.length === 0) {
    console.log(`⚠️ 셀메이트 상품목록이 없어서 스마트스토어 데이터만 사용`);
    return {
      ...returnItem,
      barcode: smartStoreMatch.barcode || '',
      purchaseName: smartStoreMatch.productName,
      zigzagProductCode: returnItem.zigzagProductCode,
      customProductCode: smartStoreMatch.productCode,
      matchSimilarity: 1,
      matchType: '스마트스토어 단독 매칭',
      matchedProductName: smartStoreMatch.productName,
      matchedProductOption: smartStoreMatch.optionName
    };
  }
  
  // 셀메이트 상품목록에서 상품코드로 매칭
  const cellmateMatches = cellmateProducts.filter(product => 
    product.customProductCode === smartStoreMatch!.productCode ||
    product.zigzagProductCode === smartStoreMatch!.productCode
  );
  
  if (cellmateMatches.length === 0) {
    console.log(`❌ 2단계 실패: 셀메이트 상품목록에서 상품코드 "${smartStoreMatch.productCode}"를 찾을 수 없음`);
    // 스마트스토어 데이터만으로 반환
    return {
      ...returnItem,
      barcode: smartStoreMatch.barcode || '',
      purchaseName: smartStoreMatch.productName,
      zigzagProductCode: returnItem.zigzagProductCode,
      customProductCode: smartStoreMatch.productCode,
      matchSimilarity: 0.8,
      matchType: '스마트스토어 단독 매칭 (셀메이트 없음)',
      matchedProductName: smartStoreMatch.productName,
      matchedProductOption: smartStoreMatch.optionName
    };
  }
  
  console.log(`✅ 2단계 성공: 셀메이트에서 ${cellmateMatches.length}개 상품 발견`);
  
  // 3단계: 동일한 상품명을 찾은 후, 동일한 옵션명을 찾아, 사입상품명과 바코드번호를 표시한다
  console.log(`🔍 3단계: 옵션명 "${returnItem.optionName}"으로 최종 매칭 시도...`);
  
  let finalMatch: ProductInfo | null = null;
  
  // 3-1: 옵션명이 정확히 일치하는 상품 찾기 (최우선)
  if (returnItem.optionName && returnItem.optionName.trim() !== '') {
    const exactOptionMatch = cellmateMatches.find(product => 
      product.optionName && 
      product.optionName.toLowerCase().trim() === returnItem.optionName.toLowerCase().trim()
    );
    
    if (exactOptionMatch) {
      finalMatch = exactOptionMatch;
      console.log(`✅ 3단계 성공: 옵션명 정확 매칭 "${exactOptionMatch.optionName}"`);
    } else {
      // 3-2: 옵션명 부분 매칭 (정확 매칭이 없을 때만)
      const partialOptionMatch = cellmateMatches.find(product => 
        product.optionName && 
        (product.optionName.toLowerCase().includes(returnItem.optionName.toLowerCase()) ||
         returnItem.optionName.toLowerCase().includes(product.optionName.toLowerCase()))
      );
      
      if (partialOptionMatch) {
        finalMatch = partialOptionMatch;
        console.log(`✅ 3단계 성공: 옵션명 부분 매칭 "${partialOptionMatch.optionName}"`);
      }
    }
  }
  
  // 3-3: 옵션명 매칭이 실패하면 유사도 기반 선택
  if (!finalMatch) {
    console.log(`⚠️ 3단계: 옵션명 매칭 실패, 유사도 기반 선택 시도`);
    
    let bestSimilarityMatch: ProductInfo | null = null;
    let highestSimilarity = 0;
    
    for (const product of cellmateMatches) {
      if (product.optionName && returnItem.optionName) {
        const similarity = calculateStringSimilarity(
          returnItem.optionName.toLowerCase().trim(),
          product.optionName.toLowerCase().trim()
        );
        if (similarity > highestSimilarity) {
          highestSimilarity = similarity;
          bestSimilarityMatch = product;
        }
      }
    }
    
    if (bestSimilarityMatch && highestSimilarity > 0.3) {
      finalMatch = bestSimilarityMatch;
      console.log(`✅ 3단계: 옵션명 유사도 매칭 성공 "${bestSimilarityMatch.optionName}" (유사도: ${highestSimilarity.toFixed(2)})`);
    } else {
      finalMatch = cellmateMatches[0];
      console.log(`⚠️ 3단계: 옵션명 유사도 매칭도 실패, 첫 번째 상품 사용 "${finalMatch.productName}"`);
    }
  }
  
  // 3-4: 최종 바코드 검증 - 옵션명이 정확히 일치하는지 확인
  if (returnItem.optionName && finalMatch.optionName) {
    const isOptionValid = returnItem.optionName.toLowerCase().trim() === finalMatch.optionName.toLowerCase().trim();
    
    if (!isOptionValid) {
      console.log(`⚠️ 스마트스토어 매칭: 옵션명 불일치 "${returnItem.optionName}" ≠ "${finalMatch.optionName}"`);
      // 옵션명이 정확히 일치하는 다른 상품이 있는지 재검색
      const exactOptionMatch = cellmateMatches.find(product => 
        product.optionName && 
        product.optionName.toLowerCase().trim() === returnItem.optionName.toLowerCase().trim()
      );
      
      if (exactOptionMatch) {
        finalMatch = exactOptionMatch;
        console.log(`✅ 스마트스토어 재매칭 성공: 정확한 옵션명 매칭 "${exactOptionMatch.optionName}"`);
      }
    }
  }
  
  console.log(`🎯 최종 매칭 완료: "${finalMatch.productName}" - "${finalMatch.optionName}" (바코드: ${finalMatch.barcode})`);
  
  return {
    ...returnItem,
    barcode: finalMatch.barcode || '',
    purchaseName: finalMatch.purchaseName || finalMatch.productName,
    zigzagProductCode: finalMatch.zigzagProductCode || '',
    customProductCode: smartStoreMatch.productCode,
    matchSimilarity: 1,
    matchType: '3단계 매칭 (스마트스토어→셀메이트→옵션)',
    matchedProductName: finalMatch.productName,
    matchedProductOption: finalMatch.optionName
  };
}

// 문자열 유사도 계산 함수 (Levenshtein 거리 기반)
function calculateStringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  // 길이 차이가 너무 크면 낮은 유사도 반환
  const maxLenDiff = Math.max(str1.length, str2.length) * 0.4;
  if (Math.abs(str1.length - str2.length) > maxLenDiff) {
    return 0.2;
  }
  
  const len1 = str1.length;
  const len2 = str2.length;
  const maxLen = Math.max(len1, len2);
  
  if (maxLen === 0) return 1.0;
  
  // 편집 거리 계산을 위한 배열
  const dp: number[][] = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
  
  // 초기값 설정
  for (let i = 0; i <= len1; i++) dp[i][0] = i;
  for (let j = 0; j <= len2; j++) dp[0][j] = j;
  
  // 동적 프로그래밍으로 편집 거리 계산
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // 삭제
        dp[i][j - 1] + 1,      // 삽입
        dp[i - 1][j - 1] + cost // 대체
      );
    }
  }
  
  // 유사도 = 1 - (편집 거리 / 최대 길이)
  return 1 - dp[len1][len2] / maxLen;
}
