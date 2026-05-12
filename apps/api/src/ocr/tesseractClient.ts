import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execAsync = promisify(exec);

export async function extractTextWithTesseract(imagePath: string): Promise<string> {
  const outBase = join(tmpdir(), `moto-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const outFile = `${outBase}.txt`;
  try {
    // --psm 3 = fully automatic page segmentation (best for mixed layouts)
    // -l tur = Turkish language model
    await execAsync(`tesseract "${imagePath}" "${outBase}" -l tur --psm 3`);
    const text = await readFile(outFile, "utf-8");
    return text.trim();
  } catch {
    return "";
  } finally {
    await unlink(outFile).catch(() => {});
  }
}
