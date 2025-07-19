const WebSocket = require('ws');

// Configuration
const PORT = process.env.PORT || 3000;

// Create WebSocket server
const wss = new WebSocket.Server({ port: PORT });

const sessions = new Map();
const webClients = new Map();
const activeBaseCodes = new Set();

console.log(`🚀 WebSocket server started on ws://localhost:${PORT}`);

// --- Helper Functions ---

function generateUniqueBaseCode() {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code;
    do {
        code = Array.from({ length: 6 }, () => CHARS.charAt(Math.floor(Math.random() * CHARS.length))).join('');
    } while (activeBaseCodes.has(code));
    activeBaseCodes.add(code);
    return code;
}

function findSessionByBaseCode(baseCode) {
    for (const session of sessions.values()) {
        if (session.baseSessionCode === baseCode) {
            return session;
        }
    }
    return undefined;
}

// --- WebSocket Event Handlers ---

wss.on('connection', (ws) => {
    console.log('🔌 New client connected.');
    ws.clientInfo = {
        type: null,
        sessionHash: null,
        connectionId: null,
        fullKeycode: null,
    };

    ws.on('message', (message) => {
        let data;
        try {
            let messageStr = message.toString();
            
            // Clean up the message - try to find valid JSON by looking for closing brace
            const lastBraceIndex = messageStr.lastIndexOf('}');
            if (lastBraceIndex !== -1 && lastBraceIndex < messageStr.length - 1) {
                const cleanMessage = messageStr.substring(0, lastBraceIndex + 1);
                const extraChars = messageStr.substring(lastBraceIndex + 1);
                
                console.log(`🧹 Cleaned message, removed extra characters: "${extraChars}"`);
                messageStr = cleanMessage;
            }
            
            data = JSON.parse(messageStr);
        } catch (e) {
            console.error('❌ Error parsing JSON message:', message.toString());
            return;
        }
        switch (data.type) {
            case 'lens_studio_request_session': handleHostSessionRequest(ws, data); break;
            case 'lens_studio_join_session': handleClientJoinRequest(ws, data); break;
            case 'user_keycode_assigned': handleUserKeycodeAssignment(data); break;
            case 'web_app_connect': handleWebAppConnection(ws, data); break;
            case 'mouth_data': handleMouthData(data); break;
            default: console.warn(`❓ Unknown message type received: ${data.type}`); break;
        }
    });

    ws.on('close', () => handleDisconnection(ws));
    ws.on('error', (error) => console.error('❌ WebSocket error:', error));
});

// --- Message Handling Logic (No changes to these functions) ---

function handleHostSessionRequest(ws, data) {
    const { sessionHash, connectionId } = data;
    if (!sessionHash || !connectionId) {
        console.error('❌ Host session request missing sessionHash or connectionId.');
        return;
    }
    console.log(`👑 Host [${connectionId}] requested session with hash [${sessionHash}]`);
    const baseSessionCode = generateUniqueBaseCode();
    const newSession = {
        baseSessionCode,
        lensClients: new Map(),
        userCodeMap: new Map(),
    };
    newSession.lensClients.set(connectionId, ws);
    sessions.set(sessionHash, newSession);
    ws.clientInfo = { type: 'lens_host', sessionHash, connectionId, fullKeycode: null };
    ws.send(JSON.stringify({
        type: 'lens_studio_session_response',
        success: true,
        baseSessionCode,
        sessionHash
    }));
    console.log(`✅ Session [${sessionHash}] created with code [${baseSessionCode}]`);
}

function handleClientJoinRequest(ws, data) {
    const { sessionHash, connectionId } = data;
    const session = sessions.get(sessionHash);
    if (!session) {
        console.error(`❌ Client [${connectionId}] tried to join non-existent session [${sessionHash}]`);
        ws.send(JSON.stringify({ type: 'error', message: 'Session not found.' }));
        return;
    }
    console.log(`🔗 Client [${connectionId}] joining session [${sessionHash}]`);
    session.lensClients.set(connectionId, ws);
    ws.clientInfo = { type: 'lens_client', sessionHash, connectionId, fullKeycode: null };
    ws.send(JSON.stringify({
        type: 'lens_studio_join_response',
        success: true,
        baseSessionCode: session.baseSessionCode,
        sessionHash
    }));
}

