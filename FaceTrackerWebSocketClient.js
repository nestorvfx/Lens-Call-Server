/**
 * WebSocket Face Tracker Integration for Lens Studio Spectacles
 * 
 * This script connects to the Face Tracker WebSocket server, requests a session code,
 * and receives real-time mouth openness data from the web application.
 * 
 * Features:
 * - Requests session code from server
 * - Prints session code to console for user input in web app
 * - Receives and prints mouth openness data with user identification
 * - Handles connection management and error recovery
 */

//@input InternetModule internetModule
//@input string serverUrl = "ws://localhost:3000"
//@input bool autoRequestSession = true
//@input bool enableDebugLogging = true

const TAG = "FaceTrackerWebSocket";

// WebSocket connection
var socket = null;
var isConnected = false;
var currentSessionCode = null;
var reconnectAttempts = 0;
var maxReconnectAttempts = 5;
var reconnectDelay = 2000; // 2 seconds

// Data tracking
var lastMouthDataTime = 0;
var mouthDataCount = 0;
var connectedUsers = new Map();

function onAwake() {
    print("Face Tracker WebSocket Client initialized");
    
    if (!script.internetModule) {
        print("ERROR: InternetModule is required! Please assign it in the inspector.");
        return;
    }

    if (script.autoRequestSession) {
        // Small delay to ensure everything is initialized
        var delayedEvent = script.createEvent("DelayedCallbackEvent");
        delayedEvent.bind(function() {
            requestNewSession();
        });
        delayedEvent.trigger(1.0); // 1 second delay
    }

    print("Use manual controls to request a session if auto-request is disabled");
}

/**
 * Request a new session code from the server
 */
function requestNewSession() {
    if (isConnected) {
        print("Already connected. Disconnecting first...");
        disconnect();
    }

    print("Requesting new session from server...");
    connect();
}

/**
 * Connect to the WebSocket server
 */
function connect() {
    try {
        // Create WebSocket connection using InternetModule
        socket = script.internetModule.createWebSocket(script.serverUrl);
        
        if (!socket) {
            print("ERROR: Failed to create WebSocket connection");
            return;
        }

        debugLog("Created WebSocket connection to: " + script.serverUrl);

        // Set up event handlers
        socket.onopen = function(event) {
            print("✅ Connected to Face Tracker server");
            isConnected = true;
            reconnectAttempts = 0;
            
            // Request a session code
            requestSessionCode();
        };

        socket.onmessage = function(event) {
            handleMessage(event);
        };

        socket.onclose = function(event) {
            print("WebSocket connection closed. Code: " + event.code + ", Clean: " + event.wasClean);
            handleDisconnection();
        };

        socket.onerror = function(event) {
            print("❌ WebSocket connection error occurred");
            handleConnectionError();
        };

    } catch (error) {
        print("ERROR: Failed to create WebSocket connection: " + error);
        scheduleReconnect();
    }
}

/**
 * Request a session code from the server
 */
function requestSessionCode() {
    if (!socket || !isConnected) {
        print("ERROR: Cannot request session code: not connected to server");
        return;
    }

    try {
        // For Socket.IO compatibility, we'll send a simple request
        // The server expects 'lens_studio_request_session' event
        socket.send("lens_studio_request_session");
        debugLog("Session code request sent to server");

    } catch (error) {
        print("ERROR: Failed to request session code: " + error);
    }
}

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(event) {
    try {
        var messageData;

        // Handle both text and binary messages
        if (typeof event.data === 'string') {
            messageData = JSON.parse(event.data);
        } else {
            print("Received binary message, skipping...");
            return;
        }

        debugLog("Received message: " + JSON.stringify(messageData));

        switch (messageData.type) {
            case 'session_created':
                handleSessionCreated(messageData);
                break;
                
            case 'web_app_connected':
                handleWebAppConnected(messageData);
                break;
                
            case 'mouth_data':
                handleMouthData(messageData);
                break;
                
            case 'user_disconnected':
                handleUserDisconnected(messageData);
                break;
                
            default:
                debugLog("Unknown message type: " + messageData.type);
                break;
        }

    } catch (error) {
        print("ERROR: Error handling message: " + error);
    }
}

/**
 * Handle session created response
 */
function handleSessionCreated(data) {
    if (data.success && data.sessionCode) {
        currentSessionCode = data.sessionCode;
        
        // Print session code prominently for user
        print("==================================================");
        print("📱 FACE TRACKER SESSION CODE 📱");
        print("==================================================");
        print("SESSION CODE: " + currentSessionCode);
        print("==================================================");
        print("1. Open the Face Tracker web app");
        print("2. Enter this code in the session input field");
        print("3. Click 'Connect to Session'");
        print("4. Start face tracking to send mouth data");
        print("==================================================");
        
        debugLog("Session created successfully. Code: " + currentSessionCode);
        
    } else {
        print("ERROR: Failed to create session: " + (data.error || 'Unknown error'));
        scheduleReconnect();
    }
}

