// Generates the tear-sheet PDF in the browser (no serverless function): renders the print layout
// off-screen, rasterizes each US Letter page, and saves a two-page PDF.
//
// This module has no access to the AI: it receives a finished data object from reportData.js and
// only draws it. For Wharton-mode data it additionally refuses to produce a file if any AI section
// were present.
import { AI_SECTION_TITLE } from './reportData.js';

// Wait for the next paint. Animation frames do not fire in a background tab, so a timer is raced
// against the frame: the export must never hang because the user switched tabs.
const nextFrame = () => new Promise((resolve) => {
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      resolve();
    }
  };
  requestAnimationFrame(finish);
  setTimeout(finish, 80);
});

/** Shrink the narrative font until it fits its fixed-height box (keeps the report to two pages). */
function fitNarrative(host) {
  const box = host.querySelector('[data-ts-fit]');
  if (!box) return { fontSize: null, fits: true };
  let size = parseFloat(box.style.fontSize) || 9;
  const min = 6.2;
  let guard = 0;
  while (box.scrollHeight > box.clientHeight + 1 && size > min && guard < 60) {
    size -= 0.15;
    box.style.fontSize = `${size}px`;
    guard += 1;
  }
  return { fontSize: size, fits: box.scrollHeight <= box.clientHeight + 1 };
}

/** If page 1's content is taller than the space above the footer, scale it down uniformly to fit. */
function fitPageOne(host) {
  const page = host.querySelector('[data-ts-page="1"]');
  const main = page && page.querySelector('[data-ts-main]');
  const footer = page && page.querySelector('[data-ts-footer]');
  if (!main || !footer) return 1;
  const available = footer.offsetTop - main.offsetTop - 8;
  let k = 1;
  for (let i = 0; i < 5; i++) {
    const natural = main.scrollHeight; // layout height, unaffected by the transform
    if (natural * k <= available) break;
    k = Math.max(0.6, Math.min(k, available / natural) - 0.005);
    main.style.width = `${100 / k}%`; // lay out wider, then scale back to the page width
    main.style.transform = `scale(${k})`;
  }
  return k;
}

export async function generateTearSheet(data, { save = true } = {}) {
  const [{ default: html2canvas }, { jsPDF }, React, { createRoot }, { default: TearSheet }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
    import('react'),
    import('react-dom/client'),
    import('../components/report/TearSheet.jsx'),
  ]);

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-12000px;top:0;width:816px;background:#ffffff;color:#000000;pointer-events:none;';
  document.body.appendChild(host);
  // The CSS reset makes <img> block-level. The rasterizer measures text baselines with a tiny inline
  // image in the live document, so with the reset every line of text is drawn a few pixels low.
  // Restore inline images for the duration of the capture only (the app itself renders no <img>).
  const baselineFix = document.createElement('style');
  baselineFix.textContent = 'img { display: inline-block !important; }';
  document.head.appendChild(baselineFix);
  const root = createRoot(host);
  try {
    root.render(React.createElement(TearSheet, { data }));
    await nextFrame();
    await nextFrame();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const fit = fitNarrative(host);
    const pageOneScale = fitPageOne(host);
    await nextFrame();

    const text = host.innerText || '';
    if (data.mode === 'wharton') {
      // Hard rule: a Wharton report contains no AI-generated text.
      // (Compared case-insensitively: section headings are rendered in capitals.)
      if (data.containsAiText || data.narrative.kind !== 'methodology' || text.toLowerCase().includes(AI_SECTION_TITLE.toLowerCase())) {
        throw new Error('Refusing to export: a Wharton report must not contain AI-generated text.');
      }
    }

    const pages = [...host.querySelectorAll('[data-ts-page]')];
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
    pdf.setProperties({
      title: `Conviction 2.0 tear sheet: ${data.ticker} (${data.modeName})`,
      subject: data.mode === 'wharton' ? 'Template-generated analysis. No AI-generated text.' : 'Includes a section of AI-generated reasoning, labelled as such.',
      creator: 'Conviction 2.0',
      keywords: `${data.ticker}, ${data.modeName}, ${data.runDate}`,
    });
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const canvases = [];
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: 1200,
      });
      canvases.push(canvas);
      if (i > 0) pdf.addPage('letter', 'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, W, H);
    }
    if (save) pdf.save(data.filename);
    const result = { filename: data.filename, pages: pages.length, narrativeFontPx: fit.fontSize, narrativeFits: fit.fits, pageOneScale, text };
    // Development aid only: lets a test inspect the rendered pages.
    if (import.meta.env && import.meta.env.DEV) window.__tearSheetDebug = { ...result, images: canvases.map((c) => c.toDataURL('image/jpeg', 0.8)) };
    return result;
  } finally {
    baselineFix.remove();
    root.unmount();
    host.remove();
  }
}
