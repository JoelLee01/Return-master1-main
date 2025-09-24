'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseSmartStoreExcel } from '@/utils/excel';
import { SmartStoreProductInfo } from '@/types/returns';

interface SmartStoreUploadProps {
  onUpload: (products: SmartStoreProductInfo[]) => void;
  onError: (error: string) => void;
  isLoading?: boolean;
}

export default function SmartStoreUpload({ onUpload, onError, isLoading = false }: SmartStoreUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [productCount, setProductCount] = useState(0);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setUploadStatus('idle');
      setProductCount(0);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      onError('파일을 선택해주세요.');
      return;
    }

    setUploadStatus('uploading');
    
    try {
      const products = await parseSmartStoreExcel(selectedFile);
      
      if (products.length === 0) {
        onError('파일에서 유효한 스마트스토어 상품 데이터를 찾을 수 없습니다.');
        setUploadStatus('error');
        return;
      }

      setProductCount(products.length);
      setUploadStatus('success');
      onUpload(products);
      
      // 파일 입력 초기화
      setSelectedFile(null);
      const fileInput = document.getElementById('smartstore-file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      
    } catch (error) {
      console.error('스마트스토어 파일 업로드 오류:', error);
      onError(error instanceof Error ? error.message : '파일 업로드 중 오류가 발생했습니다.');
      setUploadStatus('error');
    }
  };

  const getStatusColor = () => {
    switch (uploadStatus) {
      case 'uploading': return 'text-blue-600';
      case 'success': return 'text-green-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusText = () => {
    switch (uploadStatus) {
      case 'uploading': return '업로드 중...';
      case 'success': return `${productCount}개 상품 업로드 완료`;
      case 'error': return '업로드 실패';
      default: return '파일을 선택해주세요';
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-medium flex items-center gap-2">
          <span className="text-blue-600">📱</span>
          스마트스토어 상품목록 업로드
        </CardTitle>
        <p className="text-sm text-gray-600">
          스마트스토어 상품코드를 기반으로 한 매칭 시스템을 위한 상품목록을 업로드하세요.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="smartstore-file-input" className="block text-sm font-medium text-gray-700">
            엑셀 파일 선택
          </label>
          <input
            id="smartstore-file-input"
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            disabled={isLoading}
          />
          <p className="text-xs text-gray-500">
            필수 컬럼: 상품코드, 상품명 | 선택 컬럼: 옵션명, 바코드, 카테고리, 가격, 재고
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div className={`text-sm font-medium ${getStatusColor()}`}>
            {getStatusText()}
          </div>
          
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || isLoading || uploadStatus === 'uploading'}
            className="bg-blue-500 hover:bg-blue-600 text-white"
          >
            {uploadStatus === 'uploading' ? '업로드 중...' : '업로드'}
          </Button>
        </div>

        {uploadStatus === 'success' && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-md">
            <div className="flex items-center gap-2">
              <span className="text-green-600">✅</span>
              <span className="text-sm text-green-800">
                {productCount}개의 스마트스토어 상품이 성공적으로 업로드되었습니다.
              </span>
            </div>
          </div>
        )}

        {uploadStatus === 'error' && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-center gap-2">
              <span className="text-red-600">❌</span>
              <span className="text-sm text-red-800">
                업로드 중 오류가 발생했습니다. 파일 형식을 확인해주세요.
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
