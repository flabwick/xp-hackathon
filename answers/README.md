# answers/ — Answer Submission & Mobile OCR Module

This module handles student answer collection for the test page, including:
- Text answer fields with localStorage persistence
- Mobile image upload via QR code with Tesseract.js OCR
- Submission to the `/api/test/mark` endpoint

## Files

| File | Purpose |
|------|---------|
| `router.js` | Express router mounted at `/api/answers` |
| `sessions.js` | In-memory session store for mobile upload tokens (30-min TTL) |
| `ocr.js` | Tesseract.js wrapper — takes an image Buffer, returns extracted text |

## API Endpoints

### `POST /api/answers/session`
Creates a new mobile upload session.
**Response:** `{ token: "abc123xyz" }`

### `GET /api/answers/session/:token`
Polls for OCR results from a mobile upload.
**Response:**
```json
{
  "status": "waiting" | "processing" | "complete" | "error",
  "ocrResults": [
    { "filename": "photo.jpg", "text": "...", "size": 123456 }
  ]
}
```

### `POST /api/answers/upload/:token`
Mobile page POSTs images here (multipart/form-data, field name: `images`).
- Runs OCR on each image via Tesseract.js
- Stores results in the session (retrievable via GET above)
- Max 20 images, 15MB each

**Response:** `{ success: true, count: 2 }`

## QR Code Flow

1. Desktop test page generates a session token via `POST /api/answers/session`
2. A QR code is rendered in a modal pointing to `/mobile-upload?token=<token>`
3. Student scans QR on their phone, opens the mobile upload page
4. Student takes/selects photos of their handwritten answers
5. Photos POST to `/api/answers/upload/<token>`
6. Desktop polls `GET /api/answers/session/<token>` every 2 seconds
7. When `status === "complete"`, OCR text is distributed into answer fields

## OCR Text Distribution

If N images are uploaded and there are M answer fields:
- Images 1..min(N,M) map to answer fields 1..min(N,M) respectively
- Extra images (if N > M) are appended to the last answer field
- Answer fields with no corresponding image are left unchanged

## Dependencies

```
tesseract.js  — OCR engine (runs in Node.js)
multer        — Multipart file upload handling
```
