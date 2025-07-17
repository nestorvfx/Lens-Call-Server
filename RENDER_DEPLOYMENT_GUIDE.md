# 🚀 Render.com Free Tier Deployment Guide
## Face Tracking WebSocket System

*A comprehensive reminder document for deploying the Lens Studio Face Tracking WebSocket system to Render.com free tier*

---

## 📋 **Quick Reference Summary**

### **What Works on Free Tier:**
- ✅ **Automatic HTTPS/WSS** - No SSL setup needed
- ✅ **WebSocket Support** - Both Socket.IO and native WebSockets work
- ✅ **Auto-deployment** - GitHub integration with webhooks
- ✅ **Environment Variables** - Secure secret management
- ✅ **Health Checks** - Built-in monitoring

### **Critical Free Tier Limitations:**
- ⚠️ **15-minute idle timeout** - Service spins down after 15 min of inactivity
- ⚠️ **~1 minute cold start** - Delay when service spins back up
- ⚠️ **750 hours/month limit** - Service suspends if exceeded
- ⚠️ **WebSocket disconnects** - Connections drop during spin-down
- ⚠️ **Single instance only** - No scaling, random restarts possible

---

## 🚨 **WebSocket-Specific Warnings**

### **Known Issues from Community:**
- **"Socket.io connection drops and reconnects every 5 minutes"** (8 replies, 3689 views)
- **"Can't use Node.js websockets on free plan. No solution yet?"** (3 replies, 661 views)
- **"Render Free node.js websocket disconnects for no reason"** (2 replies, 311 views)

### **Free Tier Reality Check:**
- **Real-time apps are challenging** on free tier due to sleep behavior
- **WebSocket connections will drop** when service goes idle
- **Consider paid tier ($7/month)** for production WebSocket apps

---

## 🏗️ **Pre-Deployment Architecture Requirements**

### **✅ Already Completed:**
- [x] **Single Port Configuration** - Server uses `process.env.PORT || 3000`
- [x] **Combined WebSocket Servers** - Socket.IO + Native WebSocket on same port
- [x] **Environment Detection** - Supports both dev and production URLs
- [x] **Health Check Endpoint** - `/health` endpoint exists
- [x] **Graceful Shutdown** - SIGTERM handling implemented

### **Required File Structure:**
```
Face Track Website/
├── server/
│   ├── package.json          ✅ Exists
│   ├── server.js            ✅ Exists  
│   └── node_modules/
├── index.html               ✅ Exists (served statically)
├── .gitignore               📝 Need to create
└── README.md                📝 Update with deployment info
```

---

## 🔧 **Environment Variables Configuration**

### **Required Variables:**
```bash
# Auto-set by Render
NODE_ENV=production           # Auto-set to "production"
PORT=10000                   # Auto-assigned (don't override)

# Custom variables to add manually
CORS_ORIGIN=https://your-app-name.onrender.com
```

### **Automatic Render Variables (Don't Set These):**
- `RENDER=true` - Detects Render environment
- `RENDER_EXTERNAL_URL` - Your app's full URL
- `RENDER_EXTERNAL_HOSTNAME` - Your app's hostname
- `NODE_ENV=production` - Auto-set for Node.js services

---

## 📝 **Step-by-Step Deployment Process**

### **Phase 1: Repository Preparation**

1. **Create GitHub Repository**
   - Must be GitHub or GitLab (Render requirement)
   - Public or Private both work
   - Ensure all changes are committed and pushed

2. **Create `.gitignore`** (if not exists):
   ```gitignore
   # Dependencies
   node_modules/
   
   # Environment variables
   .env
   .env.local
   .env.production
   
   # Logs
   npm-debug.log*
   yarn-debug.log*
   yarn-error.log*
   
   # Cache
   .cache/
   
   # OS
   .DS_Store
   Thumbs.db
   ```

3. **Update `package.json`** (verify these exist):
   ```json
   {
     "scripts": {
       "start": "node server.js",
       "dev": "nodemon server.js"
     },
     "engines": {
       "node": ">=18.0.0"
     }
   }
   ```

### **Phase 2: Render Service Creation**

1. **Login to Render.com**
   - Use GitHub account for easy integration
   - Free account is sufficient

2. **Create New Web Service**
   - Click "New" → "Web Service"
   - Connect your GitHub repository
   - Select the repository containing your server

3. **Service Configuration**
   ```
   Name: face-tracker-websocket
   Environment: Node
   Branch: main
   Root Directory: server
   Build Command: npm install
   Start Command: npm start
   Instance Type: Free
   Auto-Deploy: Yes
   ```

### **Phase 3: Environment Setup**

1. **Add Environment Variables**
   - Go to service → Environment tab
   - Add `CORS_ORIGIN` variable
   - Set value to your future Render URL format: `https://your-app-name.onrender.com`

2. **Configure Health Check**
   ```
   Health Check Path: /health
   Grace Period: 30 seconds
   ```

