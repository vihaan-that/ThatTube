const request = require('supertest');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const app = require('../app');
const { getDb } = require('../db');
const { VALID_API_TOKENS } = require('../middleware/auth');

describe('POST /videos/merge', () => {
    const API_TOKEN = Array.from(VALID_API_TOKENS)[0];
    let videoId1;
    let videoId2;

    before(async () => {
        // Upload test videos
        const testVideoPath = path.join(__dirname, 'fixtures', 'test-video1.raw');
        
        const response1 = await request(app)
            .post('/upload')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .attach('video', testVideoPath)
            .expect(200);
        
        videoId1 = response1.body.id;

        const response2 = await request(app)
            .post('/upload')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .attach('video', testVideoPath)
            .expect(200);
        
        videoId2 = response2.body.id;
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
            .post('/videos/merge')
            .send({ videoIds: [1, 2] })
            .expect(401);
    });

    it('should reject requests with invalid authentication', async () => {
        await request(app)
            .post('/videos/merge')
            .set('Authorization', 'Bearer invalid-token')
            .send({ videoIds: [1, 2] })
            .expect(403);
    });

    it('should return 400 if no video IDs are provided', async () => {
        await request(app)
            .post('/videos/merge')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .send({})
            .expect(400);
    });

    it('should return 400 if only one video ID is provided', async () => {
        await request(app)
            .post('/videos/merge')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .send({ videoIds: [1] })
            .expect(400);
    });

    it('should return 404 if any video ID does not exist', async () => {
        await request(app)
            .post('/videos/merge')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .send({ videoIds: [9999, 9998] })
            .expect(404);
    });

    it('should successfully merge two videos', async () => {
        const response = await request(app)
            .post('/videos/merge')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .send({ videoIds: [videoId1, videoId2] })
            .expect(200);

        expect(response.body).to.have.property('id');
        expect(response.body).to.have.property('filename');
        expect(response.body).to.have.property('duration');
        expect(response.body.duration).to.be.approximately(10, 0.1); // 5s + 5s = 10s
    });
});
