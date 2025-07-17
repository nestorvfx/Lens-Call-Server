const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// Server configuration - Single port for Render.com
const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);

// CORS configuration for production deployment
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.CORS_ORIGIN, /\.onrender\.com$/]
    : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8080", "file://"],
  methods: ["GET", "POST"],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Serve static files from parent directory (where index.html is located)
const path = require('path');
app.use(express.static(path.join(__dirname, '..')));

// Socket.IO setup with CORS (for web app)
const io = socketIo(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  path: '/socket.io/'  // Explicit path for Socket.IO
});

// Native WebSocket Server setup (for Lens Studio) - Use noServer mode
const wss = new WebSocket.Server({ 
  noServer: true,  // Don't attach to server automatically
  perMessageDeflate: false
});

// Manual upgrade handling to separate Socket.IO from native WebSocket
server.on('upgrade', (request, socket, head) => {
  const pathname = request.url;
  
  // If it's a Socket.IO upgrade request, let Socket.IO handle it
  if (pathname.startsWith('/socket.io/')) {
    // Socket.IO will handle this automatically
    return;
  }
  
  // Otherwise, handle it as a native WebSocket for Lens Studio
  console.log(`[WS_UPGRADE] Handling native WebSocket upgrade for: ${pathname}`);
  console.log(`[WS_UPGRADE] Client IP: ${socket.remoteAddress}`);
  console.log(`[WS_UPGRADE] User Agent: ${request.headers['user-agent'] || 'Not provided'}`);
  
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

console.log(`[SERVER] Starting Face Tracker WebSocket Server on port ${PORT}`);
console.log(`[SERVER] Socket.IO (web app): ${PORT}/socket.io/`);
console.log(`[SERVER] Native WebSocket (Lens Studio): ${PORT}/`);
console.log(`[SERVER] Production WebSocket URL: wss://your-app.onrender.com`);
console.log(`[SERVER] Development WebSocket URL: ws://localhost:${PORT}`);

// Add server-level error handling
wss.on('error', (error) => {
  console.error(`[WS_SERVER_ERROR] WebSocket server error:`, error);
});

// Log successful WebSocket server setup
console.log(`[WS_SERVER] ✅ Native WebSocket server configured for manual upgrade handling`);

// Session management
class MultiUserSessionManager {
  constructor() {
    this.sessions = new Map(); // sessionHash -> SessionData
    this.userSessions = new Map(); // socketId -> sessionHash
    this.webAppSessions = new Map(); // webAppSocketId -> sessionHash
    this.cleanupInterval = setInterval(() => this.cleanupInactiveSessions(), 60000); // 1 minute
  }

  // Generate 6-character base session code (excluding confusing characters)
  generateBaseSessionCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding I, O, 0, 1
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.sessions.has(code)); // Ensure uniqueness
    return code;
  }

  // Create new multi-user session
  createMultiUserSession(sessionHash, lensStudioSocketId, users) {
    const baseCode = this.generateBaseSessionCode();
    const keycodeChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    
    // Generate user keycodes
    const userKeycodes = users.map((user, index) => ({
      connectionId: user.connectionId,
      userId: user.userId,
      displayName: user.displayName,
      keycodeChar: user.keycodeChar || keycodeChars[index],
      fullKeycode: `${baseCode}${user.keycodeChar || keycodeChars[index]}`,
      webAppSocketId: null
    }));

    const sessionData = {
      sessionHash: sessionHash,
      baseCode: baseCode,
      lensStudioSocket: lensStudioSocketId,
      users: userKeycodes,
      webAppConnections: new Map(), // fullKeycode -> socketId
      createdAt: Date.now(),
      lastActivity: Date.now(),
      isActive: true
    };
    
    this.sessions.set(sessionHash, sessionData);
    this.userSessions.set(lensStudioSocketId, sessionHash);
    
    console.log(`[SESSION] Created multi-user session ${sessionHash} with base code ${baseCode}`);
    console.log(`[SESSION] ${users.length} users assigned keycodes`);
    
    return sessionData;
  }

  // Get session by hash
  getSessionByHash(sessionHash) {
    return this.sessions.get(sessionHash);
  }

  // Join session from web app using keycode
  joinSessionWithKeycode(fullKeycode, webAppSocketId) {
    // Find session that contains this keycode
    for (const [sessionHash, session] of this.sessions) {
      const userKeycode = session.users.find(u => u.fullKeycode === fullKeycode);
      if (userKeycode) {
        // Check if keycode is already in use
        if (session.webAppConnections.has(fullKeycode)) {
          return { success: false, error: 'Keycode already in use' };
        }

        // Assign web app socket to this keycode
        session.webAppConnections.set(fullKeycode, webAppSocketId);
        userKeycode.webAppSocketId = webAppSocketId;
        session.lastActivity = Date.now();
        
        this.webAppSessions.set(webAppSocketId, sessionHash);
        
        console.log(`[SESSION] Web app ${webAppSocketId} joined session ${sessionHash} with keycode ${fullKeycode}`);
        return { success: true, session, userKeycode };
      }
    }
    
    return { success: false, error: 'Invalid keycode' };
  }

  // Get session by socket ID
  getSessionBySocket(socketId) {
    const sessionHash = this.userSessions.get(socketId) || this.webAppSessions.get(socketId);
    return sessionHash ? this.sessions.get(sessionHash) : null;
  }

  // Update session activity
  updateActivity(sessionHash) {
    const session = this.sessions.get(sessionHash);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  // Route mouth data to other users
  routeMouthData(fromKeycode, mouthData, session) {
    const recipients = [];
    
    // Find all other connected users in the session
    for (const [keycode, webAppSocketId] of session.webAppConnections) {
      if (keycode !== fromKeycode && webAppSocketId) {
        recipients.push({
          keycode: keycode,
          socketId: webAppSocketId,
          keycodeChar: keycode.slice(-1)
        });
      }
    }

    console.log(`[MOUTH_DATA] Routing from ${fromKeycode} to ${recipients.length} recipients`);
    
    // Send to Lens Studio
    if (session.lensStudioSocket) {
      recipients.push({
        keycode: 'lens_studio',
        socketId: session.lensStudioSocket,
        keycodeChar: 'LS'
      });
    }

    return recipients;
  }

  // Add user to session (dynamic join)
  addUserToSession(sessionHash, userInfo) {
    const session = this.sessions.get(sessionHash);
    if (!session) return null;

    const keycodeChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const usedChars = session.users.map(u => u.keycodeChar);
    
    // Find first available character
    let assignedChar = null;
    for (let i = 0; i < keycodeChars.length; i++) {
      if (!usedChars.includes(keycodeChars[i])) {
        assignedChar = keycodeChars[i];
        break;
      }
    }

    if (!assignedChar) {
      console.log(`[SESSION] No available slots for new user in session ${sessionHash}`);
      return null;
    }

    const newUserKeycode = {
      connectionId: userInfo.connectionId,
      userId: userInfo.userId,
      displayName: userInfo.displayName,
      keycodeChar: assignedChar,
      fullKeycode: `${session.baseCode}${assignedChar}`,
      webAppSocketId: null
    };

    session.users.push(newUserKeycode);
    session.lastActivity = Date.now();

    console.log(`[SESSION] Added user ${userInfo.displayName} to session ${sessionHash} with keycode ${newUserKeycode.fullKeycode}`);
    
    return newUserKeycode;
  }

  // Remove user from session
  removeUserFromSession(socketId) {
    const sessionHash = this.userSessions.get(socketId) || this.webAppSessions.get(socketId);
    if (!sessionHash) return null;

    const session = this.sessions.get(sessionHash);
    if (!session) return null;

    // Remove from appropriate connection type
    if (this.userSessions.has(socketId)) {
      // Lens Studio user
      session.lensStudioSocket = null;
      this.userSessions.delete(socketId);
    } else {
      // Web app user
      for (const [keycode, webAppSocketId] of session.webAppConnections) {
        if (webAppSocketId === socketId) {
          session.webAppConnections.delete(keycode);
          const user = session.users.find(u => u.fullKeycode === keycode);
          if (user) {
            user.webAppSocketId = null;
          }
          break;
        }
      }
      this.webAppSessions.delete(socketId);
    }

    // Check if session should be marked as inactive
    if (!session.lensStudioSocket && session.webAppConnections.size === 0) {
      session.isActive = false;
      console.log(`[SESSION] Session ${sessionHash} marked as inactive`);
    }

    console.log(`[SESSION] Removed socket ${socketId} from session ${sessionHash}`);
    return session;
  }

  // Join session with 7-character keycode (for web app)
  joinSessionWithKeycode(keycode, socketId) {
    if (!keycode || keycode.length !== 7) {
      return {
        success: false,
        error: 'Invalid keycode format'
      };
    }

    const baseCode = keycode.substring(0, 6);
    const userChar = keycode.substring(6);

    // Find session by base code
    let targetSession = null;
    let sessionHash = null;
    
    for (const [hash, session] of this.sessions) {
      if (session.baseCode === baseCode) {
        targetSession = session;
        sessionHash = hash;
        break;
      }
    }

    if (!targetSession) {
      return {
        success: false,
        error: 'Session not found'
      };
    }

    // Find user with matching keycode character
    const userKeycode = targetSession.users.find(u => u.keycodeChar === userChar);
    if (!userKeycode) {
      return {
        success: false,
        error: 'User keycode not found'
      };
    }

    // Check if this keycode is already connected
    if (targetSession.webAppConnections.has(keycode)) {
      return {
        success: false,
        error: 'Keycode already in use'
      };
    }

    // Connect web app to this specific keycode
    targetSession.webAppConnections.set(keycode, socketId);
    this.webAppSessions.set(socketId, sessionHash);
    targetSession.lastActivity = Date.now();

    console.log(`[SESSION] Web app ${socketId} joined session ${sessionHash} with keycode ${keycode}`);

    return {
      success: true,
      sessionId: sessionHash,
      sessionCode: baseCode,
      userKeycode: keycode,
      connectedUsers: targetSession.users.length,
      session: targetSession
    };
  }

  // Cleanup inactive sessions (older than 2 hours)
  cleanupInactiveSessions() {
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000; // 2 hours

    for (const [sessionHash, session] of this.sessions) {
      if (!session.isActive || (now - session.lastActivity) > maxAge) {
        console.log(`[SESSION] Cleaning up inactive session ${sessionHash}`);
        this.sessions.delete(sessionHash);
        
        // Clean up user mappings
        if (session.lensStudioSocket) {
          this.userSessions.delete(session.lensStudioSocket);
        }
        for (const [keycode, webAppSocketId] of session.webAppConnections) {
          if (webAppSocketId) {
            this.webAppSessions.delete(webAppSocketId);
          }
        }
      }
    }
  }

  // Get session statistics
  getStats() {
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.isActive);
    const totalUsers = activeSessions.reduce((sum, s) => sum + s.users.length, 0);
    const totalWebAppConnections = activeSessions.reduce((sum, s) => sum + s.webAppConnections.size, 0);
    
    return {
      totalSessions: this.sessions.size,
      activeSessions: activeSessions.length,
      totalUsers: totalUsers,
      connectedWebApps: totalWebAppConnections,
      connectedLensStudio: activeSessions.filter(s => s.lensStudioSocket).length
    };
  }
}

