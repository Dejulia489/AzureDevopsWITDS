const express = require('express');
const router = express.Router();
const configManager = require('../services/configManager');
const AzureDevOpsService = require('../services/azureDevOps');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask a PAT string, showing only the last 4 characters.
 * @param {string} pat - Personal Access Token
 * @returns {string} Masked PAT (e.g. "****abcd")
 */
function maskPat(pat) {
  if (!pat) return '****';
  return '****' + pat.slice(-4);
}

/**
 * Return a shallow copy of a connection with the PAT masked.
 * @param {{ id: string, name: string, orgUrl: string, pat: string }} conn
 * @returns {{ id: string, name: string, orgUrl: string, pat: string }}
 */
function sanitizeConnection(conn) {
  return { ...conn, pat: maskPat(conn.pat) };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET / - List all connections (PATs masked).
 */
router.get('/', async (req, res) => {
  try {
    const connections = await configManager.getConnections();
    res.json({ connections: connections.map(sanitizeConnection) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:id - Get a single connection by id (PAT masked).
 */
router.get('/:id', async (req, res) => {
  try {
    const connection = await configManager.getConnection(req.params.id);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    res.json(sanitizeConnection(connection));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST / - Create a new connection.
 * Body: { name, orgUrl, pat }
 */
router.post('/', async (req, res) => {
  try {
    const { name, orgUrl, pat } = req.body;

    if (!name || !orgUrl || !pat) {
      return res.status(400).json({ error: 'name, orgUrl, and pat are required' });
    }

    const connection = await configManager.addConnection({ name, orgUrl, pat });
    res.status(201).json(sanitizeConnection(connection));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /:id - Update an existing connection.
 * Body can include: { name, orgUrl, pat }
 */
router.put('/:id', async (req, res) => {
  try {
    const { name, orgUrl, pat } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (orgUrl !== undefined) updates.orgUrl = orgUrl;
    if (pat !== undefined) updates.pat = pat;

    const connection = await configManager.updateConnection(req.params.id, updates);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    res.json(sanitizeConnection(connection));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /:id - Delete a connection.
 */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await configManager.deleteConnection(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/test - Test an Azure DevOps connection.
 */
router.post('/:id/test', async (req, res) => {
  try {
    const connection = await configManager.getConnection(req.params.id);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const service = new AzureDevOpsService(connection.orgUrl, connection.pat);
    const success = await service.testConnection();

    res.json({
      success,
      message: success
        ? 'Connection successful'
        : 'Connection failed',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
