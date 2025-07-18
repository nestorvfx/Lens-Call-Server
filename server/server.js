const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Server configuration
const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);

// CORS configuration
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.CORS_ORIGIN, /\.onrender\.com$/]
    : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8080", "file://"],
  methods: ["GET", "POST"],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Socket.IO for web apps
const io = socketIo(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  path: '/socket.io/'
});

// Native WebSocket for Lens Studio
const wss = new WebSocket.Server({ noServer: true });

// Handle WebSocket upgrades
server.on('upgrade', (request, socket, head) => {
  if (request.url.startsWith('/socket.io/')) return;
  
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

console.log(`[SERVER] Multi-User Face Tracker running on port ${PORT}`);

// Session Management
class MultiUserSessionManager {
  constructor() {
    this.sessions = new Map(); // sessionHash -> SessionData
    this.keycodeToSession = new Map(); // fullKeycode -> sessionHash
    this.socketToSession = new Map(); // socketId -> sessionHash
    this.cleanupInterval = setInterval(() => this.cleanup(), 300000); // 5 minutes
  }

  generateBaseCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  createSession(sessionHash, users, lensStudioSocketId) {
    const baseCode = this.generateBaseCode();
    
    const sessionData = {
      sessionHash,
      baseCode,
      lensStudioSocketId,
      users: users.map(user => ({
        userId: user.userId,
        displayName: user.displayName,
        keycodeChar: user.keycodeChar,
        fullKeycode: baseCode + user.keycodeChar
      })),
      webAppConnections: new Map(), // fullKeycode -> socketId
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    this.sessions.set(sessionHash, sessionData);
    this.socketToSession.set(lensStudioSocketId, sessionHash);
    
    // Map all keycodes to this session
    sessionData.users.forEach(user => {
      this.keycodeToSession.set(user.fullKeycode, sessionHash);
    });

    console.log(`[SESSION] Created: ${baseCode} (${users.length} users)`);
    return sessionData;
  }

  joinWebApp(keycode, webAppSocketId) {
    const sessionHash = this.keycodeToSession.get(keycode);
    if (!sessionHash) {
      return { success: false, error: 'Invalid keycode' };
    }

    const session = this.sessions.get(sessionHash);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    // Check if keycode already in use
    if (session.webAppConnections.has(keycode)) {
      return { success: false, error: 'Keycode already in use' };
    }

    session.webAppConnections.set(keycode, webAppSocketId);
    this.socketToSession.set(webAppSocketId, sessionHash);
    session.lastActivity = Date.now();

    console.log(`[JOIN] ${keycode} → ${webAppSocketId}`);
    return { success: true, session };
  }

  getSessionBySocket(socketId) {
    const sessionHash = this.socketToSession.get(socketId);
    return sessionHash ? this.sessions.get(sessionHash) : null;
  }

  removeSocket(socketId) {
    const sessionHash = this.socketToSession.get(socketId);
    if (!sessionHash) return null;

    const session = this.sessions.get(sessionHash);
    if (!session) return null;

    // Remove from socket mapping
    this.socketToSession.delete(socketId);

    // Remove from Lens Studio
    if (session.lensStudioSocketId === socketId) {
      session.lensStudioSocketId = null;
    }

    // Remove from web app connections
    for (const [keycode, webSocketId] of session.webAppConnections) {
      if (webSocketId === socketId) {
        session.webAppConnections.delete(keycode);
        break;
      }
    }

    return session;
  }

  cleanup() {
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000; // 2 hours

    for (const [sessionHash, session] of this.sessions) {
      if ((now - session.lastActivity) > maxAge) {
        console.log(`[CLEANUP] Removing session ${session.baseCode}`);
        
        // Clean up all mappings
        this.sessions.delete(sessionHash);
        if (session.lensStudioSocketId) {
          this.socketToSession.delete(session.lensStudioSocketId);
        }
        session.webAppConnections.forEach((socketId) => {
          this.socketToSession.delete(socketId);
        });
        session.users.forEach(user => {
          this.keycodeToSession.delete(user.fullKeycode);
        });
      }
    }
  }

  getStats() {
    return {
      sessions: this.sessions.size,
      totalUsers: Array.from(this.sessions.values()).reduce((sum, s) => sum + s.users.length, 0),
      activeConnections: this.socketToSession.size
    };
  }
}

const sessionManager = new MultiUserSessionManager();

// Lens Studio WebSocket Handler
wss.on('connection', (ws, req) => {
  ws.id = uuidv4();
  console.log(`[LENS] Connected: ${ws.id}`);

  ws.on('message', (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      
      if (message.type === 'multi_user_session_request') {
        handleSessionRequest(ws, message);
      } else {
        console.log(`[LENS] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`[LENS] Message parse error:`, error);
    }
  });

  ws.on('close', () => {
    console.log(`[LENS] Disconnected: ${ws.id}`);
    const session = sessionManager.removeSocket(ws.id);
    
    if (session) {
      // Notify all web apps
      session.webAppConnections.forEach((socketId) => {
        io.to(socketId).emit('lens_disconnected', {
          sessionCode: session.baseCode,
          timestamp: Date.now()
        });
      });
    }
  });
});

function handleSessionRequest(ws, message) {
  try {
    const { sessionHash, users } = message;
    
    if (!sessionHash || !users || !Array.isArray(users)) {
      throw new Error('Invalid session request');
    }

    const session = sessionManager.createSession(sessionHash, users, ws.id);
    
    const response = {
      type: 'multi_user_session_created',
      success: true,
      baseCode: session.baseCode,
      sessionHash: session.sessionHash,
      users: session.users,
      timestamp: Date.now()
    };

    ws.send(JSON.stringify(response));
    
    console.log(`[SESSION] Keycodes:`);
    session.users.forEach(user => {
      console.log(`  ${user.displayName}: ${user.fullKeycode}`);
    });

  } catch (error) {
    console.error(`[SESSION] Creation failed:`, error);
    
    ws.send(JSON.stringify({
      type: 'multi_user_session_created',
      success: false,
      error: error.message,
      timestamp: Date.now()
    }));
  }
}

// Web App Socket.IO Handler
io.on('connection', (socket) => {
  console.log(`[WEB] Connected: ${socket.id}`);

  socket.on('join_session', (data, callback) => {
    const { keycode } = data;
    
    if (!keycode || typeof keycode !== 'string') {
      return callback({ success: false, error: 'Invalid keycode' });
    }

    const result = sessionManager.joinWebApp(keycode.toUpperCase(), socket.id);
    
    if (result.success) {
      // Notify Lens Studio
      const lensSocket = findLensStudioSocket(result.session.lensStudioSocketId);
      if (lensSocket) {
        lensSocket.send(JSON.stringify({
          type: 'web_app_connected',
          keycode: keycode.toUpperCase(),
          timestamp: Date.now()
        }));
      }
    }

    callback(result);
  });

  socket.on('mouth_data', (data) => {
    const session = sessionManager.getSessionBySocket(socket.id);
    if (!session) return;

    // Validate data
    if (typeof data.mouthOpenness !== 'number' || data.mouthOpenness < 0 || data.mouthOpenness > 1) {
      return;
    }

    // Find sender's keycode
    let senderKeycode = null;
    for (const [keycode, socketId] of session.webAppConnections) {
      if (socketId === socket.id) {
        senderKeycode = keycode;
        break;
      }
    }

    if (!senderKeycode) return;

    // Route to all other users
    const recipients = [];
    session.webAppConnections.forEach((socketId, keycode) => {
      if (keycode !== senderKeycode) {
        recipients.push(keycode);
      }
    });

    // Send to Lens Studio
    const lensSocket = findLensStudioSocket(session.lensStudioSocketId);
    if (lensSocket) {
      lensSocket.send(JSON.stringify({
        type: 'mouth_data',
        fromUser: senderKeycode,
        toUsers: recipients,
        mouthOpenness: data.mouthOpenness,
        timestamp: Date.now()
      }));
    }

    session.lastActivity = Date.now();
  });

  socket.on('disconnect', () => {
    console.log(`[WEB] Disconnected: ${socket.id}`);
    sessionManager.removeSocket(socket.id);
  });
});

function findLensStudioSocket(socketId) {
  for (const ws of wss.clients) {
    if (ws.id === socketId && ws.readyState === WebSocket.OPEN) {
      return ws;
    }
  }
  return null;
}

// HTTP Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    ...sessionManager.getStats()
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
  console.log(`[SERVER] Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SERVER] Shutting down gracefully...');
  clearInterval(sessionManager.cleanupInterval);
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[SERVER] Shutting down gracefully...');
  clearInterval(sessionManager.cleanupInterval);
  server.close(() => process.exit(0));
});
