import React, { useState } from 'react';

/** "Save portfolio" with an inline name prompt. onSave(name) returns the saved entry. */
export default function SavePortfolioButton({ defaultName, isUpdate, onSave, disabled }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName || '');
  const [saved, setSaved] = useState(null);
  const submit = (e) => {
    e.preventDefault();
    const entry = onSave(name.trim() || defaultName || 'Untitled portfolio');
    setSaved(entry ? entry.name : null);
    setOpen(false);
    setTimeout(() => setSaved(null), 2500);
  };
  if (open) {
    return (
      <form className="inline-flex items-center gap-2 flex-wrap" onSubmit={submit}>
        <input className="input w-48" autoFocus placeholder="Portfolio name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <button type="submit" className="btn btn-sm btn-primary">{isUpdate ? 'Save changes' : 'Save'}</button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </form>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button className="btn" onClick={() => { setName(defaultName || ''); setOpen(true); }} disabled={disabled}>{isUpdate ? 'Save changes' : 'Save portfolio'}</button>
      {saved && <span className="text-xs text-muted">Saved "{saved}" in this browser</span>}
    </span>
  );
}
