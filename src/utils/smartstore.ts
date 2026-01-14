import { ReturnItem, SmartStoreProductInfo, ProductInfo } from '@/types/returns';

// 색상 추출 헬퍼 함수
function extractColorFromOption(optionText: string): string | null {
  const colors = [
    '블랙', '화이트', '화이트', '그레이', '그레이', '네이비', '네이비', '베이지', '베이지',
    '브라운', '브라운', '레드', '레드', '핑크', '핑크', '옐로우', '옐로우', '그린', '그린',
    '블루', '블루', '퍼플', '퍼플', '오렌지', '오렌지', '골드', '골드', '실버', '실버',
    '아이보리', '아이보리', '크림', '크림', '차콜', '차콜', '카키', '카키', '민트', '민트',
    '로즈', '로즈', '라벤더', '라벤더', '코랄', '코랄', '터콰이즈', '터콰이즈', '버건디', '버건디',
    '마린', '마린', '올리브', '올리브', '샌드', '샌드', '타우프', '타우프', '인디고', '인디고'
  ];
  
  const lowerText = optionText.toLowerCase();
  for (const color of colors) {
    if (lowerText.includes(color.toLowerCase())) {
      return color;
    }
  }
  return null;
}

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
  
  // 3단계: 옵션명 매칭 - 점수 기반 시스템
  if (returnItem.optionName && returnItem.optionName.trim() !== '') {
    console.log(`🔍 3단계: 옵션명 매칭 시작 "${returnItem.optionName}" (후보 ${cellmateMatches.length}개)`);
    
    const returnOptionName = returnItem.optionName.toLowerCase().trim();
    
    // 모든 후보에 대해 매칭 점수 계산
    const scoredCandidates = cellmateMatches.map(product => {
      if (!product.optionName) {
        return { product, score: 0, reason: '옵션명 없음' };
      }

      const productOptionName = product.optionName.toLowerCase().trim();
      let score = 0;
      let reason = '';

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
          const similarity = calculateStringSimilarity(returnOptionName, productOptionName);
          score = Math.round(similarity * 50); // 0-50점
          reason = `유사도 ${similarity.toFixed(2)}`;
        }
      }

      return { product, score, reason };
    });

    // 점수 순으로 정렬 (높은 점수 우선)
    scoredCandidates.sort((a, b) => b.score - a.score);

    console.log(`📊 스마트스토어 옵션명 매칭 결과:`);
    scoredCandidates.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.product.optionName} (${item.reason}, 점수: ${item.score})`);
    });

    // 최고 점수 상품 선택 (점수가 30 이상인 경우만)
    const bestMatch = scoredCandidates[0];
    if (bestMatch.score >= 30) {
      finalMatch = bestMatch.product;
      console.log(`✅ 3단계 성공: 옵션명 매칭 "${bestMatch.product.optionName}" (${bestMatch.reason}, 점수: ${bestMatch.score})`);
    } else {
      console.log(`❌ 3단계 실패: 최고 점수 ${bestMatch.score} (임계값 30 미달)`);
    }
  }
  
  // 옵션명 매칭이 실패한 경우 첫 번째 상품 사용
  if (!finalMatch) {
    finalMatch = cellmateMatches[0];
    console.log(`⚠️ 3단계: 옵션명 매칭 실패, 첫 번째 상품 사용 "${finalMatch.productName}"`);
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

/**
 * 바코드 더블체크 함수
 * 바코드로 찾은 상품의 옵션명(바코드번호 아래 텍스트)과 원래 옵션명(옵션명 열)을 비교
 * 일치하지 않으면 옵션명 열과 정확히 일치하는 옵션을 가진 상품을 찾아 바코드 교체
 */
export function doubleCheckBarcodeWithOption(
  returnItem: ReturnItem,
  products: ProductInfo[]
): ReturnItem {
  // 바코드가 없으면 그대로 반환
  if (!returnItem.barcode || returnItem.barcode === '-') {
    return returnItem;
  }
  
  // 옵션명이 없으면 그대로 반환
  if (!returnItem.optionName || returnItem.optionName.trim() === '') {
    return returnItem;
  }
  
  // 바코드로 상품 찾기 (바코드번호 아래 텍스트에 표시될 상품)
  const matchedProduct = products.find(product => 
    product.barcode === returnItem.barcode && product.barcode !== '-'
  );
  
  if (!matchedProduct) {
    console.log(`⚠️ 더블체크: 바코드 "${returnItem.barcode}"로 상품을 찾을 수 없음`);
    return returnItem;
  }
  
  // 옵션명 비교: 옵션명 열(returnItem.optionName) vs 바코드 아래 텍스트(matchedProduct.optionName)
  const returnOptionName = returnItem.optionName.trim();
  const productOptionName = (matchedProduct.optionName || '').trim();
  
  if (!productOptionName) {
    console.log(`⚠️ 더블체크: 상품에 옵션명이 없음`);
    return returnItem;
  }
  
  // 정규화된 옵션명 (비교용)
  const normalizedReturnOption = returnOptionName.toLowerCase().replace(/\s+/g, '');
  const normalizedProductOption = productOptionName.toLowerCase().replace(/\s+/g, '');
  
  // 1. 정확 일치 확인
  if (normalizedReturnOption === normalizedProductOption) {
    console.log(`✅ 더블체크 통과: 옵션명 정확 일치 "${returnOptionName}" = "${productOptionName}"`);
    return returnItem;
  }
  
  // 2. 유사도 계산 (0-100점)
  const similarity = calculateStringSimilarity(normalizedReturnOption, normalizedProductOption);
  const similarityScore = Math.round(similarity * 100);
  
  console.log(`🔍 더블체크: 옵션명 비교 "${returnOptionName}" vs "${productOptionName}" (유사도: ${similarityScore}점)`);
  
  // 90점 이상이면 통과
  if (similarityScore >= 90) {
    console.log(`✅ 더블체크 통과: 유사도 ${similarityScore}점`);
    return returnItem;
  }
  
  // 90점 미만이면 재매칭 시도
  console.log(`❌ 더블체크 실패: 유사도 ${similarityScore}점 (90점 미만) - 옵션명에 맞는 바코드 재매칭 시도`);
  
  // 옵션명이 일치하는 상품 찾기 (상품명은 고려하되 옵션명 우선)
  const normalizedReturnProductName = returnItem.productName.toLowerCase().trim();
  
  // 모든 상품 중에서 옵션명이 일치하는 상품 찾기
  const optionMatches = products.filter(product => {
    if (!product.barcode || product.barcode === '-' || product.barcode === returnItem.barcode) {
      return false; // 바코드가 없거나 현재 바코드와 동일하면 제외
    }
    
    // 옵션명이 있는지 확인
    if (!product.optionName || product.optionName.trim() === '') {
      return false;
    }
    
    return true;
  });
  
  if (optionMatches.length === 0) {
    console.log(`⚠️ 더블체크 재매칭 실패: 옵션명이 있는 다른 상품을 찾을 수 없음`);
    return returnItem;
  }
  
  // 옵션명 매칭 점수 계산 (상품명 유사도도 고려)
  const scoredMatches = optionMatches.map(product => {
    const productOption = (product.optionName || '').trim();
    const normalizedProductOption = productOption.toLowerCase().replace(/\s+/g, '');
    
    // 상품명 유사도 계산
    const productNameSimilarity = calculateStringSimilarity(
      normalizedReturnProductName,
      (product.productName || '').toLowerCase().trim()
    );
    
    let score = 0;
    let matchType = '';
    
    // 1. 옵션명 정확 일치 (최고 점수)
    if (normalizedReturnOption === normalizedProductOption) {
      // 상품명도 일치하면 최고 점수, 아니면 약간 감점
      if (productNameSimilarity >= 0.8) {
        score = 100;
        matchType = '옵션명 정확 일치 + 상품명 일치';
      } else {
        score = 95; // 옵션명은 정확하지만 상품명이 다름
        matchType = '옵션명 정확 일치 (상품명 다름)';
      }
    }
    // 2. 옵션명 부분 일치 (포함 관계)
    else if (normalizedReturnOption.includes(normalizedProductOption) || 
             normalizedProductOption.includes(normalizedReturnOption)) {
      score = 85;
      matchType = '옵션명 부분 일치';
    }
    // 3. 옵션명 유사도 계산
    else {
      const optionSimilarity = calculateStringSimilarity(normalizedReturnOption, normalizedProductOption);
      score = Math.round(optionSimilarity * 100);
      matchType = `옵션명 유사도 ${score}점`;
    }
    
    // 상품명 유사도가 낮으면 약간 감점 (옵션명이 정확히 일치하는 경우는 이미 처리됨)
    if (normalizedReturnOption !== normalizedProductOption && productNameSimilarity < 0.5) {
      score = Math.max(0, score - 10);
    }
    
    return { 
      product, 
      score, 
      matchType, 
      optionName: productOption,
      productNameSimilarity 
    };
  });
  
  // 점수 순으로 정렬 (높은 점수 우선)
  scoredMatches.sort((a, b) => b.score - a.score);
  
  console.log(`📊 더블체크 재매칭 후보 (${scoredMatches.length}개):`);
  scoredMatches.slice(0, 5).forEach((match, index) => {
    console.log(`  ${index + 1}. "${match.optionName}" (${match.matchType}, 점수: ${match.score})`);
  });
  
  // 최고 점수 상품 선택 (90점 이상인 경우만)
  const bestMatch = scoredMatches[0];
  if (bestMatch && bestMatch.score >= 90 && bestMatch.product.barcode && bestMatch.product.barcode !== '-') {
    console.log(`✅ 더블체크 재매칭 성공: "${bestMatch.optionName}" (${bestMatch.matchType}, 점수: ${bestMatch.score}) - 바코드 변경: ${returnItem.barcode} → ${bestMatch.product.barcode}`);
    
    return {
      ...returnItem,
      barcode: bestMatch.product.barcode,
      purchaseName: bestMatch.product.purchaseName || bestMatch.product.productName,
      zigzagProductCode: bestMatch.product.zigzagProductCode || returnItem.zigzagProductCode,
      customProductCode: bestMatch.product.customProductCode || returnItem.customProductCode,
      matchType: returnItem.matchType ? `${returnItem.matchType} (더블체크 재매칭)` : '더블체크 재매칭',
      matchedProductName: bestMatch.product.productName,
      matchedProductOption: bestMatch.product.optionName
    };
  }
  
  // 재매칭 실패 시 원래 아이템 반환 (경고만 표시)
  console.log(`⚠️ 더블체크 재매칭 실패: 옵션명 "${returnOptionName}"에 맞는 상품을 찾을 수 없음 (최고 점수: ${bestMatch?.score || 0}점)`);
  return returnItem;
}
