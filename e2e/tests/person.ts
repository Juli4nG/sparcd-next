import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PERSON_FILE = join(import.meta.dirname, '..', '.auth', 'person.json');

export const person = (): { code: string; password: string } => JSON.parse(readFileSync(PERSON_FILE, 'utf8'));
