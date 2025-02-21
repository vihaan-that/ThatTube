const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { getDb } = require('./db');
const { calculateRawVideoDuration, processVideo, mergeVideos } = require('./videoProcessing');
const { authenticateToken } = require('./middleware/auth');

const app = express();
app.use(express.json());

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

// Upload endpoint
app.post('/upload', authenticateToken, upload.single('video'), handleUploadError, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file provided' });
        }

        const db = getDb();
        const filepath = req.file.path;
        const filename = req.file.filename;
        const filesize = fs.statSync(filepath).size;

        // For raw video files, calculate duration based on file size
        let duration;
        if (req.file.originalname.endsWith('.raw')) {
            duration = calculateRawVideoDuration(filepath);
        } else {
            // Get video duration using ffprobe
            duration = await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(req.file.path, (err, metadata) => {
                    if (err) reject(err);
                    resolve(metadata.format.duration);
                });
            });
        }

        // Check if duration exceeds maximum allowed length (5 minutes)
        if (duration > 300) { // 5 minutes in seconds
            fs.unlinkSync(filepath); // Delete the uploaded file
            return res.status(400).json({ error: 'Video duration exceeds maximum allowed length' });
        }

        // Insert video record into database
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

// Video trimming endpoint
app.post('/videos/:id/trim', authenticateToken, async (req, res) => {
    try {
        const { trimStart, trimEnd } = req.body;
        const videoId = parseInt(req.params.id);

        // Validate parameters
        if (!trimStart && !trimEnd) {
            return res.status(400).json({ error: 'Invalid trim parameters. Provide either trimStart or trimEnd' });
        }

        if ((trimStart && trimStart < 0) || (trimEnd && trimEnd < 0)) {
            return res.status(400).json({ error: 'Trim values must be positive numbers' });
        }

        // Get video from database
        const db = getDb();
        const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);

        if (!video) {
            return res.status(404).json({ error: 'Video not found' });
        }

        // Process video
        const { outputPath, duration } = await processVideo(video.filepath, {
            trimStart,
            trimEnd
        });

        // Save new video to database
        const result = db.prepare(`
            INSERT INTO videos (filename, filepath, size, duration)
            VALUES (?, ?, ?, ?)
        `).run(
            path.basename(outputPath),
            outputPath,
            fs.statSync(outputPath).size,
            duration
        );

        // Return new video details
        res.json({
            id: result.lastInsertRowid,
            filename: path.basename(outputPath),
            duration: duration,
            size: fs.statSync(outputPath).size
        });

    } catch (error) {
        res.status(500).json({ error: 'Error processing video: ' + error.message });
    }
});

// Video merging endpoint
app.post('/videos/merge', authenticateToken, async (req, res) => {
    try {
        const { videoIds } = req.body;

        // Validate input
        if (!Array.isArray(videoIds) || videoIds.length < 2) {
            return res.status(400).json({ error: 'At least two video IDs are required' });
        }

        // Get videos from database
        const db = getDb();
        const videos = videoIds.map(id => 
            db.prepare('SELECT * FROM videos WHERE id = ?').get(id)
        );

        // Check if all videos exist
        if (videos.some(v => !v)) {
            return res.status(404).json({ error: 'One or more videos not found' });
        }

        // Get file paths
        const videoPaths = videos.map(v => v.filepath);

        // Merge videos
        const { outputPath, duration } = await mergeVideos(videoPaths);

        // Save new video to database
        const result = db.prepare(`
            INSERT INTO videos (filename, filepath, size, duration)
            VALUES (?, ?, ?, ?)
        `).run(
            path.basename(outputPath),
            outputPath,
            fs.statSync(outputPath).size,
            duration
        );

        // Return new video details
        res.json({
            id: result.lastInsertRowid,
            filename: path.basename(outputPath),
            duration: duration,
            size: fs.statSync(outputPath).size
        });

    } catch (error) {
        res.status(500).json({ error: 'Error merging videos: ' + error.message });
    }
});

// Share video endpoint
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
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get shared video endpoint
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
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = app;
