import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthGate } from '../features/auth';
import { ConfirmModalProvider } from '../ui/confirm';
import { AppErrorBoundary } from '../ui/ErrorBoundary';
import { Toast } from '../ui/toast';
import { AppShell } from './AppShell';
import { PwaUpdatePrompt } from './pwa/PwaUpdatePrompt';
import { createQueryClient } from './queryClient';
import { TextSizeProvider } from './TextSizeProvider';

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TextSizeProvider>
          <ConfirmModalProvider>
            <AuthGate>
              <AppShell />
            </AuthGate>
            <Toast />
            <PwaUpdatePrompt />
          </ConfirmModalProvider>
        </TextSizeProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
