const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Create a raw video file with a simple pattern
function createTestVideo(outputPath, duration, color) {
    return new Promise((resolve, reject) => {
        // Create a raw video file with a simple pattern
        const width = 320;
        const height = 240;
        const frameRate = 30;
        const totalFrames = duration * frameRate;
        
        // Create a buffer for a single frame
        const frameSize = width * height * 3; // RGB format
        const frame = Buffer.alloc(frameSize);
        
        // Fill the frame with the specified color
        for (let i = 0; i < frameSize; i += 3) {
            if (color === 'red') {
                frame[i] = 255;     // R
                frame[i + 1] = 0;   // G
                frame[i + 2] = 0;   // B
            } else {
                frame[i] = 0;       // R
                frame[i + 1] = 0;   // G
                frame[i + 2] = 255; // B
            }
        }
        
        // Write frames to file
        const writeStream = fs.createWriteStream(outputPath);
        
        for (let f = 0; f < totalFrames; f++) {
            writeStream.write(frame);
        }
        
        writeStream.end();
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
    });
}

async function main() {
    const fixturesDir = path.join(__dirname, 'tests', 'fixtures');
    
    // Create fixtures directory if it doesn't exist
    if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
    }
    
    // Create test videos
    await Promise.all([
        createTestVideo(path.join(fixturesDir, 'test-video1.raw'), 5, 'red'),
        createTestVideo(path.join(fixturesDir, 'test-video2.raw'), 5, 'blue'),
        createTestVideo(path.join(fixturesDir, 'test-video.raw'), 10, 'red'),
        createTestVideo(path.join(fixturesDir, 'long-video.raw'), 301, 'blue') // Just over 5 minutes
    ]);
    
    console.log('Test video files created successfully');
}

main().catch(console.error);
