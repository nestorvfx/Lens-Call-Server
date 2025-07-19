const WebSocket = require('ws');

// Configuration
const PORT = process.env.PORT || 3000;

// Create WebSocket server
const wss = new WebSocket.Server({ port: PORT });

/**
 * In-memory data stores for session management.
 * In a production environment, you might use a more persistent store like Redis.
 */
const sessions = new Map(); // Stores Lens Studio session data. Key: sessionHash, Value: { baseSessionCode, hostSocket }
const webAppConnections = new Map(); // Stores active Web App connections. Key: sevenCharCode, Value: webAppSocket
const activeBaseCodes = new Set(); // Tracks used 6-character base codes to ensure uniqueness.

console.log(`🚀 WebSocket server started on ws://localhost:${PORT}`);

/**
 * Generates a unique 6-character alphanumeric code for a new session.
 * @returns {string} A unique 6-character code.
 */
function generateUniqueBaseCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += characters.charAt(Math.floor(Math.random() * characters.length));
        }
    } while (activeBaseCodes.has(code)); // Ensure the code is not already in use
    activeBaseCodes.add(code);
    return code;
}

// WebSocket server connection handler
wss.on('connection', (ws) => {
    console.log('🔌 New client connected.');

    // Temporary storage for the client's associated code, determined after message exchange
    let clientCode = null;

    // Message handler for this specific client
    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Error parsing JSON message:', e);
            return;
        }

        console.log('➡️ Received message:', data.type);

        switch (data.type) {
            // --- Message from Lens Studio Host ---
            case 'lens_studio_request_session':
                handleLensSessionRequest(ws, data);
                break;

            // --- Message from Web App Client ---
            case 'web_app_connect':
                clientCode = handleWebAppConnection(ws, data);
                break;

            // --- Data Message from Web App Client ---
            case 'mouth_data':
                handleMouthData(data);
                break;

            default:
                console.warn(`❓ Unknown message type: ${data.type}`);
        }
    });

    // Close handler for this specific client
    ws.on('close', () => {
        console.log('🔌 Client disconnected.');
        // If the disconnected client was a Web App, clean up its connection state
        if (clientCode && webAppConnections.has(clientCode)) {
            const baseCode = clientCode.substring(0, 6);
            const session = findSessionByBaseCode(baseCode);

            // Notify Lens Studio that the web app has disconnected
            if (session && session.hostSocket.readyState === WebSocket.OPEN) {
                session.hostSocket.send(JSON.stringify({
                    type: 'web_app_disconnected',
                    sevenCharCode: clientCode
                }));
            }
            webAppConnections.delete(clientCode);
            console.log(`🧹 Cleaned up Web App connection for code: ${clientCode}`);
        }
        // If the disconnected client was a Lens host, we need to find and clean up the session
        else {
             let sessionHashToDelete = null;
             sessions.forEach((session, hash) => {
                 if (session.hostSocket === ws) {
                     sessionHashToDelete = hash;
                 }
             });

             if (sessionHashToDelete) {
                 const session = sessions.get(sessionHashToDelete);
                 activeBaseCodes.delete(session.baseSessionCode);
                 sessions.delete(sessionHashToDelete);
                 console.log(`🧹 Cleaned up Lens Studio session: ${sessionHashToDelete} (Code: ${session.baseSessionCode})`);
                 
                 // Optional: Disconnect all Web Apps associated with this session
                 webAppConnections.forEach((socket, code) => {
                    if (code.startsWith(session.baseSessionCode)) {
                        socket.close();
                    }
                 });
             }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

/**
 * Handles the initial session request from a Lens Studio host.
 * @param {WebSocket} ws - The host's WebSocket connection.
 * @param {object} data - The incoming message data, containing the sessionHash.
 */
function handleLensSessionRequest(ws, data) {
    const { sessionHash } = data;
    if (!sessionHash) {
        console.error('❌ Lens session request missing sessionHash.');
        return;
    }

    // Generate a unique 6-character base code for the session
    const baseSessionCode = generateUniqueBaseCode();

    // Store the new session information
    sessions.set(sessionHash, {
        baseSessionCode,
        hostSocket: ws
    });

    // Send the base code back to the Lens Studio client
    ws.send(JSON.stringify({
        type: 'lens_studio_session_response',
        success: true,
        baseSessionCode: baseSessionCode,
        sessionHash: sessionHash
    }));

    console.log(`✅ Session created for hash ${sessionHash} with code ${baseSessionCode}`);
}

/**
 * Handles a connection attempt from a Web App client.
 * @param {WebSocket} ws - The web app's WebSocket connection.
 * @param {object} data - The incoming message data, containing the sevenCharCode.
 * @returns {string|null} The validated 7-character code if successful.
 */
function handleWebAppConnection(ws, data) {
    const { sevenCharCode } = data;

    // Validate the code
    if (!sevenCharCode || sevenCharCode.length !== 7) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid code format. Must be 7 characters.' }));
        ws.close();
        return null;
    }

    // Check if the code is already in use
    if (webAppConnections.has(sevenCharCode)) {
        ws.send(JSON.stringify({ type: 'error', message: 'This code is already in use.' }));
        ws.close();
        return null;
    }

    // Find the corresponding Lens Studio session from the first 6 chars of the code
    const baseCode = sevenCharCode.substring(0, 6);
    const session = findSessionByBaseCode(baseCode);

    if (!session) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid session code. Please check the code and try again.' }));
        ws.close();
        return null;
    }

    // The connection is valid. Store it.
    webAppConnections.set(sevenCharCode, ws);
    console.log(`🔗 Web App connected with code: ${sevenCharCode}`);

    // Notify the Web App client of successful connection
    ws.send(JSON.stringify({ type: 'connection_successful' }));

    // Notify the Lens Studio host that a web app has connected
    if (session.hostSocket.readyState === WebSocket.OPEN) {
        session.hostSocket.send(JSON.stringify({
            type: 'web_app_connected',
            sevenCharCode: sevenCharCode
        }));
    }
    
    return sevenCharCode; // Return the code to associate it with the connection
}

/**
 * Forwards mouth tracking data from a Web App to the correct Lens Studio host.
 * @param {object} data - The incoming mouth data, containing sevenCharCode and mouthOpenness.
 */
function handleMouthData(data) {
    const { sevenCharCode, mouthOpenness } = data;
    if (!sevenCharCode || mouthOpenness === undefined) return;

    // Find the session associated with this code
    const baseCode = sevenCharCode.substring(0, 6);
    const session = findSessionByBaseCode(baseCode);

    if (session && session.hostSocket.readyState === WebSocket.OPEN) {
        // Forward the data to the correct Lens Studio host
        session.hostSocket.send(JSON.stringify({
            type: 'mouth_data',
            sevenCharCode,
            mouthOpenness,
            timestamp: Date.now()
        }));
    } else {
        // This can happen if the Lens host disconnects but the web app doesn't
        console.warn(`⚠️ Received mouth data for an inactive session: ${sevenCharCode}`);
    }
}

/**
 * Finds a session by its 6-character base code.
 * @param {string} baseCode - The 6-character session code.
 * @returns {object|undefined} The session object or undefined if not found.
 */
function findSessionByBaseCode(baseCode) {
    for (let session of sessions.values()) {
        if (session.baseSessionCode === baseCode) {
            return session;
        }
    }
    return undefined;
}