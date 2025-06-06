import { NextRequest, NextResponse } from 'next/server';
import { fetchReturns, updateReturns } from '@/firebase/firestore';
import { ReturnItem, ReturnState, ProductInfo } from '@/types/returns';

// Edge 런타임 설정 추가 (25초 응답 시작 후 스트리밍 가능)
export const runtime = 'edge';

// 타임아웃 설정 (초 단위) - Vercel 무료 계정에서는 최대 10초이지만, Edge 함수는 더 길게 사용 가능
export const maxDuration = 300;

// 중복 제거 함수
function removeDuplicates<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  items.forEach(item => {
    const key = keyFn(item);
    seen.set(key, item);
  });
  return Array.from(seen.values());
}

// 반품 항목 중복 체크 함수 (완료된 항목과 비교)
function checkDuplicatesWithCompleted(newItems: ReturnItem[], completedItems: ReturnItem[]): ReturnItem[] {
  // 완료된 항목의 키 맵 생성
  const completedKeys = new Set<string>();
  
  completedItems.forEach(item => {
    // 고유 키 생성 (주문번호, 상품명, 옵션명, 수량, 반품사유 조합)
    const key = `${item.orderNumber}-${item.productName}-${item.optionName}-${item.quantity}-${item.returnReason}`;
    completedKeys.add(key);
    
    // 바코드가 있는 경우 바코드 기반 키도 추가
    if (item.barcode) {
      const barcodeKey = `barcode-${item.barcode}-${item.quantity}`;
      completedKeys.add(barcodeKey);
    }
    
    // 송장번호 기반 키도 추가
    if (item.returnTrackingNumber) {
      completedKeys.add(`tracking-${item.returnTrackingNumber}`);
    }
  });
  
  // 중복되지 않은 항목만 필터링
  return newItems.filter(item => {
    // 고유 키 생성
    const key = `${item.orderNumber}-${item.productName}-${item.optionName}-${item.quantity}-${item.returnReason}`;
    
    // 바코드 기반 키
    const barcodeKey = item.barcode ? `barcode-${item.barcode}-${item.quantity}` : '';
    
    // 송장번호 기반 키
    const trackingKey = item.returnTrackingNumber ? `tracking-${item.returnTrackingNumber}` : '';
    
    // 어떤 키도 완료된 항목에 없으면 중복되지 않은 것
    return !completedKeys.has(key) && 
           (!barcodeKey || !completedKeys.has(barcodeKey)) && 
           (!trackingKey || !completedKeys.has(trackingKey));
  });
}

