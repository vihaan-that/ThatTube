const request = require('supertest');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const app = require('../app');
const { getDb } = require('../db');
const { VALID_API_TOKENS } = require('../middleware/auth');

describe('End-to-End Video Processing Flow', () => {
    let uploadedVideoId1;
    let uploadedVideoId2;
    let shareToken;
    const API_TOKEN = Array.from(VALID_API_TOKENS)[0];

    before(async function() {
        this.timeout(10000); // Increase timeout for setup
        
        // Ensure uploads directory exists
        const uploadsDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir);
        }
    });

    it('should reject requests without authentication', async () => {
        await request(app)
            .post('/upload')
            .attach('video', path.join(__dirname, 'fixtures', 'test-video1.raw'))
            .expect(401);
    });

    it('should reject requests with invalid authentication', async () => {
        await request(app)
            .post('/upload')
            .set('Authorization', 'Bearer invalid-token')
            .attach('video', path.join(__dirname, 'fixtures', 'test-video1.raw'))
            .expect(403);
    });

    it('should upload two test videos successfully', async () => {
        // Upload first video
        const response1 = await request(app)
            .post('/upload')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .attach('video', path.join(__dirname, 'fixtures', 'test-video1.raw'))
            .expect(200);

        expect(response1.body).to.have.property('id');
        expect(response1.body).to.have.property('duration');
        uploadedVideoId1 = response1.body.id;

        // Upload second video
        const response2 = await request(app)
            .post('/upload')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .attach('video', path.join(__dirname, 'fixtures', 'test-video2.raw'))
            .expect(200);

        expect(response2.body).to.have.property('id');
        expect(response2.body).to.have.property('duration');
        uploadedVideoId2 = response2.body.id;
    });

    describe('Video Trimming Flow', () => {
        let trimmedVideoId;

        it('should trim the first uploaded video', async () => {
            const response = await request(app)
                .post(`/videos/${uploadedVideoId1}/trim`)
                .set('Authorization', `Bearer ${API_TOKEN}`)
                .send({
                    trimStart: 1,
                    trimEnd: 1
                })
                .expect(200);

            expect(response.body).to.have.property('id');
            expect(response.body).to.have.property('duration');
            expect(response.body.duration).to.be.approximately(3, 0.1); // Original 5s - 2s = 3s
            trimmedVideoId = response.body.id;
        });

        it('should create a share link for the trimmed video', async () => {
            const response = await request(app)
                .post(`/videos/${trimmedVideoId}/share`)
                .set('Authorization', `Bearer ${API_TOKEN}`)
                .send({ expiryHours: 24 })
                .expect(200);

            expect(response.body).to.have.property('shareUrl');
            expect(response.body).to.have.property('expiryTimestamp');
            shareToken = response.body.shareUrl.split('/').pop();
        });

        it('should successfully access the shared trimmed video without authentication', async () => {
            const response = await request(app)
                .get(`/videos/share/${shareToken}`)
                .expect(200);

            expect(response.headers['content-type']).to.equal('video/raw');
            expect(response.headers['content-disposition']).to.include('.raw');
        });
    });

    describe('Video Merging Flow', () => {
        let mergedVideoId;

        it('should merge the two uploaded videos', async () => {
            const response = await request(app)
                .post('/videos/merge')
                .set('Authorization', `Bearer ${API_TOKEN}`)
                .send({ videoIds: [uploadedVideoId1, uploadedVideoId2] })
                .expect(200);

            expect(response.body).to.have.property('id');
            expect(response.body).to.have.property('duration');
            expect(response.body.duration).to.be.approximately(10, 0.1); // 5s + 5s = 10s
            mergedVideoId = response.body.id;
        });

        it('should create a share link for the merged video', async () => {
            const response = await request(app)
                .post(`/videos/${mergedVideoId}/share`)
                .set('Authorization', `Bearer ${API_TOKEN}`)
                .send({ expiryHours: 48 })
                .expect(200);

            expect(response.body).to.have.property('shareUrl');
            expect(response.body).to.have.property('expiryTimestamp');
            shareToken = response.body.shareUrl.split('/').pop();
        });

        it('should successfully access the shared merged video without authentication', async () => {
            const response = await request(app)
                .get(`/videos/share/${shareToken}`)
                .expect(200);

            expect(response.headers['content-type']).to.equal('video/raw');
            expect(response.headers['content-disposition']).to.include('.raw');
        });
    });

    after(async () => {
        // Cleanup: Remove all test files from uploads directory
        const uploadsDir = path.join(__dirname, '../uploads');
        if (fs.existsSync(uploadsDir)) {
            fs.readdirSync(uploadsDir).forEach(file => {
                fs.unlinkSync(path.join(uploadsDir, file));
            });
        }

        // Clean up database
        const db = getDb();
        db.prepare('DELETE FROM share_links').run();
        db.prepare('DELETE FROM videos').run();
    });
});
