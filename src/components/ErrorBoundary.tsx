import { Component, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
};

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Terjadi kesalahan yang tidak diketahui.',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Application render error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12 text-center">
          <section
            role="alert"
            className="w-full max-w-lg rounded-2xl border border-rose-400/30 bg-slate-900 p-8 shadow-2xl"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-400/15 text-2xl text-rose-300">
              !
            </div>
            <h1 className="mt-5 text-xl font-semibold text-white">Aplikasi mengalami kendala</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Halaman tidak dapat dirender dengan benar. Muat ulang halaman untuk mencoba kembali.
            </p>
            <p className="mt-4 break-words rounded-lg bg-rose-400/10 px-3 py-2 text-left text-xs text-rose-200">
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-6 rounded-full bg-rose-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-200 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              Muat ulang aplikasi
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;