import { TriangleAlert } from 'lucide-react';
import { Component, type ReactNode } from 'react';

/** Keeps a crashing page from blanking the whole app; resets when `resetKey` (the route) changes. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string; title: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="glass max-w-md p-6 text-center">
          <TriangleAlert className="mx-auto mb-2 text-amber-300" size={32} />
          <h2 className="font-display text-lg font-bold text-white">{this.props.title}</h2>
          <p className="mt-2 break-words font-mono text-xs text-slate-400">{this.state.error.message}</p>
          <button className="btn-primary mt-4" onClick={() => this.setState({ error: null })}>
            ↻
          </button>
        </div>
      </div>
    );
  }
}
