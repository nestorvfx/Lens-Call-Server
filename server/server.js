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
class SessionManager {
  constructor() {
    this.sessions = new Map(); // sessionCode -> SessionData
    this.userSessions = new Map(); // socketId -> sessionCode
    this.cleanupInterval = setInterval(() => this.cleanupInactiveSessions(), 60000); // 1 minute
  }

  // Generate 6-character session code (excluding confusing characters)
  generateSessionCode() {
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

  // Create new session initiated by Lens Studio
  createSession(lensStudioSocketId) {
    const sessionCode = this.generateSessionCode();
    const sessionData = {
      code: sessionCode,
      lensStudioSocket: lensStudioSocketId,
      webAppSocket: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      isActive: true
    };
    
    this.sessions.set(sessionCode, sessionData);
    this.userSessions.set(lensStudioSocketId, sessionCode);
    
    console.log(`[SESSION] Created session ${sessionCode} for Lens Studio socket ${lensStudioSocketId}`);
    return sessionData;
  }

  // Join session from web app
  joinSession(sessionCode, webAppSocketId) {
    const session = this.sessions.get(sessionCode);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    if (session.webAppSocket && session.webAppSocket !== webAppSocketId) {
      return { success: false, error: 'Session already has a web app user' };
    }

    session.webAppSocket = webAppSocketId;
    session.lastActivity = Date.now();
    this.userSessions.set(webAppSocketId, sessionCode);
    
    console.log(`[SESSION] Web app ${webAppSocketId} joined session ${sessionCode}`);
    return { success: true, session };
  }

  // Get session by code
  getSession(sessionCode) {
    return this.sessions.get(sessionCode);
  }

  // Get session by socket ID
  getSessionBySocket(socketId) {
    const sessionCode = this.userSessions.get(socketId);
    return sessionCode ? this.sessions.get(sessionCode) : null;
  }

  // Update session activity
  updateActivity(sessionCode) {
    const session = this.sessions.get(sessionCode);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  // Remove user from session
  removeUserFromSession(socketId) {
    const sessionCode = this.userSessions.get(socketId);
    if (!sessionCode) return null;

    const session = this.sessions.get(sessionCode);
    if (!session) return null;

    // Remove user from session
    if (session.lensStudioSocket === socketId) {
      session.lensStudioSocket = null;
    } else if (session.webAppSocket === socketId) {
      session.webAppSocket = null;
    }

    this.userSessions.delete(socketId);

    // If session has no users, mark as inactive
    if (!session.lensStudioSocket && !session.webAppSocket) {
      session.isActive = false;
      console.log(`[SESSION] Session ${sessionCode} marked as inactive`);
    }

    console.log(`[SESSION] Removed socket ${socketId} from session ${sessionCode}`);
    return session;
  }

  // Cleanup inactive sessions (older than 2 hours)
  cleanupInactiveSessions() {
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000; // 2 hours

    for (const [code, session] of this.sessions) {
      if (!session.isActive || (now - session.lastActivity) > maxAge) {
        console.log(`[SESSION] Cleaning up inactive session ${code}`);
        this.sessions.delete(code);
        
        // Clean up user mappings
        if (session.lensStudioSocket) {
          this.userSessions.delete(session.lensStudioSocket);
        }
        if (session.webAppSocket) {
          this.userSessions.delete(session.webAppSocket);
        }
      }
    }
  }

  // Get session statistics
  getStats() {
    return {
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter(s => s.isActive).length,
      connectedUsers: this.userSessions.size
    };
  }
}

// Initialize session manager
const sessionManager = new SessionManager();

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
        case 'lens_studio_request_session':
          handleLensStudioSessionRequest(ws);
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



// Handle Lens Studio session request (native WebSocket)
function handleLensStudioSessionRequest(ws) {
  console.log(`[WS_SESSION] 🎯 Processing session request for socket ${ws.socketId}`);
  
  try {
    console.log(`[WS_SESSION] Creating new session...`);
    const session = sessionManager.createSession(ws.socketId);
    console.log(`[WS_SESSION] ✅ Session created successfully`);
    console.log(`[WS_SESSION] Session code: ${session.code}`);
    console.log(`[WS_SESSION] Session data:`, {
      code: session.code,
      lensStudioSocket: session.lensStudioSocket,
      createdAt: new Date(session.createdAt).toISOString(),
      isActive: session.isActive
    });
    
    const response = {
      type: 'session_created',
      success: true,
      sessionCode: session.code,
      message: 'Session created successfully',
      timestamp: Date.now(),
      sessionInfo: {
        code: session.code,
        createdAt: session.createdAt,
        isActive: session.isActive
      }
    };

    console.log(`[WS_SESSION] 📤 Sending response to ${ws.socketId}:`, response);
    
    // Check socket state before sending
    if (ws.readyState !== WebSocket.OPEN) {
      console.error(`[WS_SESSION] ❌ Cannot send response - socket not open. State: ${ws.readyState}`);
      return;
    }
    
    ws.send(JSON.stringify(response));
    console.log(`[WS_SESSION] ✅ Session response sent successfully to ${ws.socketId}`);
    console.log(`[WS_SESSION] 🎉 SESSION CODE FOR USER: ${session.code}`);
    
  } catch (error) {
    console.error(`[WS_SESSION] ❌ Failed to create session for ${ws.socketId}:`);
    console.error(`[WS_SESSION] Error type: ${error.constructor.name}`);
    console.error(`[WS_SESSION] Error message: ${error.message}`);
    console.error(`[WS_SESSION] Error stack:`, error.stack);
    
    const errorResponse = {
      type: 'session_created',
      success: false,
      error: 'Failed to create session',
      errorDetails: error.message,
      timestamp: Date.now()
    };

    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(errorResponse));
        console.log(`[WS_SESSION] ❌ Error response sent to ${ws.socketId}`);
      } else {
        console.error(`[WS_SESSION] ❌ Cannot send error response - socket not open. State: ${ws.readyState}`);
      }
    } catch (sendError) {
      console.error(`[WS_SESSION] ❌ Failed to send error response to ${ws.socketId}:`, sendError);
    }
  }
}

// Socket.IO connection handling (for web app only)
io.on('connection', (socket) => {
  console.log(`[SOCKETIO] Web app connected: ${socket.id}`);

  // Web app joins a session with code
  socket.on('web_app_join_session', (data, callback) => {
    try {
      const { sessionCode } = data;
      if (!sessionCode || typeof sessionCode !== 'string') {
        throw new Error('Invalid session code');
      }

      const result = sessionManager.joinSession(sessionCode.toUpperCase(), socket.id);
      
      if (result.success) {
        console.log(`[WEB_APP] ${socket.id} joined session ${sessionCode}`);
        
        // Notify Lens Studio that web app connected
        if (result.session.lensStudioSocket) {
          const webAppConnectedData = {
            sessionCode: sessionCode,
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
