const express = require('express');
const router = express.Router();
const tempStorage = require('../services/tempStorage');

// ---------------------------------------------------------------------------
// Helpers – comparison logic
// ---------------------------------------------------------------------------

/**
 * Compare work item types across all provided processes.
 *
 * @param {Array<{ processId: string, data: object }>} processesData
 * @returns {object} workItemTypes comparison section
 */
function compareWorkItemTypes(processesData) {
  const processIds = processesData.map((p) => p.processId);

  // Group by display name across all processes
  // byName[displayName][processId] = { present, isDisabled, referenceName, color, ... }
  const byName = {};
  const byProcess = {}; // processId -> [refNames] (kept for other comparison functions)

  for (const proc of processesData) {
    const refNames = [];
    for (const w of proc.data.workItemTypes || []) {
      const name = w.name || w.referenceName || w.id;
      const ref = w.referenceName || w.id;
      refNames.push(ref);
      if (!byName[name]) {
        byName[name] = {};
      }
      byName[name][proc.processId] = {
        present: true,
        isDisabled: w.isDisabled || false,
        referenceName: ref,
        color: w.color || '',
        description: w.description || '',
        icon: w.icon || '',
        isDefault: w.isDefault || false,
      };
    }
    byProcess[proc.processId] = refNames;
  }

  // Build sorted unique list of display names
  const allNames = Object.keys(byName).sort((a, b) => a.localeCompare(b));

  const differences = [];
  for (const witName of allNames) {
    const presentIn = processIds.filter((pid) => byName[witName][pid]);
    const missingFrom = processIds.filter((pid) => !byName[witName][pid]);

    if (missingFrom.length > 0) {
      differences.push({
        witName,
        presentIn,
        missingFrom,
      });
    }
  }

  return {
    all: allNames,
    byProcess,
    byName,
    differences,
  };
}

/**
 * Compare fields for each work item type across all processes.
 *
 * @param {Array<{ processId: string, data: object }>} processesData
 * @returns {object} fields comparison section
 */
