-- OCR the phone already did. A native client runs Apple Vision on-device and
-- sends the recognised lines (text + positions) with the photo, so the server
-- can read the document in milliseconds without running OCR at all. Stored so
-- a re-run of the pipeline sees exactly what the device saw.
ALTER TABLE document ADD COLUMN client_ocr_json TEXT;
