'use strict';

const express = require('express');
const router = express.Router();
const configManager = require('../services/configManager');
const AzureDevOpsService = require('../services/azureDevOps');

async function createService(connectionId) {
  const connection = await configManager.getConnection(connectionId);
  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }
  return new AzureDevOpsService(connection.orgUrl, connection.pat);
}

// ---------------------------------------------------------------------------
// GET /:connectionId - Fetch all user entitlements for a connection
// ---------------------------------------------------------------------------
router.get('/:connectionId', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const service = await createService(connectionId);
    console.log(`[licenses] Fetching user entitlements for connection ${connectionId}`);
    const data = await service.getUserEntitlements();
    console.log(`[licenses] Fetched ${data.items.length} entitlements (total: ${data.totalCount})`);
    res.json(data);
  } catch (err) {
    console.error('Error fetching user entitlements:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /:connectionId/test - Test license API access for a connection
// ---------------------------------------------------------------------------
router.post('/:connectionId/test', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const service = await createService(connectionId);
    const result = await service.testLicenseAccess();
    res.json(result);
  } catch (err) {
    console.error('Error testing license access:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /:connectionId/:userId - Update a user's license / access level
// ---------------------------------------------------------------------------
router.patch('/:connectionId/:userId', async (req, res) => {
  try {
    const { connectionId, userId } = req.params;
    const { accessLevel } = req.body;
    if (!accessLevel || !accessLevel.accountLicenseType) {
      return res.status(400).json({ error: 'accessLevel.accountLicenseType is required' });
    }
    const service = await createService(connectionId);
    console.log(`[licenses] Updating license for user ${userId}: ${JSON.stringify(accessLevel)}`);
    const result = await service.updateUserEntitlement(userId, accessLevel);
    console.log(`[licenses] Update result: ${JSON.stringify(result?.isSuccess)}`);
    res.json(result);
  } catch (err) {
    console.error('Error updating user entitlement:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
