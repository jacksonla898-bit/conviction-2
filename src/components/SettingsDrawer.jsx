import React, { useEffect } from 'react';
import SettingsPanel from './SettingsPanel.jsx';

const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

/** The single Settings menu (gear icon): appearance plus every model and rate setting. */
export default function SettingsDrawer({ settings, onChange, onClose, rfInfo }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer p-5 space-y-6" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Settings</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close settings">Close</button>
        </header>
        <section>
          <div className="text-xs text-ink-2 mb-1">Appearance</div>
          <div className="seg" role="tablist" aria-label="Theme">
            {THEMES.map(([v, l]) => <button key={v} role="tab" aria-selected={(settings.theme || 'system') === v} onClick={() => onChange({ ...settings, theme: v })}>{l}</button>)}
          </div>
        </section>
        <SettingsPanel settings={settings} onChange={onChange} rfInfo={rfInfo} embedded />
      </aside>
    </>
  );
}
