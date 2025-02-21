const request = require('supertest');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const app = require('../app');
const { getDb } = require('../db');
const { VALID_API_TOKENS } = require('../middleware/auth');

describe('POST /upload', () => {
    const API_TOKEN = Array.from(VALID_API_TOKENS)[0];

    before(() => {
        // Create uploads directory if it doesn't exist
        const uploadsDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir);
        }
    });

    after(() => {
        // Cleanup: Remove test files from uploads directory
        const uploadsDir = path.join(__dirname, '../uploads');
        fs.readdirSync(uploadsDir).forEach(file => {
            if (file.startsWith('test-')) {
                fs.unlinkSync(path.join(uploadsDir, file));
            }
        });
    });

    it('should reject requests without authentication', async () => {
        const response = await request(app)
            .post('/upload')
            .expect(401);
        
        expect(response.body.error).to.equal('No authentication token provided');
    });

    it('should reject requests with invalid authentication', async () => {
        const response = await request(app)
            .post('/upload')
            .set('Authorization', 'Bearer invalid-token')
            .expect(403);
        
        expect(response.body.error).to.equal('Invalid authentication token');
    });

    it('should reject when no file is provided', async () => {
        const response = await request(app)
            .post('/upload')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .expect(400);
        
        expect(response.body.error).to.equal('No video file provided');
    });

    it('should reject invalid file types', async () => {
        // Create a temporary text file
        const textFilePath = path.join(__dirname, 'fixtures', 'test.txt');
        fs.writeFileSync(textFilePath, 'This is a test file', 'utf8');

        try {
            const response = await request(app)
                .post('/upload')
                .set('Authorization', `Bearer ${API_TOKEN}`)
                .attach('video', textFilePath, { filename: 'test.txt', contentType: 'text/plain' })
                .expect(400);
            
            expect(response.body.error).to.equal('Invalid file type. Only video files are allowed');
        } finally {
            // Cleanup
            if (fs.existsSync(textFilePath)) {
                fs.unlinkSync(textFilePath);
            }
        }
    });

    it('should successfully upload a valid video file', async () => {
        const testVideoPath = path.join(__dirname, 'fixtures', 'test-video1.raw');
        
        const response = await request(app)
            .post('/upload')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .attach('video', testVideoPath, { filename: 'test-video1.raw', contentType: 'video/raw' })
            .expect(200);
        
        expect(response.body).to.have.property('id');
        expect(response.body).to.have.property('filename');
        expect(response.body).to.have.property('duration');
        expect(response.body.duration).to.be.approximately(5.0, 0.1);
    });

    it('should reject videos that exceed maximum duration', async () => {
        const testVideoPath = path.join(__dirname, 'fixtures', 'long-video.raw');
        
        const response = await request(app)
            .post('/upload')
            .set('Authorization', `Bearer ${API_TOKEN}`)
            .attach('video', testVideoPath, { filename: 'long-video.raw', contentType: 'video/raw' })
            .expect(400);
        
        expect(response.body.error).to.equal('Video duration exceeds maximum allowed length');
    }).timeout(5000); // Increase timeout for large file
});
