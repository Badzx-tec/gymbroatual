import React from 'react';

function FallbackUI({ error, onReset, fullscreen }) {
  const handleBack = () => {
    if (onReset) onReset();
    else window.history.back();
  };

  return (
    <div
      className={
        fullscreen
          ? 'flex min-h-screen items-center justify-center bg-[var(--surface-canvas)] px-4'
          : 'flex min-h-[320px] items-center justify-center px-4'
      }
    >
      <div className="max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Erro inesperado</p>
        <h1 className="mt-3 text-xl font-semibold text-[var(--text-primary)]">Algo deu errado</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Esta parte da pagina encontrou um problema. Tente voltar ou recarregar.
        </p>
        {error?.message ? (
          <p className="mt-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-soft)] px-3 py-2 font-mono text-xs text-[var(--text-muted)]">
            {error.message}
          </p>
        ) : null}
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-soft)] px-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft-hover)]"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 text-xs font-bold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--brand-primary-hover)]"
          >
            Recarregar
          </button>
        </div>
      </div>
    </div>
  );
}

function reportError(error, info) {
  try {
    const token = sessionStorage.getItem('gymbro_token') || localStorage.getItem('gymbro_token') || '';
    fetch('/api/ops/client-errors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message: error?.message || String(error),
        stack: error?.stack || '',
        component_stack: info?.componentStack || '',
        url: window.location.href,
        ua: navigator.userAgent,
      }),
    }).catch(() => {});
  } catch {
    // silence — we're already in an error handler
  }
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError(error, info);
  }

  handleReset() {
    this.setState({ error: null });
    if (this.props.onReset) this.props.onReset();
  }

  render() {
    if (this.state.error) {
      return (
        <FallbackUI
          error={this.state.error}
          onReset={this.handleReset}
          fullscreen={this.props.fullscreen}
        />
      );
    }
    return this.props.children;
  }
}
