const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Video Processing API',
            version: '1.0.0',
            description: 'API for video processing operations including upload, trim, merge, and share',
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Development server',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        error: {
                            type: 'string',
                            description: 'Error message',
                        },
                    },
                },
                Video: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'integer',
                            description: 'Video ID',
                        },
                        filename: {
                            type: 'string',
                            description: 'Name of the video file',
                        },
                        duration: {
                            type: 'number',
                            description: 'Duration of the video in seconds',
                        },
                    },
                },
                ShareLink: {
                    type: 'object',
                    properties: {
                        shareUrl: {
                            type: 'string',
                            description: 'URL to access the shared video',
                        },
                        expiryTimestamp: {
                            type: 'string',
                            format: 'date-time',
                            description: 'When the share link will expire',
                        },
                    },
                },
            },
        },
        security: [
            {
                bearerAuth: [],
            },
        ],
    },
    apis: ['./app.js'], // Path to the API docs
};

const specs = swaggerJsdoc(options);

module.exports = specs;
