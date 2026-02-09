# 2209 매칭 시퀀스 (현재 동작)

진입점: **`matchProductByZigzagCode`** (page.tsx)  
반품 건에 **자체상품코드(customProductCode)** 가 있으면 아래 순서로 동작합니다.

---

## 1. 자체상품코드 우선 매칭 (현재 2209 오매칭 원인)

**위치:** `page.tsx` 2460~2485행

1. `returnItem.customProductCode` 가 있으면 (예: `"2209"`) **우선** 이 경로로 진입.
2. **`productList.find(...)`** 로 **자체상품코드가 일치하는 상품 1개만** 선택.
   - 동일 코드를 가진 **첫 번째** 상품만 사용 (예: 항상 `B-10207420060 (2209 코듀ver크림아이보리,3, 기본)`).
   - 같은 2209라도 블랙/베이지/브라운/그레이 등 **옵션별로 여러 행**이 있어도 **옵션을 보지 않고** 첫 번째만 선택.
3. 그 상품의 `barcode`, `purchaseName`, `optionName` 으로 반품 건을 채움.
4. **`doubleCheckBarcodeWithOption(matched, productList)`** 호출 → 옵션 불일치 시 재매칭 시도.

**결과:**  
색상/사이즈가 다른데도 모두 “첫 번째 2209 옵션(크림아이보리,3,기본)”으로 매칭되는 현상이 발생.

---

## 2. 더블체크 (옵션명 검증·재매칭)

**위치:** `smartstore.ts` – `doubleCheckBarcodeWithOption`

1. 이미 매칭된 **바코드**로 상품 1건 조회.
2. **반품 옵션명** vs **그 상품 옵션명** 비교:
   - `normalizedReturnOption` = 반품 옵션 (소문자, 공백 제거)
   - `normalizedProductOption` = 상품 옵션 (동일 정규화)
3. **정확 일치** → 그대로 통과.
4. **유사도 90점 이상** → 통과.
5. **90점 미만** → 재매칭 시도:
   - 상품명 유사도 0.8 이상인 상품들 먼저 후보로 사용.
   - 후보들에 대해 **옵션명**으로 점수 계산 (정확 일치 100점, 부분 일치 85점, 유사도 등).
   - **90점 이상** 또는 **옵션명 정확 일치**인 상품이 있으면 그 상품의 바코드로 교체.

**2209에서의 한계:**  
- 1단계에서 이미 “첫 번째 2209” 한 건으로 고정된 상태로 들어옴.  
- 반품 옵션: `코듀ver,블랙,사이즈,1숏` / 사입 옵션 형식: `2209 코듀ver크림아이보리,3,기본` 등 **표기 형식이 다르면** 유사도가 90 미만이 될 수 있음.  
- 상품명이 “2209”만 있는 반품 vs “2209 코듀ver…” 같은 풀네임인 사입 상품 간 **상품명 유사도 필터**가 기대대로 동작하지 않을 수 있음.  
→ 더블체크가 재매칭에 실패하면 **1단계에서 잡힌 “첫 번째 2209”가 그대로 유지**됨.

---

## 3. 자체상품코드 매칭 실패 시: 스마트스토어 3단계 매칭

**위치:** `page.tsx` 2487~2495행, `smartstore.ts` – `matchProductWithSmartStoreCode`

- 자체상품코드로 **한 건도 못 찾은 경우**에만 실행.
- 2209는 자체상품코드가 있으므로 보통 **이 경로는 타지 않음**.

**스마트스토어 3단계 요약:**  
1. 스마트스토어 상품목록에서 **상품명**으로 1:1 매칭 (정확 → 유사도).  
2. 그 상품의 **상품코드**로 셀메이트(사입) 상품 목록에서 **동일 코드 상품들** 조회.  
3. **옵션명**으로 점수 매칭 (정확 100, 부분 80, 색상 60, 유사도 0~50) → **30점 이상**인 최고 점수 상품 선택.  
4. 옵션 매칭 실패 시 **첫 번째 상품** 사용 (여기서도 “첫 번째” 폴백 존재).

---

## 4. 그 외 지그재그/상품명 매칭 (자체상품코드·스마트스토어 이후)

**위치:** `page.tsx` 2496행 이후

- 계절 키워드만 다른 동일 상품, 연채원 607 특별 매칭, 지그재그 상품코드·상품명 유사도 등.
- 2209는 **1단계(자체상품코드 find)** 에서 이미 매칭되므로, 이 단계들은 **실행되지 않음**.

---

## 요약: 2209가 잘못 매칭되는 이유

| 단계 | 동작 | 2209에서의 문제 |
|------|------|------------------|
| 1 | 자체상품코드로 **find** → **1건만** 선택 | 옵션(색상/기장/사이즈)을 보지 않고 **항상 첫 번째 2209**만 선택 |
| 2 | 더블체크에서 옵션명으로 재매칭 시도 | 반품 옵션 형식과 사입 옵션 형식이 달라 유사도 90 미만·재매칭 실패 가능 |
| 결과 | | 모든 2209 건이 동일한 한 옵션(예: 크림아이보리,3,기본)으로 고정 |

**적용한 수정 (되돌리기 가능):**  
자체상품코드가 일치하는 **전체 후보**를 `filter`로 구한 뒤, 옵션명으로 점수 매칭(정확 100, 부분 80, 색상 60, 유사도 0~50)으로 한 건을 고르고, 그 다음에만 `doubleCheckBarcodeWithOption`을 호출하도록 변경함.

---

## 되돌리기 (revert)

옵션별 매칭이 마음에 들지 않으면 `page.tsx`에서 아래처럼 되돌리면 됩니다.

1. **검색:** `[2209 옵션별 매칭] revert`
2. 해당 **if (returnItem.customProductCode ...)** 블록 전체를 아래 코드로 **교체**:

```tsx
    // 자체상품코드가 있는 경우 우선 매칭 시도 (스마트스토어보다 우선)
    if (returnItem.customProductCode && returnItem.customProductCode !== '-') {
      console.log(`🔍 자체상품코드 우선 매칭 시도: "${returnItem.customProductCode}"`);
      
      const exactCustomMatch = productList.find(product => 
        product.customProductCode && 
        product.customProductCode.toLowerCase().trim() === returnItem.customProductCode!.toLowerCase().trim()
      );
      
      if (exactCustomMatch) {
        console.log(`✅ 자체상품코드 우선 매칭: ${returnItem.customProductCode} → ${exactCustomMatch.productName} [${exactCustomMatch.optionName}]`);
        const matched = {
          ...returnItem,
          barcode: exactCustomMatch.barcode,
          purchaseName: exactCustomMatch.purchaseName || exactCustomMatch.productName,
          zigzagProductCode: exactCustomMatch.zigzagProductCode || '',
          customProductCode: exactCustomMatch.customProductCode || '',
          matchType: "custom_code_priority",
          matchSimilarity: 1.0,
          matchedProductName: exactCustomMatch.productName,
          matchedProductOption: exactCustomMatch.optionName
        };
        return doubleCheckBarcodeWithOption(matched, productList);
      }
    }
```
