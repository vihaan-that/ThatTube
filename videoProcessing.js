const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Calculate duration for raw video
 * @param {string} filepath Path to raw video file
 * @returns {number} Duration in seconds
 */
function calculateRawVideoDuration(filepath) {
    const fileSize = fs.statSync(filepath).size;
    return fileSize / (320 * 240 * 3 * 30); // width * height * bytes_per_pixel * fps
}

/**
 * Process raw video with proper input parameters
 * @param {string} inputPath Path to input raw video file
 * @returns {Object} ffmpeg command object
 */
function createRawVideoCommand(inputPath) {
    return ffmpeg(inputPath)
        .inputOptions([
            '-f rawvideo',
            '-pixel_format rgb24',
            '-video_size 320x240',
            '-framerate 30'
        ]);
}

/**
 * Process video with ffmpeg to create a trimmed version
 * @param {string} inputPath Path to input video file
 * @param {Object} options Trim options
 * @param {number} [options.trimStart] Seconds to trim from start
 * @param {number} [options.trimEnd] Seconds to trim from end
 * @returns {Promise<Object>} Object containing output path and duration
 */
async function processVideo(inputPath, options) {
    // Generate output filename
    const dir = path.dirname(inputPath);
    const ext = path.extname(inputPath);
    const basename = path.basename(inputPath, ext);
    const timestamp = Date.now();
    const outputPath = path.join(dir, `${basename}-trimmed-${timestamp}${ext}`);

    // For raw videos, we need to calculate the frame offset and count
    const isRawVideo = inputPath.endsWith('.raw');
    const totalDuration = isRawVideo ? calculateRawVideoDuration(inputPath) : 0;
    
    if (isRawVideo) {
        return new Promise((resolve, reject) => {
            const inputFileSize = fs.statSync(inputPath).size;
            const frameSize = 320 * 240 * 3; // width * height * bytes_per_pixel
            const totalFrames = inputFileSize / frameSize;
            
            let startFrame = options.trimStart ? options.trimStart * 30 : 0; // 30 fps
            let endFrame = options.trimEnd ? 
                (totalFrames - (options.trimEnd * 30)) : 
                totalFrames;
            
            // Read the input file
            const inputBuffer = fs.readFileSync(inputPath);
            
            // Create output buffer with trimmed frames
            const outputBuffer = Buffer.alloc((endFrame - startFrame) * frameSize);
            inputBuffer.copy(
                outputBuffer,
                0,
                startFrame * frameSize,
                endFrame * frameSize
            );
            
            // Write the output file
            fs.writeFileSync(outputPath, outputBuffer);
            
            // Calculate new duration
            const newDuration = (endFrame - startFrame) / 30; // 30 fps
            
            resolve({
                outputPath,
                duration: newDuration
            });
        });
    }
    
    // For regular video files, use ffmpeg
    return new Promise((resolve, reject) => {
        let command = ffmpeg(inputPath);

        if (options.trimStart) {
            command = command.setStartTime(options.trimStart);
        }

        if (options.trimEnd) {
            const duration = totalDuration - options.trimEnd;
            command = command.setDuration(duration);
        }

        command
            .output(outputPath)
            .on('end', async () => {
                // Get final duration
                const finalDuration = await new Promise((resolve, reject) => {
                    ffmpeg.ffprobe(outputPath, (err, metadata) => {
                        if (err) reject(err);
                        resolve(metadata.format.duration);
                    });
                });

                resolve({
                    outputPath,
                    duration: finalDuration
                });
            })
            .on('error', (err) => {
                reject(new Error(`Error processing video: ${err.message}`));
            })
            .run();
    });
}

/**
 * Merge multiple videos into a single video file
 * @param {string[]} inputPaths Array of paths to input video files
 * @returns {Promise<Object>} Object containing output path and duration
 */
async function mergeVideos(inputPaths) {
    // Generate output filename
    const outputDir = path.dirname(inputPaths[0]);
    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `merged-${timestamp}.raw`);

    // Create write stream for output file
    const writeStream = fs.createWriteStream(outputPath);

    // Read and concatenate all input files
    for (const inputPath of inputPaths) {
        const content = fs.readFileSync(inputPath);
        writeStream.write(content);
    }

    return new Promise((resolve, reject) => {
        writeStream.end();
        writeStream.on('finish', () => {
            // Calculate final duration based on file size
            const fileSize = fs.statSync(outputPath).size;
            const duration = fileSize / (320 * 240 * 3 * 30); // width * height * bytes_per_pixel * fps

            resolve({
                outputPath,
                duration
            });
        });
        writeStream.on('error', reject);
    });
}

module.exports = {
    processVideo,
    mergeVideos,
    calculateRawVideoDuration
};
