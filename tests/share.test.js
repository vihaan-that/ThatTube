const request = require('supertest');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const app = require('../app');
const { getDb } = require('../db');
const { VALID_API_TOKENS } = require('../middleware/auth');

describe('Video Sharing Endpoints', () => {
    const API_TOKEN = Array.from(VALID_API_TOKENS)[0];
    let testVideoId;
    let shareToken;

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

    after(() => {
        // Clean up share_links first (due to foreign key constraint)
        const db = getDb();
        db.prepare('DELETE FROM share_links').run();
        db.prepare('DELETE FROM videos').run();

        // Cleanup uploaded files
        const uploadsDir = path.join(__dirname, '../uploads');
        fs.readdirSync(uploadsDir).forEach(file => {
            fs.unlinkSync(path.join(uploadsDir, file));
        });
    });

    describe('POST /videos/:id/share', () => {
        it('should reject requests without authentication', async () => {
            await request(app)
                .post('/videos/1/share')
                .expect(401);
        });

        it('should reject requests with invalid authentication', async () => {
            await request(app)
                .post('/videos/1/share')
                .set('Authorization', 'Bearer invalid-token')
                .expect(403);
        });

        it('should return 404 for non-existent video ID', async () => {
            await request(app)
                .post('/videos/999999/share')
                .set('Authorization', `Bearer ${API_TOKEN}`)
                .expect(404);
        });

        it('should create share link with default expiry', async () => {
            const response = await request(app)
                .post(`/videos/${testVideoId}/share`)
                .set('Authorization', `Bearer ${API_TOKEN}`)
                .expect(200);
            
            expect(response.body).to.have.property('shareUrl');
            expect(response.body).to.have.property('expiryTimestamp');

            // Verify the link was saved in database
            const db = getDb();
            const shareLink = db.prepare('SELECT * FROM share_links WHERE token = ?')
                .get(response.body.shareUrl.split('/').pop());
            
            expect(shareLink).to.exist;
            expect(shareLink.video_id).to.equal(testVideoId);

            // Store token for later tests
            shareToken = response.body.shareUrl.split('/').pop();
        });

        it('should create share link with custom expiry', async () => {
            const expiryHours = 48;
            const response = await request(app)
                .post(`/videos/${testVideoId}/share`)
                .set('Authorization', `Bearer ${API_TOKEN}`)
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
            await request(app)
                .get('/videos/share/non-existent-token')
                .expect(404);
        });

        it('should return 404 for expired token', async () => {
            await request(app)
                .get(`/videos/share/${expiredToken}`)
                .expect(404);
        });

        it('should serve video content for valid token', async () => {
            const response = await request(app)
                .get(`/videos/share/${validToken}`)
                .expect(200);
            
            expect(response.headers['content-type']).to.equal('video/raw');
            expect(response.headers['content-disposition']).to.include('test-share-video.raw');
        });

        it('should serve video content for valid token created in previous test', async () => {
            const response = await request(app)
                .get(`/videos/share/${shareToken}`)
                .expect(200);
            
            expect(response.headers['content-type']).to.equal('video/raw');
            expect(response.headers['content-disposition']).to.include('test-share-video.raw');
        });
    });
});
