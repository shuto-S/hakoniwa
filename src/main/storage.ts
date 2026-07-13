import fs from 'node:fs';

export interface LoadWorldFilesResult {
  json: string | null;
  recovered: boolean;
  failed: boolean;
}

function validJson(raw: string): boolean {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

async function readValidJson(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return validJson(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function loadWorldFiles(
  target: string,
  backup: string,
): Promise<LoadWorldFilesResult> {
  const primaryExists = fs.existsSync(target);
  const primary = await readValidJson(target);
  if (primary) return { json: primary, recovered: false, failed: false };
  const recovered = await readValidJson(backup);
  if (recovered) return { json: recovered, recovered: true, failed: false };
  return { json: null, recovered: false, failed: primaryExists };
}

export async function saveWorldAtomic(
  target: string,
  backup: string,
  json: string,
): Promise<boolean> {
  const temp = `${target}.tmp`;
  try {
    if (!validJson(json)) return false;
    const current = await readValidJson(target);
    if (current) await fs.promises.writeFile(backup, current, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.writeFile(temp, json, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(temp, target);
    return true;
  } catch {
    await fs.promises.unlink(temp).catch(() => {});
    return false;
  }
}
