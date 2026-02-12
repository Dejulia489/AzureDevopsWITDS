const express = require('express');
const router = express.Router();
const configManager = require('../services/configManager');
const AzureDevOpsService = require('../services/azureDevOps');
const tempStorage = require('../services/tempStorage');

/**
 * Creates an AzureDevOpsService instance for the given connection ID.
 * @param {string} connectionId
 * @returns {Promise<AzureDevOpsService>}
 * @throws {Error} If the connection is not found
 */
async function createService(connectionId) {
  const connection = await configManager.getConnection(connectionId);
  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }
  return new AzureDevOpsService(connection.orgUrl, connection.pat);
}

// ---------------------------------------------------------------------------
// GET /session/data - Get all session data from temp storage
// ---------------------------------------------------------------------------
router.get('/session/data', async (req, res) => {
  try {
    const data = await tempStorage.getAllSessionData();
    res.json(data);
  } catch (err) {
    console.error('Error getting session data:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /temp/all - Clear all temp data
// ---------------------------------------------------------------------------
router.delete('/temp/all', async (req, res) => {
  try {
    await tempStorage.clearAllProcessData();
    res.json({ message: 'All temp data cleared' });
  } catch (err) {
    console.error('Error clearing all temp data:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /temp/:connectionId/:processId - Clear specific temp data
// ---------------------------------------------------------------------------
router.delete('/temp/:connectionId/:processId', async (req, res) => {
  try {
    const { connectionId, processId } = req.params;
    const deleted = await tempStorage.clearProcessData(connectionId, processId);
    if (!deleted) {
      return res.status(404).json({ error: 'No temp data found for this process' });
    }
    res.json({ message: 'Temp data cleared' });
  } catch (err) {
    console.error('Error clearing temp data:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /:connectionId/fields/all - Get all organization-level fields
// ---------------------------------------------------------------------------
router.get('/:connectionId/fields/all', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const service = await createService(connectionId);
    const data = await service.getOrganizationFields();
    res.json(data);
  } catch (err) {
    console.error('Error getting organization fields:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /:connectionId - List all processes for a connection
// ---------------------------------------------------------------------------
router.get('/:connectionId', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const service = await createService(connectionId);
    const data = await service.getProcesses();
    res.json({ processes: data.value });
  } catch (err) {
    console.error('Error listing processes:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /:connectionId/:processId - Get a single process summary
// ---------------------------------------------------------------------------
router.get('/:connectionId/:processId', async (req, res) => {
  try {
    const { connectionId, processId } = req.params;

    // Check temp storage first for pulled data
    const stored = await tempStorage.getProcessData(connectionId, processId);
    if (stored) {
      return res.json(stored);
    }

    // Fall back to API
    const service = await createService(connectionId);
    const data = await service.getProcess(processId);
    res.json(data);
  } catch (err) {
    console.error('Error getting process:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /:connectionId/:processId/pull - Pull full process data from Azure DevOps
// ---------------------------------------------------------------------------
router.post('/:connectionId/:processId/pull', async (req, res) => {
  try {
    const { connectionId, processId } = req.params;
    const connection = await configManager.getConnection(connectionId);
    if (!connection) {
      return res.status(404).json({ error: `Connection not found: ${connectionId}` });
    }

    const service = new AzureDevOpsService(connection.orgUrl, connection.pat);

    // 1. Get process info
    const processInfo = await service.getProcess(processId);

    // 2. Get all work item types
    const witResponse = await service.getWorkItemTypes(processId);
    const workItemTypes = witResponse.value || [];

    // 3. For each work item type, fetch details in parallel
    const enrichedWorkItemTypes = await Promise.all(
      workItemTypes.map(async (wit) => {
        const witRefName = wit.referenceName;

        const [fields, states, rules, behaviors, layout] = await Promise.all([
          service.getFields(processId, witRefName).catch((err) => {
            console.warn(`Warning: Failed to fetch fields for ${witRefName}:`, err.message);
            return { value: [] };
          }),
          service.getStates(processId, witRefName).catch((err) => {
            console.warn(`Warning: Failed to fetch states for ${witRefName}:`, err.message);
            return { value: [] };
          }),
          service.getRules(processId, witRefName).catch((err) => {
            console.warn(`Warning: Failed to fetch rules for ${witRefName}:`, err.message);
            return { value: [] };
          }),
          service.getWorkItemTypeBehaviors(processId, witRefName).catch((err) => {
            console.warn(`Warning: Failed to fetch behaviors for ${witRefName}:`, err.message);
            return { value: [] };
          }),
          service.getLayout(processId, witRefName).catch((err) => {
            console.warn(`Warning: Failed to fetch layout for ${witRefName}:`, err.message);
            return null;
          }),
        ]);

        return {
          ...wit,
          fields: fields.value || [],
          states: states.value || [],
          rules: rules.value || [],
          behaviors: behaviors.value || [],
          layout: layout,
        };
      })
    );

    // 4. Get process-level behaviors
    const behaviorsResponse = await service.getBehaviors(processId);

    // 5. Assemble complete process data
    const processData = {
      process: { ...processInfo },
      workItemTypes: enrichedWorkItemTypes,
      behaviors: behaviorsResponse.value || [],
      pulledAt: new Date().toISOString(),
      connectionId,
      orgUrl: connection.orgUrl,
    };

    // 6. Save to temp storage
    await tempStorage.saveProcessData(connectionId, processId, processData);

    // 7. Return the assembled data
    res.json(processData);
  } catch (err) {
    console.error('Error pulling process data:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /:connectionId/:processId/data - Get stored/pulled process data
// ---------------------------------------------------------------------------
router.get('/:connectionId/:processId/data', async (req, res) => {
  try {
    const { connectionId, processId } = req.params;
    const data = await tempStorage.getProcessData(connectionId, processId);
    if (!data) {
      return res.status(404).json({ error: 'No pulled data found. Pull the process first.' });
    }
    res.json(data);
  } catch (err) {
    console.error('Error getting process data:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