// Initialize session manager
const sessionManager = new MultiUserSessionManager();

// Helper function to send messages to Lens Studio (native WebSocket)
function sendToLensStudio(socketId, eventName, data) {
  // First try to find in native WebSocket connections
  wss.clients.forEach(ws => {
    if (ws.socketId === socketId && ws.readyState === WebSocket.OPEN) {
      try {
        const message = JSON.stringify({
          type: eventName,
          ...data
        });
        ws.send(message);
        console.log(`[WS_SEND] Sent ${eventName} to Lens Studio ${socketId}`);
        return;
      } catch (error) {
        console.error(`[ERROR] Failed to send message to Lens Studio ${socketId}:`, error);
      }
    }
  });

  // Fallback to Socket.IO (for test interface)
  const targetSocket = io.sockets.sockets.get(socketId);
  if (targetSocket) {
    try {
      targetSocket.emit(eventName, data);
    } catch (error) {
      console.error(`[ERROR] Failed to send Socket.IO message to ${socketId}:`, error);
    }
  }
}

// Native WebSocket Server (for Lens Studio)
wss.on('connection', (ws, req) => {
  // Generate unique ID for this WebSocket connection
  ws.socketId = uuidv4();
  console.log(`[WS_CONNECT] Lens Studio connected: ${ws.socketId}`);

  // Handle incoming messages from Lens Studio
  ws.on('message', (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      console.log(`[WS_MESSAGE] Received from ${ws.socketId}:`, message);

      switch (message.type) {
        case 'lens_multi_user_session_request':
          // Multi-user session request
          handleMultiUserSessionRequest(ws, message);
          break;
        case 'user_joined_session':
          handleUserJoinedSession(ws, message);
          break;
        case 'user_left_session':
          handleUserLeftSession(ws, message);
          break;
        default:
          console.log(`[WS_MESSAGE] Unknown message type: ${message.type}`);
          break;
      }
    } catch (error) {
      console.error(`[WS_ERROR] Failed to parse message from ${ws.socketId}:`, error);
      console.error(`[WS_ERROR] Raw message:`, rawMessage.toString());
    }
  });

  // Handle WebSocket close
  ws.on('close', (code, reason) => {
    console.log(`[WS_DISCONNECT] WebSocket ${ws.socketId} disconnected. Code: ${code}, Reason: ${reason}`);
    
    // Remove from session
    const session = sessionManager.removeUserFromSession(ws.socketId);
    if (session && session.webAppSocket) {
      // Notify web app about Lens Studio disconnection
      io.to(session.webAppSocket).emit('user_disconnected', {
        sessionCode: session.code,
        disconnectedUserId: ws.socketId,
        timestamp: Date.now()
      });
    }
  });
  });



