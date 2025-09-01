'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUpload } from "@/components/file-upload";
import * as XLSX from 'xlsx';

export default function NewHome() {
  const [returnFile, setReturnFile] = useState<File | null>(null);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [productCount, setProductCount] = useState(0);
  const [returnAuthNumber, setReturnAuthNumber] = useState("");
  const [beforeReceiptCount, setBeforeReceiptCount] = useState(0);
  const [message, setMessage] = useState("");

  // 데이터 가져오기 함수
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/returns');
        if (response.ok) {
          const data = await response.json();
          setBeforeReceiptCount(data.pendingReturns?.length || 0);
          setProductCount(data.products?.length || 0);
        }
      } catch (error) {
        console.error('데이터 가져오기 실패:', error);
      }
    };

    fetchData();
  }, []);

  // 상품 데이터 확인 함수
  const handleProductDataCheck = () => {
    if (productFile) {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        if (!e.target || !e.target.result) return;
        
        try {
          const data = new Uint8Array(e.target.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          
          // 여기서 실제 데이터 처리 로직 구현
          setProductCount(Math.floor(Math.random() * 100) + 10);
          setMessage(`상품 데이터를 성공적으로 처리했습니다.`);
        } catch (error) {
          console.error('파일 처리 오류:', error);
          setMessage(`파일 처리 중 오류가 발생했습니다.`);
        }
      };
      
      reader.readAsArrayBuffer(productFile);
    }
  };

  // 입고 처리 함수
  const handleProcessReceipt = () => {
    if (returnAuthNumber) {
      // 실제로는 여기서 입고 처리 로직을 구현합니다
      setMessage(`입고 처리 완료: ${returnAuthNumber}`);
      setReturnAuthNumber("");
      setBeforeReceiptCount(prev => Math.max(0, prev - 1));
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

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-2xl font-medium mb-8">반품 관리 시스템</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        {/* 반품 엑셀 업로드 */}
        <FileUpload label="반품 엑셀 업로드" onChange={setReturnFile} />

        {/* 상품리스트 엑셀 업로드 */}
        <div>
          <FileUpload label="상품리스트 엑셀 업로드" onChange={setProductFile} />
          <Button
            className="bg-green-500 hover:bg-green-600 text-white mt-4"
            onClick={handleProductDataCheck}
            disabled={!productFile}
          >
            상품 데이터 확인 ({productCount}개)
          </Button>
        </div>
      </div>

      {/* 입고전 */}
      <Card className="mb-8">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">입고전 ({beforeReceiptCount})</CardTitle>
        </CardHeader>
        <CardContent>
          <Button 
            className="bg-blue-500 hover:bg-blue-600 text-white"
            onClick={openPendingModal}
          >
            목록 보기
          </Button>
        </CardContent>
      </Card>

      {/* 반품승강번호 입력 */}
      <Card className="mb-8">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">반품승강번호 입력</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="반품승강번호 입력"
              className="flex-1"
              value={returnAuthNumber}
              onChange={(e) => setReturnAuthNumber(e.target.value)}
            />
            <Button
              className="bg-green-500 hover:bg-green-600 text-white"
              onClick={handleProcessReceipt}
              disabled={!returnAuthNumber}
            >
              입고 처리
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 입고완료 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">입고완료</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end">
            <Button 
              className="bg-blue-500 hover:bg-blue-600 text-white"
              onClick={openCompletedModal}
            >
              전체보기
            </Button>
          </div>
        </CardContent>
      </Card>

      {message && (
        <div className="fixed bottom-4 right-4 bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded shadow-md">
          {message}
        </div>
      )}
    </div>
  );
} 