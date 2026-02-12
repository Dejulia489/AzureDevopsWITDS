import { useState, useEffect, useCallback, useMemo } from 'react';
import { editor, processes } from '../../services/api';
import ChangePreview from '../ChangePreview/ChangePreview';

const STATE_CATEGORIES = ['Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed'];
const FIELD_TYPES = [
  'boolean', 'dateTime', 'double', 'html', 'identity',
  'integer', 'picklistDouble', 'picklistInteger', 'picklistString',
  'plainText', 'string', 'treePath',
];

export default function ProcessEditor({ pendingChanges, pulledProcesses, connections, onApply, onProcessPulled, notify }) {
  const [selectedKey, setSelectedKey] = useState('');
  const [selectedWit, setSelectedWit] = useState(null);
  const [orgFields, setOrgFields] = useState([]);
  const [changes, setChanges] = useState(emptyChanges());
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [applyResults, setApplyResults] = useState(null);
  const [applyLoading, setApplyLoading] = useState(false);

  // Inline add forms
  const [showAddWit, setShowAddWit] = useState(false);
  const [showAddField, setShowAddField] = useState(false);
  const [showAddState, setShowAddState] = useState(false);
  const [witForm, setWitForm] = useState({ name: '', description: '', color: '009CCC', icon: 'icon_clipboard' });
  const [fieldForm, setFieldForm] = useState({ referenceName: '', name: '', type: 'string', description: '', required: false, defaultValue: '', existingField: '' });
  const [stateForm, setStateForm] = useState({ name: '', stateCategory: 'Proposed', color: '007ACC', order: '' });

  // Batch apply
  const [showBatch, setShowBatch] = useState(false);
  const [batchTargets, setBatchTargets] = useState([]);

  function emptyChanges() {
    return { workItemTypes: { add: [], update: [], remove: [] }, fields: {}, states: {}, behaviors: {}, workItemTypeBehaviors: {} };
  }

  const processOptions = useMemo(() =>
    pulledProcesses.map((p) => {
      const conn = connections.find((c) => c.id === p.connectionId);
      return { key: `${p.connectionId}::${p.process.typeId}`, label: `${conn?.name || p.connectionId} / ${p.process.name}`, data: p };
    }), [pulledProcesses, connections]);

  const selectedProcess = useMemo(() => {
    const opt = processOptions.find((o) => o.key === selectedKey);
    return opt?.data || null;
  }, [selectedKey, processOptions]);

  // Auto-select from pendingChanges
  useEffect(() => {
    if (pendingChanges?.processData) {
      const key = `${pendingChanges.connectionId}::${pendingChanges.processId}`;
      setSelectedKey(key);
    }
  }, [pendingChanges]);

  // Load org fields when process is selected
  useEffect(() => {
    if (!selectedProcess) return;
    processes.getOrgFields(selectedProcess.connectionId)
      .then((data) => setOrgFields(data.value || []))
      .catch(() => setOrgFields([]));
  }, [selectedProcess?.connectionId]);

  const witList = selectedProcess?.workItemTypes || [];
  const selectedWitData = useMemo(() => witList.find((w) => w.referenceName === selectedWit), [witList, selectedWit]);

  const pendingCount = useMemo(() => {
    let count = 0;
    const c = changes;
    count += c.workItemTypes.add.length + c.workItemTypes.update.length + c.workItemTypes.remove.length;
    Object.values(c.fields).forEach((f) => { count += (f.add?.length || 0) + (f.update?.length || 0) + (f.remove?.length || 0); });
    Object.values(c.states).forEach((s) => { count += (s.add?.length || 0) + (s.update?.length || 0) + (s.remove?.length || 0); });
    return count;
  }, [changes]);

  // === Handlers ===

  const handleAddWit = () => {
    if (!witForm.name) { notify('warning', 'Name is required'); return; }
    setChanges((prev) => ({
      ...prev,
      workItemTypes: { ...prev.workItemTypes, add: [...prev.workItemTypes.add, { ...witForm }] }
    }));
    setWitForm({ name: '', description: '', color: '009CCC', icon: 'icon_clipboard' });
    setShowAddWit(false);
    notify('info', `Work item type "${witForm.name}" queued for creation`);
  };

  const handleRemoveWit = (witRefName) => {
    if (!window.confirm(`Queue removal of work item type "${witRefName}"?`)) return;
    setChanges((prev) => ({
      ...prev,
      workItemTypes: { ...prev.workItemTypes, remove: [...prev.workItemTypes.remove, witRefName] }
    }));
    notify('info', `Work item type "${witRefName}" queued for removal`);
  };

  const handleAddField = () => {
    if (!selectedWit) return;
    const field = fieldForm.existingField ? { referenceName: fieldForm.existingField, required: fieldForm.required, defaultValue: fieldForm.defaultValue }
      : { referenceName: fieldForm.referenceName, name: fieldForm.name, type: fieldForm.type, description: fieldForm.description, required: fieldForm.required, defaultValue: fieldForm.defaultValue };
    if (!field.referenceName && !field.name) { notify('warning', 'Field name or reference is required'); return; }
    setChanges((prev) => {
      const witFields = prev.fields[selectedWit] || { add: [], update: [], remove: [] };
      return { ...prev, fields: { ...prev.fields, [selectedWit]: { ...witFields, add: [...witFields.add, field] } } };
    });
    setFieldForm({ referenceName: '', name: '', type: 'string', description: '', required: false, defaultValue: '', existingField: '' });
    setShowAddField(false);
    notify('info', `Field queued for addition to ${selectedWit}`);
  };

  const handleRemoveField = (fieldRefName) => {
    if (!selectedWit) return;
    if (!window.confirm(`Queue removal of field "${fieldRefName}" from ${selectedWit}?`)) return;
    setChanges((prev) => {
      const witFields = prev.fields[selectedWit] || { add: [], update: [], remove: [] };
      return { ...prev, fields: { ...prev.fields, [selectedWit]: { ...witFields, remove: [...witFields.remove, fieldRefName] } } };
    });
    notify('info', `Field "${fieldRefName}" queued for removal`);
  };

  const handleAddState = () => {
    if (!selectedWit || !stateForm.name) { notify('warning', 'State name is required'); return; }
    setChanges((prev) => {
      const witStates = prev.states[selectedWit] || { add: [], update: [], remove: [] };
      return { ...prev, states: { ...prev.states, [selectedWit]: { ...witStates, add: [...witStates.add, { ...stateForm }] } } };
    });
    setStateForm({ name: '', stateCategory: 'Proposed', color: '007ACC', order: '' });
    setShowAddState(false);
    notify('info', `State "${stateForm.name}" queued for creation`);
  };

  const handleRemoveState = (stateId, stateName) => {
    if (!selectedWit) return;
    if (!window.confirm(`Queue removal of state "${stateName}"? This may fail if work items are in this state.`)) return;
    setChanges((prev) => {
      const witStates = prev.states[selectedWit] || { add: [], update: [], remove: [] };
      return { ...prev, states: { ...prev.states, [selectedWit]: { ...witStates, remove: [...witStates.remove, stateId] } } };
    });
    notify('info', `State "${stateName}" queued for removal`);
  };

  const handlePreview = async () => {
    if (!selectedProcess) return;
    try {
      const result = await editor.preview({
        connectionId: selectedProcess.connectionId,
        processId: selectedProcess.process.typeId,
        changes,
      });
      setPreviewData(result);
      setApplyResults(null);
      setShowPreview(true);
    } catch (err) {
      notify('error', `Preview failed: ${err.message}`);
    }
  };

  const handleApply = async () => {
    if (!selectedProcess) return;
    setApplyLoading(true);
    try {
      const result = await editor.apply({
        connectionId: selectedProcess.connectionId,
        processId: selectedProcess.process.typeId,
        changes,
      });
      setApplyResults(result);
      if (result.success) {
        notify('success', `Changes applied: ${result.summary.applied} applied, ${result.summary.skipped} skipped, ${result.summary.errors} errors`);
        setChanges(emptyChanges());
        // Re-pull to refresh data
        try {
          const refreshed = await processes.pull(selectedProcess.connectionId, selectedProcess.process.typeId);
          onProcessPulled(refreshed);
        } catch (e) { /* ignore re-pull failures */ }
      }
    } catch (err) {
      notify('error', `Apply failed: ${err.message}`);
    } finally {
      setApplyLoading(false);
    }
  };

  const handleApplyBatch = async () => {
    if (batchTargets.length === 0) { notify('warning', 'Select at least one target process'); return; }
    setApplyLoading(true);
    try {
      const targets = batchTargets.map((key) => {
        const [connectionId, processId] = key.split('::');
        return { connectionId, processId };
      });
      const result = await editor.applyBatch({ targets, changes });
      setApplyResults(result);
      notify('success', 'Batch apply completed');
      setChanges(emptyChanges());
      setShowBatch(false);
    } catch (err) {
      notify('error', `Batch apply failed: ${err.message}`);
    } finally {
      setApplyLoading(false);
    }
  };

  const handleResetChanges = () => {
    if (pendingCount > 0 && !window.confirm('Discard all pending changes?')) return;
    setChanges(emptyChanges());
    notify('info', 'Changes cleared');
  };

  if (pulledProcesses.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <h3>No Processes Available</h3>
          <p>Go to the Discovery tab and pull one or more processes to start editing.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Process selector */}
      <div className="card">
        <div className="card-header">
          <h2>Process Editor</h2>
          {pendingCount > 0 && (
            <div className="btn-group">
              <span className="badge badge-warning">{pendingCount} pending changes</span>
              <button className="btn btn-sm" onClick={handlePreview}>Preview Changes</button>
              <button className="btn btn-sm btn-primary" onClick={handleApply}>Apply</button>
              <button className="btn btn-sm" onClick={() => setShowBatch(true)}>Apply to Multiple</button>
              <button className="btn btn-sm btn-danger" onClick={handleResetChanges}>Reset</button>
            </div>
          )}
        </div>
        <div className="form-group">
          <label>Select Process</label>
          <select value={selectedKey} onChange={(e) => { setSelectedKey(e.target.value); setSelectedWit(null); }}>
            <option value="">-- Select a process --</option>
            {processOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {selectedProcess && (
        <>
          {/* Work Item Types */}
          <div className="card">
            <div className="card-header">
              <h3>Work Item Types</h3>
              <button className="btn btn-sm btn-primary" onClick={() => setShowAddWit(true)}>+ Add Work Item Type</button>
            </div>

            {showAddWit && (
              <div style={{ padding: 12, background: 'var(--color-primary-light)', borderRadius: 'var(--radius)', marginBottom: 12 }}>
                <div className="form-row">
                  <div className="form-group"><label>Name</label><input value={witForm.name} onChange={(e) => setWitForm({ ...witForm, name: e.target.value })} placeholder="e.g. Custom Bug" /></div>
                  <div className="form-group"><label>Color</label><input type="color" value={`#${witForm.color}`} onChange={(e) => setWitForm({ ...witForm, color: e.target.value.replace('#', '') })} /></div>
                </div>
                <div className="form-group"><label>Description</label><input value={witForm.description} onChange={(e) => setWitForm({ ...witForm, description: e.target.value })} /></div>
                <div className="btn-group"><button className="btn btn-primary btn-sm" onClick={handleAddWit}>Queue Add</button><button className="btn btn-sm" onClick={() => setShowAddWit(false)}>Cancel</button></div>
              </div>
            )}

            {/* Queued additions */}
            {changes.workItemTypes.add.length > 0 && (
              <div className="mb-2">
                <div className="text-sm text-secondary mb-2"><strong>Queued for creation:</strong></div>
                {changes.workItemTypes.add.map((w, i) => (
                  <span key={i} className="badge badge-success" style={{ marginRight: 4 }}>{w.name}</span>
                ))}
              </div>
            )}
            {changes.workItemTypes.remove.length > 0 && (
              <div className="mb-2">
                <div className="text-sm text-secondary mb-2"><strong>Queued for removal:</strong></div>
                {changes.workItemTypes.remove.map((w, i) => (
                  <span key={i} className="badge badge-danger" style={{ marginRight: 4 }}>{w}</span>
                ))}
              </div>
            )}

            <div className="table-wrap scroll-panel">
              <table>
                <thead>
                  <tr><th>Name</th><th>Reference Name</th><th>Color</th><th>Disabled</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {witList.map((wit) => (
                    <tr
                      key={wit.referenceName}
                      onClick={() => setSelectedWit(wit.referenceName)}
                      style={{ cursor: 'pointer', background: selectedWit === wit.referenceName ? 'var(--color-primary-light)' : undefined }}
                    >
                      <td><strong>{wit.name}</strong></td>
                      <td className="text-mono text-sm">{wit.referenceName}</td>
                      <td><span className="color-swatch" style={{ backgroundColor: `#${wit.color || '009CCC'}` }} /> {wit.color}</td>
                      <td>{wit.isDisabled ? <span className="badge badge-neutral">Disabled</span> : <span className="badge badge-success">Active</span>}</td>
                      <td>
                        <div className="btn-group">
                          <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setSelectedWit(wit.referenceName); }}>Select</button>
                          {!wit.isDefault && <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); handleRemoveWit(wit.referenceName); }}>Remove</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fields for selected WIT */}
          {selectedWitData && (
            <div className="card">
              <div className="card-header">
                <h3>Fields - {selectedWitData.name}</h3>
                <button className="btn btn-sm btn-primary" onClick={() => setShowAddField(true)}>+ Add Field</button>
              </div>

              {showAddField && (
                <div style={{ padding: 12, background: 'var(--color-primary-light)', borderRadius: 'var(--radius)', marginBottom: 12 }}>
                  <div className="form-group">
                    <label>Add Existing Field</label>
                    <select value={fieldForm.existingField} onChange={(e) => setFieldForm({ ...fieldForm, existingField: e.target.value })}>
                      <option value="">-- Create new field --</option>
                      {orgFields.map((f) => <option key={f.referenceName} value={f.referenceName}>{f.name} ({f.referenceName})</option>)}
                    </select>
                  </div>
                  {!fieldForm.existingField && (
                    <>
                      <div className="form-row">
                        <div className="form-group"><label>Name</label><input value={fieldForm.name} onChange={(e) => setFieldForm({ ...fieldForm, name: e.target.value })} /></div>
                        <div className="form-group"><label>Reference Name</label><input value={fieldForm.referenceName} onChange={(e) => setFieldForm({ ...fieldForm, referenceName: e.target.value })} placeholder="Custom.FieldName" /></div>
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label>Type</label>
                          <select value={fieldForm.type} onChange={(e) => setFieldForm({ ...fieldForm, type: e.target.value })}>
                            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div className="form-group"><label>Description</label><input value={fieldForm.description} onChange={(e) => setFieldForm({ ...fieldForm, description: e.target.value })} /></div>
                      </div>
                    </>
                  )}
                  <div className="form-row">
                    <div className="form-group">
                      <label><input type="checkbox" checked={fieldForm.required} onChange={(e) => setFieldForm({ ...fieldForm, required: e.target.checked })} style={{ marginRight: 6 }} />Required</label>
                    </div>
                    <div className="form-group"><label>Default Value</label><input value={fieldForm.defaultValue} onChange={(e) => setFieldForm({ ...fieldForm, defaultValue: e.target.value })} /></div>
                  </div>
                  <div className="btn-group"><button className="btn btn-primary btn-sm" onClick={handleAddField}>Queue Add</button><button className="btn btn-sm" onClick={() => setShowAddField(false)}>Cancel</button></div>
                </div>
              )}

              {/* Show queued field changes */}
              {(changes.fields[selectedWit]?.add?.length > 0 || changes.fields[selectedWit]?.remove?.length > 0) && (
                <div className="mb-2 text-sm">
                  {changes.fields[selectedWit]?.add?.map((f, i) => <span key={i} className="badge badge-success" style={{ marginRight: 4 }}>+ {f.referenceName || f.name}</span>)}
                  {changes.fields[selectedWit]?.remove?.map((f, i) => <span key={i} className="badge badge-danger" style={{ marginRight: 4 }}>- {f}</span>)}
                </div>
              )}

              <div className="table-wrap scroll-panel">
                <table>
                  <thead><tr><th>Name</th><th>Reference Name</th><th>Type</th><th>Required</th><th>Default</th><th>Actions</th></tr></thead>
                  <tbody>
                    {(selectedWitData.fields || []).map((field) => (
                      <tr key={field.referenceName || field.name}>
                        <td>{field.name}</td>
                        <td className="text-mono text-sm">{field.referenceName}</td>
                        <td><span className="badge badge-neutral">{field.type}</span></td>
                        <td>{field.required ? 'Yes' : 'No'}</td>
                        <td className="text-sm">{field.defaultValue || '--'}</td>
                        <td><button className="btn btn-sm btn-danger" onClick={() => handleRemoveField(field.referenceName)}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* States for selected WIT */}
          {selectedWitData && (
            <div className="card">
              <div className="card-header">
                <h3>States - {selectedWitData.name}</h3>
                <button className="btn btn-sm btn-primary" onClick={() => setShowAddState(true)}>+ Add State</button>
              </div>

              {showAddState && (
                <div style={{ padding: 12, background: 'var(--color-primary-light)', borderRadius: 'var(--radius)', marginBottom: 12 }}>
                  <div className="form-row">
                    <div className="form-group"><label>Name</label><input value={stateForm.name} onChange={(e) => setStateForm({ ...stateForm, name: e.target.value })} /></div>
                    <div className="form-group">
                      <label>Category</label>
                      <select value={stateForm.stateCategory} onChange={(e) => setStateForm({ ...stateForm, stateCategory: e.target.value })}>
                        {STATE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label>Color</label><input type="color" value={`#${stateForm.color}`} onChange={(e) => setStateForm({ ...stateForm, color: e.target.value.replace('#', '') })} /></div>
                    <div className="form-group"><label>Order</label><input type="number" value={stateForm.order} onChange={(e) => setStateForm({ ...stateForm, order: e.target.value })} /></div>
                  </div>
                  <div className="btn-group"><button className="btn btn-primary btn-sm" onClick={handleAddState}>Queue Add</button><button className="btn btn-sm" onClick={() => setShowAddState(false)}>Cancel</button></div>
                </div>
              )}

              {(changes.states[selectedWit]?.add?.length > 0 || changes.states[selectedWit]?.remove?.length > 0) && (
                <div className="mb-2 text-sm">
                  {changes.states[selectedWit]?.add?.map((s, i) => <span key={i} className="badge badge-success" style={{ marginRight: 4 }}>+ {s.name}</span>)}
                  {changes.states[selectedWit]?.remove?.map((s, i) => <span key={i} className="badge badge-danger" style={{ marginRight: 4 }}>- {s}</span>)}
                </div>
              )}

              <div className="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>Category</th><th>Color</th><th>Order</th><th>Actions</th></tr></thead>
                  <tbody>
                    {(selectedWitData.states || []).map((state) => (
                      <tr key={state.id || state.name}>
                        <td><strong>{state.name}</strong></td>
                        <td><span className={`badge badge-neutral state-${(state.stateCategory || '').toLowerCase()}`}>{state.stateCategory}</span></td>
                        <td><span className="color-swatch" style={{ backgroundColor: `#${state.color || '000'}` }} /> {state.color}</td>
                        <td>{state.order ?? '--'}</td>
                        <td>
                          {!state.isSystem && (
                            <button className="btn btn-sm btn-danger" onClick={() => handleRemoveState(state.id, state.name)}>Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Batch target selector */}
      {showBatch && (
        <div className="modal-overlay" onClick={() => setShowBatch(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>Apply to Multiple Processes</h2><button className="modal-close" onClick={() => setShowBatch(false)}>&times;</button></div>
            <div className="modal-body">
              <p className="text-sm text-secondary mb-4">Select target processes to apply the same changes:</p>
              {processOptions.map((o) => (
                <div key={o.key} className="toggle-row">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={batchTargets.includes(o.key)} onChange={(e) => {
                      setBatchTargets((prev) => e.target.checked ? [...prev, o.key] : prev.filter((k) => k !== o.key));
                    }} />
                    {o.label}
                  </label>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowBatch(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleApplyBatch} disabled={applyLoading || batchTargets.length === 0}>
                {applyLoading ? <><span className="spinner" /> Applying...</> : `Apply to ${batchTargets.length} processes`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Preview modal */}
      {showPreview && (
        <ChangePreview
          preview={previewData}
          onConfirm={handleApply}
          onCancel={() => { setShowPreview(false); setApplyResults(null); }}
          loading={applyLoading}
          results={applyResults}
        />
      )}
    </div>
  );
}
