import mammoth from 'mammoth';
import pdf from 'pdf-parse/lib/pdf-parse.js';

export async function extractCvText(file) {
  if (!file) return '';
  const name = file.originalname.toLowerCase();
  try {
    if (name.endsWith('.pdf')) return (await pdf(file.buffer)).text.slice(0, 12000);
    if (name.endsWith('.docx')) return (await mammoth.extractRawText({ buffer: file.buffer })).value.slice(0, 12000);
  } catch {
    throw new Error('Could not read the CV file. Try a different PDF or DOCX.');
  }
  throw new Error('CV must be a PDF or DOCX file.');
}
