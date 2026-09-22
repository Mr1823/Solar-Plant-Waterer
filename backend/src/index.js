import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { initDB } from './db.js';
import readingsRoutes from './routes/readings.js';
import pumpRoutes from './routes/pump.js';
import aiRoutes from './routes/ai.js';
import weatherRoutes from './routes/weather.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database (async for sql.js)
const dbPath = process.env.DB_PATH || './data/solar.db';

async function start() {
  await initDB(dbPath);

  // Routes
  app.use('/api/readings', readingsRoutes(io));
  app.use('/api/pump', pumpRoutes(io));
  app.use('/api/ai', aiRoutes);
  app.use('/api/weather', weatherRoutes);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // Socket.IO connection handling
  io.on('connection', (socket) => {
    console.log(`🔌 Dashboard client connected: ${socket.id}`);

    socket.on('disconnect', (reason) => {
      console.log(`❌ Dashboard client disconnected: ${socket.id} (${reason})`);
    });
  });

  // Start server
  const PORT = process.env.PORT || 3001;
  httpServer.listen(PORT, () => {
    console.log(`\n🌱 Solar IoT Backend running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket server ready`);
    console.log(`📊 API endpoints:`);
    console.log(`   POST /api/readings         — ESP32 sends sensor data`);
    console.log(`   GET  /api/readings/latest   — Latest reading`);
    console.log(`   GET  /api/readings/history  — Historical data`);
    console.log(`   POST /api/pump/schedule     — Set watering schedule`);
    console.log(`   POST /api/pump/manual       — Manual pump control`);
    console.log(`   GET  /api/pump/status       — ESP32 polls for commands`);
    console.log(`   POST /api/ai/insight        — AI-generated insight`);
    console.log(`   GET  /api/weather            — Current weather (OpenWeatherMap)\n`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
