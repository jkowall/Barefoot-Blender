import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }
            return (
                <div className="error-boundary" style={{
                    padding: '24px',
                    margin: '20px auto',
                    maxWidth: '800px',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    backgroundColor: '#fef2f2',
                    color: '#991b1b',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}>
                    <h3 style={{ marginTop: 0, fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h3>
                    <div style={{
                        fontFamily: 'monospace',
                        backgroundColor: 'rgba(255,255,255,0.7)',
                        padding: '12px',
                        borderRadius: '6px',
                        margin: '16px 0',
                        fontSize: '0.875rem',
                        border: '1px solid #fee2e2',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all'
                    }}>
                        {this.state.error?.message}
                    </div>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        style={{
                            padding: '8px 16px',
                            backgroundColor: '#dc2626',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            transition: 'background-color 0.2s'
                        }}
                    >
                        Try again
                    </button>
                    <div style={{ marginTop: '12px', fontSize: '0.75rem', opacity: 0.8 }}>
                        If this persists, please try clearing your browser data or resetting settings.
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
