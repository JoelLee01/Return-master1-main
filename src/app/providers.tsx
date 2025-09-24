'use client';

import { ReactNode } from 'react';
import { ReturnProvider } from '@/hooks/useReturnState';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ReturnProvider>
      {children}
    </ReturnProvider>
  );
} 