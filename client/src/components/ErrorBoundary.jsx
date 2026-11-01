import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Resenha Error Boundary captured error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    localStorage.removeItem('resenha_token');
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-well text-fg-strong p-6 select-none">
          <div className="max-w-md w-full bg-chat border border-panel rounded-xl p-6 shadow-2xl text-center space-y-4">
            <div className="w-16 h-16 mx-auto bg-danger-hover/20 text-danger-hover rounded-2xl flex items-center justify-center">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-fg-strong">Ops! Algo deu errado</h2>
            <p className="text-xs text-fg-muted leading-relaxed">
              Ocorreu uma falha inesperada na interface. Clique abaixo para recarregar ou reiniciar a sessão.
            </p>
            {this.state.error?.message && (
              <div className="p-3 bg-well rounded text-left font-mono text-[11px] text-danger overflow-auto max-h-28 border border-side">
                {this.state.error.message}
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                onClick={this.handleReload}
                className="sticker-btn flex-1 bg-accent hover:bg-accent-hover text-on-accent text-xs font-semibold py-2.5 rounded-lg transition"
              >
                Recarregar
              </button>
              <button
                onClick={this.handleReset}
                className="bg-side hover:bg-hover text-fg hover:text-fg-strong text-xs font-semibold py-2.5 px-4 rounded-lg transition border border-well"
              >
                Resetar Sessão
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