function handleUserKeycodeAssignment(data) {
    const { sessionHash, userMapping } = data;
    const session = sessions.get(sessionHash);
    if (!session || !userMapping || !userMapping.connectionId) return;
    session.userCodeMap.set(userMapping.fullKeycode, userMapping.connectionId);
    const lensClientWs = session.lensClients.get(userMapping.connectionId);
    if (lensClientWs) {
        lensClientWs.clientInfo.fullKeycode = userMapping.fullKeycode;
    }
    console.log(`- 📋 Code registered: [${userMapping.displayName}] (${userMapping.connectionId}) -> [${userMapping.fullKeycode}]`);
}

function handleWebAppConnection(ws, data) {
    const { sevenCharCode } = data;
    if (!sevenCharCode || sevenCharCode.length !== 7) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid code format.' }));
        ws.close();
        return;
    }
    const baseCode = sevenCharCode.substring(0, 6);
    const session = findSessionByBaseCode(baseCode);
    if (!session || !session.userCodeMap.has(sevenCharCode)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid or inactive session code.' }));
        ws.close();
        return;
    }
    const sessionHash = [...sessions.entries()].find(([hash, s]) => s.baseSessionCode === baseCode)?.[0];
    ws.clientInfo = { type: 'web_app', fullKeycode: sevenCharCode, sessionHash: sessionHash, connectionId: null };
    webClients.set(sevenCharCode, ws);
    ws.send(JSON.stringify({ type: 'connection_successful' }));
    console.log(`✅ Web App connected with code [${sevenCharCode}]`);
    session.lensClients.forEach(clientWs => {
        clientWs.send(JSON.stringify({
            type: 'web_app_connected',
            sevenCharCode
        }));
    });
}

// --- THIS IS THE REWRITTEN FUNCTION ---

function handleMouthData(data) {
    const { sevenCharCode, mouthOpenness } = data;
    const webClientWs = webClients.get(sevenCharCode);

    // Guard against invalid data or disconnected web clients
    if (!webClientWs || !webClientWs.clientInfo.sessionHash) return;

    const session = sessions.get(webClientWs.clientInfo.sessionHash);
    if (!session) return;

    // Find the connectionId of the user who sent this data.
    const senderConnectionId = session.userCodeMap.get(sevenCharCode);
    if (!senderConnectionId) {
        // This can happen if the user disconnected but the web app is still sending data.
        console.warn(`⚠️ Received mouth data for code [${sevenCharCode}] which has no owner. Ignoring.`);
        return;
    }

    // Prepare the message once, before the loop.
    const message = JSON.stringify({
        type: 'mouth_data',
        sevenCharCode,
        mouthOpenness,
        timestamp: Date.now()
    });

    // Iterate through all Lens clients in the session.
    session.lensClients.forEach((clientWs, clientConnectionId) => {
        // *** THE CORE LOGIC CHANGE IS HERE ***
        // Only send the message if the recipient is NOT the original sender.
        if (clientConnectionId !== senderConnectionId) {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(message);
            }
        }
    });
}

function handleDisconnection(ws) {
    const { type, sessionHash, connectionId, fullKeycode } = ws.clientInfo;
    console.log(`🔌 Client [${connectionId || fullKeycode}] disconnected.`);

    if (type === 'web_app') {
        webClients.delete(fullKeycode);
        const session = sessions.get(sessionHash);
        if (session) {
            session.lensClients.forEach(clientWs => {
                clientWs.send(JSON.stringify({ type: 'web_app_disconnected', sevenCharCode: fullKeycode }));
            });
        }
    } else if (type === 'lens_host' || type === 'lens_client') {
        const session = sessions.get(sessionHash);
        if (!session) return;
        session.lensClients.delete(connectionId);
        if (fullKeycode) {
            session.userCodeMap.delete(fullKeycode);
        }
        if (type === 'lens_host') {
            console.log(`💥 Host [${connectionId}] disconnected. Terminating session [${sessionHash}]...`);
            session.userCodeMap.forEach((connId, code) => {
                const webClientWs = webClients.get(code);
                if (webClientWs) {
                    webClientWs.close();
                    webClients.delete(code);
                }
            });
            session.lensClients.forEach(clientWs => {
                clientWs.send(JSON.stringify({ type: 'session_ended', reason: 'Host disconnected.' }));
                clientWs.close();
            });
            activeBaseCodes.delete(session.baseSessionCode);
            sessions.delete(sessionHash);
        }
    }
}