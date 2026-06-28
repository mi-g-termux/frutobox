import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// ErrorBoundary — catches any render-time crash and shows a message
// instead of a completely blank white screen
interface EBProps { children: React.ReactNode; }
interface EBState { hasError: boolean; error: string; }
class ErrorBoundary extends React.Component<EBProps, EBState> {
  state: EBState = { hasError: false, error: '' };
  constructor(props: EBProps) {
    super(props);
  }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, error: err?.message || String(err) };
  }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught crash:', err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#f8fafc', fontFamily: 'Inter, sans-serif', padding: '2rem'
        }}>
          <div style={{
            background: '#fff', border: '1px solid #fecaca', borderRadius: '16px',
            padding: '2.5rem', maxWidth: '520px', width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.07)'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚠️</div>
            <h1 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem' }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1.25rem', lineHeight: 1.6 }}>
              The app crashed during startup. Check the browser console for full details.
            </p>
            <pre style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
              padding: '0.75rem 1rem', fontSize: '0.7rem', color: '#b91c1c',
              overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
            }}>
              {this.state.error}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: '1.25rem', background: '#10b981', color: '#fff',
                border: 'none', borderRadius: '8px', padding: '0.6rem 1.5rem',
                fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.05em'
              }}
            >
              RELOAD PAGE
            </button>
          </div>
        </div>
      );
    }
    const p = this as unknown as { props: EBProps }; return p.props.children as React.ReactElement;
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