### **Phase 4: Initial Deployment**

1. **Deploy Service**
   - Click "Create Web Service"
   - Wait for initial deployment (5-15 minutes)
   - Monitor logs for any errors

2. **Verify Deployment**
   - Check health endpoint: `https://your-app.onrender.com/health`
   - Verify WebSocket endpoint accessibility
   - Test session statistics: `https://your-app.onrender.com/stats`

---

## 🔗 **Post-Deployment URL Updates**

### **Update Lens Studio Client:**
```typescript
// In FaceTrackerWebSocketClient.ts
private serverUrl: string = process.env.NODE_ENV === 'production' 
  ? "wss://your-app-name.onrender.com"
  : "ws://localhost:3000";
```

### **Update Web App (if used):**
```javascript
// In index.html WebSocket manager
this.serverUrl = process.env.NODE_ENV === 'production'
  ? 'wss://your-app-name.onrender.com'  
  : 'ws://localhost:3000';
```

---

## ⚡ **Free Tier Optimization Strategies**

### **Minimize Sleep Issues:**
1. **Keep-Alive Service** (External)
   - Use UptimeRobot or similar to ping every 10 minutes
   - Send GET requests to `/health` endpoint
   - Note: Only delays sleep, doesn't prevent it

2. **Reconnection Logic** (Already Implemented)
   - Client auto-reconnects after connection loss
   - Exponential backoff prevents server spam
   - Session persistence across reconnections

3. **User Communication**
   - Display "Connecting..." during cold starts
   - Show connection status in UI
   - Educate users about potential delays

### **Monitor Usage:**
- **Track monthly hours** via Render Dashboard
- **Monitor bandwidth usage** 
- **Watch for suspension warnings**

---

## 🚦 **Deployment Checklist**

### **Pre-Deployment:**
- [ ] Code committed and pushed to GitHub
- [ ] `package.json` contains correct start script
- [ ] Server listens on `process.env.PORT`
- [ ] Health check endpoint responds correctly
- [ ] Environment variables identified

### **During Deployment:**
- [ ] Render service created and configured
- [ ] Environment variables added
- [ ] Health check configured
- [ ] Initial deployment successful
- [ ] No build errors in logs

### **Post-Deployment:**
- [ ] Health endpoint accessible
- [ ] WebSocket connections work
- [ ] Lens Studio can connect and get session codes
- [ ] Web app can join sessions and send data
- [ ] URLs updated in client applications
- [ ] Documentation updated with production URLs

### **Production Validation:**
- [ ] End-to-end data flow verified
- [ ] Session management working
- [ ] Reconnection logic tested
- [ ] Performance acceptable for use case

---

## 📊 **Expected Performance (Free Tier)**

### **Normal Operation:**
- **Cold Start Time:** 30-60 seconds
- **Response Time:** Normal (once warmed up)
- **WebSocket Latency:** Minimal when active
- **Uptime:** Good during active usage

### **Limitations:**
- **Sleep After:** 15 minutes of inactivity
- **Wake Time:** 30-60 seconds
- **Monthly Limit:** 750 hours (31 days × 24 hours = 744 hours)
- **Connection Drops:** During sleep/wake cycles

---

## 🎯 **Production Considerations**

### **When to Upgrade to Paid ($7/month):**
- **No sleep timeout** - Always-on service
- **Instant wake** - No cold start delays
- **Better reliability** - For production use
- **More resources** - Better performance

### **Alternative Free Options:**
- **Railway.com** - Similar free tier
- **Fly.io** - Different limitations
- **Vercel** - For serverless approach (different architecture needed)

---

## 🔍 **Troubleshooting Guide**

### **Common Issues:**

1. **Build Fails:**
   - Check `package.json` syntax
   - Verify Node.js version compatibility
   - Review build logs for missing dependencies

2. **Service Won't Start:**
   - Ensure server binds to `process.env.PORT`
   - Check start command in service settings
   - Verify no syntax errors in server.js

3. **WebSocket Connection Fails:**
   - Confirm WSS (not WS) in client URLs
   - Check CORS configuration
   - Verify service is not sleeping

4. **Environment Variables Not Working:**
   - Check variable names (case-sensitive)
   - Verify values don't contain quotes
   - Re-deploy after adding variables

### **Debugging Steps:**
1. Check Render Dashboard logs
2. Test health endpoint
3. Verify environment variables
4. Test WebSocket connection manually
5. Monitor for sleep/wake cycles

---

## 📱 **Final Production URLs**

```
Main Service: https://your-app-name.onrender.com
WebSocket: wss://your-app-name.onrender.com
Health Check: https://your-app-name.onrender.com/health
Session Stats: https://your-app-name.onrender.com/stats
```

---

*This guide provides all essential information for deploying and maintaining the Face Tracking WebSocket system on Render.com's free tier. Keep this document as a reference for deployment and troubleshooting.*
