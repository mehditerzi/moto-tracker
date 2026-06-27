import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.js";

const execAsync = promisify(exec);

export async function extractTextWithTesseract(
  imagePath: string,
  signal?: AbortSignal,
): Promise<string> {
  const outBase = join(tmpdir(), `moto-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const outFile = `${outBase}.txt`;
  try {
    // --psm 3 = fully automatic page segmentation (best for mixed layouts)
    // -l tur = Turkish language model
    // `signal` lets the worker's shared deadline kill the child process so an
    // abandoned Tesseract run can't keep burning CPU after a pipeline timeout.
    await execAsync(`tesseract "${imagePath}" "${outBase}" -l tur --psm 3`, {
      timeout: config.OCR_TIMEOUT_MS,
      killSignal: "SIGKILL",
      signal,
    });
    const text = await readFile(outFile, "utf-8");
    return text.trim();
  } catch {
    return "";
  } finally {
    await unlink(outFile).catch(() => {});
  }
}
