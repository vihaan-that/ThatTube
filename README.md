# EditThat - Video Processing API

A robust REST API for video processing operations including uploading, trimming, merging, and sharing videos.

## Features

- **Video Upload**: Support for raw video files with automatic duration calculation
- **Video Processing**:
  - Trim videos from start or end
  - Merge multiple videos into one
- **Video Sharing**:
  - Generate temporary share links
  - Configurable expiry times
  - Secure token-based access
- **API Security**:
  - Bearer token authentication
  - API endpoint protection
  - Public access only for share links
- **API Documentation**:
  - Interactive Swagger UI
  - Detailed endpoint documentation
  - Request/response examples

## Prerequisites

- Node.js (v16 or higher)
- SQLite3
- Git LFS (for handling large video files)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/vihaan-that/editThat.git
   cd editThat
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Initialize Git LFS (for development):
   ```bash
   git lfs install
   ```

4. Create the uploads directory:
   ```bash
   mkdir uploads
   ```

## Configuration

1. API Authentication:
   - Valid API tokens are defined in `middleware/auth.js`
   - Default test tokens: `test-token-1`, `test-token-2`

2. Video Limits:
   - Maximum file size: 1GB
   - Maximum duration: 5 minutes
   - Supported formats: raw video files

3. Share Links:
   - Default expiry: 24 hours
   - Configurable up to any duration

## API Endpoints

### Video Operations

#### Upload Video
```http
POST /upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: video
```

#### Trim Video
```http
POST /videos/:id/trim
Authorization: Bearer <token>
Content-Type: application/json

{
  "trimStart": number,  // optional
  "trimEnd": number    // optional
}
```

#### Merge Videos
```http
POST /videos/merge
Authorization: Bearer <token>
Content-Type: application/json

{
  "videoIds": number[]
}
```

### Share Operations

#### Create Share Link
```http
POST /videos/:id/share
Authorization: Bearer <token>
Content-Type: application/json

{
  "expiryHours": number  // optional, default: 24
}
```

#### Access Shared Video
```http
GET /videos/share/:token
```

## API Documentation

Interactive API documentation is available at `/api-docs` when the server is running. The documentation includes:
- Detailed endpoint descriptions
- Request/response schemas
- Authentication requirements
- Try-it-out functionality

## Database Schema

### Videos Table
```sql
CREATE TABLE videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    size INTEGER NOT NULL,
    duration REAL NOT NULL
);
```

### Share Links Table
```sql
CREATE TABLE share_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expiry_timestamp TEXT NOT NULL,
    FOREIGN KEY (video_id) REFERENCES videos(id)
);
```

## Development

### Running Tests
```bash
npm test
```

The test suite includes:
- End-to-end tests
- API endpoint tests
- Authentication tests
- Share link functionality tests

### Working with Large Files

This project uses Git LFS to handle large video files. The following file patterns are tracked by LFS:
- `*.raw` - Raw video files
- `tests/fixtures/*` - Test video files

If you're developing, make sure to:
1. Install Git LFS
2. Run `git lfs install` in the repository
3. Pull LFS objects when cloning: `git lfs pull`

## Error Handling

The API uses standard HTTP status codes:
- 200: Success
- 400: Bad Request (invalid parameters)
- 401: Unauthorized (missing token)
- 403: Forbidden (invalid token)
- 404: Not Found
- 500: Internal Server Error

Error responses include a descriptive message:
```json
{
  "error": "Error description"
}
```

## Running the Server

Start the server:
```bash
node server.js
```

The server will start on port 3000 (configurable via PORT environment variable).
- API: http://localhost:3000
- Documentation: http://localhost:3000/api-docs

## Contributing

1. Fork the repository
2. Create your feature branch
3. Install Git LFS and pull LFS objects
4. Make your changes
5. Run the test suite
6. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Test Files
 Generate them using the following commands:
```bash
mkdir tests/fixtures
cd tests/fixtures
dd if=/dev/zero of=test-video1.raw bs=230400 count=150
dd if=/dev/zero of=test-video2.raw bs=230400 count=150
dd if=/dev/zero of=test-video.raw bs=230400 count=150
dd if=/dev/zero of=long-video.raw bs=230400 count=5400