// Handle Multi-User Session Request
function handleMultiUserSessionRequest(ws, message) {
  console.log(`[WS_MULTI_SESSION] 🎯 Processing multi-user session request for socket ${ws.socketId}`);
  
  try {
    const { sessionHash, users } = message;
    
    if (!sessionHash || !users || !Array.isArray(users)) {
      throw new Error('Invalid session request - missing sessionHash or users');
    }

    console.log(`[WS_MULTI_SESSION] Creating multi-user session with hash ${sessionHash}`);
    console.log(`[WS_MULTI_SESSION] ${users.length} users to assign keycodes`);
    
    const session = sessionManager.createMultiUserSession(sessionHash, ws.socketId, users);
    
    const response = {
      type: 'multi_user_session_created',
      success: true,
      sessionHash: sessionHash,
      baseSessionCode: session.baseCode,
      userKeycodes: session.users,
      message: 'Multi-user session created successfully',
      timestamp: Date.now(),
      sessionInfo: {
        sessionHash: sessionHash,
        baseCode: session.baseCode,
        userCount: session.users.length,
        createdAt: session.createdAt,
        isActive: session.isActive
      }
    };

    console.log(`[WS_MULTI_SESSION] 📤 Sending response to ${ws.socketId}`);
    console.log(`[WS_MULTI_SESSION] Base code: ${session.baseCode}`);
    
    // Check socket state before sending
    if (ws.readyState !== WebSocket.OPEN) {
      console.error(`[WS_MULTI_SESSION] ❌ Cannot send response - socket not open. State: ${ws.readyState}`);
      return;
    }
    
    ws.send(JSON.stringify(response));
    console.log(`[WS_MULTI_SESSION] ✅ Multi-user session response sent successfully to ${ws.socketId}`);
    console.log(`[WS_MULTI_SESSION] 🎉 MULTI-USER SESSION CREATED: ${sessionHash}`);
    
  } catch (error) {
    console.error(`[WS_MULTI_SESSION] ❌ Failed to create multi-user session for ${ws.socketId}:`);
    console.error(`[WS_MULTI_SESSION] Error: ${error.message}`);
    
    const errorResponse = {
      type: 'multi_user_session_created',
      success: false,
      error: 'Failed to create multi-user session',
      errorDetails: error.message,
      timestamp: Date.now()
    };

    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(errorResponse));
        console.log(`[WS_MULTI_SESSION] ❌ Error response sent to ${ws.socketId}`);
      }
    } catch (sendError) {
      console.error(`[WS_MULTI_SESSION] ❌ Failed to send error response: ${sendError}`);
    }
  }
}

