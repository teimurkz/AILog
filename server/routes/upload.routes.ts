import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { usesFirebase } from '../services/tracking-context.js';

const router = Router();
const UPLOADS_DIR = path.join(process.cwd(), 'server', 'uploads');

if (!usesFirebase() && !fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// POST /api/upload - handles base64 data-URI or base64 file string
router.post('/', (req, res) => {
  try {
    const { fileName, fileData, fileType } = req.body;
    if (!fileData) {
      return res.status(400).json({ error: 'Missing fileData' });
    }

    let base64Content = fileData;
    let extension = '.bin';

    if (fileName && path.extname(fileName)) {
      extension = path.extname(fileName);
    } else if (fileType) {
      if (fileType.includes('pdf')) extension = '.pdf';
      else if (fileType.includes('jpeg') || fileType.includes('jpg')) extension = '.jpg';
      else if (fileType.includes('png')) extension = '.png';
      else if (fileType.includes('excel') || fileType.includes('spreadsheet')) extension = '.xlsx';
    }

    // Strip Data-URI prefix if present
    const dataUriMatch = fileData.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (dataUriMatch) {
      base64Content = dataUriMatch[2];
    }

    const cleanBaseName = (fileName ? path.parse(fileName).name : 'doc')
      .replace(/[^a-zA-Z0-9а-яёА-ЯЁ_-]/g, '_')
      .slice(0, 40);
    const uniqueFileName = `${Date.now()}_${cleanBaseName}${extension}`;
    const filePath = path.join(UPLOADS_DIR, uniqueFileName);

    const buffer = Buffer.from(base64Content, 'base64');
    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/uploads/${uniqueFileName}`;
    return res.status(201).json({
      success: true,
      url: publicUrl,
      fileName: fileName || uniqueFileName,
      fileSize: buffer.length
    });
  } catch (err: any) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
