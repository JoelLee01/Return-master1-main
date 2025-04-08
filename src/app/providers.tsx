'use client';

import { ReactNode } from 'react';
import { ReturnStateProvider } from '@/hooks/useReturnState';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ReturnStateProvider>
      {children}
    </ReturnStateProvider>
  );
} 