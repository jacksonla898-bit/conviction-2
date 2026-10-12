// Minimal Markdown -> React renderer for the AI explanation (headings, bullets, bold, paragraphs).
import React from 'react';

function inline(text, key) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong> : <React.Fragment key={`${key}-${i}`}>{p}</React.Fragment>));
}

export function renderMarkdown(md) {
  const lines = String(md || '').split(/\r?\n/);
  const out = [];
  let list = [];
  let para = [];
  const flushList = () => {
    if (list.length) {
      out.push(<ul key={`ul-${out.length}`}>{list.map((l, i) => <li key={i}>{inline(l, `li-${out.length}-${i}`)}</li>)}</ul>);
      list = [];
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push(<p key={`p-${out.length}`}>{inline(para.join(' '), `p-${out.length}`)}</p>);
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      flushPara();
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      flushPara();
      out.push(<h2 key={`h-${out.length}`}>{inline(h[2], `h-${out.length}`)}</h2>);
      continue;
    }
    const b = line.match(/^[-*•]\s+(.*)$/) || line.match(/^\d+[.)]\s+(.*)$/);
    if (b) {
      flushPara();
      list.push(b[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushList();
  flushPara();
  return out;
}