function compareFields(processesData) {
  // Collect all unique WIT ref names that have field data
  const allWitRefs = new Set();
  for (const proc of processesData) {
    const fieldsByWit = proc.data.fields || {};
    for (const witRef of Object.keys(fieldsByWit)) {
      allWitRefs.add(witRef);
    }
  }

  const processIds = processesData.map((p) => p.processId);
  const byWorkItemType = {};

  for (const witRef of allWitRefs) {
    // Build witRefNames mapping: WIT display name -> WIT refname per process
    const witRefNames = {};
    for (const proc of processesData) {
      const wit = (proc.data.workItemTypes || []).find(
        (w) => (w.name || w.referenceName || w.id) === witRef
      );
      if (wit) {
        witRefNames[proc.processId] = wit.referenceName || wit.id;
      }
    }

    // Build a map of fieldRefName -> { processId: fieldObject }
    const fieldMap = {};

    for (const proc of processesData) {
      const fields = (proc.data.fields || {})[witRef] || [];
      for (const field of fields) {
        const ref = field.referenceName || field.name;
        if (!fieldMap[ref]) {
          fieldMap[ref] = {};
        }
        fieldMap[ref][proc.processId] = field;
      }
    }

    // Build a layout control index: fieldRefName -> { groupId, visible, controlType, label }
    // for each process, so we can cross-reference field visibility on the form.
    const layoutIndex = {}; // processId -> { fieldRefName -> controlInfo }
    const layoutGroups = {}; // processId -> [{ groupId, label }]
    for (const proc of processesData) {
      const layout = (proc.data.layouts || {})[witRef];
      const index = {};
      const groups = [];
      if (layout && layout.pages) {
        const AVOID_CONTROL_TYPES = new Set(['HtmlFieldControl', 'LinksControl', 'DeploymentsControl', 'WorkItemLogControl']);
        for (const page of layout.pages) {
          if (page.isContribution || ['history', 'links', 'attachments'].includes(page.pageType)) continue;
          for (const section of page.sections || []) {
            for (const group of section.groups || []) {
              if (!group.id) continue;
              // Collect all non-contribution groups for the user-facing dropdown
              if (!group.isContribution) {
                groups.push({ groupId: group.id, label: group.label || group.id });
              }
              const controls = group.controls || [];
              // Index each control by field referenceName
              for (const ctrl of controls) {
                if (ctrl.id) {
                  index[ctrl.id] = {
                    groupId: group.id,
                    groupLabel: group.label || group.id,
                    visible: ctrl.visible !== false,
                    controlType: ctrl.controlType || null,
                    label: ctrl.label || '',
                  };
                }
              }
            }
          }
        }
      }
      layoutIndex[proc.processId] = index;
      layoutGroups[proc.processId] = groups;
    }

    // Build byField map and allFieldNames, both keyed by display name
    const byField = {};
    const allFieldNames = Object.keys(fieldMap).map((ref) => {
      const entries = Object.values(fieldMap[ref]);
      const displayName = entries[0].name || ref;

      byField[displayName] = {};
      for (const [processId, field] of Object.entries(fieldMap[ref])) {
        const fieldRef = field.referenceName || ref;
        const ctrlInfo = layoutIndex[processId]?.[fieldRef];
        byField[displayName][processId] = {
          present: true,
          referenceName: fieldRef,
          name: field.name || ref,
          required: field.required || false,
          readOnly: field.readOnly || false,
          type: field.type || '',
          onLayout: !!ctrlInfo,
          layoutVisible: ctrlInfo ? ctrlInfo.visible : false,
          layoutGroupId: ctrlInfo ? ctrlInfo.groupId : null,
          layoutGroupLabel: ctrlInfo ? ctrlInfo.groupLabel : null,
          layoutControlType: ctrlInfo ? ctrlInfo.controlType : null,
          layoutLabel: ctrlInfo ? ctrlInfo.label : '',
        };
      }

      return displayName;
    });

    const differences = [];

    for (const [fieldRefName, procFields] of Object.entries(fieldMap)) {
      const presentIn = processIds.filter((pid) => procFields[pid] !== undefined);
      const missingFrom = processIds.filter((pid) => procFields[pid] === undefined);

      // Determine display name from any available process
      const sampleField = Object.values(procFields)[0];
      const fieldName = sampleField.name || fieldRefName;

      // Compare properties across processes where the field is present.
      // Skip metadata-only properties that always differ (e.g. url contains process-specific GUIDs).
      const IGNORED_FIELD_PROPS = new Set(['url', 'customization', 'hidden', 'isLocked']);
      const propertyDifferences = [];
      if (presentIn.length > 1) {
        // Gather all property keys across every process copy of this field
        const allProps = new Set();
        for (const pid of presentIn) {
          for (const key of Object.keys(procFields[pid])) {
            if (!IGNORED_FIELD_PROPS.has(key)) {
              allProps.add(key);
            }
          }
        }

        for (const prop of allProps) {
          const values = {};
          for (const pid of presentIn) {
            values[pid] = procFields[pid][prop] !== undefined ? procFields[pid][prop] : null;
          }

          // Detect differences using strict JSON comparison to catch type, casing, etc.
          const serialized = presentIn.map((pid) => JSON.stringify(values[pid]));
          const allSame = serialized.every((v) => v === serialized[0]);
          if (!allSame) {
            propertyDifferences.push({ property: prop, values });
          }
        }
      }

      // Also compare layout visibility across processes where the field is present
      if (presentIn.length > 1) {
        const onLayoutValues = {};
        const visibleValues = {};
        for (const pid of presentIn) {
          const fieldRef = procFields[pid].referenceName || fieldRefName;
          const ctrlInfo = layoutIndex[pid]?.[fieldRef];
          onLayoutValues[pid] = !!ctrlInfo;
          visibleValues[pid] = ctrlInfo ? ctrlInfo.visible : false;
        }
        const onLayoutSerialized = presentIn.map((pid) => JSON.stringify(onLayoutValues[pid]));
        if (!onLayoutSerialized.every((v) => v === onLayoutSerialized[0])) {
          propertyDifferences.push({ property: 'onLayout', values: onLayoutValues });
        }
        // Only compare layoutVisible when all processes have the field on the layout
        const allOnLayout = presentIn.every((pid) => onLayoutValues[pid]);
        if (allOnLayout) {
          const visibleSerialized = presentIn.map((pid) => JSON.stringify(visibleValues[pid]));
          if (!visibleSerialized.every((v) => v === visibleSerialized[0])) {
            propertyDifferences.push({ property: 'layoutVisible', values: visibleValues });
          }
        }
      }

      if (missingFrom.length > 0 || propertyDifferences.length > 0) {
        differences.push({
          fieldRefName,
          fieldName,
          presentIn,
          missingFrom,
          propertyDifferences,
        });
      }
    }

    byWorkItemType[witRef] = {
      all: allFieldNames,
      differences,
      byField,
      witRefNames,
      layoutGroups,
    };
  }

  return { byWorkItemType };
}

