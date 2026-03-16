// Load environment variables from .env before other imports execute.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveDefaultDatabasePath() {
  const legacyDir = path.join(os.homedir(), '.vibelab');
  const legacyDbPath = path.join(legacyDir, 'auth.db');
  const legacySidecars = [`${legacyDbPath}-shm`, `${legacyDbPath}-wal`];

  const currentDir = path.join(os.homedir(), '.dr-claw');
  const currentDbPath = path.join(currentDir, 'auth.db');
  const currentSidecars = [`${currentDbPath}-shm`, `${currentDbPath}-wal`];

  if (fs.existsSync(currentDbPath)) {
    return currentDbPath;
  }

  if (!fs.existsSync(legacyDbPath)) {
    return currentDbPath;
  }

  try {
    fs.mkdirSync(currentDir, { recursive: true });
    fs.copyFileSync(legacyDbPath, currentDbPath);

    legacySidecars.forEach((legacySidecar, index) => {
      if (fs.existsSync(legacySidecar) && !fs.existsSync(currentSidecars[index])) {
        fs.copyFileSync(legacySidecar, currentSidecars[index]);
      }
    });

    return currentDbPath;
  } catch (error) {
    console.warn('[load-env] Failed to migrate legacy auth DB, using legacy path:', error.message);
    return legacyDbPath;
  }
}

try {
  const envPath = path.join(__dirname, '../.env');
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0 && !process.env[key]) {
        process.env[key] = valueParts.join('=').trim();
      }
    }
  });
} catch (e) {
  console.log('No .env file found or error reading it:', e.message);
}

if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = resolveDefaultDatabasePath();
}
