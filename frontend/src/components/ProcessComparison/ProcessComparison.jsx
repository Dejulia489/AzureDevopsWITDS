import { useState, useMemo } from 'react';
import { comparison as comparisonApi, editor, processes as processesApi } from '../../services/api';

const TABS = ['Summary', 'Work Item Types', 'Fields', 'States', 'Behaviors'];

function getOrgName(orgUrl) {
  if (!orgUrl) return '';
  try {
    const url = new URL(orgUrl);
    if (url.hostname === 'dev.azure.com') return url.pathname.split('/').filter(Boolean)[0] || '';
    return url.hostname.split('.')[0] || '';
  } catch { return ''; }
}

function StateCategoryBadge({ category }) {
  const cls = {
    Proposed: 'state-proposed',
    InProgress: 'state-inprogress',
    Resolved: 'state-resolved',
    Completed: 'state-completed',
    Removed: 'state-removed',
  }[category] || '';
  return <span className={`badge badge-neutral ${cls}`}>{category || 'Unknown'}</span>;
}

function DiffBadge({ type }) {
  if (type === 'added') return <span className="badge badge-success">Present</span>;
  if (type === 'missing') return <span className="badge badge-danger">Missing</span>;
  if (type === 'changed') return <span className="badge badge-warning">Changed</span>;
  return <span className="badge badge-success">Match</span>;
}

function CollapsibleSection({ title, badge, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="collapsible-header" onClick={() => setOpen(!open)}>
        <span className={`collapsible-arrow ${open ? 'open' : ''}`}>&#9654;</span>
        <strong>{title}</strong>
        {badge}
      </div>
      {open && <div style={{ paddingLeft: 20 }}>{children}</div>}
    </div>
  );
}