/**
 * Compare states for each work item type across all processes.
 *
 * @param {Array<{ processId: string, data: object }>} processesData
 * @returns {object} states comparison section
 */
function compareStates(processesData) {
  // Collect all unique WIT ref names that have state data
  const allWitRefs = new Set();
  for (const proc of processesData) {
    const statesByWit = proc.data.states || {};
    for (const witRef of Object.keys(statesByWit)) {
      allWitRefs.add(witRef);
    }
  }

  const processIds = processesData.map((p) => p.processId);
  const byWorkItemType = {};

  for (const witRef of allWitRefs) {
    // Build witRefNames mapping: WIT display name -> WIT refname per process
    const witRefNames = {};
    for (const proc of processesData) {
      const wit = (proc.data.workItemTypes || []).find(
        (w) => (w.name || w.referenceName || w.id) === witRef
      );
      if (wit) {
        witRefNames[proc.processId] = wit.referenceName || wit.id;
      }
    }

    // Build a map of stateName -> { processId: stateObject }
    const stateMap = {};

    for (const proc of processesData) {
      const states = (proc.data.states || {})[witRef] || [];
      for (const state of states) {
        const name = state.name;
        if (!stateMap[name]) {
          stateMap[name] = {};
        }
        stateMap[name][proc.processId] = state;
      }
    }

    // Build byState map with per-process state metadata
    const byState = {};
    const allStateNames = Object.keys(stateMap);

    for (const [stateName, procStates] of Object.entries(stateMap)) {
      byState[stateName] = {};
      for (const [processId, state] of Object.entries(procStates)) {
        byState[stateName][processId] = {
          present: true,
          id: state.id || '',
          name: state.name || stateName,
          color: state.color || '',
          stateCategory: state.stateCategory || '',
          order: state.order != null ? state.order : null,
          customizationType: state.customizationType || '',
        };
      }
    }

    const differences = [];

    for (const [stateName, procStates] of Object.entries(stateMap)) {
      const presentIn = processIds.filter((pid) => procStates[pid] !== undefined);
      const missingFrom = processIds.filter((pid) => procStates[pid] === undefined);

      // Compare properties across processes where the state is present.
      // Skip metadata-only properties that always differ.
      const IGNORED_STATE_PROPS = new Set(['url', 'customization', 'customizationType', 'id']);
      const propertyDifferences = [];
      if (presentIn.length > 1) {
        const allProps = new Set();
        for (const pid of presentIn) {
          for (const key of Object.keys(procStates[pid])) {
            if (!IGNORED_STATE_PROPS.has(key)) {
              allProps.add(key);
            }
          }
        }

        for (const prop of allProps) {
          const values = {};
          for (const pid of presentIn) {
            values[pid] = procStates[pid][prop] !== undefined ? procStates[pid][prop] : null;
          }

          const serialized = presentIn.map((pid) => JSON.stringify(values[pid]));
          const allSame = serialized.every((v) => v === serialized[0]);
          if (!allSame) {
            propertyDifferences.push({ property: prop, values });
          }
        }
      }

      if (missingFrom.length > 0 || propertyDifferences.length > 0) {
        differences.push({
          stateName,
          presentIn,
          missingFrom,
          propertyDifferences,
        });
      }
    }

    byWorkItemType[witRef] = {
      all: allStateNames,
      differences,
      byState,
      witRefNames,
    };
  }

  return { byWorkItemType };
}

/**
 * Compare process-level behaviors across all processes.
 *
 * @param {Array<{ processId: string, data: object }>} processesData
 * @returns {object} behaviors comparison section
 */
function compareBehaviors(processesData) {
  const behaviorMap = {}; // behaviorId -> { processId: behaviorObject }
  const processIds = processesData.map((p) => p.processId);

  for (const proc of processesData) {
    const behaviors = proc.data.behaviors || [];
    for (const behavior of behaviors) {
      const id = behavior.id || behavior.referenceName;
      if (!behaviorMap[id]) {
        behaviorMap[id] = {};
      }
      behaviorMap[id][proc.processId] = behavior;
    }
  }

  // Derive display names
  const behaviorNameMap = {};
  for (const [id, procBehaviors] of Object.entries(behaviorMap)) {
    const sample = Object.values(procBehaviors)[0];
    behaviorNameMap[id] = sample.name || id;
  }

  const allBehaviorNames = Object.keys(behaviorMap).map(
    (id) => behaviorNameMap[id] || id
  );

  const differences = [];

  for (const [behaviorId, procBehaviors] of Object.entries(behaviorMap)) {
    const presentIn = processIds.filter((pid) => procBehaviors[pid] !== undefined);
    const missingFrom = processIds.filter((pid) => procBehaviors[pid] === undefined);

    if (missingFrom.length > 0) {
      differences.push({
        behaviorId,
        behaviorName: behaviorNameMap[behaviorId] || behaviorId,
        presentIn,
        missingFrom,
      });
    }
  }

  return {
    all: allBehaviorNames,
    differences,
  };
}