// GET 요청 처리
export async function GET() {
  console.log('API GET 요청 시작');
  try {
    const data = await fetchReturns();
    if (!data) {
      console.error('API 오류: 데이터를 가져올 수 없습니다');
      return NextResponse.json({ error: '데이터를 가져올 수 없습니다.' }, { status: 500 });
    }
    console.log('API GET 요청 성공');
    return NextResponse.json(data);
  } catch (error) {
    console.error('API 일반 오류:', error);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// POST 요청 처리 - Edge 함수에 맞게 최적화
export async function POST(request: Request) {
  console.log('API POST 요청 시작');
  try {
    // 스트림 응답 설정 - Edge 함수의 장점 활용
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 초기 응답 전송 (스트리밍 시작)
          controller.enqueue(encoder.encode('{"status":"processing","message":"데이터 처리 시작..."}\n'));
          
          // 요청 데이터 파싱
          let requestData;
          try {
            requestData = await request.json();
          } catch (parseError) {
            controller.enqueue(encoder.encode('{"status":"error","message":"요청 데이터 파싱 오류"}\n'));
            controller.close();
            return;
          }
          
          const { type, data } = requestData;
          
          if (!type || !data) {
            controller.enqueue(encoder.encode('{"status":"error","message":"필수 데이터가 누락되었습니다."}\n'));
            controller.close();
            return;
          }
          
          const dataCount = Array.isArray(data) ? data.length : 0;
          console.log('API POST 요청 데이터 타입:', type, '데이터 개수:', dataCount);
          controller.enqueue(encoder.encode(`{"status":"processing","message":"${dataCount}개 항목 처리 중...","progress":0}\n`));
          
          // 더 작은 청크 사이즈로 설정 - 처리 속도 향상
          const chunkSize = 5; // 청크 크기를 더 작게 조정
          
          // 대용량 데이터 처리
          if (Array.isArray(data) && data.length > 0) {
            const chunks: any[][] = [];
            
            for (let i = 0; i < data.length; i += chunkSize) {
              chunks.push(data.slice(i, i + chunkSize));
            }
            
            const totalChunks = chunks.length;
            console.log(`${totalChunks}개 청크로 분할됨`);
            controller.enqueue(encoder.encode(`{"status":"processing","message":"${totalChunks}개 청크로 분할하여 처리 중...","progress":5}\n`));
            
            // 청크 처리 시작 시간
            const startTime = Date.now();
            
            // 순차적으로 청크 처리
            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i];
              const progress = Math.round(((i + 1) / chunks.length) * 100);
              
              // 처리 시간 확인 - 너무 오래 걸리면 중단
              const currentTime = Date.now();
              const elapsedSeconds = (currentTime - startTime) / 1000;
              
              // 15초 이상 걸렸을 경우 처리 중단 (Edge 함수 제한 고려)
              if (elapsedSeconds > 15 && i < chunks.length - 1) {
                console.log(`처리 시간 초과로 부분 처리 종료. ${i+1}/${chunks.length} 청크 완료`);
                controller.enqueue(encoder.encode(
                  `{"status":"warning","message":"일부 데이터만 처리됨 (${i+1}/${chunks.length} 청크). 나머지는 재시도 필요.","progress":${progress},"partialComplete":true,"processedCount":${(i+1) * chunkSize}}\n`
                ));
                break;
              }
              
              console.log(`청크 ${i+1}/${chunks.length} 처리 중 (${chunk.length}개 항목)`);
              controller.enqueue(encoder.encode(`{"status":"processing","message":"청크 ${i+1}/${chunks.length} 처리 중...","progress":${progress}}\n`));
              
              try {
                // 각 청크를 소비하고 DB에 저장
                await updateReturns(
                  type === 'returns' ? chunk as ReturnItem[] : [], 
                  type === 'products' ? chunk as ProductInfo[] : []
                );
                controller.enqueue(encoder.encode(`{"status":"processing","message":"청크 ${i+1}/${chunks.length} 처리 완료","progress":${progress}}\n`));
              } catch (chunkError) {
                console.error(`청크 ${i+1}/${chunks.length} 처리 오류:`, chunkError);
                controller.enqueue(encoder.encode(`{"status":"warning","message":"청크 ${i+1}/${chunks.length} 처리 중 오류 발생, 계속 진행 중...","progress":${progress}}\n`));
                
                // 심각한 오류인 경우 처리 중단
                if (i < chunks.length - 1 && (chunkError instanceof Error && chunkError.message.includes('permission-denied'))) {
                  controller.enqueue(encoder.encode(
                    `{"status":"error","message":"권한 오류로 처리 중단. ${i+1}/${chunks.length} 청크 처리됨.","progress":${progress}}\n`
                  ));
                  break;
                }
              }
              
              // 처리 대기 시간 (제한 시간에 맞게 조정)
              if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100)); // 대기 시간 짧게 조정
              }
            }
            
            controller.enqueue(encoder.encode(`{"status":"success","message":"데이터 처리가 완료되었습니다.","progress":100}\n`));
          } else {
            controller.enqueue(encoder.encode('{"status":"warning","message":"처리할 데이터가 없습니다.","progress":100}\n'));
          }
          
          controller.close();
        } catch (error) {
          console.error('API POST 스트리밍 처리 오류:', error);
          controller.enqueue(encoder.encode(`{"status":"error","message":"서버 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}"}\n`));
          controller.close();
        }
      }
    });
    
    // 스트림 응답 반환
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });
  } catch (error) {
    console.error('API POST 초기화 오류:', error);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
} 