export default function ProcessComparison({ comparisonResult, pulledProcesses, onCompare, onProcessPulled, notify }) {
  const [activeTab, setActiveTab] = useState('Summary');
  const [filterDiffsOnly, setFilterDiffsOnly] = useState(true);
  const [recomparing, setRecomparing] = useState(false);

  if (!comparisonResult) {
    return (
      <div className="card">
        <div className="empty-state">
          <h3>No Comparison Data</h3>
          <p>Go to the Discovery tab, pull two or more processes, then select them for comparison.</p>
        </div>
      </div>
    );
  }

  const { processes: procs, comparison: comp } = comparisonResult;
  const processNames = {};
  procs.forEach((p) => {
    const org = getOrgName(p.orgUrl);
    processNames[p.processId] = org ? `${p.processName} (${org})` : p.processName;
  });

  const handleRecompare = async () => {
    setRecomparing(true);
    try {
      // Re-pull all processes from Azure DevOps before comparing
      const pairs = procs.map((p) => ({ connectionId: p.connectionId, processId: p.processId }));
      await Promise.all(
        pairs.map(async ({ connectionId, processId }) => {
          const data = await processesApi.pull(connectionId, processId);
          onProcessPulled(data);
        })
      );
      const result = await comparisonApi.compare(pairs);
      onCompare(result);
      notify('success', 'Processes re-pulled and comparison refreshed');
    } catch (err) {
      notify('error', `Recomparison failed: ${err.message}`);
    } finally {
      setRecomparing(false);
    }
  };

  const { summary } = comp;

  return (
    <div>
      {/* Summary banner */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 style={{ marginBottom: 4 }}>Process Comparison</h2>
            <div className="text-sm text-secondary">
              Comparing {procs.length} processes: {procs.map((p) => processNames[p.processId]).join(' vs ')}
            </div>
          </div>
          <div className="btn-group">
            <button className="btn btn-sm" onClick={handleRecompare} disabled={recomparing}>
              {recomparing ? <><span className="spinner" /> Refreshing...</> : 'Re-compare'}
            </button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap mt-4">
          <span className={`badge ${summary.totalDifferences === 0 ? 'badge-success' : 'badge-danger'}`}>
            {summary.totalDifferences} Total Differences
          </span>
          {summary.witDifferences > 0 && <span className="badge badge-warning">{summary.witDifferences} WIT diffs</span>}
          {summary.fieldDifferences > 0 && <span className="badge badge-warning">{summary.fieldDifferences} Field diffs</span>}
          {summary.stateDifferences > 0 && <span className="badge badge-warning">{summary.stateDifferences} State diffs</span>}
          {summary.behaviorDifferences > 0 && <span className="badge badge-warning">{summary.behaviorDifferences} Behavior diffs</span>}
          {summary.witBehaviorDifferences > 0 && <span className="badge badge-warning">{summary.witBehaviorDifferences} WIT Behavior diffs</span>}
          {summary.totalDifferences === 0 && <span className="badge badge-success">All processes match!</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map((tab) => (
          <button key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </div>

      {/* Filter toggle */}
      {['Fields', 'States'].includes(activeTab) && (
        <div className="flex items-center gap-2 mb-4">
          <label className="text-sm">
            <input type="checkbox" checked={filterDiffsOnly} onChange={(e) => setFilterDiffsOnly(e.target.checked)} style={{ marginRight: 6 }} />
            Show only differences
          </label>
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'Summary' && <SummaryTab comp={comp} procs={procs} processNames={processNames} />}
      {activeTab === 'Work Item Types' && <WitTab comp={comp} procs={procs} processNames={processNames} notify={notify} onRecompare={handleRecompare} />}
      {activeTab === 'Fields' && <FieldsTab comp={comp} procs={procs} processNames={processNames} filterDiffsOnly={filterDiffsOnly} notify={notify} onRecompare={handleRecompare} />}
      {activeTab === 'States' && <StatesTab comp={comp} procs={procs} processNames={processNames} filterDiffsOnly={filterDiffsOnly} notify={notify} onRecompare={handleRecompare} />}
      {activeTab === 'Behaviors' && <BehaviorsTab comp={comp} procs={procs} processNames={processNames} />}
    </div>
  );
}

function SummaryTab({ comp, procs, processNames }) {
  const { summary, workItemTypes, fields, states, behaviors } = comp;
  return (
    <div className="card">
      <h3 style={{ marginBottom: 12 }}>Comparison Overview</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Total Items</th>
              <th>Differences</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Work Item Types</strong></td>
              <td>{workItemTypes.all.length}</td>
              <td>{workItemTypes.differences.length}</td>
              <td>{workItemTypes.differences.length === 0 ? <span className="badge badge-success">Match</span> : <span className="badge badge-danger">{workItemTypes.differences.length} diffs</span>}</td>
            </tr>
            <tr>
              <td><strong>Fields</strong></td>
              <td>--</td>
              <td>{summary.fieldDifferences}</td>
              <td>{summary.fieldDifferences === 0 ? <span className="badge badge-success">Match</span> : <span className="badge badge-danger">{summary.fieldDifferences} diffs</span>}</td>
            </tr>
            <tr>
              <td><strong>States</strong></td>
              <td>--</td>
              <td>{summary.stateDifferences}</td>
              <td>{summary.stateDifferences === 0 ? <span className="badge badge-success">Match</span> : <span className="badge badge-danger">{summary.stateDifferences} diffs</span>}</td>
            </tr>
            <tr>
              <td><strong>Behaviors</strong></td>
              <td>{behaviors.all.length}</td>
              <td>{behaviors.differences.length}</td>
              <td>{behaviors.differences.length === 0 ? <span className="badge badge-success">Match</span> : <span className="badge badge-danger">{behaviors.differences.length} diffs</span>}</td>
            </tr>
            <tr>
              <td><strong>WIT Behaviors</strong></td>
              <td>--</td>
              <td>{summary.witBehaviorDifferences}</td>
              <td>{summary.witBehaviorDifferences === 0 ? <span className="badge badge-success">Match</span> : <span className="badge badge-danger">{summary.witBehaviorDifferences} diffs</span>}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {/* Per-process WIT counts */}
      <h3 style={{ marginTop: 20, marginBottom: 8 }}>Processes</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Process</th><th>Organization</th><th>Work Item Types</th></tr>
          </thead>
          <tbody>
            {procs.map((p) => (
              <tr key={p.processId}>
                <td><strong>{processNames[p.processId]}</strong></td>
                <td className="text-sm text-secondary">{p.orgUrl}</td>
                <td>{(workItemTypes.byProcess[p.processId] || []).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WitTab({ comp, procs, processNames, notify, onRecompare }) {
  const { workItemTypes } = comp;
  const [actionLoading, setActionLoading] = useState(false);
  const [showCreateWit, setShowCreateWit] = useState(false);
  const [createTargetKey, setCreateTargetKey] = useState('');
  const [witForm, setWitForm] = useState({ name: '', description: '', color: '009CCC', icon: 'icon_clipboard' });

  const handleToggleDisabled = async (proc, witName, witInfo) => {
    setActionLoading(true);
    try {
      await editor.updateWorkItemType(
        proc.connectionId, proc.processId, witInfo.referenceName,
        { isDisabled: !witInfo.isDisabled }
      );
      notify('success', `${witName} ${witInfo.isDisabled ? 'enabled' : 'disabled'} in ${processNames[proc.processId]}`);
      await onRecompare();
    } catch (err) {
      notify('error', `Failed to toggle ${witName}: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddWit = async (targetProc, witName) => {
    const sourceProc = procs.find((p) => workItemTypes.byName?.[witName]?.[p.processId]);
    if (!sourceProc) return;
    const sourceInfo = workItemTypes.byName[witName][sourceProc.processId];
    setActionLoading(true);
    try {
      await editor.createWorkItemType(
        targetProc.connectionId, targetProc.processId,
        { name: witName, color: sourceInfo.color || '009CCC', description: sourceInfo.description || '', icon: sourceInfo.icon || 'icon_clipboard' }
      );
      notify('success', `Added "${witName}" to ${processNames[targetProc.processId]}`);
      await onRecompare();
    } catch (err) {
      notify('error', `Failed to add ${witName}: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateWit = async () => {
    if (!createTargetKey || !witForm.name) return;
    const [connectionId, processId] = createTargetKey.split('::');
    setActionLoading(true);
    try {
      await editor.createWorkItemType(connectionId, processId, {
        name: witForm.name, color: witForm.color, description: witForm.description, icon: witForm.icon || 'icon_clipboard',
      });
      notify('success', `Created "${witForm.name}"`);
      setWitForm({ name: '', description: '', color: '009CCC', icon: 'icon_clipboard' });
      setShowCreateWit(false);
      await onRecompare();
    } catch (err) {
      notify('error', `Failed to create work item type: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3>Work Item Types</h3>
        <button className="btn btn-sm btn-primary" onClick={() => setShowCreateWit(!showCreateWit)}>+ Create New Work Item Type</button>
      </div>

      {showCreateWit && (
        <div style={{ padding: 12, background: 'var(--color-primary-light)', borderRadius: 'var(--radius)', marginBottom: 12 }}>
          <div className="form-group">
            <label>Target Process</label>
            <select value={createTargetKey} onChange={(e) => setCreateTargetKey(e.target.value)}>
              <option value="">-- Select process --</option>
              {procs.map((p) => <option key={p.processId} value={`${p.connectionId}::${p.processId}`}>{processNames[p.processId]}</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Name</label><input value={witForm.name} onChange={(e) => setWitForm({ ...witForm, name: e.target.value })} placeholder="e.g. Custom Bug" /></div>
            <div className="form-group"><label>Color</label><input type="color" value={`#${witForm.color}`} onChange={(e) => setWitForm({ ...witForm, color: e.target.value.replace('#', '') })} /></div>
          </div>
          <div className="form-group"><label>Description</label><input value={witForm.description} onChange={(e) => setWitForm({ ...witForm, description: e.target.value })} /></div>
          <div className="btn-group">
            <button className="btn btn-primary btn-sm" onClick={handleCreateWit} disabled={actionLoading || !createTargetKey || !witForm.name}>
              {actionLoading ? <><span className="spinner" /> Creating...</> : 'Create'}
            </button>
            <button className="btn btn-sm" onClick={() => setShowCreateWit(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Work Item Type</th>
              {procs.map((p) => <th key={p.processId}>{processNames[p.processId]}</th>)}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(workItemTypes.all || []).map((witName, index) => {
              const diff = workItemTypes.differences.find((d) => d.witName === witName);
              const hasDiff = !!diff && (diff.missingFrom?.length > 0);
              const presentIds = procs.filter((p) => workItemTypes.byName?.[witName]?.[p.processId]).map((p) => p.processId);
              const disabledValues = presentIds.map((pid) => workItemTypes.byName[witName][pid].isDisabled);
              const hasDisabledMismatch = !hasDiff && presentIds.length > 1 && !disabledValues.every((v) => v === disabledValues[0]);
              return (
                <tr key={witName} className={hasDiff ? 'diff-changed' : hasDisabledMismatch ? 'diff-changed' : ''}>
                  <td className="text-secondary">{index + 1}</td>
                  <td><strong>{witName}</strong></td>
                  {procs.map((p) => {
                    const witInfo = workItemTypes.byName?.[witName]?.[p.processId];
                    return (
                      <td key={p.processId} className={!witInfo ? 'diff-removed' : ''}>
                        {witInfo ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            {witInfo.isDisabled
                              ? <span className="badge badge-neutral">Disabled</span>
                              : <span className="badge badge-success">Enabled</span>}
                            {!witInfo.isDefault && (
                              <button className="btn btn-sm" disabled={actionLoading} onClick={() => handleToggleDisabled(p, witName, witInfo)}>
                                {witInfo.isDisabled ? 'Enable' : 'Disable'}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="badge badge-danger">Missing</span>
                            <button className="btn btn-sm btn-primary" disabled={actionLoading} onClick={() => handleAddWit(p, witName)}>Add</button>
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    {hasDiff ? <span className="badge badge-danger">Mismatch</span>
                      : hasDisabledMismatch ? <span className="badge badge-warning">Disabled Mismatch</span>
                      : <span className="badge badge-success">Match</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FieldInfoPopover({ fieldPerProc, procs, processNames, onClose }) {
  // Show field properties from the first process that has it
  const firstPid = procs.find((p) => fieldPerProc[p.processId])?.processId;
  if (!firstPid) return null;
  const info = fieldPerProc[firstPid];
  return (
    <div className="field-popover" onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontSize: 13 }}>{info.name}</strong>
        <button className="info-icon" onClick={onClose} title="Close" style={{ border: 'none', background: 'none', fontSize: 14, cursor: 'pointer' }}>&times;</button>
      </div>
      <dl style={{ margin: 0 }}>
        <dt>Reference Name</dt>
        <dd className="text-mono">{info.referenceName}</dd>
        <dt>Type</dt>
        <dd>{info.type || '--'}</dd>
        {info.description && <><dt>Description</dt><dd>{info.description}</dd></>}
        <dt>Required</dt>
        <dd>{info.required ? 'Yes' : 'No'}</dd>
        <dt>Read Only</dt>
        <dd>{info.readOnly ? 'Yes' : 'No'}</dd>
        {info.defaultValue != null && <><dt>Default Value</dt><dd>{String(info.defaultValue)}</dd></>}
      </dl>
      {procs.filter((p) => fieldPerProc[p.processId]).length > 1 && (
        <div style={{ marginTop: 8, borderTop: '1px solid var(--color-border)', paddingTop: 6 }}>
          <dt style={{ fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: 11, marginBottom: 4 }}>Per-Process Layout</dt>
          {procs.map((p) => {
            const fi = fieldPerProc[p.processId];
            if (!fi) return null;
            return (
              <div key={p.processId} style={{ fontSize: 11, marginBottom: 2 }}>
                <strong>{processNames[p.processId]}:</strong>{' '}
                {fi.onLayout ? (fi.layoutVisible ? `On Form (${fi.layoutGroupLabel || 'unknown group'})` : `Hidden (${fi.layoutGroupLabel || 'unknown group'})`) : 'Not on Form'}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FieldsTab({ comp, procs, processNames, filterDiffsOnly, notify, onRecompare }) {
  const { fields } = comp;
  const [actionLoading, setActionLoading] = useState(false);
  const [orgFieldsCache, setOrgFieldsCache] = useState({}); // connectionId -> fields[]
  const [loadingOrgFields, setLoadingOrgFields] = useState(false);
  const [addFieldWit, setAddFieldWit] = useState(null); // which WIT section has the add-field form open
  const [addFieldTarget, setAddFieldTarget] = useState(''); // connectionId::processId
  const [addFieldRef, setAddFieldRef] = useState(''); // selected org field referenceName
  const [openInfoField, setOpenInfoField] = useState(null); // "witName::fieldName" key for open popover

  if (!fields?.byWorkItemType) return <div className="card"><p className="text-secondary">No field data available.</p></div>;

  const witNames = Object.keys(fields.byWorkItemType);
  if (witNames.length === 0) return <div className="card"><p className="text-secondary">No field data available.</p></div>;

  // Load org fields for all unique connections (deduplicated)
  const loadOrgFields = async () => {
    const connIds = [...new Set(procs.map((p) => p.connectionId))];
    const missing = connIds.filter((id) => !orgFieldsCache[id]);
    if (missing.length === 0) return;
    setLoadingOrgFields(true);
    try {
      const results = await Promise.all(missing.map((id) => processesApi.getOrgFields(id).then((r) => ({ id, fields: r.fields || r.value || [] }))));
      setOrgFieldsCache((prev) => {
        const next = { ...prev };
        results.forEach((r) => { next[r.id] = r.fields; });
        return next;
      });
    } catch (err) {
      notify('error', `Failed to load org fields: ${err.message}`);
    } finally {
      setLoadingOrgFields(false);
    }
  };

  const handleOpenAddField = async (witName) => {
    setAddFieldWit(witName);
    setAddFieldTarget('');
    setAddFieldRef('');
    await loadOrgFields();
  };

  const [showGroupPicker, setShowGroupPicker] = useState(null); // key = `${processId}::${witName}::${fieldName}`
  const [selectedGroup, setSelectedGroup] = useState('');

  const handleToggleVisibility = async (proc, witName, fieldName, fieldInfo) => {
    const witData = fields.byWorkItemType[witName];
    const witRefName = witData?.witRefNames?.[proc.processId];
    if (!witRefName) { notify('error', `Cannot find WIT reference name for ${witName}`); return; }
    if (!fieldInfo.layoutGroupId) { notify('error', 'Field has no layout control to toggle'); return; }
    const newVisible = !fieldInfo.layoutVisible;
    setActionLoading(true);
    try {
      await editor.editControl(proc.connectionId, proc.processId, witRefName, fieldInfo.layoutGroupId, fieldInfo.referenceName, {
        visible: newVisible,
      });
      notify('success', `${newVisible ? 'Showing' : 'Hiding'} "${fieldName}" on form in ${processNames[proc.processId]}`);
      await onRecompare();
    } catch (err) {
      notify('error', `Failed to toggle visibility: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveField = async (proc, witName, fieldName, fieldInfo) => {
    const witData = fields.byWorkItemType[witName];
    const witRefName = witData?.witRefNames?.[proc.processId];
    if (!witRefName) { notify('error', `Cannot find WIT reference name for ${witName}`); return; }
    setActionLoading(true);
    try {
      await editor.removeField(proc.connectionId, proc.processId, witRefName, fieldInfo.referenceName);
      notify('success', `Removed "${fieldName}" from ${witName} in ${processNames[proc.processId]}`);
      await onRecompare();
    } catch (err) {
      notify('error', `Failed to remove field: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleShowOnLayout = async (proc, witName, fieldName, fieldInfo, groupId) => {
    const witData = fields.byWorkItemType[witName];
    const witRefName = witData?.witRefNames?.[proc.processId];
    if (!witRefName) { notify('error', `Cannot find WIT reference name for ${witName}`); return; }
    setActionLoading(true);
    try {
      await editor.addControl(proc.connectionId, proc.processId, witRefName, groupId, {
        id: fieldInfo.referenceName,
        order: null,
        label: fieldInfo.name || fieldName,
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
      notify('success', `Added "${fieldName}" to form layout in ${processNames[proc.processId]}`);
      setShowGroupPicker(null);
      setSelectedGroup('');
      await onRecompare();
    } catch (err) {
      notify('error', `Failed to add to layout: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddMissingField = async (targetProc, witName, fieldName) => {
    const witData = fields.byWorkItemType[witName];
    const witRefName = witData?.witRefNames?.[targetProc.processId];
    if (!witRefName) { notify('error', `Cannot find WIT reference name for ${witName}`); return; }
    // Get the field refname from a process that has it
    const fieldInfo = witData.byField?.[fieldName];
    const sourceEntry = fieldInfo && Object.values(fieldInfo)[0];
    if (!sourceEntry) { notify('error', `Cannot find field data for ${fieldName}`); return; }
    setActionLoading(true);
    try {
      await editor.addField(targetProc.connectionId, targetProc.processId, witRefName, { referenceName: sourceEntry.referenceName });
      notify('success', `Added "${fieldName}" to ${witName} in ${processNames[targetProc.processId]}`);
      await onRecompare();
    } catch (err) {
      notify('error', `Failed to add field: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddNewField = async (witName) => {
    if (!addFieldTarget || !addFieldRef) return;
    const [connectionId, processId] = addFieldTarget.split('::');
    const witData = fields.byWorkItemType[witName];
    const witRefName = witData?.witRefNames?.[processId];
    if (!witRefName) { notify('error', `Cannot find WIT reference name for ${witName}`); return; }
    setActionLoading(true);
    try {
      await editor.addField(connectionId, processId, witRefName, { referenceName: addFieldRef });
      const fieldLabel = addFieldRef.split('.').pop();
      notify('success', `Added "${fieldLabel}" to ${witName}`);
      setAddFieldWit(null);
      setAddFieldTarget('');
      setAddFieldRef('');
      await onRecompare();
    } catch (err) {
      notify('error', `Failed to add field: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Build filtered list of org fields for the add-field dropdown (exclude already-present fields)
  const getAvailableOrgFields = (witName) => {
    if (!addFieldTarget) return [];
    const [connectionId] = addFieldTarget.split('::');
    const allOrgFields = orgFieldsCache[connectionId] || [];
    const witData = fields.byWorkItemType[witName];
    const byField = witData?.byField || {};
    // Collect refnames already present in ANY process for this WIT
    const existingRefs = new Set();
    for (const perProc of Object.values(byField)) {
      for (const info of Object.values(perProc)) {
        if (info.referenceName) existingRefs.add(info.referenceName);
      }
    }
    return allOrgFields.filter((f) => !existingRefs.has(f.referenceName));
  };

  return (
    <div>
      {witNames.map((witName) => {
        const witData = fields.byWorkItemType[witName];
        const diffs = witData.differences || [];
        const byField = witData.byField || {};
        if (filterDiffsOnly && diffs.length === 0) return null;

        const fieldsToShow = (filterDiffsOnly ? diffs.map((d) => d.fieldName) : (witData.all || [])).slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const isAddFieldOpen = addFieldWit === witName;
        const availableOrgFields = isAddFieldOpen ? getAvailableOrgFields(witName) : [];

        return (
          <CollapsibleSection
            key={witName}
            title={witName}
            badge={diffs.length > 0 ? <span className="badge badge-danger" style={{ marginLeft: 8 }}>{diffs.length} diffs</span> : <span className="badge badge-success" style={{ marginLeft: 8 }}>Match</span>}
            defaultOpen={diffs.length > 0}
          >
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <span className="text-sm text-secondary">{fieldsToShow.length} field{fieldsToShow.length !== 1 ? 's' : ''}</span>
                <button className="btn btn-sm btn-primary" onClick={() => isAddFieldOpen ? setAddFieldWit(null) : handleOpenAddField(witName)}>
                  {isAddFieldOpen ? 'Cancel' : '+ Add Field'}
                </button>
              </div>

              {isAddFieldOpen && (
                <div style={{ padding: 12, background: 'var(--color-primary-light)', borderRadius: 'var(--radius)', marginBottom: 12 }}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Target Process</label>
                      <select value={addFieldTarget} onChange={(e) => { setAddFieldTarget(e.target.value); setAddFieldRef(''); }}>
                        <option value="">-- Select process --</option>
                        {procs.map((p) => <option key={p.processId} value={`${p.connectionId}::${p.processId}`}>{processNames[p.processId]}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Organization Field</label>
                      {loadingOrgFields ? (
                        <div className="text-sm text-secondary"><span className="spinner" /> Loading fields...</div>
                      ) : (
                        <select value={addFieldRef} onChange={(e) => setAddFieldRef(e.target.value)} disabled={!addFieldTarget}>
                          <option value="">-- Select field --</option>
                          {availableOrgFields.map((f) => (
                            <option key={f.referenceName} value={f.referenceName}>{f.name} ({f.referenceName})</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                  <div className="btn-group">
                    <button className="btn btn-primary btn-sm" onClick={() => handleAddNewField(witName)} disabled={actionLoading || !addFieldTarget || !addFieldRef}>
                      {actionLoading ? <><span className="spinner" /> Adding...</> : 'Add Field'}
                    </button>
                    <button className="btn btn-sm" onClick={() => setAddFieldWit(null)}>Cancel</button>
                  </div>
                </div>
              )}

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      {procs.map((p) => <th key={p.processId}>{processNames[p.processId]}</th>)}
                      <th>Differences</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldsToShow.map((fieldName) => {
                      const diff = diffs.find((d) => d.fieldName === fieldName);
                      const hasDiff = !!diff;
                      const fieldPerProc = byField[fieldName] || {};
                      // Check for layout visibility mismatch
                      const presentProcs = procs.filter((p) => fieldPerProc[p.processId]);
                      const layoutValues = presentProcs.map((p) => fieldPerProc[p.processId].onLayout);
                      const hasLayoutMismatch = presentProcs.length > 1 && !layoutValues.every((v) => v === layoutValues[0]);

                      return (
                        <tr key={fieldName} className={hasDiff ? 'diff-changed' : hasLayoutMismatch ? 'diff-changed' : ''}>
                          <td className="text-mono text-sm" style={{ position: 'relative' }}>
                            <div className="flex items-center gap-2">
                              <strong>{fieldName}</strong>
                              <span
                                className="info-icon"
                                title="View field details"
                                onClick={() => setOpenInfoField(openInfoField === `${witName}::${fieldName}` ? null : `${witName}::${fieldName}`)}
                              >i</span>
                            </div>
                            {openInfoField === `${witName}::${fieldName}` && (
                              <>
                                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpenInfoField(null)} />
                                <FieldInfoPopover
                                  fieldPerProc={fieldPerProc}
                                  procs={procs}
                                  processNames={processNames}
                                  onClose={() => setOpenInfoField(null)}
                                />
                              </>
                            )}
                          </td>
                          {procs.map((p) => {
                            const info = fieldPerProc[p.processId];
                            const isMissing = !info;
                            const pickerKey = `${p.processId}::${witName}::${fieldName}`;
                            const isPickerOpen = showGroupPicker === pickerKey;
                            const groups = witData.layoutGroups?.[p.processId] || [];
                            return (
                              <td key={p.processId} className={isMissing ? 'diff-removed' : ''}>
                                {isMissing ? (
                                  <div className="field-cell">
                                    <div className="field-cell-status"><span className="badge badge-danger">Missing</span></div>
                                    <div className="field-cell-actions">
                                      <button className="btn btn-sm btn-primary" disabled={actionLoading} onClick={() => handleAddMissingField(p, witName, fieldName)}>Add</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="field-cell">
                                    <div className="field-cell-status">
                                      {info.onLayout && info.layoutVisible
                                        ? <>
                                            <span className="badge badge-success">On Form</span>
                                            <span className="text-sm text-secondary">{info.layoutGroupLabel}</span>
                                          </>
                                        : info.onLayout && !info.layoutVisible
                                        ? <>
                                            <span className="badge badge-warning">Hidden</span>
                                            <span className="text-sm text-secondary">{info.layoutGroupLabel}</span>
                                          </>
                                        : <span className="badge badge-neutral">Not on Form</span>
                                      }
                                    </div>
                                    <div className="field-cell-actions">
                                      {info.onLayout && info.layoutVisible
                                        ? <button className="btn btn-sm" disabled={actionLoading} onClick={() => handleToggleVisibility(p, witName, fieldName, info)}>Hide</button>
                                        : info.onLayout && !info.layoutVisible
                                        ? <button className="btn btn-sm btn-primary" disabled={actionLoading} onClick={() => handleToggleVisibility(p, witName, fieldName, info)}>Show</button>
                                        : isPickerOpen ? (
                                            <>
                                              <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)} style={{ fontSize: '0.85em', maxWidth: 140 }}>
                                                <option value="">-- Group --</option>
                                                {groups.map((g) => <option key={g.groupId} value={g.groupId}>{g.label}</option>)}
                                              </select>
                                              <button className="btn btn-sm btn-primary" disabled={actionLoading || !selectedGroup} onClick={() => handleShowOnLayout(p, witName, fieldName, info, selectedGroup)}>Place</button>
                                              <button className="btn btn-sm" onClick={() => { setShowGroupPicker(null); setSelectedGroup(''); }}>X</button>
                                            </>
                                          ) : (
                                            <button className="btn btn-sm btn-primary" disabled={actionLoading} onClick={() => { setShowGroupPicker(pickerKey); setSelectedGroup(''); }}>Show</button>
                                          )
                                      }
                                      <button className="btn btn-sm btn-danger" disabled={actionLoading} onClick={() => handleRemoveField(p, witName, fieldName, info)} title="Remove field from work item type">Remove</button>
                                    </div>
                                  </div>
                                )}
                              </td>
                            );
                          })}
                          <td>
                            {diff?.propertyDifferences?.length > 0 ? (
                              <div>
                                {diff.propertyDifferences.map((pd, i) => (
                                  <div key={i} className="text-sm" style={{ marginBottom: 2 }}>
                                    <strong>{pd.property}:</strong>{' '}
                                    {Object.entries(pd.values || {}).map(([pid, val]) => (
                                      <span key={pid} className="badge badge-neutral" style={{ margin: '0 2px' }}>
                                        {processNames[pid]}: {String(val ?? 'null')}
                                      </span>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            ) : hasDiff ? (
                              <span className="badge badge-warning">Presence differs</span>
                            ) : hasLayoutMismatch ? (
                              <span className="badge badge-warning">Layout Mismatch</span>
                            ) : (
                              <span className="text-sm text-secondary">--</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </CollapsibleSection>
        );
      })}
    </div>
  );
}

const STATE_CATEGORIES = ['Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed'];

function StatesTab({ comp, procs, processNames, filterDiffsOnly, notify, onRecompare }) {
  const { states } = comp;
  const [actionLoading, setActionLoading] = useState(false);
  const [createStateWit, setCreateStateWit] = useState(null); // which WIT section has the create form open
  const [createTargetKey, setCreateTargetKey] = useState(''); // connectionId::processId
  const [stateForm, setStateForm] = useState({ name: '', color: '000000', stateCategory: 'Proposed', order: '' });

  if (!states?.byWorkItemType) return <div className="card"><p className="text-secondary">No state data available.</p></div>;

  const witNames = Object.keys(states.byWorkItemType);
  if (witNames.length === 0) return <div className="card"><p className="text-secondary">No state data available.</p></div>;

  const handleAddMissingState = async (targetProc, witName, stateName) => {
    const witData = states.byWorkItemType[witName];
    const witRefName = witData?.witRefNames?.[targetProc.processId];
    if (!witRefName) { notify('error', `Cannot find WIT reference name for ${witName}`); return; }
    // Get state data from a process that has it
    const stateInfo = witData.byState?.[stateName];
    const sourceEntry = stateInfo && Object.values(stateInfo)[0];
    if (!sourceEntry) { notify('error', `Cannot find state data for ${stateName}`); return; }
    setActionLoading(true);
    try {
      await editor.createState(targetProc.connectionId, targetProc.processId, witRefName, {
        name: sourceEntry.name,
        color: sourceEntry.color || '000000',
        stateCategory: sourceEntry.stateCategory || 'Proposed',
        order: sourceEntry.order,
      });
      notify('success', `Added state "${stateName}" to ${witName} in ${processNames[targetProc.processId]}`);
      await onRecompare();
    } catch (err) {
      notify('error', `Failed to add state: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMoveState = async (proc, witName, stateName, direction) => {
    const witData = states.byWorkItemType[witName];
    const witRefName = witData?.witRefNames?.[proc.processId];
    if (!witRefName) { notify('error', `Cannot find WIT reference name for ${witName}`); return; }
    const byState = witData.byState || {};

    // Collect all states for this process in this WIT, sorted by order
    const procStates = [];
    for (const [sName, perProc] of Object.entries(byState)) {
      const info = perProc[proc.processId];
      if (info) procStates.push({ name: sName, ...info });
    }
    procStates.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const idx = procStates.findIndex((s) => s.name === stateName);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= procStates.length) return;

    const current = procStates[idx];
    const adjacent = procStates[swapIdx];

    const currentIsSystem = current.customizationType === 'system';
    const adjacentIsSystem = adjacent.customizationType === 'system';

    if (currentIsSystem && adjacentIsSystem) {
      notify('error', 'Cannot reorder system states — they are read-only in inherited processes');
      return;
    }

    setActionLoading(true);
    try {
      if (!currentIsSystem && !adjacentIsSystem) {
        // Both custom: swap orders
        await editor.updateState(proc.connectionId, proc.processId, witRefName, current.id, { order: adjacent.order });
        await editor.updateState(proc.connectionId, proc.processId, witRefName, adjacent.id, { order: current.order });
      } else if (currentIsSystem) {
        // Current is system (can't PATCH it) — only move adjacent into current's slot
        await editor.updateState(proc.connectionId, proc.processId, witRefName, adjacent.id, { order: current.order });
      } else {
        // Adjacent is system (can't PATCH it) — only move current into adjacent's slot
        await editor.updateState(proc.connectionId, proc.processId, witRefName, current.id, { order: adjacent.order });
      }
      notify('success', `Reordered "${stateName}" in ${processNames[proc.processId]}`);
      await onRecompare();
    } catch (err) {
      notify('error', `Failed to reorder state: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateState = async (witName) => {
    if (!createTargetKey || !stateForm.name) return;
    const [connectionId, processId] = createTargetKey.split('::');
    const witData = states.byWorkItemType[witName];
    const witRefName = witData?.witRefNames?.[processId];
    if (!witRefName) { notify('error', `Cannot find WIT reference name for ${witName}`); return; }
    setActionLoading(true);
    try {
      await editor.createState(connectionId, processId, witRefName, {
        name: stateForm.name,
        color: stateForm.color,
        stateCategory: stateForm.stateCategory,
        order: stateForm.order ? Number(stateForm.order) : undefined,
      });
      notify('success', `Created state "${stateForm.name}" in ${witName}`);
      setCreateStateWit(null);
      setCreateTargetKey('');
      setStateForm({ name: '', color: '000000', stateCategory: 'Proposed', order: '' });
      await onRecompare();
    } catch (err) {
      notify('error', `Failed to create state: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div>
      {witNames.map((witName) => {
        const witData = states.byWorkItemType[witName];
        const diffs = witData.differences || [];
        const byState = witData.byState || {};
        if (filterDiffsOnly && diffs.length === 0) return null;

        const stateNamesToShow = filterDiffsOnly ? diffs.map((d) => d.stateName) : (witData.all || []);
        const isCreateOpen = createStateWit === witName;

        // Build sorted state lists per process for up/down boundary detection
        const sortedPerProc = {};
        for (const proc of procs) {
          const list = [];
          for (const [sName, perProc] of Object.entries(byState)) {
            const info = perProc[proc.processId];
            if (info) list.push({ name: sName, order: info.order ?? 0 });
          }
          list.sort((a, b) => a.order - b.order);
          sortedPerProc[proc.processId] = list;
        }

        return (
          <CollapsibleSection
            key={witName}
            title={witName}
            badge={diffs.length > 0 ? <span className="badge badge-danger" style={{ marginLeft: 8 }}>{diffs.length} diffs</span> : <span className="badge badge-success" style={{ marginLeft: 8 }}>Match</span>}
            defaultOpen={diffs.length > 0}
          >
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <span className="text-sm text-secondary">{stateNamesToShow.length} state{stateNamesToShow.length !== 1 ? 's' : ''}</span>
                <button className="btn btn-sm btn-primary" onClick={() => isCreateOpen ? setCreateStateWit(null) : setCreateStateWit(witName)}>
                  {isCreateOpen ? 'Cancel' : '+ Create State'}
                </button>
              </div>

              {isCreateOpen && (
                <div style={{ padding: 12, background: 'var(--color-primary-light)', borderRadius: 'var(--radius)', marginBottom: 12 }}>
                  <div className="form-group">
                    <label>Target Process</label>
                    <select value={createTargetKey} onChange={(e) => setCreateTargetKey(e.target.value)}>
                      <option value="">-- Select process --</option>
                      {procs.map((p) => <option key={p.processId} value={`${p.connectionId}::${p.processId}`}>{processNames[p.processId]}</option>)}
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label>Name</label><input value={stateForm.name} onChange={(e) => setStateForm({ ...stateForm, name: e.target.value })} placeholder="e.g. In Review" /></div>
                    <div className="form-group">
                      <label>Category</label>
                      <select value={stateForm.stateCategory} onChange={(e) => setStateForm({ ...stateForm, stateCategory: e.target.value })}>
                        {STATE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label>Color</label><input type="color" value={`#${stateForm.color}`} onChange={(e) => setStateForm({ ...stateForm, color: e.target.value.replace('#', '') })} /></div>
                    <div className="form-group"><label>Order</label><input type="number" value={stateForm.order} onChange={(e) => setStateForm({ ...stateForm, order: e.target.value })} placeholder="Optional" /></div>
                  </div>
                  <div className="btn-group">
                    <button className="btn btn-primary btn-sm" onClick={() => handleCreateState(witName)} disabled={actionLoading || !createTargetKey || !stateForm.name}>
                      {actionLoading ? <><span className="spinner" /> Creating...</> : 'Create State'}
                    </button>
                    <button className="btn btn-sm" onClick={() => setCreateStateWit(null)}>Cancel</button>
                  </div>
                </div>
              )}

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>State</th>
                      {procs.map((p) => <th key={p.processId}>{processNames[p.processId]}</th>)}
                      <th>Differences</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stateNamesToShow.map((stateName) => {
                      const diff = diffs.find((d) => d.stateName === stateName);
                      const hasDiff = !!diff;
                      const statePerProc = byState[stateName] || {};
                      return (
                        <tr key={stateName} className={hasDiff ? 'diff-changed' : ''}>
                          <td><strong>{stateName}</strong></td>
                          {procs.map((p) => {
                            const info = statePerProc[p.processId];
                            const isMissing = !info;
                            return (
                              <td key={p.processId} className={isMissing ? 'diff-removed' : (hasDiff && !isMissing) ? 'diff-changed' : ''}>
                                {isMissing ? (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="badge badge-danger">Missing</span>
                                    <button className="btn btn-sm btn-primary" disabled={actionLoading} onClick={() => handleAddMissingState(p, witName, stateName)}>Add</button>
                                  </div>
                                ) : (() => {
                                  const sorted = sortedPerProc[p.processId] || [];
                                  const posIdx = sorted.findIndex((s) => s.name === stateName);
                                  const isFirst = posIdx <= 0;
                                  const isLast = posIdx >= sorted.length - 1;
                                  const isSystem = info.customizationType === 'system';
                                  return (
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <StateCategoryBadge category={info.stateCategory} />
                                      {info.color && <span style={{ backgroundColor: `#${info.color}`, display: 'inline-block', width: 14, height: 14, borderRadius: '50%', border: '1px solid #ccc' }} />}
                                      <span className="text-sm text-secondary">#{info.order ?? '-'}</span>
                                      {isSystem && <span className="badge badge-neutral" title="System state — read-only in inherited processes">System</span>}
                                      <div className="btn-group">
                                        <button className="btn btn-sm" disabled={actionLoading || isFirst} onClick={() => handleMoveState(p, witName, stateName, 'up')} title="Move up">&#9650;</button>
                                        <button className="btn btn-sm" disabled={actionLoading || isLast} onClick={() => handleMoveState(p, witName, stateName, 'down')} title="Move down">&#9660;</button>
                                      </div>
                                    </div>
                                  );
                                })()}
                              </td>
                            );
                          })}
                          <td>
                            {diff?.propertyDifferences?.length > 0 ? (
                              <div>
                                {diff.propertyDifferences.map((pd, i) => (
                                  <div key={i} className="text-sm" style={{ marginBottom: 2 }}>
                                    <strong>{pd.property}:</strong>{' '}
                                    {Object.entries(pd.values || {}).map(([pid, val]) => (
                                      <span key={pid} className="badge badge-neutral" style={{ margin: '0 2px' }}>
                                        {processNames[pid]}: {pd.property === 'color' ? (
                                          <><span className="color-swatch" style={{ backgroundColor: `#${val}`, display: 'inline-block', width: 10, height: 10, borderRadius: '50%' }} /> {val}</>
                                        ) : String(val ?? 'null')}
                                      </span>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            ) : hasDiff ? (
                              <span className="badge badge-warning">Presence differs</span>
                            ) : (
                              <span className="text-sm text-secondary">--</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </CollapsibleSection>
        );
      })}
    </div>
  );
}

function BehaviorsTab({ comp, procs, processNames }) {
  const { behaviors, workItemTypeBehaviors } = comp;
  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 8 }}>Process Behaviors</h3>
        <p className="text-sm text-secondary" style={{ marginBottom: 12 }}>
          Behaviors define how work item types participate in backlogs. For example, a "Requirements" behavior places a WIT on the Requirements backlog,
          a "Task" behavior makes it appear as a task under parent items, and portfolio-level behaviors control epic/feature backlogs.
          Comparing behaviors shows whether processes have the same backlog structure.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Behavior</th>
                {procs.map((p) => <th key={p.processId}>{processNames[p.processId]}</th>)}
              </tr>
            </thead>
            <tbody>
              {(behaviors.all || []).map((bName) => {
                const diff = (behaviors.differences || []).find((d) => d.behaviorName === bName || d.behaviorId === bName);
                const hasDiff = !!diff && diff.missingFrom?.length > 0;
                return (
                  <tr key={bName} className={hasDiff ? 'diff-changed' : ''}>
                    <td><strong>{bName}</strong></td>
                    {procs.map((p) => {
                      const missing = diff?.missingFrom?.includes(p.processId);
                      return (
                        <td key={p.processId} className={missing ? 'diff-removed' : ''}>
                          {missing ? <span className="badge badge-danger">Missing</span> : <span className="badge badge-success">Present</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {(behaviors.all || []).length === 0 && (
                <tr><td colSpan={procs.length + 1} className="text-secondary text-sm">No behaviors to compare.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {workItemTypeBehaviors?.byWorkItemType && Object.keys(workItemTypeBehaviors.byWorkItemType).length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Work Item Type Behavior Assignments</h3>
          {Object.entries(workItemTypeBehaviors.byWorkItemType).map(([witRefName, witData]) => {
            const diffs = witData.differences || [];
            if (diffs.length === 0) return null;
            return (
              <CollapsibleSection key={witRefName} title={witRefName} badge={<span className="badge badge-warning" style={{ marginLeft: 8 }}>{diffs.length} diffs</span>} defaultOpen>
                <div className="text-sm">
                  {diffs.map((d, i) => (
                    <div key={i} style={{ marginBottom: 4 }}>
                      <strong>{d.behaviorId}:</strong>{' '}
                      {d.missingFrom?.length > 0 && (
                        <span className="badge badge-danger" style={{ margin: '0 2px' }}>
                          Missing from: {d.missingFrom.map((pid) => processNames[pid]).join(', ')}
                        </span>
                      )}
                      {(d.propertyDifferences || []).map((pd, j) => (
                        <span key={j} style={{ marginLeft: 4 }}>
                          <strong>{pd.property}:</strong>{' '}
                          {Object.entries(pd.values || {}).map(([pid, val]) => (
                            <span key={pid} className="badge badge-neutral" style={{ margin: '0 2px' }}>
                              {processNames[pid]}: {String(val ?? 'null')}
                            </span>
                          ))}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            );
          })}
        </div>
      )}
    </div>
  );
}
