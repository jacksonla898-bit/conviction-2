import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { SkeletonCard, ErrorState } from './ui.jsx';

/**
 * Owner-only gate for the analysis log (History and Track Record). The passcode is checked on the
 * server against LOG_PASSCODE; a correct passcode sets an HttpOnly session cookie the browser cannot read.
 * children: (onLock) => ReactNode, rendered only for the owner.
 */
export default function LogGate({ title, children }) {
  const [state, setState] = useState({ status: 'checking', owner: false, configured: true, error: null });
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    const res = await api.logSession();
    if (res.ok) setState({ status: 'done', owner: Boolean(res.data.owner), configured: res.data.configured !== false, error: null });
    else setState({ status: 'done', owner: false, configured: true, error: res.error });
  }, []);
  useEffect(() => { check(); }, [check]);

  const login = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await api.logLogin(passcode);
    setBusy(false);
    setPasscode('');
    if (res.ok && res.data.owner) setState({ status: 'done', owner: true, configured: true, error: null });
    else setState((s) => ({ ...s, owner: false, error: res.error || 'Wrong passcode.' }));
  };
  const lock = async () => {
    await api.logLogout();
    setState({ status: 'done', owner: false, configured: true, error: null });
  };

  if (state.status === 'checking') return <SkeletonCard lines={2} />;
  if (state.owner) return children(lock);
  return (
    <section className="card p-5 md:p-6 max-w-lg" id="log-gate">
      <h2 className="font-semibold">{title} is private</h2>
      <p className="text-sm text-ink-2 mt-1">The analysis log is readable only by the site owner. Enter the owner passcode to view it. Anyone can still run analyses; each completed run is saved to the log.</p>
      {!state.configured && <div className="mt-3"><ErrorState title="Not configured" text="LOG_PASSCODE is not set on the server, so the log cannot be opened." /></div>}
      <form className="mt-4 flex flex-col sm:flex-row gap-2" onSubmit={login}>
        <label className="flex-1"><span className="sr-only">Owner passcode</span><input className="input" type="password" autoComplete="current-password" placeholder="Owner passcode" value={passcode} onChange={(e) => setPasscode(e.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={busy || !passcode}>{busy ? 'Checking…' : 'Unlock'}</button>
      </form>
      {state.error && <p className="mt-2 text-xs text-bad" role="alert">{state.error}</p>}
      <p className="mt-3 text-[11px] text-muted">The session lasts 7 days on this browser. Lock it again from the page.</p>
    </section>
  );
}
