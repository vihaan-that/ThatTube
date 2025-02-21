const Database = require('better-sqlite3');
const path = require('path');

let db = null;

function initDb() {
    if (db) return db;

    const dbPath = path.join(__dirname, 'videos.db');
    db = new Database(dbPath);

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    // Create videos table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            size INTEGER NOT NULL,
            duration FLOAT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Create share_links table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS share_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            expiry_timestamp DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (video_id) REFERENCES videos(id)
        )
    `).run();

    return db;
}

function getDb() {
    return db || initDb();
}

module.exports = {
    initDb,
    getDb
};
