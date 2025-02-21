const request = require('supertest');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const app = require('../app');
const { getDb } = require('../db');

describe('POST /videos/merge', () => {
    let testVideoIds = [];

    before(async () => {
        // Setup: Upload two test videos
        const db = getDb();
        
        // Copy test videos to uploads directory
        const testVideos = ['test-video1.raw', 'test-video2.raw'];
        for (const video of testVideos) {
            const testVideoPath = path.join(__dirname, 'fixtures', video);
            const uploadPath = path.join(__dirname, '../uploads', `test-merge-${video}`);
            fs.copyFileSync(testVideoPath, uploadPath);
            
            // Insert test video record
            const result = db.prepare(`
                INSERT INTO videos (filename, filepath, size, duration)
                VALUES (?, ?, ?, ?)
            `).run(`test-merge-${video}`, uploadPath, fs.statSync(uploadPath).size, 5.0);
            
            testVideoIds.push(result.lastInsertRowid);
        }
    });

    after(() => {
        // Cleanup: Remove test files from uploads directory
        const uploadsDir = path.join(__dirname, '../uploads');
        fs.readdirSync(uploadsDir).forEach(file => {
            if (file.includes('test-merge-') || file.includes('merged-')) {
                fs.unlinkSync(path.join(uploadsDir, file));
            }
        });
    });

    it('should return 400 if no video IDs are provided', async () => {
        const response = await request(app)
            .post('/videos/merge')
            .send({ videoIds: [] })
            .expect(400);
        
        expect(response.body.error).to.equal('At least two video IDs are required');
    });

    it('should return 400 if only one video ID is provided', async () => {
        const response = await request(app)
            .post('/videos/merge')
            .send({ videoIds: [testVideoIds[0]] })
            .expect(400);
        
        expect(response.body.error).to.equal('At least two video IDs are required');
    });

    it('should return 404 if any video ID does not exist', async () => {
        const response = await request(app)
            .post('/videos/merge')
            .send({ videoIds: [...testVideoIds, 99999] })
            .expect(404);
        
        expect(response.body.error).to.equal('One or more videos not found');
    });

    it('should successfully merge two videos', async () => {
        const response = await request(app)
            .post('/videos/merge')
            .send({ videoIds: testVideoIds })
            .expect(200);
        
        expect(response.body).to.have.property('id');
        expect(response.body).to.have.property('filename');
        expect(response.body).to.have.property('duration');
        expect(response.body.duration).to.be.approximately(10.0, 0.1); // Sum of both video durations
    });
});
