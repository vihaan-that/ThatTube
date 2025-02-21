const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db');
const { calculateRawVideoDuration } = require('./videoProcessing');
const { processVideo, mergeVideos } = require('./videoProcessing');
const { authenticateToken } = require('./middleware/auth');
const swaggerUi = require('swagger-ui-express');
const specs = require('./swagger');

const app = express();
app.use(express.json());

// Serve Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// Configure multer for handling file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (!file) {
        cb(new Error('No video file provided'), false);
        return;
    }

    // Check file type
    const allowedTypes = ['video/mp4', 'video/raw', 'video/quicktime'];
    if (!allowedTypes.includes(file.mimetype) && !file.originalname.endsWith('.raw')) {
        cb(new Error('Invalid file type. Only video files are allowed'), false);
        return;
    }

    cb(null, true);
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 1024 * 1024 * 1024 // 1GB
    }
});

// Handle file upload errors
const handleUploadError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Video duration exceeds maximum allowed length' });
        }
        return res.status(400).json({ error: err.message });
    }
    if (err) {
        return res.status(400).json({ error: err.message });
    }
    next();
};

/**
 * @swagger
 * /upload:
 *   post:
 *     summary: Upload a new video file
 *     tags: [Videos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               video:
 *                 type: string
 *                 format: binary
 *                 description: Video file to upload
 *     responses:
 *       200:
 *         description: Video uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Video'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Invalid authentication token
 */
