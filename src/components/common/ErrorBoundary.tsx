import React, { Component, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  t: (key: string) => string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState;
  props: ErrorBoundaryProps;
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorDetails = "";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        errorDetails = JSON.stringify(parsed, null, 2);
      } catch {
        errorDetails = this.state.error?.message || "Unknown error";
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-8 border border-red-100">
            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mb-6">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-4">{this.props.t('somethingWentWrong')}</h1>
            <div className="bg-slate-900 rounded-2xl p-6 mb-8 overflow-auto max-h-96">
              <pre className="text-red-400 text-xs font-mono whitespace-pre-wrap">
                {errorDetails}
              </pre>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all"
            >
              {this.props.t('reloadApp')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
