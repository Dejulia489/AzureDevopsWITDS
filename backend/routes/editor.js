'use strict';

const express = require('express');
const router = express.Router();
const configManager = require('../services/configManager');
const AzureDevOpsService = require('../services/azureDevOps');
const tempStorage = require('../services/tempStorage');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a connection by id and return a new AzureDevOpsService instance.
 * Throws if the connection is not found.
 * @param {string} connectionId
 * @returns {Promise<{ service: AzureDevOpsService, connection: object }>}
 */
async function createService(connectionId) {
  const connection = await configManager.getConnection(connectionId);
  if (!connection) {
    const err = new Error('Connection not found');
    err.statusCode = 404;
    throw err;
  }
  const service = new AzureDevOpsService(connection.orgUrl, connection.pat);
  return { service, connection };
}

/**
 * Determine whether an error represents a 409 Conflict (already exists).
 * @param {Error} err
 * @returns {boolean}
 */
function isConflict(err) {
  return err.message && err.message.includes('409');
}

/**
 * Determine whether an error represents a 404 Not Found.
 * @param {Error} err
 * @returns {boolean}
 */
function isNotFound(err) {
  return err.message && err.message.includes('404');
}

/**
 * Find the best layout group for placing a new field control.
 * Prefers groups that already contain regular field controls (FieldControl,
 * DateTimeControl), avoiding HTML/rich-text groups and special control groups.
 * @param {object} layout - The layout object from getLayout()
 * @returns {{ groupId: string } | null}
 */
function findBestGroupForField(layout) {
  // Find the first non-contribution, non-system page
  const page = (layout.pages || []).find(
    (p) => !p.isContribution && p.sections && !['history', 'links', 'attachments'].includes(p.pageType)
  );
  if (!page) return null;

  const FIELD_CONTROL_TYPES = new Set(['FieldControl', 'DateTimeControl']);

  // Pass 1: find a group that already contains regular field controls
  for (const section of page.sections || []) {
    for (const group of section.groups || []) {
      const controls = group.controls || [];
      if (controls.some((c) => FIELD_CONTROL_TYPES.has(c.controlType))) {
        return { groupId: group.id };
      }
    }
  }

  // Pass 2: find any non-empty group that isn't HTML/special
  const AVOID_CONTROL_TYPES = new Set(['HtmlFieldControl', 'LinksControl', 'DeploymentsControl', 'WorkItemLogControl']);
  for (const section of page.sections || []) {
    for (const group of section.groups || []) {
      const controls = group.controls || [];
      if (controls.length === 0) continue;
      if (controls.some((c) => !c.controlType || !AVOID_CONTROL_TYPES.has(c.controlType))) {
        return { groupId: group.id };
      }
    }
  }

  // Pass 3: last resort — first group in any section
  for (const section of page.sections || []) {
    if ((section.groups || []).length > 0) {
      return { groupId: section.groups[0].id };
    }
  }

  return null;
}

/**
 * Refresh the temp storage for a specific process after a mutation.
 * Re-pulls the work item types, their fields, states, rules, behaviors, and layout.
 * Silently ignores errors so that it never breaks the primary response.
 * @param {AzureDevOpsService} service
 * @param {string} connectionId
 * @param {string} processId
 */
async function refreshTempStorage(service, connectionId, processId) {
  try {
    const existing = await tempStorage.getProcessData(connectionId, processId);
    if (!existing) return;

    const [processInfo, workItemTypes, behaviors] = await Promise.all([
      service.getProcess(processId),
      service.getWorkItemTypes(processId),
      service.getBehaviors(processId),
    ]);

    const witList = workItemTypes.value || workItemTypes || [];
    const witDetails = await Promise.all(
      witList.map(async (wit) => {
        const witRefName = wit.referenceName;
        const [fields, states, rules, witBehaviors, layout] = await Promise.all([
          service.getFields(processId, witRefName).catch(() => ({ value: [] })),
          service.getStates(processId, witRefName).catch(() => ({ value: [] })),
          service.getRules(processId, witRefName).catch(() => ({ value: [] })),
          service.getWorkItemTypeBehaviors(processId, witRefName).catch(() => ({ value: [] })),
          service.getLayout(processId, witRefName).catch(() => null),
        ]);
        return {
          ...wit,
          fields: fields.value || fields || [],
          states: states.value || states || [],
          rules: rules.value || rules || [],
          behaviors: witBehaviors.value || witBehaviors || [],
          layout: layout,
        };
      })
    );

    await tempStorage.saveProcessData(connectionId, processId, {
      process: processInfo,
      workItemTypes: witDetails,
      behaviors: behaviors.value || behaviors || [],
      connectionId: existing.connectionId || connectionId,
      orgUrl: existing.orgUrl || '',
      pulledAt: existing.pulledAt || new Date().toISOString(),
    });
  } catch {
    // Silently ignore refresh errors
  }
}

