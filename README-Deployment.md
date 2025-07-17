# Face Tracker WebSocket Server for Lens Studio

A real-time face tracking WebSocket server that streams mouth openness data from a web application to Lens Studio Spectacles.

## 🚀 Deployment on Render.com

This project is configured for easy deployment on Render.com with automatic HTTPS/WSS support.

### Quick Deploy to Render

1. **Fork this repository** to your GitHub account
2. **Sign up/Login** to [Render.com](https://render.com)
3. **Create a new Web Service**:
   - Connect your GitHub repository
   - Use these settings:
     - **Name**: `face-tracker-websocket`
     - **Environment**: `Node`
     - **Build Command**: `cd server && npm install`
     - **Start Command**: `cd server && npm start`
     - **Node Version**: `18.x`

4. **Set Environment Variables**:
   - `NODE_ENV` = `production`
   - `CORS_ORIGIN` = `https://your-frontend-domain.com` (if needed)

5. **Deploy** and get your WSS URL: `wss://your-app-name.onrender.com`

### Lens Studio Configuration

Update your Lens Studio `FaceTrackerWebSocketClient` script:

**For Production:**
```typescript
Server URL: wss://your-app-name.onrender.com
```

**For Development:**
```typescript
Server URL: ws://localhost:3000
```

## 🏗️ Architecture

- **Single Port**: Both Socket.IO and native WebSocket on same port (Render requirement)
- **Automatic WSS**: Render automatically provides SSL certificates
- **Session Management**: 6-character session codes for pairing
- **Real-time Data**: ~30fps mouth tracking data streaming

## 📡 WebSocket Endpoints

- **Web App**: Socket.IO connection for face tracking data
- **Lens Studio**: Native WebSocket for receiving data
- **Health Check**: `/health` endpoint for monitoring

## 🔧 Development

```bash
cd server
npm install
npm start
```

Server runs on `http://localhost:3000` with WebSocket on same port.

## 📚 API

### Session Flow
1. Lens Studio requests session code
2. Server generates 6-character code
3. Web app joins session with code
4. Real-time mouth data streaming begins

### Message Types
- `lens_studio_request_session` - Request new session
- `session_created` - Session code response  
- `web_app_connected` - Web app joined session
- `mouth_data` - Real-time face tracking data
- `user_disconnected` - User left session

## 🎯 Production URLs

- **Service**: `https://your-app-name.onrender.com`
- **WebSocket**: `wss://your-app-name.onrender.com`
- **Health**: `https://your-app-name.onrender.com/health`
- **Stats**: `https://your-app-name.onrender.com/stats`
