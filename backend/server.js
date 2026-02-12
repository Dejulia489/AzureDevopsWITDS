const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const connectionsRoutes = require('./routes/connections');
const processesRoutes = require('./routes/processes');
const comparisonRoutes = require('./routes/comparison');
const editorRoutes = require('./routes/editor');

// File-based logging
const LOG_FILE = path.join(__dirname, '..', 'server.log');
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;
function fileLog(level, ...args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`;
  logStream.write(line);
}
console.log = (...args) => { origLog(...args); fileLog('INFO', ...args); };
console.warn = (...args) => { origWarn(...args); fileLog('WARN', ...args); };
console.error = (...args) => { origError(...args); fileLog('ERROR', ...args); };

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Log all incoming requests
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    fileLog('HTTP', `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use('/api/connections', connectionsRoutes);
app.use('/api/processes', processesRoutes);
app.use('/api/comparison', comparisonRoutes);
app.use('/api/editor', editorRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
