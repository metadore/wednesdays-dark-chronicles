# Backend Setup Guide

## Installation

1. Navigate to the backend directory:
   `cd backend`

2. Install dependencies:
   `npm install`

## Configuration

1. Copy the example environment file:
   `cp .env.example .env`

2. Edit `.env` with your specific configuration.

## Execution

### Development Mode
Runs the server with `nodemon` for auto-restarts:
`npm run dev`

### Production Mode
Runs the server using standard `node`:
`npm start`

## Testing
Run the health check suite:
`npm test`

## Project Structure
- `src/app.js`: Express application configuration.
- `src/index.js`: Server entry point.
- `src/middleware/`: Centralized logic for errors and security.
- `tests/`: Automated test suites.
