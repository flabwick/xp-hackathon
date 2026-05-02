const Tesseract = require('tesseract.js');

/**
 * Run OCR on an image buffer and return extracted text.
 * @param {Buffer} buffer - Image data as a Buffer
 * @returns {Promise<string>} Extracted text
 */
async function ocrBuffer(buffer) {
  const worker = await Tesseract.createWorker('eng');
  try {
    const { data: { text } } = await worker.recognize(buffer);
    return text.trim();
  } finally {
    await worker.terminate();
  }
}

module.exports = { ocrBuffer };
