"use client"

import React, { useState, useRef, ChangeEvent } from 'react';
import { Button } from "@/components/ui/button";

interface FileUploadProps {
  accept?: string;
  onChange: (file: File | null) => void;
  label?: string;
}

export function FileUpload({ accept = ".xlsx,.xls,.csv", onChange, label = "파일 선택" }: FileUploadProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      setFileName(file.name);
      onChange(file);
    } else {
      setFileName(null);
      onChange(null);
    }
  };

  const handleButtonClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept={accept}
        className="hidden"
      />
      <Button 
        type="button" 
        onClick={handleButtonClick}
        className="bg-blue-500 hover:bg-blue-600 text-white"
      >
        {label}
      </Button>
      {fileName && (
        <div className="text-sm text-gray-600 mt-1">
          선택된 파일: {fileName}
        </div>
      )}
    </div>
  );
} 