/**
 * Compare work item type behavior associations across all processes.
 *
 * @param {Array<{ processId: string, data: object }>} processesData
 * @returns {object} workItemTypeBehaviors comparison section
 */
function compareWorkItemTypeBehaviors(processesData) {
  // Collect all unique WIT ref names that have WIT-behavior data
  const allWitRefs = new Set();
  for (const proc of processesData) {
    const witBehaviors = proc.data.workItemTypeBehaviors || {};
    for (const witRef of Object.keys(witBehaviors)) {
      allWitRefs.add(witRef);
    }
  }

  const processIds = processesData.map((p) => p.processId);
  const byWorkItemType = {};

  for (const witRef of allWitRefs) {
    // Build a map of behaviorId -> { processId: behaviorRefObject }
    const behaviorRefMap = {};

    for (const proc of processesData) {
      const behaviors = (proc.data.workItemTypeBehaviors || {})[witRef] || [];
      for (const behaviorRef of behaviors) {
        const id = (behaviorRef.behavior && behaviorRef.behavior.id) || behaviorRef.id;
        if (!id) continue;
        if (!behaviorRefMap[id]) {
          behaviorRefMap[id] = {};
        }
        behaviorRefMap[id][proc.processId] = behaviorRef;
      }
    }

    const differences = [];

    for (const [behaviorId, procRefs] of Object.entries(behaviorRefMap)) {
      // Detect presence/absence and property differences
      const presentIn = processIds.filter((pid) => procRefs[pid] !== undefined);
      const missingFrom = processIds.filter((pid) => procRefs[pid] === undefined);

      const hasDiff = missingFrom.length > 0;

      // Compare meaningful properties, ignoring url fields that contain process-specific GUIDs
      const COMPARE_PROPS = ['isDefault', 'isLegacyDefault'];
      const propertyDifferences = [];
      if (presentIn.length > 1) {
        for (const prop of COMPARE_PROPS) {
          const values = {};
          for (const pid of presentIn) {
            values[pid] = procRefs[pid][prop] !== undefined ? procRefs[pid][prop] : null;
          }
          const serialized = presentIn.map((pid) => JSON.stringify(values[pid]));
          if (!serialized.every((v) => v === serialized[0])) {
            propertyDifferences.push({ property: prop, values });
          }
        }
      }

      if (hasDiff || propertyDifferences.length > 0) {
        differences.push({ behaviorId, presentIn, missingFrom, propertyDifferences });
      }
    }

    byWorkItemType[witRef] = { differences };
  }

  return { byWorkItemType };
}

/**
 * Normalize pulled process data so that fields, states, and WIT behaviors
 * are available as flat objects keyed by WIT refname, in addition to being
 * nested inside workItemTypes[].
 *
 * The pull endpoint stores everything inside workItemTypes[], but the
 * comparison functions expect proc.data.fields, proc.data.states, and
 * proc.data.workItemTypeBehaviors as top-level objects.
 */
function normalizeProcessData(processesData) {
  for (const proc of processesData) {
    const data = proc.data;
    if (!data.fields) {
      data.fields = {};
    }
    if (!data.states) {
      data.states = {};
    }
    if (!data.workItemTypeBehaviors) {
      data.workItemTypeBehaviors = {};
    }
    if (!data.layouts) {
      data.layouts = {};
    }
    for (const wit of data.workItemTypes || []) {
      // Key by display name so WITs with different refnames but same name
      // (e.g. Agile Bug vs Scrum Bug) merge under one key
      const displayName = wit.name || wit.referenceName || wit.id;
      if (wit.fields && wit.fields.length > 0 && !data.fields[displayName]) {
        data.fields[displayName] = wit.fields;
      }
      if (wit.states && wit.states.length > 0 && !data.states[displayName]) {
        data.states[displayName] = wit.states;
      }
      if (wit.behaviors && wit.behaviors.length > 0 && !data.workItemTypeBehaviors[displayName]) {
        data.workItemTypeBehaviors[displayName] = wit.behaviors;
      }
      if (wit.layout && !data.layouts[displayName]) {
        data.layouts[displayName] = wit.layout;
      }
    }
  }
}

