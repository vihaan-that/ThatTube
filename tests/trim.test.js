const request = require('supertest');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const app = require('../app');
const { getDb } = require('../db');

describe('POST /videos/:id/trim', () => {
    let testVideoId;

    before(async () => {
        // Setup: Upload a test video first
        const db = getDb();
        
        // Copy test video to uploads directory
        const testVideoPath = path.join(__dirname, 'fixtures', 'test-video.raw');
        const uploadPath = path.join(__dirname, '../uploads', 'test-trim-video.raw');
        fs.copyFileSync(testVideoPath, uploadPath);
        
        // Insert test video record
        const result = db.prepare(`
            INSERT INTO videos (filename, filepath, size, duration)
            VALUES (?, ?, ?, ?)
        `).run('test-trim-video.raw', uploadPath, fs.statSync(uploadPath).size, 10.0);
        
        testVideoId = result.lastInsertRowid;
    });

    after(() => {
        // Cleanup: Remove test files from uploads directory
        const uploadsDir = path.join(__dirname, '../uploads');
        fs.readdirSync(uploadsDir).forEach(file => {
            if (file.includes('test-trim-video')) {
                fs.unlinkSync(path.join(uploadsDir, file));
            }
        });
    });

    it('should return 404 for non-existent video ID', async () => {
        const response = await request(app)
            .post('/videos/999999/trim')
            .send({ trimStart: 2 })
            .expect(404);
        
        expect(response.body.error).to.equal('Video not found');
    });

    it('should validate trim parameters', async () => {
        const response = await request(app)
            .post(`/videos/${testVideoId}/trim`)
            .send({})
            .expect(400);
        
        expect(response.body.error).to.equal('Invalid trim parameters. Provide either trimStart or trimEnd');
    });

    it('should reject invalid trim values', async () => {
        const response = await request(app)
            .post(`/videos/${testVideoId}/trim`)
            .send({ trimStart: -1 })
            .expect(400);
        
        expect(response.body.error).to.equal('Trim values must be positive numbers');
    });

    it('should successfully trim video from start', async () => {
        const response = await request(app)
            .post(`/videos/${testVideoId}/trim`)
            .send({ trimStart: 2 })
            .expect(200);
        
        expect(response.body).to.have.property('id');
        expect(response.body).to.have.property('filename');
        expect(response.body).to.have.property('duration');
        expect(response.body.duration).to.be.lessThan(10.0); // Original duration was 10.0
    });

    it('should successfully trim video from end', async () => {
        const response = await request(app)
            .post(`/videos/${testVideoId}/trim`)
            .send({ trimEnd: 2 })
            .expect(200);
        
        expect(response.body).to.have.property('id');
        expect(response.body).to.have.property('filename');
        expect(response.body).to.have.property('duration');
        expect(response.body.duration).to.be.lessThan(10.0);
    });
});
