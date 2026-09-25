import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthGate } from '../features/auth';
import { ConfirmModalProvider } from '../ui/confirm';
import { Toast } from '../ui/toast';
import { AppShell } from './AppShell';
import { createQueryClient } from './queryClient';
import { TextSizeProvider } from './TextSizeProvider';

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <TextSizeProvider>
        <ConfirmModalProvider>
          <AuthGate>
            <AppShell />
          </AuthGate>
          <Toast />
        </ConfirmModalProvider>
      </TextSizeProvider>
    </QueryClientProvider>
  );
}
