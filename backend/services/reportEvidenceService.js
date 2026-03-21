import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_EVIDENCE_DIR = path.resolve(__dirname, '..', 'uploads', 'reports');
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

class ReportEvidenceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ReportEvidenceError';
    this.status = status;
  }
}

const allowedMimeToExtension = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

const decodeDataUrlImage = (dataUrlValue) => {
  const raw = String(dataUrlValue || '').trim();
  if (!raw) {
    throw new ReportEvidenceError('Debes adjuntar una foto de evidencia.', 400);
  }

  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new ReportEvidenceError('La evidencia debe enviarse como imagen valida.', 400);
  }

  const mimeType = match[1].toLowerCase();
  const extension = allowedMimeToExtension[mimeType];
  if (!extension) {
    throw new ReportEvidenceError('Formato de imagen no soportado. Usa JPG, PNG o WEBP.', 400);
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) {
    throw new ReportEvidenceError('La imagen de evidencia esta vacia.', 400);
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ReportEvidenceError('La imagen supera el maximo permitido de 6MB.', 400);
  }

  return { buffer, extension };
};

const ensureEvidenceDirectory = async () => {
  await fs.mkdir(REPORT_EVIDENCE_DIR, { recursive: true });
};

const saveEvidenceDataUrl = async (dataUrlValue) => {
  const { buffer, extension } = decodeDataUrlImage(dataUrlValue);
  await ensureEvidenceDirectory();

  const filename = `evidence_${Date.now()}_${randomBytes(6).toString('hex')}.${extension}`;
  const absolutePath = path.join(REPORT_EVIDENCE_DIR, filename);

  await fs.writeFile(absolutePath, buffer);

  return {
    absolutePath,
    relativeUrl: `/uploads/reports/${filename}`
  };
};

const deleteEvidenceFileIfExists = async (absolutePath) => {
  if (!absolutePath) {
    return;
  }

  try {
    await fs.unlink(absolutePath);
  } catch {
    // Si no existe o no se puede borrar, no detenemos el flujo de negocio.
  }
};

export {
  ReportEvidenceError,
  deleteEvidenceFileIfExists,
  ensureEvidenceDirectory,
  saveEvidenceDataUrl
};
