// Wharton-mode export: rasterize the report element and paginate it into an A4 PDF.
// Uses html2canvas + jsPDF (rendering libraries only; no math lives here).
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export async function exportElementToPdf(element, filename) {
  const canvas = await html2canvas(element, {
    backgroundColor: '#0d0d0d',
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
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    const img = slice.toDataURL('image/jpeg', 0.92);
    if (page > 0) pdf.addPage();
    pdf.setFillColor(13, 13, 13);
    pdf.rect(0, 0, pageW, pageH, 'F');
    pdf.addImage(img, 'JPEG', margin, margin, imgW, h * scale);
    y += h;
    page += 1;
  }
  pdf.save(filename);
}
