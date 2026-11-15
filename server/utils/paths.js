/* Chemins et port — racine du projet (dossier parent de server/) */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DB_PATH = path.join(ROOT, 'mtg_data.db');
export const PRICES_DB = path.join(ROOT, 'prices.db');
export const PORT = Number(process.argv[2]) || 8000;
