import * as SQLite from 'expo-sqlite';
import seedData from '../data/clients_seed.json';

let _db: SQLite.SQLiteDatabase | null = null;

export async function initDatabase(): Promise<void> {
  _db = await SQLite.openDatabaseAsync('phx_reports.db');

  await _db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS clients (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL UNIQUE,
      client TEXT
    );

    CREATE TABLE IF NOT EXISTS reports (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      job_name     TEXT,
      rfq          TEXT,
      technicians  TEXT,
      arrival      TEXT,
      work         TEXT,
      parts        TEXT,
      return_trip  INTEGER DEFAULT 0,
      photo_count  INTEGER DEFAULT 0,
      submitted_at INTEGER NOT NULL,
      slack_sent   INTEGER DEFAULT 0
    );
  `);

  const row = await _db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM clients'
  );
  if (row && row.count === 0 && (seedData as Array<{ name: string }>).length > 0) {
    for (const c of seedData as Array<{ name: string }>) {
      await _db.runAsync('INSERT OR IGNORE INTO clients (name) VALUES (?)', [c.name]);
    }
  }
}

export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) throw new Error('Database not initialized');
  return _db;
}
