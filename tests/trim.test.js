const request = require('supertest');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const app = require('../app');
const { getDb } = require('../db');
const { VALID_API_TOKENS } = require('../middleware/auth');

describe('POST /videos/:id/trim', () => {
    const API_TOKEN = Array.from(VALID_API_TOKENS)[0];
    let videoId;

    before(async () => {
        // Upload a test video
        const testVideoPath = path.join(__dirname, 'fixtures', 'test-video1.raw');
        
        const response = await request(app)
            .post('/upload')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .attach('video', testVideoPath)
            .expect(200);
        
        videoId = response.body.id;
    });

    after(() => {
        // Cleanup database
        const db = getDb();
        db.prepare('DELETE FROM videos').run();

        // Cleanup uploaded files
        const uploadsDir = path.join(__dirname, '../uploads');
        fs.readdirSync(uploadsDir).forEach(file => {
            fs.unlinkSync(path.join(uploadsDir, file));
        });
    });

    it('should reject requests without authentication', async () => {
        await request(app)
            .post('/videos/1/trim')
            .send({ trimStart: 1 })
            .expect(401);
    });

    it('should reject requests with invalid authentication', async () => {
        await request(app)
            .post('/videos/1/trim')
            .set('Authorization', 'Bearer invalid-token')
            .send({ trimStart: 1 })
            .expect(403);
    });

    it('should return 404 for non-existent video ID', async () => {
        await request(app)
            .post('/videos/9999/trim')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .send({ trimStart: 1 })
            .expect(404);
    });

    it('should validate trim parameters', async () => {
        await request(app)
            .post(`/videos/${videoId}/trim`)
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .send({})
            .expect(400);
    });

    it('should reject invalid trim values', async () => {
        await request(app)
            .post(`/videos/${videoId}/trim`)
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .send({ trimStart: -1 })
            .expect(400);
    });

    it('should successfully trim video from start', async () => {
        const response = await request(app)
            .post(`/videos/${videoId}/trim`)
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .send({ trimStart: 1 })
            .expect(200);

        expect(response.body).to.have.property('id');
        expect(response.body).to.have.property('filename');
        expect(response.body).to.have.property('duration');
        expect(response.body.duration).to.be.approximately(4, 0.1); // Original 5s - 1s = 4s
    });

    it('should successfully trim video from end', async () => {
        const response = await request(app)
            .post(`/videos/${videoId}/trim`)
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .send({ trimEnd: 1 })
            .expect(200);

        expect(response.body).to.have.property('id');
        expect(response.body).to.have.property('filename');
        expect(response.body).to.have.property('duration');
        expect(response.body.duration).to.be.approximately(4, 0.1); // Original 5s - 1s = 4s
    });
});
