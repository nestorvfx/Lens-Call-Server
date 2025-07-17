# Face Tracker WebSocket Integration - Setup & Testing Guide

## Complete Integration Overview

This guide provides step-by-step instructions for setting up and testing the complete Face Tracker WebSocket integration between the web application and Lens Studio Spectacles.

## 📁 Project Structure

```
Face Track Website/
├── server/
│   ├── server.js                    # Node.js WebSocket server
│   ├── package.json                 # Server dependencies
│   └── package-lock.json
├── index.html                       # Enhanced web app with WebSocket
├── test-websocket.html              # Server testing interface
├── FaceTrackerWebSocketClient.js    # Lens Studio script
├── deploy-render.md                 # Deployment instructions
└── SETUP.md                         # This file
```

## 🚀 Quick Start (Localhost Testing)

### 1. Start the WebSocket Server

```bash
cd server
npm install
npm start
```

The server will start on `http://localhost:3000`

### 2. Set Up Lens Studio

1. Open your Lens Studio project
2. Add the `FaceTrackerWebSocketClient.js` script to your project
3. Create a new Scene Object and attach the script
4. In the inspector, assign:
   - **Internet Module**: Add an InternetModule to your scene and assign it
   - **Server URL**: Keep as `ws://localhost:3000` for testing
   - **Auto Request Session**: ✅ (enabled)
   - **Enable Debug Logging**: ✅ (enabled)

### 3. Test the Connection

1. **Start Lens Studio**: Run your lens in the preview or on Spectacles
2. **Watch Console**: You should see a session code printed like:
   ```
   ==================================================
   📱 FACE TRACKER SESSION CODE 📱
   ==================================================
   SESSION CODE: ABC123
   ==================================================
   ```
3. **Open Web App**: Navigate to `http://localhost:3000` in your browser
4. **Connect**: Enter the session code and click "Connect to Session"
5. **Test Face Tracking**: Allow camera access and open your mouth

## 🔧 Detailed Setup

### Server Configuration

The server automatically:
- Generates unique 6-character session codes
- Manages real-time WebSocket connections
- Forwards mouth data between web app and Lens Studio
- Handles user identification and session cleanup

Key features:
- 2-user maximum per session
- 2-hour session timeout
- Health monitoring endpoint
- Collision-free session codes

### Web App Features

Enhanced `index.html` includes:
- **Preserved Functionality**: All original face tracking works unchanged
- **Session Management**: Connect/disconnect from sessions
- **Real-time Data**: 30fps mouth openness streaming
- **User Interface**: Session code input and connection status
- **Error Handling**: Connection failures and reconnection

### Lens Studio Script

`FaceTrackerWebSocketClient.js` provides:
- **Session Requests**: Automatically requests session codes
- **Data Reception**: Receives mouth data with user identification
- **Console Output**: Prints session codes and mouth openness percentages
- **Reconnection**: Automatic retry with exponential backoff
- **Manual Control**: API for manual session management

## 📊 Testing Scenarios

### Test 1: Basic Connection
1. Start server and Lens Studio
2. Note the session code in Lens Studio console
3. Open web app and enter session code
4. Verify "WEB APP CONNECTED!" message in Lens Studio

### Test 2: Mouth Tracking
1. Complete Test 1
2. Allow camera access in web app
3. Open and close your mouth
4. Verify mouth openness percentages in Lens Studio console:
   ```
   👄 Mouth Opening: 45% (0.453)
   👄 Mouth Opening: 78% (0.782)
   ```

### Test 3: Multi-User Support
1. Complete Test 1
2. Open a second browser tab
3. Enter the same session code
4. Both users should show in Lens Studio with user IDs:
   ```
   👄 Mouth Opening [User: a1b2]: 45% (0.453)
   👄 Mouth Opening [User: c3d4]: 67% (0.672)
   ```

### Test 4: Disconnection Handling
1. Complete Test 2
2. Close the web app tab
3. Verify disconnection message in Lens Studio:
   ```
   ❌ USER DISCONNECTED: [user-id]
   ```