// Handle User Joined Session (dynamic)
function handleUserJoinedSession(ws, message) {
  console.log(`[WS_USER_JOIN] User joined session: ${message.userInfo.displayName}`);
  
  try {
    const { sessionHash, userInfo, keycodeChar } = message;
    const session = sessionManager.getSessionByHash(sessionHash);
    
    if (!session) {
      console.error(`[WS_USER_JOIN] Session not found: ${sessionHash}`);
      return;
    }

    const newUserKeycode = sessionManager.addUserToSession(sessionHash, userInfo);
    
    if (newUserKeycode) {
      console.log(`[WS_USER_JOIN] Successfully added user ${userInfo.displayName} with keycode ${newUserKeycode.fullKeycode}`);
      
      // Notify all web apps in the session about the new user
      const notification = {
        type: 'user_joined_session',
        sessionHash: sessionHash,
        newUser: newUserKeycode,
        timestamp: Date.now()
      };
      
      // Send to all connected web apps in this session
      for (const [keycode, webAppSocketId] of session.webAppConnections) {
        const webAppSocket = io.sockets.sockets.get(webAppSocketId);
        if (webAppSocket) {
          webAppSocket.emit('user_joined_session', notification);
        }
      }
    }
    
  } catch (error) {
    console.error(`[WS_USER_JOIN] Error handling user joined: ${error.message}`);
  }
}

