import { useState, useEffect, useCallback } from 'react';
import { connections as connectionsApi } from '../../services/api';

const EMPTY_FORM = { name: '', orgUrl: '', pat: '' };

function maskPat(pat) {
  if (!pat) return '';
  if (pat.length <= 4) return '****';
  return '****' + pat.slice(-4);
}

function ConnectionForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY_FORM);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  const isValid = form.name.trim() && form.orgUrl.trim() && form.pat.trim();

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Name</label>
        <input
          type="text"
          value={form.name}
          onChange={handleChange('name')}
          placeholder="e.g. My Organization"
          autoFocus
        />
      </div>
      <div className="form-group">
        <label>Organization URL</label>
        <input
          type="url"
          value={form.orgUrl}
          onChange={handleChange('orgUrl')}
          placeholder="https://dev.azure.com/your-org"
        />
      </div>
      <div className="form-group">
        <label>Personal Access Token</label>
        <input
          type="password"
          value={form.pat}
          onChange={handleChange('pat')}
          placeholder="Enter PAT"
        />
      </div>
      <div className="btn-group mt-2">
        <button type="submit" className="btn btn-primary" disabled={!isValid || saving}>
          {saving ? <><span className="spinner" /> Saving...</> : 'Save'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ConnectionCard({ connection, onEdit, onDelete, onTest, testStatus, testing }) {
  const status = testStatus[connection.id];

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center gap-2">
          <h3>{connection.name}</h3>
          {status === 'success' && <span className="badge badge-success">Connected</span>}
          {status === 'failed' && <span className="badge badge-danger">Failed</span>}
        </div>
        <div className="btn-group">
          <button
            className="btn btn-sm"
            onClick={() => onTest(connection.id)}
            disabled={testing === connection.id}
          >
            {testing === connection.id ? <><span className="spinner" /> Testing...</> : 'Test'}
          </button>
          <button className="btn btn-sm" onClick={() => onEdit(connection.id)}>
            Edit
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => onDelete(connection.id)}>
            Delete
          </button>
        </div>
      </div>
      <div className="text-sm text-secondary" style={{ marginBottom: 4 }}>
        <strong>URL:</strong> {connection.orgUrl}
      </div>
      <div className="text-sm text-secondary">
        <strong>PAT:</strong> <span className="text-mono">{maskPat(connection.pat)}</span>
      </div>
    </div>
  );
}

export default function ConnectionManager({ connections, setConnections, notify }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(null);
  const [testStatus, setTestStatus] = useState({});

  const fetchConnections = useCallback(async () => {
    try {
      const result = await connectionsApi.list();
      setConnections(result.connections);
    } catch (err) {
      notify('error', `Failed to load connections: ${err.message}`);
    }
  }, [setConnections, notify]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchConnections().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [fetchConnections]);

  const handleCreate = useCallback(async (formData) => {
    setSaving(true);
    try {
      await connectionsApi.create(formData);
      await fetchConnections();
      setShowAddForm(false);
      notify('success', `Connection "${formData.name}" created successfully.`);
    } catch (err) {
      notify('error', `Failed to create connection: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [fetchConnections, notify]);

  const handleUpdate = useCallback(async (formData) => {
    setSaving(true);
    try {
      await connectionsApi.update(editingId, formData);
      await fetchConnections();
      setEditingId(null);
      notify('success', `Connection "${formData.name}" updated successfully.`);
    } catch (err) {
      notify('error', `Failed to update connection: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [editingId, fetchConnections, notify]);

  const handleDelete = useCallback(async (id) => {
    const conn = connections.find((c) => c.id === id);
    const confirmed = window.confirm(
      `Are you sure you want to delete the connection "${conn?.name || id}"?`
    );
    if (!confirmed) return;

    try {
      await connectionsApi.delete(id);
      await fetchConnections();
      setTestStatus((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (editingId === id) setEditingId(null);
      notify('success', 'Connection deleted successfully.');
    } catch (err) {
      notify('error', `Failed to delete connection: ${err.message}`);
    }
  }, [connections, editingId, fetchConnections, notify]);

  const handleTest = useCallback(async (id) => {
    setTesting(id);
    try {
      const result = await connectionsApi.test(id);
      if (result.success) {
        setTestStatus((prev) => ({ ...prev, [id]: 'success' }));
        notify('success', result.message || 'Connection test successful.');
      } else {
        setTestStatus((prev) => ({ ...prev, [id]: 'failed' }));
        notify('error', result.message || 'Connection test failed.');
      }
    } catch (err) {
      setTestStatus((prev) => ({ ...prev, [id]: 'failed' }));
      notify('error', `Connection test failed: ${err.message}`);
    } finally {
      setTesting(null);
    }
  }, [notify]);

  const handleStartEdit = useCallback((id) => {
    setEditingId(id);
    setShowAddForm(false);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleStartAdd = useCallback(() => {
    setShowAddForm(true);
    setEditingId(null);
  }, []);

  const handleCancelAdd = useCallback(() => {
    setShowAddForm(false);
  }, []);

  if (loading) {
    return (
      <div className="loading-overlay">
        <span className="spinner spinner-lg" />
        Loading connections...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2>Connections</h2>
        {!showAddForm && (
          <button className="btn btn-primary" onClick={handleStartAdd}>
            Add Connection
          </button>
        )}
      </div>

      {showAddForm && (
        <div className="card mb-4">
          <div className="card-header">
            <h3>New Connection</h3>
          </div>
          <ConnectionForm onSave={handleCreate} onCancel={handleCancelAdd} saving={saving} />
        </div>
      )}

      {connections.length === 0 && !showAddForm ? (
        <div className="empty-state">
          <h3>No connections configured</h3>
          <p>Add an Azure DevOps connection to get started.</p>
          <button className="btn btn-primary" onClick={handleStartAdd}>
            Add Connection
          </button>
        </div>
      ) : (
        connections.map((conn) =>
          editingId === conn.id ? (
            <div className="card" key={conn.id}>
              <div className="card-header">
                <h3>Edit Connection</h3>
              </div>
              <ConnectionForm
                initial={{ name: conn.name, orgUrl: conn.orgUrl, pat: conn.pat }}
                onSave={handleUpdate}
                onCancel={handleCancelEdit}
                saving={saving}
              />
            </div>
          ) : (
            <ConnectionCard
              key={conn.id}
              connection={conn}
              onEdit={handleStartEdit}
              onDelete={handleDelete}
              onTest={handleTest}
              testStatus={testStatus}
              testing={testing}
            />
          )
        )
      )}
    </div>
  );
}