### Test 5: Server Restart
1. Stop the server while connected
2. Verify Lens Studio shows reconnection attempts:
   ```
   🔄 Reconnecting in 2 seconds... (1/5)
   ```
3. Restart server and verify automatic reconnection

## 🐛 Troubleshooting

### Common Issues

**"InternetModule is required!"**
- Solution: Add an InternetModule to your Lens Studio scene and assign it in the script inspector

**"Failed to create WebSocket connection"**
- Check server is running on localhost:3000
- Verify server URL in Lens Studio script
- Check firewall settings

**"Session not found"**
- Session may have expired (2-hour timeout)
- Request a new session in Lens Studio
- Check session code was entered correctly

**No mouth data in Lens Studio**
- Verify camera permissions in web browser
- Check face is detected (green overlay in web app)
- Ensure mouth tracking is working (mouth area highlighted)

**Connection keeps failing**
- Check network connectivity
- Verify WebSocket port isn't blocked
- Try restarting both server and Lens Studio

### Debug Mode

Enable detailed logging by setting `enableDebugLogging = true` in Lens Studio:

```javascript
//@input bool enableDebugLogging = true
```

This will show additional debug information:
```
[DEBUG] Created WebSocket connection to: ws://localhost:3000
[DEBUG] Session code request sent to server
[DEBUG] Received message: {"type":"session_created","success":true,"sessionCode":"ABC123"}
[DEBUG] Mouth data - User: user123, Opening: 0.453, Time: 1640995200000
```

## 🌐 Production Deployment

For deployment to Render.com (or other hosting services):

1. **Update Server URL**: Change the Lens Studio script URL from:
   ```javascript
   //@input string serverUrl = "ws://localhost:3000"
   ```
   to:
   ```javascript
   //@input string serverUrl = "wss://your-app.onrender.com"
   ```

2. **Deploy Server**: Follow the instructions in `deploy-render.md`

3. **Update Web App**: The web app automatically connects to the same domain it's served from

4. **Test Production**: Verify all functionality works with the deployed URLs

## 📝 API Reference

### Lens Studio Script API

**Manual Functions** (accessible via script.api):
```javascript
script.requestNewSession()  // Request new session code
script.disconnect()         // Manually disconnect
script.getSessionInfo()     // Get connection status
```

**Events Received**:
- `session_created`: New session code available
- `web_app_connected`: User joined session
- `mouth_data`: Real-time mouth openness data
- `user_disconnected`: User left session

### Server API

**WebSocket Events**:
- `lens_studio_request_session`: Request new session
- `join_session`: Join existing session
- `mouth_data`: Send mouth tracking data

**HTTP Endpoints**:
- `GET /`: Serve web application
- `GET /health`: Server health check
- `GET /test`: WebSocket testing interface

## 🔄 Data Flow

1. **Lens Studio** requests session → **Server** generates code
2. **Server** sends session code → **Lens Studio** prints to console
3. **User** enters code in **Web App** → **Server** connects user to session
4. **Web App** streams mouth data → **Server** forwards to **Lens Studio**
5. **Lens Studio** receives and prints mouth openness data

## 📈 Performance

- **Latency**: < 50ms typical (localhost)
- **Frame Rate**: 30fps mouth data streaming
- **Bandwidth**: ~1KB/second per user
- **Sessions**: Unlimited concurrent sessions
- **Users**: 2 users maximum per session

## 🛡️ Security

- Session codes are cryptographically random
- Sessions auto-expire after 2 hours
- No user data persistence
- WebSocket-only communication (no HTTP data exposure)

## 💡 Next Steps

1. **Test thoroughly** with all scenarios above
2. **Deploy to production** when localhost testing is complete
3. **Monitor performance** in real-world conditions
4. **Consider enhancements** like voice data or hand tracking

This completes your Face Tracker WebSocket integration! The system is now ready for testing and deployment. 🎉