// Handle User Left Session (dynamic)
function handleUserLeftSession(ws, message) {
  console.log(`[WS_USER_LEFT] User left session: ${message.userInfo.displayName}`);
  
  try {
    const { sessionHash, userInfo, keycodeChar } = message;
    const session = sessionManager.getSessionByHash(sessionHash);
    
    if (!session) {
      console.error(`[WS_USER_LEFT] Session not found: ${sessionHash}`);
      return;
    }

    // Remove user from session
    const userIndex = session.users.findIndex(u => u.connectionId === userInfo.connectionId);
    if (userIndex >= 0) {
      session.users.splice(userIndex, 1);
      console.log(`[WS_USER_LEFT] Removed user ${userInfo.displayName} from session ${sessionHash}`);
      
      // Notify all web apps in the session about the user leaving
      const notification = {
        type: 'user_left_session',
        sessionHash: sessionHash,
        leftUser: {
          connectionId: userInfo.connectionId,
          displayName: userInfo.displayName,
          keycodeChar: keycodeChar
        },
        timestamp: Date.now()
      };
      
      // Send to all connected web apps in this session
      for (const [keycode, webAppSocketId] of session.webAppConnections) {
        const webAppSocket = io.sockets.sockets.get(webAppSocketId);
        if (webAppSocket) {
          webAppSocket.emit('user_left_session', notification);
        }
      }
    }
    
  } catch (error) {
    console.error(`[WS_USER_LEFT] Error handling user left: ${error.message}`);
  }
}