// ---------------------------------------------------------------------------
// POST /preview - Preview changes before applying (dry run)
// ---------------------------------------------------------------------------

router.post('/preview', async (req, res) => {
  try {
    const { changes } = req.body;

    if (!changes) {
      return res.status(400).json({ error: 'changes object is required' });
    }

    const preview = {
      workItemTypes: { toAdd: [], toUpdate: [], toRemove: [] },
      fields: {},
      states: {},
      behaviors: { toAdd: [], toUpdate: [], toRemove: [] },
      workItemTypeBehaviors: {},
      totalOperations: 0,
      warnings: [],
    };

    // Work item types
    const witChanges = changes.workItemTypes || {};
    if (witChanges.add) {
      preview.workItemTypes.toAdd = witChanges.add.map((wit) => ({
        name: wit.name,
        description: wit.description,
      }));
    }
    if (witChanges.update) {
      preview.workItemTypes.toUpdate = witChanges.update.map((wit) => ({
        witRefName: wit.witRefName,
        updates: Object.keys(wit).filter((k) => k !== 'witRefName'),
      }));
    }
    if (witChanges.remove) {
      preview.workItemTypes.toRemove = witChanges.remove.map((ref) => ref);
      witChanges.remove.forEach((ref) => {
        preview.warnings.push(
          `Removing work item type "${ref}" will delete all associated fields, states, and rules`
        );
      });
    }

    // Fields
    const fieldChanges = changes.fields || {};
    for (const [witRefName, fieldOps] of Object.entries(fieldChanges)) {
      preview.fields[witRefName] = { toAdd: [], toUpdate: [], toRemove: [] };
      if (fieldOps.add) {
        preview.fields[witRefName].toAdd = fieldOps.add.map((f) => ({
          referenceName: f.referenceName,
          name: f.name,
          type: f.type,
        }));
      }
      if (fieldOps.update) {
        preview.fields[witRefName].toUpdate = fieldOps.update.map((f) => ({
          fieldRefName: f.fieldRefName,
          updates: Object.keys(f).filter((k) => k !== 'fieldRefName'),
        }));
      }
      if (fieldOps.remove) {
        preview.fields[witRefName].toRemove = fieldOps.remove.map((ref) => ref);
        fieldOps.remove.forEach((ref) => {
          preview.warnings.push(
            `Removing field "${ref}" from "${witRefName}" may fail if it is in use by rules or layouts`
          );
        });
      }
    }

    // States
    const stateChanges = changes.states || {};
    for (const [witRefName, stateOps] of Object.entries(stateChanges)) {
      preview.states[witRefName] = { toAdd: [], toUpdate: [], toRemove: [] };
      if (stateOps.add) {
        preview.states[witRefName].toAdd = stateOps.add.map((s) => ({
          name: s.name,
          stateCategory: s.stateCategory,
          color: s.color,
        }));
      }
      if (stateOps.update) {
        preview.states[witRefName].toUpdate = stateOps.update.map((s) => ({
          stateId: s.stateId,
          updates: Object.keys(s).filter((k) => k !== 'stateId'),
        }));
      }
      if (stateOps.remove) {
        preview.states[witRefName].toRemove = stateOps.remove.map((id) => id);
        stateOps.remove.forEach((id) => {
          preview.warnings.push(
            `Removing state "${id}" from "${witRefName}" may fail if work items currently use this state`
          );
        });
      }
    }

    // Behaviors
    const behaviorChanges = changes.behaviors || {};
    if (behaviorChanges.add) {
      preview.behaviors.toAdd = behaviorChanges.add.map((b) => ({
        name: b.name,
        description: b.description,
      }));
    }
    if (behaviorChanges.update) {
      preview.behaviors.toUpdate = behaviorChanges.update.map((b) => ({
        behaviorId: b.behaviorId,
        updates: Object.keys(b).filter((k) => k !== 'behaviorId'),
      }));
    }
    if (behaviorChanges.remove) {
      preview.behaviors.toRemove = behaviorChanges.remove.map((id) => id);
      behaviorChanges.remove.forEach((id) => {
        preview.warnings.push(
          `Removing behavior "${id}" may fail if it is assigned to work item types`
        );
      });
    }

    // Work item type behaviors
    const witBehaviorChanges = changes.workItemTypeBehaviors || {};
    for (const [witRefName, witBehOps] of Object.entries(witBehaviorChanges)) {
      preview.workItemTypeBehaviors[witRefName] = { toAdd: [], toUpdate: [], toRemove: [] };
      if (witBehOps.add) {
        preview.workItemTypeBehaviors[witRefName].toAdd = witBehOps.add.map((b) => ({
          behaviorId: b.behavior && b.behavior.id,
          isDefault: b.isDefault,
        }));
      }
      if (witBehOps.update) {
        preview.workItemTypeBehaviors[witRefName].toUpdate = witBehOps.update.map((b) => ({
          behaviorId: b.behaviorId,
          isDefault: b.isDefault,
        }));
      }
      if (witBehOps.remove) {
        preview.workItemTypeBehaviors[witRefName].toRemove = witBehOps.remove.map((id) => id);
      }
    }

    // Count total operations
    preview.totalOperations =
      preview.workItemTypes.toAdd.length +
      preview.workItemTypes.toUpdate.length +
      preview.workItemTypes.toRemove.length +
      preview.behaviors.toAdd.length +
      preview.behaviors.toUpdate.length +
      preview.behaviors.toRemove.length;

    for (const witRefName of Object.keys(preview.fields)) {
      const f = preview.fields[witRefName];
      preview.totalOperations += f.toAdd.length + f.toUpdate.length + f.toRemove.length;
    }
    for (const witRefName of Object.keys(preview.states)) {
      const s = preview.states[witRefName];
      preview.totalOperations += s.toAdd.length + s.toUpdate.length + s.toRemove.length;
    }
    for (const witRefName of Object.keys(preview.workItemTypeBehaviors)) {
      const wb = preview.workItemTypeBehaviors[witRefName];
      preview.totalOperations += wb.toAdd.length + wb.toUpdate.length + wb.toRemove.length;
    }

    res.json({ preview });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /apply - Apply changes to a single process
// ---------------------------------------------------------------------------

/**
 * Core logic for applying a set of changes to a single process.
 * Returns { applied, skipped, errors } arrays.
 * @param {AzureDevOpsService} service
 * @param {string} processId
 * @param {object} changes
 * @returns {Promise<{ applied: Array, skipped: Array, errors: Array }>}
 */
async function applyChanges(service, processId, changes) {
  const applied = [];
  const skipped = [];
  const errors = [];

  // --- 1. Behaviors ---
  const behaviorChanges = changes.behaviors || {};

  for (const b of behaviorChanges.add || []) {
    try {
      const result = await service.createBehavior(processId, b);
      applied.push({ type: 'behavior', action: 'add', item: b.name, result });
    } catch (err) {
      if (isConflict(err)) {
        skipped.push({ type: 'behavior', action: 'add', item: b.name, reason: 'already exists' });
      } else {
        errors.push({ type: 'behavior', action: 'add', item: b.name, error: err.message });
      }
    }
  }

  for (const b of behaviorChanges.update || []) {
    try {
      const { behaviorId, ...updates } = b;
      const result = await service.updateBehavior(processId, behaviorId, updates);
      applied.push({ type: 'behavior', action: 'update', item: behaviorId, result });
    } catch (err) {
      if (isNotFound(err)) {
        skipped.push({ type: 'behavior', action: 'update', item: b.behaviorId, reason: 'not found' });
      } else {
        errors.push({ type: 'behavior', action: 'update', item: b.behaviorId, error: err.message });
      }
    }
  }

  for (const behaviorId of behaviorChanges.remove || []) {
    try {
      await service.deleteBehavior(processId, behaviorId);
      applied.push({ type: 'behavior', action: 'remove', item: behaviorId });
    } catch (err) {
      if (isNotFound(err)) {
        skipped.push({ type: 'behavior', action: 'remove', item: behaviorId, reason: 'not found' });
      } else {
        errors.push({ type: 'behavior', action: 'remove', item: behaviorId, error: err.message });
      }
    }
  }

  // --- 2. Work Item Types ---
  const witChanges = changes.workItemTypes || {};

  for (const wit of witChanges.add || []) {
    try {
      const result = await service.createWorkItemType(processId, wit);
      applied.push({ type: 'workItemType', action: 'add', item: wit.name, result });
    } catch (err) {
      if (isConflict(err)) {
        skipped.push({ type: 'workItemType', action: 'add', item: wit.name, reason: 'already exists' });
      } else {
        errors.push({ type: 'workItemType', action: 'add', item: wit.name, error: err.message });
      }
    }
  }

  for (const wit of witChanges.update || []) {
    try {
      const { witRefName, ...updates } = wit;
      const result = await service.updateWorkItemType(processId, witRefName, updates);
      applied.push({ type: 'workItemType', action: 'update', item: witRefName, result });
    } catch (err) {
      if (isNotFound(err)) {
        skipped.push({ type: 'workItemType', action: 'update', item: wit.witRefName, reason: 'not found' });
      } else {
        errors.push({ type: 'workItemType', action: 'update', item: wit.witRefName, error: err.message });
      }
    }
  }

  for (const witRefName of witChanges.remove || []) {
    try {
      await service.deleteWorkItemType(processId, witRefName);
      applied.push({ type: 'workItemType', action: 'remove', item: witRefName });
    } catch (err) {
      if (isNotFound(err)) {
        skipped.push({ type: 'workItemType', action: 'remove', item: witRefName, reason: 'not found' });
      } else {
        errors.push({ type: 'workItemType', action: 'remove', item: witRefName, error: err.message });
      }
    }
  }

  // --- 3. Fields ---
  const fieldChanges = changes.fields || {};

  for (const [witRefName, fieldOps] of Object.entries(fieldChanges)) {
    for (const f of fieldOps.add || []) {
      try {
        const result = await service.addField(processId, witRefName, f);
        applied.push({ type: 'field', action: 'add', witRefName, item: f.referenceName || f.name, result });

        // Auto-add to form layout (best-effort)
        const fieldRefName = result.referenceName || f.referenceName;
        if (fieldRefName) {
          try {
            const layout = await service.getLayout(processId, witRefName);
            const target = findBestGroupForField(layout);
            if (target) {
              await service.addControl(processId, witRefName, target.groupId, {
                id: fieldRefName,
                order: null,
                label: result.name || '',
                readOnly: false,
                visible: true,
                controlType: null,
                metadata: null,
                inherited: null,
                overridden: null,
                watermark: null,
                contribution: null,
                height: null,
                isContribution: false,
              });
            }
          } catch {
            // Layout placement is best-effort
          }
        }
      } catch (err) {
        if (isConflict(err)) {
          skipped.push({ type: 'field', action: 'add', witRefName, item: f.referenceName || f.name, reason: 'already exists' });
        } else {
          errors.push({ type: 'field', action: 'add', witRefName, item: f.referenceName || f.name, error: err.message });
        }
      }
    }

    for (const f of fieldOps.update || []) {
      try {
        const { fieldRefName, ...updates } = f;
        const result = await service.updateField(processId, witRefName, fieldRefName, updates);
        applied.push({ type: 'field', action: 'update', witRefName, item: fieldRefName, result });
      } catch (err) {
        if (isNotFound(err)) {
          skipped.push({ type: 'field', action: 'update', witRefName, item: f.fieldRefName, reason: 'not found' });
        } else {
          errors.push({ type: 'field', action: 'update', witRefName, item: f.fieldRefName, error: err.message });
        }
      }
    }

    for (const fieldRefName of fieldOps.remove || []) {
      try {
        await service.removeField(processId, witRefName, fieldRefName);
        applied.push({ type: 'field', action: 'remove', witRefName, item: fieldRefName });
      } catch (err) {
        if (isNotFound(err)) {
          skipped.push({ type: 'field', action: 'remove', witRefName, item: fieldRefName, reason: 'not found' });
        } else {
          errors.push({ type: 'field', action: 'remove', witRefName, item: fieldRefName, error: err.message });
        }
      }
    }
  }

  // --- 4. States ---
  const stateChanges = changes.states || {};

  for (const [witRefName, stateOps] of Object.entries(stateChanges)) {
    for (const s of stateOps.add || []) {
      try {
        const result = await service.createState(processId, witRefName, s);
        applied.push({ type: 'state', action: 'add', witRefName, item: s.name, result });
      } catch (err) {
        if (isConflict(err)) {
          skipped.push({ type: 'state', action: 'add', witRefName, item: s.name, reason: 'already exists' });
        } else {
          errors.push({ type: 'state', action: 'add', witRefName, item: s.name, error: err.message });
        }
      }
    }

    for (const s of stateOps.update || []) {
      try {
        const { stateId, ...updates } = s;
        const result = await service.updateState(processId, witRefName, stateId, updates);
        applied.push({ type: 'state', action: 'update', witRefName, item: stateId, result });
      } catch (err) {
        if (isNotFound(err)) {
          skipped.push({ type: 'state', action: 'update', witRefName, item: s.stateId, reason: 'not found' });
        } else {
          errors.push({ type: 'state', action: 'update', witRefName, item: s.stateId, error: err.message });
        }
      }
    }

    for (const stateId of stateOps.remove || []) {
      try {
        await service.deleteState(processId, witRefName, stateId);
        applied.push({ type: 'state', action: 'remove', witRefName, item: stateId });
      } catch (err) {
        if (isNotFound(err)) {
          skipped.push({ type: 'state', action: 'remove', witRefName, item: stateId, reason: 'not found' });
        } else {
          errors.push({ type: 'state', action: 'remove', witRefName, item: stateId, error: err.message });
        }
      }
    }
  }

  // --- 5. Work Item Type Behaviors ---
  const witBehaviorChanges = changes.workItemTypeBehaviors || {};

  for (const [witRefName, witBehOps] of Object.entries(witBehaviorChanges)) {
    for (const b of witBehOps.add || []) {
      try {
        const result = await service.addWorkItemTypeBehavior(processId, witRefName, b);
        const behaviorId = b.behavior && b.behavior.id;
        applied.push({ type: 'workItemTypeBehavior', action: 'add', witRefName, item: behaviorId, result });
      } catch (err) {
        const behaviorId = b.behavior && b.behavior.id;
        if (isConflict(err)) {
          skipped.push({ type: 'workItemTypeBehavior', action: 'add', witRefName, item: behaviorId, reason: 'already exists' });
        } else {
          errors.push({ type: 'workItemTypeBehavior', action: 'add', witRefName, item: behaviorId, error: err.message });
        }
      }
    }

    for (const b of witBehOps.update || []) {
      try {
        const { behaviorId, ...updates } = b;
        const result = await service.updateWorkItemTypeBehavior(processId, witRefName, behaviorId, updates);
        applied.push({ type: 'workItemTypeBehavior', action: 'update', witRefName, item: behaviorId, result });
      } catch (err) {
        if (isNotFound(err)) {
          skipped.push({ type: 'workItemTypeBehavior', action: 'update', witRefName, item: b.behaviorId, reason: 'not found' });
        } else {
          errors.push({ type: 'workItemTypeBehavior', action: 'update', witRefName, item: b.behaviorId, error: err.message });
        }
      }
    }

    for (const behaviorId of witBehOps.remove || []) {
      try {
        await service.removeWorkItemTypeBehavior(processId, witRefName, behaviorId);
        applied.push({ type: 'workItemTypeBehavior', action: 'remove', witRefName, item: behaviorId });
      } catch (err) {
        if (isNotFound(err)) {
          skipped.push({ type: 'workItemTypeBehavior', action: 'remove', witRefName, item: behaviorId, reason: 'not found' });
        } else {
          errors.push({ type: 'workItemTypeBehavior', action: 'remove', witRefName, item: behaviorId, error: err.message });
        }
      }
    }
  }

  return { applied, skipped, errors };
}

router.post('/apply', async (req, res) => {
  try {
    const { connectionId, processId, changes } = req.body;

    if (!connectionId || !processId || !changes) {
      return res.status(400).json({ error: 'connectionId, processId, and changes are required' });
    }

    const { service } = await createService(connectionId);
    const results = await applyChanges(service, processId, changes);

    const success = results.errors.length === 0;

    // Refresh temp storage after mutations
    await refreshTempStorage(service, connectionId, processId);

    res.json({
      success,
      results,
      summary: {
        applied: results.applied.length,
        skipped: results.skipped.length,
        errors: results.errors.length,
      },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /apply-batch - Apply changes to multiple processes
// ---------------------------------------------------------------------------

router.post('/apply-batch', async (req, res) => {
  try {
    const { targets, changes } = req.body;

    if (!targets || !Array.isArray(targets) || targets.length === 0 || !changes) {
      return res.status(400).json({ error: 'targets (array) and changes are required' });
    }

    const processResults = [];

    for (const target of targets) {
      const { connectionId, processId } = target;

      try {
        const { service } = await createService(connectionId);
        const results = await applyChanges(service, processId, changes);

        // Refresh temp storage after mutations
        await refreshTempStorage(service, connectionId, processId);

        processResults.push({
          connectionId,
          processId,
          success: results.errors.length === 0,
          results,
          summary: {
            applied: results.applied.length,
            skipped: results.skipped.length,
            errors: results.errors.length,
          },
        });
      } catch (err) {
        processResults.push({
          connectionId,
          processId,
          success: false,
          results: { applied: [], skipped: [], errors: [{ error: err.message }] },
          summary: { applied: 0, skipped: 0, errors: 1 },
        });
      }
    }

    const allSuccess = processResults.every((r) => r.success);

    res.json({
      success: allSuccess,
      processResults,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Direct Edit Endpoints - Organization-Level Fields
// ---------------------------------------------------------------------------

/**
 * POST /:connectionId/org-field - Create a field at the organization level.
 * Body: { name, referenceName, type, description, usage, readOnly }
 * 409 Conflict (field already exists) is treated as success.
 */
router.post('/:connectionId/org-field', async (req, res) => {
  try {
    const { connectionId } = req.params;
    console.log(`[editor/createOrgField] connectionId=${connectionId} body=${JSON.stringify(req.body)}`);
    const { service } = await createService(connectionId);
    const result = await service.createOrganizationField(req.body);
    res.status(201).json(result);
  } catch (err) {
    if (isConflict(err) || (err.message && err.message.includes('VS402803'))) {
      // Field already exists at org level (409 or VS402803) — treat as success
      console.log(`[editor/createOrgField] Field already exists, continuing`);
      res.json({ alreadyExists: true, referenceName: req.body.referenceName });
    } else {
      console.error(`[editor/createOrgField] FAILED: ${err.message}`);
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// Direct Edit Endpoints - Work Item Types
// ---------------------------------------------------------------------------

/**
 * POST /:connectionId/:processId/workitemtype - Create a work item type.
 */
router.post('/:connectionId/:processId/workitemtype', async (req, res) => {
  try {
    const { connectionId, processId } = req.params;
    const { service } = await createService(connectionId);
    const result = await service.createWorkItemType(processId, req.body);
    await refreshTempStorage(service, connectionId, processId);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * PATCH /:connectionId/:processId/workitemtype/:witRefName - Update a work item type.
 */
router.patch('/:connectionId/:processId/workitemtype/:witRefName', async (req, res) => {
  try {
    const { connectionId, processId, witRefName } = req.params;
    const { service } = await createService(connectionId);
    const result = await service.updateWorkItemType(processId, witRefName, req.body);
    await refreshTempStorage(service, connectionId, processId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * DELETE /:connectionId/:processId/workitemtype/:witRefName - Delete a work item type.
 */
router.delete('/:connectionId/:processId/workitemtype/:witRefName', async (req, res) => {
  try {
    const { connectionId, processId, witRefName } = req.params;
    const { service } = await createService(connectionId);
    await service.deleteWorkItemType(processId, witRefName);
    await refreshTempStorage(service, connectionId, processId);
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Direct Edit Endpoints - Fields
// ---------------------------------------------------------------------------

/**
 * POST /:connectionId/:processId/:witRefName/field - Add a field to a work item type.
 * Also adds the field as a control on the form layout so it's visible on the form.
 */
router.post('/:connectionId/:processId/:witRefName/field', async (req, res) => {
  try {
    const { connectionId, processId, witRefName } = req.params;
    console.log(`[editor/addField] connectionId=${connectionId} processId=${processId} witRefName=${witRefName} body=${JSON.stringify(req.body)}`);
    if (!witRefName || witRefName === 'undefined') {
      return res.status(400).json({ error: 'witRefName is required' });
    }
    const { service } = await createService(connectionId);
    const result = await service.addField(processId, witRefName, req.body);

    // Auto-add the field to the form layout so it appears on the form.
    const fieldRefName = result.referenceName || req.body.referenceName;
    if (fieldRefName) {
      try {
        const layout = await service.getLayout(processId, witRefName);
        const target = findBestGroupForField(layout);
        if (target) {
          console.log(`[editor/addField] Adding control: group=${target.groupId} field=${fieldRefName} label=${result.name}`);
          await service.addControl(processId, witRefName, target.groupId, {
            id: fieldRefName,
            order: null,
            label: result.name || '',
            readOnly: false,
            visible: true,
            controlType: null,
            metadata: null,
            inherited: null,
            overridden: null,
            watermark: null,
            contribution: null,
            height: null,
            isContribution: false,
          });
        }
      } catch (layoutErr) {
        // Layout placement is best-effort — field was still added to the WIT
        console.warn(`[editor/addField] Field added but layout placement failed: ${layoutErr.message}`);
      }
    }

    await refreshTempStorage(service, connectionId, processId);
    res.status(201).json(result);
  } catch (err) {
    console.error(`[editor/addField] FAILED: ${err.message}`);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * PATCH /:connectionId/:processId/:witRefName/field/:fieldRefName - Update a field.
 */
router.patch('/:connectionId/:processId/:witRefName/field/:fieldRefName', async (req, res) => {
  try {
    const { connectionId, processId, witRefName, fieldRefName } = req.params;
    const { service } = await createService(connectionId);
    const result = await service.updateField(processId, witRefName, fieldRefName, req.body);
    await refreshTempStorage(service, connectionId, processId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * DELETE /:connectionId/:processId/:witRefName/field/:fieldRefName - Remove a field.
 */
router.delete('/:connectionId/:processId/:witRefName/field/:fieldRefName', async (req, res) => {
  try {
    const { connectionId, processId, witRefName, fieldRefName } = req.params;
    const { service } = await createService(connectionId);
    await service.removeField(processId, witRefName, fieldRefName);
    await refreshTempStorage(service, connectionId, processId);
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Direct Edit Endpoints - States
// ---------------------------------------------------------------------------

/**
 * POST /:connectionId/:processId/:witRefName/state - Create a state.
 */
router.post('/:connectionId/:processId/:witRefName/state', async (req, res) => {
  try {
    const { connectionId, processId, witRefName } = req.params;
    const { service } = await createService(connectionId);
    const result = await service.createState(processId, witRefName, req.body);
    await refreshTempStorage(service, connectionId, processId);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * PATCH /:connectionId/:processId/:witRefName/state/:stateId - Update a state.
 */
router.patch('/:connectionId/:processId/:witRefName/state/:stateId', async (req, res) => {
  try {
    const { connectionId, processId, witRefName, stateId } = req.params;
    console.log(`[editor/updateState] witRefName=${witRefName} stateId=${stateId} body=${JSON.stringify(req.body)}`);
    const { service } = await createService(connectionId);
    const result = await service.updateState(processId, witRefName, stateId, req.body);
    await refreshTempStorage(service, connectionId, processId);
    res.json(result);
  } catch (err) {
    console.error(`[editor/updateState] FAILED: ${err.message}`);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * DELETE /:connectionId/:processId/:witRefName/state/:stateId - Delete a state.
 */
router.delete('/:connectionId/:processId/:witRefName/state/:stateId', async (req, res) => {
  try {
    const { connectionId, processId, witRefName, stateId } = req.params;
    const { service } = await createService(connectionId);
    await service.deleteState(processId, witRefName, stateId);
    await refreshTempStorage(service, connectionId, processId);
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Direct Edit Endpoints - Work Item Type Behaviors
// ---------------------------------------------------------------------------

/**
 * POST /:connectionId/:processId/:witRefName/behavior - Add a behavior to a work item type.
 */
router.post('/:connectionId/:processId/:witRefName/behavior', async (req, res) => {
  try {
    const { connectionId, processId, witRefName } = req.params;
    const { service } = await createService(connectionId);
    const result = await service.addWorkItemTypeBehavior(processId, witRefName, req.body);
    await refreshTempStorage(service, connectionId, processId);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * PATCH /:connectionId/:processId/:witRefName/behavior/:behaviorId - Update a WIT behavior.
 */
router.patch('/:connectionId/:processId/:witRefName/behavior/:behaviorId', async (req, res) => {
  try {
    const { connectionId, processId, witRefName, behaviorId } = req.params;
    const { service } = await createService(connectionId);
    const result = await service.updateWorkItemTypeBehavior(processId, witRefName, behaviorId, req.body);
    await refreshTempStorage(service, connectionId, processId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * DELETE /:connectionId/:processId/:witRefName/behavior/:behaviorId - Remove a WIT behavior.
 */
router.delete('/:connectionId/:processId/:witRefName/behavior/:behaviorId', async (req, res) => {
  try {
    const { connectionId, processId, witRefName, behaviorId } = req.params;
    const { service } = await createService(connectionId);
    await service.removeWorkItemTypeBehavior(processId, witRefName, behaviorId);
    await refreshTempStorage(service, connectionId, processId);
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * PUT /:connectionId/:processId/:witRefName/control/:groupId - Add/move a control to a layout group.
 * Body must include { id: fieldRefName, label, visible, ... }.
 */
router.put('/:connectionId/:processId/:witRefName/control/:groupId', async (req, res) => {
  try {
    const { connectionId, processId, witRefName, groupId } = req.params;
    console.log(`[editor/addControl] witRefName=${witRefName} groupId=${groupId} body=${JSON.stringify(req.body)}`);
    const { service } = await createService(connectionId);
    const result = await service.addControl(processId, witRefName, groupId, req.body);
    await refreshTempStorage(service, connectionId, processId);
    res.json(result);
  } catch (err) {
    console.error(`[editor/addControl] FAILED: ${err.message}`);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * PATCH /:connectionId/:processId/:witRefName/control/:groupId/:controlId - Edit a control in place (e.g. toggle visible).
 */
router.patch('/:connectionId/:processId/:witRefName/control/:groupId/:controlId', async (req, res) => {
  try {
    const { connectionId, processId, witRefName, groupId, controlId } = req.params;
    console.log(`[editor/editControl] witRefName=${witRefName} groupId=${groupId} controlId=${controlId} body=${JSON.stringify(req.body)}`);
    const { service } = await createService(connectionId);
    const result = await service.editControl(processId, witRefName, groupId, controlId, req.body);
    await refreshTempStorage(service, connectionId, processId);
    res.json(result);
  } catch (err) {
    console.error(`[editor/editControl] FAILED: ${err.message}`);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * DELETE /:connectionId/:processId/:witRefName/control/:groupId/:controlId - Remove a control from layout.
 */
router.delete('/:connectionId/:processId/:witRefName/control/:groupId/:controlId', async (req, res) => {
  try {
    const { connectionId, processId, witRefName, groupId, controlId } = req.params;
    console.log(`[editor/removeControl] witRefName=${witRefName} groupId=${groupId} controlId=${controlId}`);
    const { service } = await createService(connectionId);
    await service.removeControl(processId, witRefName, groupId, controlId);
    await refreshTempStorage(service, connectionId, processId);
    res.json({ success: true });
  } catch (err) {
    console.error(`[editor/removeControl] FAILED: ${err.message}`);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

module.exports = router;
