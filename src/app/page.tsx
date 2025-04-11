'use client';

import React, { useState, useEffect, useRef, useReducer, useCallback, useMemo } from 'react';
import { getFirestore, collection, getDocs, Firestore, DocumentData, FirebaseError } from 'firebase/firestore';
import { initializeApp } from 'firebase/app';
import { ReturnItem, ProductInfo, ReturnState } from '@/types/returns';
import { saveReturns, fetchReturns } from '@/firebase/firestore';
import { parseReturnExcel, parseProductExcel, matchProductWithZigzagCode, downloadCompletedReturnsExcel, matchProductData } from '@/utils/excel';
import MatchProductModal from '@/components/MatchProductModal';
import TrackingNumberModal from '@/components/TrackingNumberModal';
import ReturnReasonModal from '@/components/ReturnReasonModal';

// Firebase 구성
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || ''
};

// 파이어베이스 초기화
let app;
let db;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (error) {
  console.error('Firebase 초기화 실패:', error);
}

// 안전한 콘솔 로그 (오류 방지용)
const safeConsoleError = (...args: any[]) => {
  try {
    console.error(...args);
  } catch (e) {
    // 오류 무시
  }
};

// 문자열 유사도 계산 (Levenshtein 알고리즘 활용)
function stringSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) {
    return 1.0;
  }
  
  // Levenshtein 거리 계산
  const costs = new Array(shorter.length + 1);
  for (let i = 0; i <= shorter.length; i++) {
    costs[i] = i;
  }
  
  let currentValue, insertionCost, deletionCost, substitutionCost;
  
  for (let i = 1; i <= longer.length; i++) {
    let previousValue = i;
    
    for (let j = 1; j <= shorter.length; j++) {
      if (longer[i - 1] === shorter[j - 1]) {
        currentValue = costs[j - 1];
      } else {
        insertionCost = costs[j] + 1;
        deletionCost = costs[j - 1] + 1;
        substitutionCost = previousValue + 1;
        currentValue = Math.min(insertionCost, deletionCost, substitutionCost);
      }
      
      costs[j - 1] = previousValue;
      previousValue = currentValue;
    }
    
    costs[shorter.length] = previousValue;
  }
  
  return (longer.length - costs[shorter.length]) / longer.length;
}

// 키워드 기반 유사도 체크 - 단어 분리 후 개별 비교
function validateKeywordSimilarity(s1: string, s2: string): boolean {
  if (!s1 || !s2) return false;
  
  // 문자열 정규화
  s1 = s1.toLowerCase().trim();
  s2 = s2.toLowerCase().trim();
  
  // 빠른 체크: 하나가 다른 하나를 포함하는 경우
  if (s1.includes(s2) || s2.includes(s1)) {
    return true;
  }
  
  // 단어 단위로 분리
  const words1 = s1.split(/\s+/).filter(w => w.length > 1);
  const words2 = s2.split(/\s+/).filter(w => w.length > 1);
  
  if (words1.length === 0 || words2.length === 0) {
    // 단어 분리가 안되면 전체 문자열 유사도 체크
    return stringSimilarity(s1, s2) > 0.7;
  }
  
  // 각 단어 쌍에 대해 유사도 체크
  for (const word1 of words1) {
    for (const word2 of words2) {
      // 중요 단어(길이가 2 이상)에 대해 체크
      if (word1.length > 1 && word2.length > 1) {
        // 한 단어가 다른 단어를 포함하는 경우
        if (word1.includes(word2) || word2.includes(word1)) {
          return true;
        }
        
        // 단어 유사도 체크
        if (stringSimilarity(word1, word2) > 0.8) {
          return true;
        }
      }
    }
  }
  
  return false;
}

// completedReturns 날짜별 그룹화 및 표시
const Home = () => {
  // ... existing code ...
}