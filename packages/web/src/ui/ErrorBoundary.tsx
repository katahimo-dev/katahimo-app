import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './StatusViews';

/**
 * 描画中の例外を受け止めて、画面全体が真っ白にならないようにする。
 * - `AppErrorBoundary`: アプリ全体(最後の砦)。「再読み込み」でページを読み込み直す。
 * - `SectionErrorBoundary`: タブなど画面の一部。「もう一度読み込む」で、その部分だけ作り直し、
 *   失敗していたクエリも読み直す(QueryErrorResetBoundary)。
 */
interface ErrorBoundaryProps {
  fallback: (reset: () => void) => ReactNode;
  onReset?: () => void;
  children: ReactNode;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, { error: unknown }> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('画面の表示中にエラーが起きました', error, info.componentStack);
  }

  reset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  override render() {
    return this.state.error ? this.props.fallback(this.reset) : this.props.children;
  }
}

export const APP_ERROR_MESSAGE = '画面を表示できませんでした';
export const SECTION_ERROR_MESSAGE = 'この画面を表示できませんでした';

export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={() => (
        <div className="fixed inset-0 bg-gray-900 z-50 flex items-center justify-center p-4">
          <div role="alert" className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4">
            <ErrorState message={APP_ERROR_MESSAGE} />
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-12 py-3 bg-blue-600 text-white text-base font-bold rounded-xl"
            >
              再読み込み
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

export function SectionErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallback={(retry) => (
            <div role="alert">
              <ErrorState message={SECTION_ERROR_MESSAGE} />
              <button
                type="button"
                onClick={retry}
                className="w-full min-h-12 py-3 rounded-xl text-base font-bold bg-gray-200 text-gray-800"
              >
                もう一度読み込む
              </button>
            </div>
          )}
        >
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
