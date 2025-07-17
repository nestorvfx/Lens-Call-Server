# Face Tracker WebSocket Server

## Installation

```bash
cd server
npm install
```

## Development (Localhost)

```bash
npm run dev
```

Server will run on `http://localhost:3000`

## Production

```bash
npm start
```

## Health Check

Visit `http://localhost:3000/health` to check server status and session statistics.

## Session Statistics

Visit `http://localhost:3000/stats` for real-time session data.

## WebSocket Events

### Lens Studio → Server
- `lens_studio_request_session`: Request a new session code
- Response: `{ success: true, sessionCode: "ABC123", message: "Session created successfully" }`

### Web App → Server  
- `web_app_join_session`: Join session with code
- `mouth_data`: Send mouth openness data

### Server → Lens Studio
- `web_app_connected`: Notification when web app joins
- `mouth_data`: Real-time mouth openness data
- `user_disconnected`: Notification when web app disconnects

## Deployment to Render.com

1. Push to GitHub repository
2. Connect Render.com to repository
3. Set environment variables if needed
4. Deploy as Web Service (not Static Site)
