import crypto from 'node:crypto';
import type { Db } from '../db';
import { newId, sha256 } from './util';

// Guest identity (ARCHITECTURE.md §11.4). The SERVER issues a random token, the browser keeps it in
// an httpOnly cookie, and only a hash is stored. A client-chosen identifier is never trusted.
// LIMIT: clearing cookies creates a new identity that can start another ranked session. There is no
// recovery code or account upgrade in this build, so that is a known gap, not a hidden one.

// Sky words for the guest names, to match the climb. Both lists stay 16 long, so a given player id
// maps to the same slot it always did.
const ADJECTIVES = [
  'Silent', 'Drifting', 'Luminous', 'Crimson', 'Midnight', 'Soaring', 'Hollow', 'Pearl', 'Azure',
  'Swift', 'Gliding', 'Glimmering', 'Lofty', 'Cobalt', 'Silver', 'Twilight',
];
const CREATURES = [
  'Falcon', 'Kite', 'Swift', 'Heron', 'Condor', 'Eagle', 'Lark', 'Osprey', 'Crane',
  'Albatross', 'Harrier', 'Swallow', 'Owl', 'Raven', 'Petrel', 'Tern',
];

export function displayNameFor(playerId: string): string {
  const h = sha256(playerId);
  const adjective = ADJECTIVES[parseInt(h.slice(0, 4), 16) % ADJECTIVES.length] as string;
  const creature = CREATURES[parseInt(h.slice(4, 8), 16) % CREATURES.length] as string;
  const number = (parseInt(h.slice(8, 12), 16) % 9000) + 1000;
  return `${adjective}${creature}#${number}`;
}

export function createPlayer(db: Db, nowMs: number): { playerId: string; token: string } {
  const playerId = newId();
  const token = crypto.randomBytes(32).toString('base64url');
  db.run(
    'INSERT INTO players (id, token_hash, display_name, created_at) VALUES (?, ?, ?, ?)',
    playerId,
    sha256(token),
    displayNameFor(playerId),
    nowMs,
  );
  return { playerId, token };
}

export function playerIdForToken(db: Db, token: string): string | null {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const row = db.get<{ id: string }>('SELECT id FROM players WHERE token_hash = ?', sha256(token));
  return row?.id ?? null;
}