// Socket.IO connection handling (for web app only)
io.on('connection', (socket) => {
  console.log(`[SOCKETIO] Web app connected: ${socket.id}`);

  // Web app joins a session with 7-character keycode (multi-user system only)
  socket.on('web_app_join_session', (data, callback) => {
    try {
      const { sessionCode } = data;
      if (!sessionCode || typeof sessionCode !== 'string') {
        throw new Error('Invalid session code');
      }

      const upperCaseCode = sessionCode.toUpperCase();
      
      // Only support 7-character keycodes (multi-user system)
      if (upperCaseCode.length !== 7) {
        throw new Error('Invalid keycode format. Expected 7-character keycode (e.g., ABC123A)');
      }

      const result = sessionManager.joinSessionWithKeycode(upperCaseCode, socket.id);
      
      if (result.success) {
        console.log(`[WEB_APP] ${socket.id} joined session with code ${upperCaseCode}`);
        
        // Notify Lens Studio that web app connected
        if (result.session && result.session.lensStudioSocket) {
          const webAppConnectedData = {
            sessionCode: upperCaseCode,
            userKeycode: result.userKeycode || null,
            userId: socket.id,
            timestamp: Date.now()
          };
          
          sendToLensStudio(result.session.lensStudioSocket, 'web_app_connected', webAppConnectedData);
        }
      }

      if (callback && typeof callback === 'function') {
        callback(result);
      }
    } catch (error) {
      console.error(`[ERROR] Web app join session failed for ${socket.id}:`, error);
      if (callback && typeof callback === 'function') {
        callback({
          success: false,
          error: error.message
        });
      }
    }
  });

  // Web app sends mouth openness data
  socket.on('mouth_data', (data) => {
    try {
      const session = sessionManager.getSessionBySocket(socket.id);
      if (!session || !session.lensStudioSocket) {
        console.warn(`[MOUTH_DATA] No valid session or Lens Studio connection for ${socket.id}`);
        return;
      }

      // Validate mouth data
      if (typeof data.mouthOpenness !== 'number' || data.mouthOpenness < 0 || data.mouthOpenness > 1) {
        console.warn(`[MOUTH_DATA] Invalid mouth openness value: ${data.mouthOpenness}`);
        return;
      }

      // Update session activity
      sessionManager.updateActivity(session.code);

      // Forward mouth data to Lens Studio with user identification
      const mouthDataPacket = {
        type: 'mouth_data',
        sessionCode: session.code,
        userId: socket.id,
        timestamp: Date.now(),
        mouthOpenness: data.mouthOpenness,
        jawDistance: data.jawDistance || null,
        source: 'web_app'
      };

      // Send mouth data to Lens Studio
      sendToLensStudio(session.lensStudioSocket, 'mouth_data', mouthDataPacket);
      
      // Log every 30th frame to avoid spam (assuming 30fps)
      if (Date.now() % 1000 < 50) { // Approximate 1-second intervals
        console.log(`[MOUTH_DATA] ${session.code}: User ${socket.id} -> LS ${session.lensStudioSocket} | Openness: ${data.mouthOpenness.toFixed(3)}`);
      }
    } catch (error) {
      console.error(`[ERROR] Mouth data processing failed for ${socket.id}:`, error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`[DISCONNECT] ${socket.id} disconnected: ${reason}`);
    
    const session = sessionManager.removeUserFromSession(socket.id);
    if (session) {
      // Notify the other user in the session about disconnection
      const otherSocketId = session.lensStudioSocket === socket.id 
        ? session.webAppSocket 
        : session.lensStudioSocket;
        
      if (otherSocketId) {
        const disconnectionData = {
          sessionCode: session.code,
          disconnectedUserId: socket.id,
          timestamp: Date.now()
        };
        
        // Check if the other user is Lens Studio and send appropriate message
        if (session.lensStudioSocket === otherSocketId) {
          sendToLensStudio(otherSocketId, 'user_disconnected', disconnectionData);
        } else {
          io.to(otherSocketId).emit('user_disconnected', disconnectionData);
        }
      }
    }
  });

  // Error handling
  socket.on('error', (error) => {
    console.error(`[SOCKET_ERROR] ${socket.id}:`, error);
  });
});

// Serve main application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  const stats = sessionManager.getStats();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    sessions: stats
  });
});

// Session statistics endpoint
app.get('/stats', (req, res) => {
  const stats = sessionManager.getStats();
  res.json(stats);
});

// Start server
server.listen(PORT, () => {
  console.log(`[SERVER] Face Tracker WebSocket Server running on port ${PORT}`);
  console.log(`[SERVER] Health check: http://localhost:${PORT}/health`);
  console.log(`[SERVER] Session stats: http://localhost:${PORT}/stats`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM received, shutting down gracefully');
  clearInterval(sessionManager.cleanupInterval);
  server.close(() => {
    console.log('[SERVER] Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[SERVER] SIGINT received, shutting down gracefully');
  clearInterval(sessionManager.cleanupInterval);
  server.close(() => {
    console.log('[SERVER] Process terminated');
    process.exit(0);
  });
});
