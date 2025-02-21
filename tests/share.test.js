const request = require('supertest');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const app = require('../app');
const { getDb } = require('../db');

describe('Video Sharing Endpoints', () => {
    let testVideoId;

    before(async function() {
        this.timeout(10000); // Increase timeout for setup
        
        // Setup: Upload a test video
        const db = getDb();
        
        // Copy test video to uploads directory
        const testVideoPath = path.join(__dirname, 'fixtures', 'test-video1.raw');
        const uploadPath = path.join(__dirname, '../uploads', 'test-share-video.raw');
        fs.copyFileSync(testVideoPath, uploadPath);
        
        // Insert test video record
        const result = db.prepare(`
            INSERT INTO videos (filename, filepath, size, duration)
            VALUES (?, ?, ?, ?)
        `).run('test-share-video.raw', uploadPath, fs.statSync(uploadPath).size, 5.0);
        
        testVideoId = result.lastInsertRowid;

        // Create share_links table if it doesn't exist
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
    });

    describe('POST /videos/:id/share', () => {
        it('should return 404 for non-existent video ID', async () => {
            const response = await request(app)
                .post('/videos/999999/share')
                .send({})
                .expect(404);
            
            expect(response.body.error).to.equal('Video not found');
        });

        it('should create share link with default expiry', async () => {
            const response = await request(app)
                .post(`/videos/${testVideoId}/share`)
                .send({})
                .expect(200);
            
            expect(response.body).to.have.property('shareUrl');
            expect(response.body.shareUrl).to.include('/videos/share/');
            expect(response.body).to.have.property('expiryTimestamp');

            // Verify the link was saved in database
            const db = getDb();
            const shareLink = db.prepare('SELECT * FROM share_links WHERE token = ?')
                .get(response.body.shareUrl.split('/').pop());
            
            expect(shareLink).to.exist;
            expect(shareLink.video_id).to.equal(testVideoId);
        });

        it('should create share link with custom expiry', async () => {
            const expiryHours = 48;
            const response = await request(app)
                .post(`/videos/${testVideoId}/share`)
                .send({ expiryHours })
                .expect(200);
            
            expect(response.body).to.have.property('shareUrl');
            expect(response.body).to.have.property('expiryTimestamp');

            const db = getDb();
            const shareLink = db.prepare('SELECT * FROM share_links WHERE token = ?')
                .get(response.body.shareUrl.split('/').pop());
            
            expect(shareLink).to.exist;
            const expiryDate = new Date(shareLink.expiry_timestamp);
            const now = new Date();
            const hoursDiff = (expiryDate - now) / (1000 * 60 * 60);
            expect(hoursDiff).to.be.approximately(expiryHours, 0.1);
        });
    });

    describe('GET /videos/share/:token', () => {
        let validToken;
        let expiredToken;

        before(async () => {
            const db = getDb();
            
            // Create a valid share link
            const validResult = db.prepare(`
                INSERT INTO share_links (video_id, token, expiry_timestamp)
                VALUES (?, ?, datetime('now', '+24 hours'))
            `).run(testVideoId, 'valid-test-token');

            // Create an expired share link
            const expiredResult = db.prepare(`
                INSERT INTO share_links (video_id, token, expiry_timestamp)
                VALUES (?, ?, datetime('now', '-1 hour'))
            `).run(testVideoId, 'expired-test-token');

            validToken = 'valid-test-token';
            expiredToken = 'expired-test-token';
        });

        it('should return 404 for non-existent token', async () => {
            const response = await request(app)
                .get('/videos/share/non-existent-token')
                .expect(404);
            
            expect(response.body.error).to.equal('Share link not found or expired');
        });

        it('should return 404 for expired token', async () => {
            const response = await request(app)
                .get(`/videos/share/${expiredToken}`)
                .expect(404);
            
            expect(response.body.error).to.equal('Share link not found or expired');
        });

        it('should serve video content for valid token', async () => {
            const response = await request(app)
                .get(`/videos/share/${validToken}`)
                .expect(200);
            
            expect(response.headers['content-type']).to.equal('video/raw');
            expect(response.headers['content-disposition']).to.include('test-share-video.raw');
        });
    });
});