/**
 * Handle web app connection
 */
function handleWebAppConnected(data) {
    var userId = data.userId || 'unknown';
    connectedUsers.set(userId, {
        userId: userId,
        connectedAt: Date.now(),
        sessionCode: data.sessionCode
    });

    print("🌐 WEB APP CONNECTED!");
    print("User ID: " + userId);
    print("Session: " + data.sessionCode);
    print("Ready to receive mouth tracking data...");
    
    debugLog("Web app connected - User: " + userId + ", Session: " + data.sessionCode);
}

/**
 * Handle mouth data from web app
 */
function handleMouthData(data) {
    var userId = data.userId || 'unknown';
    var mouthOpenness = data.mouthOpenness;
    var timestamp = data.timestamp;
    
    // Update user info
    if (connectedUsers.has(userId)) {
        var userInfo = connectedUsers.get(userId);
        userInfo.lastMouthData = mouthOpenness;
        userInfo.lastDataTime = timestamp;
    }

    // Print mouth data (throttled to avoid spam)
    mouthDataCount++;
    var now = Date.now();
    
    // Print every 30th frame or every 1 second, whichever comes first
    if (mouthDataCount % 30 === 0 || (now - lastMouthDataTime) >= 1000) {
        var percentage = Math.round(mouthOpenness * 100);
        var userDisplay = connectedUsers.size > 1 ? " [User: " + userId.slice(-4) + "]" : '';
        
        print("👄 Mouth Opening" + userDisplay + ": " + percentage + "% (" + mouthOpenness.toFixed(3) + ")");
        
        lastMouthDataTime = now;
    }

    // Debug logging for detailed data
    debugLog("Mouth data - User: " + userId + ", Opening: " + mouthOpenness.toFixed(3) + ", Time: " + timestamp);
}

/**
 * Handle user disconnection
 */
function handleUserDisconnected(data) {
    var userId = data.disconnectedUserId || 'unknown';
    
    if (connectedUsers.has(userId)) {
        connectedUsers.delete(userId);
    }

    print("❌ USER DISCONNECTED: " + userId);
    debugLog("User disconnected: " + userId);
    
    if (connectedUsers.size === 0) {
        print("No users connected. Waiting for web app connection...");
    }
}

/**
 * Handle connection disconnection
 */
function handleDisconnection() {
    isConnected = false;
    socket = null;
    connectedUsers.clear();
    
    print("❌ DISCONNECTED FROM SERVER");
    debugLog("Disconnected from Face Tracker server");
    
    scheduleReconnect();
}

/**
 * Handle connection errors
 */
function handleConnectionError() {
    print("❌ WebSocket connection error");
    isConnected = false;
    
    scheduleReconnect();
}

/**
 * Schedule reconnection attempt
 */
function scheduleReconnect() {
    if (reconnectAttempts >= maxReconnectAttempts) {
        print("❌ CONNECTION FAILED - Max reconnection attempts (" + maxReconnectAttempts + ") reached");
        print("❌ Manual restart required");
        return;
    }

    reconnectAttempts++;
    var delay = reconnectDelay * reconnectAttempts; // Linear backoff
    
    print("🔄 Reconnecting in " + (delay / 1000) + " seconds... (" + reconnectAttempts + "/" + maxReconnectAttempts + ")");
    debugLog("Scheduling reconnection attempt " + reconnectAttempts + "/" + maxReconnectAttempts + " in " + delay + "ms");
    
    var delayedEvent = script.createEvent("DelayedCallbackEvent");
    delayedEvent.bind(function() {
        if (!isConnected) {
            connect();
        }
    });
    delayedEvent.trigger(delay / 1000);
}

/**
 * Manually disconnect from server
 */
function disconnect() {
    if (socket) {
        socket.close();
    }
    
    isConnected = false;
    socket = null;
    currentSessionCode = null;
    connectedUsers.clear();
    reconnectAttempts = 0;
    
    print("🔌 MANUALLY DISCONNECTED");
    debugLog("Manually disconnected from server");
}

/**
 * Get current session information
 */
function getSessionInfo() {
    return {
        isConnected: isConnected,
        sessionCode: currentSessionCode,
        connectedUsers: Array.from(connectedUsers.values()),
        reconnectAttempts: reconnectAttempts
    };
}

/**
 * Debug logging helper
 */
function debugLog(message) {
    if (script.enableDebugLogging) {
        print("[DEBUG] " + message);
    }
}

// Public API for manual control
script.requestNewSession = requestNewSession;
script.disconnect = disconnect;
script.getSessionInfo = getSessionInfo;

// Initialize on awake
script.createEvent("OnAwakeEvent").bind(onAwake);