app.post('/upload', authenticateToken, upload.single('video'), handleUploadError, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file provided' });
        }

        const filepath = req.file.path;
        const filename = req.file.filename;
        const filesize = fs.statSync(filepath).size;

        // Calculate duration
        const duration = calculateRawVideoDuration(filepath);

        // Check if duration exceeds maximum allowed length (5 minutes)
        if (duration > 300) { // 5 minutes in seconds
            fs.unlinkSync(filepath); // Delete the uploaded file
            return res.status(400).json({ error: 'Video duration exceeds maximum allowed length (5 minutes)' });
        }

        // Insert video record into database
        const db = getDb();
        const result = db.prepare(`
            INSERT INTO videos (filename, filepath, size, duration)
            VALUES (?, ?, ?, ?)
        `).run(filename, filepath, filesize, duration);

        res.json({
            id: result.lastInsertRowid,
            filename,
            duration
        });
    } catch (error) {
        console.error('Error processing upload:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /videos/{id}/trim:
 *   post:
 *     summary: Trim a video
 *     tags: [Videos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Video ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               trimStart:
 *                 type: number
 *                 description: Seconds to trim from start
 *               trimEnd:
 *                 type: number
 *                 description: Seconds to trim from end
 *     responses:
 *       200:
 *         description: Video trimmed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Video'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Invalid authentication token
 *       404:
 *         description: Video not found
 */
app.post('/videos/:id/trim', authenticateToken, async (req, res) => {
    try {
        const videoId = req.params.id;
        const { trimStart, trimEnd } = req.body;

        // Validate trim parameters
        if (!trimStart && !trimEnd) {
            return res.status(400).json({ error: 'Must specify either trimStart or trimEnd' });
        }

        if ((trimStart && trimStart < 0) || (trimEnd && trimEnd < 0)) {
            return res.status(400).json({ error: 'Trim values must be positive' });
        }

        // Get video from database
        const db = getDb();
        const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);

        if (!video) {
            return res.status(404).json({ error: 'Video not found' });
        }

        // Process video
        const result = await processVideo(video.filepath, { trimStart, trimEnd });

        // Save new video to database
        const newVideo = db.prepare(`
            INSERT INTO videos (filename, filepath, size, duration)
            VALUES (?, ?, ?, ?)
        `).run(
            path.basename(result.outputPath),
            result.outputPath,
            fs.statSync(result.outputPath).size,
            result.duration
        );

        res.json({
            id: newVideo.lastInsertRowid,
            filename: path.basename(result.outputPath),
            duration: result.duration
        });
    } catch (error) {
        console.error('Error processing trim:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /videos/merge:
 *   post:
 *     summary: Merge multiple videos
 *     tags: [Videos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               videoIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Array of video IDs to merge
 *     responses:
 *       200:
 *         description: Videos merged successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Video'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Invalid authentication token
 *       404:
 *         description: One or more videos not found
 */
app.post('/videos/merge', authenticateToken, async (req, res) => {
    try {
        const { videoIds } = req.body;

        if (!videoIds || !Array.isArray(videoIds)) {
            return res.status(400).json({ error: 'Must provide an array of video IDs' });
        }

        if (videoIds.length < 2) {
            return res.status(400).json({ error: 'Must provide at least two video IDs to merge' });
        }

        const db = getDb();
        const videos = [];

        // Get all videos from database
        for (const id of videoIds) {
            const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
            if (!video) {
                return res.status(404).json({ error: `Video with ID ${id} not found` });
            }
            videos.push(video);
        }

        // Merge videos
        const result = await mergeVideos(videos.map(v => v.filepath));

        // Save new video to database
        const newVideo = db.prepare(`
            INSERT INTO videos (filename, filepath, size, duration)
            VALUES (?, ?, ?, ?)
        `).run(
            path.basename(result.outputPath),
            result.outputPath,
            fs.statSync(result.outputPath).size,
            result.duration
        );

        res.json({
            id: newVideo.lastInsertRowid,
            filename: path.basename(result.outputPath),
            duration: result.duration
        });
    } catch (error) {
        console.error('Error processing merge:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /videos/{id}/share:
 *   post:
 *     summary: Create a share link for a video
 *     tags: [Videos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Video ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expiryHours:
 *                 type: integer
 *                 description: Hours until link expires (default 24)
 *     responses:
 *       200:
 *         description: Share link created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShareLink'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Invalid authentication token
 *       404:
 *         description: Video not found
 */
app.post('/videos/:id/share', authenticateToken, async (req, res) => {
    try {
        const videoId = req.params.id;
        const { expiryHours = 24 } = req.body; // Default 24 hours expiry

        // Get video from database
        const db = getDb();
        const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);

        if (!video) {
            return res.status(404).json({ error: 'Video not found' });
        }

        // Generate unique token (using timestamp and random string)
        const token = `${Date.now()}-${Math.random().toString(36).substring(2)}`;

        // Calculate expiry timestamp
        const expiryTimestamp = new Date();
        expiryTimestamp.setHours(expiryTimestamp.getHours() + expiryHours);

        // Save share link in database
        db.prepare(`
            INSERT INTO share_links (video_id, token, expiry_timestamp)
            VALUES (?, ?, ?)
        `).run(videoId, token, expiryTimestamp.toISOString());

        // Return share URL and expiry timestamp
        res.json({
            shareUrl: `/videos/share/${token}`,
            expiryTimestamp: expiryTimestamp.toISOString()
        });
    } catch (error) {
        console.error('Error creating share link:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /videos/share/{token}:
 *   get:
 *     summary: Access a shared video
 *     tags: [Videos]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Share token
 *     responses:
 *       200:
 *         description: Video stream
 *         content:
 *           video/raw:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Share link not found or expired
 */
app.get('/videos/share/:token', async (req, res) => {
    try {
        const token = req.params.token;

        // Get share link from database
        const db = getDb();
        const shareLink = db.prepare(`
            SELECT share_links.*, videos.* 
            FROM share_links 
            JOIN videos ON videos.id = share_links.video_id
            WHERE token = ? AND datetime(expiry_timestamp) > datetime('now')
        `).get(token);

        if (!shareLink) {
            return res.status(404).json({ error: 'Share link not found or expired' });
        }

        // Set appropriate headers
        res.setHeader('Content-Type', 'video/raw');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${shareLink.filename}"`
        );

        // Stream the video file
        const fileStream = fs.createReadStream(shareLink.filepath);
        fileStream.pipe(res);
    } catch (error) {
        console.error('Error serving shared video:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = app;