/**
 * Run the full comparison analysis across all loaded process data sets.
 *
 * @param {Array<{ connectionId: string, processId: string, data: object }>} processesData
 * @returns {object} Full comparison result
 */
function runComparison(processesData) {
  // Ensure fields/states/workItemTypeBehaviors are available at the top level
  normalizeProcessData(processesData);
  const workItemTypes = compareWorkItemTypes(processesData);
  const fields = compareFields(processesData);
  const states = compareStates(processesData);
  const behaviors = compareBehaviors(processesData);
  const workItemTypeBehaviors = compareWorkItemTypeBehaviors(processesData);

  // Count field differences across all WITs
  let fieldDiffCount = 0;
  for (const witData of Object.values(fields.byWorkItemType)) {
    fieldDiffCount += witData.differences.length;
  }

  // Count state differences across all WITs
  let stateDiffCount = 0;
  for (const witData of Object.values(states.byWorkItemType)) {
    stateDiffCount += witData.differences.length;
  }

  // Count WIT behavior differences across all WITs
  let witBehaviorDiffCount = 0;
  for (const witData of Object.values(workItemTypeBehaviors.byWorkItemType)) {
    witBehaviorDiffCount += witData.differences.length;
  }

  const witDifferences = workItemTypes.differences.length;
  const behaviorDifferences = behaviors.differences.length;

  const summary = {
    totalDifferences:
      witDifferences + fieldDiffCount + stateDiffCount + behaviorDifferences + witBehaviorDiffCount,
    witDifferences,
    fieldDifferences: fieldDiffCount,
    stateDifferences: stateDiffCount,
    behaviorDifferences,
    witBehaviorDifferences: witBehaviorDiffCount,
  };

  const processes = processesData.map((p) => ({
    connectionId: p.connectionId,
    processId: p.processId,
    processName: (p.data.process && p.data.process.name) || p.processId,
    orgUrl: (p.data.process && p.data.process.orgUrl) || p.data.orgUrl || null,
  }));

  return {
    processes,
    comparison: {
      workItemTypes,
      fields,
      states,
      behaviors,
      workItemTypeBehaviors,
      summary,
    },
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /compare - Compare two or more processes.
 * Body: { processes: [{ connectionId, processId }, ...] }
 */
router.post('/compare', async (req, res) => {
  try {
    const { processes } = req.body;

    if (!Array.isArray(processes) || processes.length < 2) {
      return res
        .status(400)
        .json({ error: 'At least two processes are required for comparison' });
    }

    // Load each process from temp storage
    const loaded = [];
    const missing = [];

    for (const { connectionId, processId } of processes) {
      if (!connectionId || !processId) {
        return res
          .status(400)
          .json({ error: 'Each process entry must include connectionId and processId' });
      }

      const data = await tempStorage.getProcessData(connectionId, processId);
      if (!data) {
        missing.push({ connectionId, processId });
      } else {
        loaded.push({ connectionId, processId, data });
      }
    }

    if (missing.length > 0) {
      const descriptions = missing
        .map((m) => `connectionId="${m.connectionId}", processId="${m.processId}"`)
        .join('; ');
      return res.status(400).json({
        error: `The following processes need to be pulled first: ${descriptions}`,
        missing,
      });
    }

    const result = runComparison(loaded);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /compare/summary - Quick summary comparison.
 * Body: { processes: [{ connectionId, processId }, ...] }
 * Returns only the summary counts.
 */
router.post('/compare/summary', async (req, res) => {
  try {
    const { processes } = req.body;

    if (!Array.isArray(processes) || processes.length < 2) {
      return res
        .status(400)
        .json({ error: 'At least two processes are required for comparison' });
    }

    const loaded = [];
    const missing = [];

    for (const { connectionId, processId } of processes) {
      if (!connectionId || !processId) {
        return res
          .status(400)
          .json({ error: 'Each process entry must include connectionId and processId' });
      }

      const data = await tempStorage.getProcessData(connectionId, processId);
      if (!data) {
        missing.push({ connectionId, processId });
      } else {
        loaded.push({ connectionId, processId, data });
      }
    }

    if (missing.length > 0) {
      const descriptions = missing
        .map((m) => `connectionId="${m.connectionId}", processId="${m.processId}"`)
        .join('; ');
      return res.status(400).json({
        error: `The following processes need to be pulled first: ${descriptions}`,
        missing,
      });
    }

    const result = runComparison(loaded);
    res.json({
      processes: result.processes,
      summary: result.comparison.summary,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
