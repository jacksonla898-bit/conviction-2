import React, { useState } from 'react';
import { StandardReasoning, MathModeBadge } from '../Reasoning.jsx';
import { exportElementToPdf } from '../../lib/exportPdf.js';

/**
 * Reasoning section (step 3 of every results page). Content is unchanged from before:
 * the fixed-template "What this means" paragraphs, then the AI explanation (Standard) or the methodology templates (Wharton).
 */
export function ReasoningSection({ mode, summary, ai, wharton, pending }) {
  return (
    <div className="space-y-5" id="reasoning-section">
      {summary && summary.length > 0 && (
        <section className="card p-5 md:p-6" id="conclusion">
          <header className="flex flex-wrap items-center justify-between gap-2 mb-2"><h2 className="font-semibold">What this means</h2>{mode === 'wharton' && <MathModeBadge />}</header>
          <div className="space-y-2 text-sm text-ink-2 leading-relaxed">{summary.map((p, i) => <p key={i} className={i === 0 ? 'text-ink' : ''}>{p}</p>)}</div>
        </section>
      )}
      {mode === 'standard' && ai && <StandardReasoning state={ai.state} onGenerate={ai.onGenerate} canGenerate={ai.canGenerate} fallback={summary} />}
      {mode !== 'standard' && wharton}
      {pending && !summary?.length && <div className="card p-5 text-sm text-muted">Reasoning appears when the analysis completes.</div>}
    </div>
  );
}

/** "Export PDF" in the same position on every results page. Either a custom exporter or a capture of `targetRef`. */
export function ExportPdfButton({ targetRef, filename, onExport, disabled, title }) {
  const [state, setState] = useState({ status: 'idle', error: null, filename: null });
  const run = async () => {
    setState({ status: 'working', error: null, filename: null });
    try {
      if (onExport) {
        const out = await onExport();
        setState({ status: 'done', error: null, filename: out && out.filename ? out.filename : filename });
      } else {
        if (!targetRef || !targetRef.current) throw new Error('Nothing to export yet.');
        await exportElementToPdf(targetRef.current, filename);
        setState({ status: 'done', error: null, filename });
      }
    } catch (e) {
      setState({ status: 'error', error: e.message, filename: null });
    }
  };
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <button className="btn btn-primary" onClick={run} disabled={disabled || state.status === 'working'} title={title || 'Save this page as a PDF'}>{state.status === 'working' ? 'Exporting…' : 'Export PDF'}</button>
      {state.status === 'done' && <span className="text-xs text-muted">Saved {state.filename}</span>}
      {state.status === 'error' && <span className="text-xs text-bad">Export failed: {state.error}</span>}
    </span>
  );
}

export const pdfName = (prefix, mode) => `${prefix}_${new Date().toISOString().slice(0, 10)}_${mode === 'wharton' ? 'Wharton' : 'Standard'}.pdf`;
