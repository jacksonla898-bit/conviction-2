// Wharton-mode export: rasterize the report element and paginate it into an A4 PDF.
// Uses html2canvas + jsPDF (rendering libraries only; no math lives here).
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export async function exportElementToPdf(element, filename) {
  const canvas = await html2canvas(element, {
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--page').trim() || '#ffffff',
    scale: Math.min(2, window.devicePixelRatio || 1.5),
    useCORS: true,
    logging: false,
    windowWidth: element.scrollWidth,
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const imgW = pageW - margin * 2;
  const scale = imgW / canvas.width;
  const sliceHeightPx = Math.floor((pageH - margin * 2) / scale);

  let y = 0;
  let page = 0;
  while (y < canvas.height) {
    const h = Math.min(sliceHeightPx, canvas.height - y);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = h;
    const ctx = slice.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--page').trim() || '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    const img = slice.toDataURL('image/jpeg', 0.92);
    if (page > 0) pdf.addPage();
    { const c = getComputedStyle(document.documentElement).getPropertyValue('--page').trim(); const m = c.match(/^#([0-9a-f]{6})$/i); if (m) pdf.setFillColor(parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)); else pdf.setFillColor(255, 255, 255); }
    pdf.rect(0, 0, pageW, pageH, 'F');
    pdf.addImage(img, 'JPEG', margin, margin, imgW, h * scale);
    y += h;
    page += 1;
  }
  pdf.save(filename);
}
