import { ReturnItem, SmartStoreProductInfo } from '@/types/returns';

// 스마트스토어 상품코드 기반 매칭 함수
export function matchProductWithSmartStoreCode(
  returnItem: ReturnItem, 
  smartStoreProducts: SmartStoreProductInfo[]
): ReturnItem {
  // 이미 바코드가 있으면 그대로 반환
  if (returnItem.barcode && returnItem.barcode !== '-') {
    console.log(`이미 매칭된 상품 (바코드: ${returnItem.barcode})`);
    return returnItem;
  }
  
  console.log(`\n[스마트스토어 매칭 시작] 상품명: "${returnItem.productName}", 자체상품코드: "${returnItem.zigzagProductCode}"`);
  console.log(`[스마트스토어 매칭 대상] 총 ${smartStoreProducts.length}개 상품 중에서 매칭 시도`);
  
  // 1단계: 자체상품코드로 스마트스토어 상품코드 매칭 시도
  if (returnItem.zigzagProductCode && returnItem.zigzagProductCode.trim() !== '' && returnItem.zigzagProductCode !== '-') {
    console.log(`🔍 자체상품코드 "${returnItem.zigzagProductCode}"로 스마트스토어 상품코드 매칭 시도...`);
    
    // 자체상품코드와 스마트스토어 상품코드가 정확히 일치하는 상품 찾기
    const exactCodeMatch = smartStoreProducts.find(product => 
      product.productCode === returnItem.zigzagProductCode
    );
    
    if (exactCodeMatch) {
      console.log(`✅ 스마트스토어 상품코드 정확 매칭 성공: ${exactCodeMatch.productCode}`);
      return {
        ...returnItem,
        barcode: exactCodeMatch.barcode || '',
        purchaseName: exactCodeMatch.productName,
        zigzagProductCode: returnItem.zigzagProductCode,
        customProductCode: exactCodeMatch.productCode,
        matchSimilarity: 1,
        matchType: '스마트스토어 상품코드 정확 매칭',
        matchedProductName: exactCodeMatch.productName,
        matchedProductOption: exactCodeMatch.optionName
      };
    }
    
    // 2단계: 자체상품코드가 스마트스토어 상품코드에 포함되거나 포함되는 경우
    const partialCodeMatch = smartStoreProducts.find(product => 
      product.productCode.includes(returnItem.zigzagProductCode) ||
      returnItem.zigzagProductCode.includes(product.productCode)
    );
    
    if (partialCodeMatch) {
      console.log(`✅ 스마트스토어 상품코드 부분 매칭 성공: ${partialCodeMatch.productCode}`);
      return {
        ...returnItem,
        barcode: partialCodeMatch.barcode || '',
        purchaseName: partialCodeMatch.productName,
        zigzagProductCode: returnItem.zigzagProductCode,
        customProductCode: partialCodeMatch.productCode,
        matchSimilarity: 0.9,
        matchType: '스마트스토어 상품코드 부분 매칭',
        matchedProductName: partialCodeMatch.productName,
        matchedProductOption: partialCodeMatch.optionName
      };
    }
    
    console.log(`❌ 스마트스토어 상품코드 매칭 실패: ${returnItem.zigzagProductCode}`);
  }
  
  // 3단계: 상품명으로 스마트스토어 상품 매칭 시도
  if (returnItem.productName) {
    console.log(`🔍 상품명 "${returnItem.productName}"로 스마트스토어 상품 매칭 시도...`);
    
    // 상품명이 정확히 일치하는 스마트스토어 상품 찾기
    const exactNameMatch = smartStoreProducts.find(product => 
      product.productName.toLowerCase().trim() === returnItem.productName.toLowerCase().trim()
    );
    
    if (exactNameMatch) {
      console.log(`✅ 스마트스토어 상품명 정확 매칭 성공: ${exactNameMatch.productName}`);
      return {
        ...returnItem,
        barcode: exactNameMatch.barcode || '',
        purchaseName: exactNameMatch.productName,
        zigzagProductCode: returnItem.zigzagProductCode,
        customProductCode: exactNameMatch.productCode,
        matchSimilarity: 1,
        matchType: '스마트스토어 상품명 정확 매칭',
        matchedProductName: exactNameMatch.productName,
        matchedProductOption: exactNameMatch.optionName
      };
    }
    
    // 4단계: 상품명 유사도 매칭
    let bestMatch: { product: SmartStoreProductInfo, similarity: number } | null = null;
    const returnProductName = returnItem.productName.toLowerCase().trim();
    
    for (const product of smartStoreProducts) {
      const productName = product.productName.toLowerCase().trim();
      const similarity = calculateStringSimilarity(returnProductName, productName);
      
      if (similarity > 0.7 && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = { product, similarity };
        console.log(`📌 스마트스토어 상품명 유사도 매칭 (유사도: ${similarity.toFixed(2)}): "${returnProductName}" ↔ "${productName}"`);
      }
    }
    
    if (bestMatch) {
      console.log(`✅ 스마트스토어 상품명 유사도 매칭 성공 (유사도: ${bestMatch.similarity.toFixed(2)}): ${bestMatch.product.productName}`);
      return {
        ...returnItem,
        barcode: bestMatch.product.barcode || '',
        purchaseName: bestMatch.product.productName,
        zigzagProductCode: returnItem.zigzagProductCode,
        customProductCode: bestMatch.product.productCode,
        matchSimilarity: bestMatch.similarity,
        matchType: '스마트스토어 상품명 유사도 매칭',
        matchedProductName: bestMatch.product.productName,
        matchedProductOption: bestMatch.product.optionName
      };
    }
  }
  
  // 매칭 실패
  console.log(`❌ 스마트스토어 매칭 실패: ${returnItem.productName}`);
  return returnItem;
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
