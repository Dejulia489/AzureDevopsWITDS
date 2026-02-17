import { useState, useMemo, useCallback } from 'react';
import { licenses as licensesApi } from '../../services/api';

// ---------------------------------------------------------------------------
// CSV Export
// ---------------------------------------------------------------------------

function escapeCSV(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportToCSV(entitlements, filename) {
  const headers = [
    'Display Name', 'Email', 'Principal Name', 'License Type',
    'Account License Type', 'MSDN License Type', 'Licensing Source',
    'Assignment', 'License Status', 'User Type', 'Origin',
    'Date Created', 'Last Accessed',
  ];

  const rows = entitlements.map((e) => [
    e.user?.displayName, e.user?.mailAddress, e.user?.principalName,
    e.accessLevel?.licenseDisplayName, e.accessLevel?.accountLicenseType,
    e.accessLevel?.msdnLicenseType, e.accessLevel?.licensingSource,
    e.accessLevel?.assignmentSource === 'groupRule' ? 'Group' : 'Direct',
    e.accessLevel?.status,
    e.user?.metaType, e.user?.origin, e.dateCreated, e.lastAccessedDate,
  ].map(escapeCSV));

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LICENSE_OPTIONS = [
  { value: 'stakeholder', label: 'Stakeholder' },
  { value: 'express', label: 'Basic' },
  { value: 'professional', label: 'Professional' },
  { value: 'advanced', label: 'Advanced' },
];

const COLUMNS = [
  { key: 'displayName', label: 'Name', accessor: (e) => e.user?.displayName || '' },
  { key: 'email', label: 'Email', accessor: (e) => e.user?.mailAddress || '' },
  { key: 'license', label: 'License', accessor: (e) => e.accessLevel?.licenseDisplayName || '' },
  { key: 'assignment', label: 'Assignment', accessor: (e) => e.accessLevel?.assignmentSource === 'groupRule' ? 'Group' : 'Direct' },
  { key: 'status', label: 'Status', accessor: (e) => e.accessLevel?.status || '' },
  { key: 'userType', label: 'User Type', accessor: (e) => e.user?.metaType || '' },
  { key: 'lastAccessed', label: 'Last Accessed', accessor: (e) => e.lastAccessedDate || '' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LicenseManager({ connections, notify }) {
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [entitlements, setEntitlements] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [fetched, setFetched] = useState(false);

  // Filtering
  const [filterText, setFilterText] = useState('');
  const [filterLicense, setFilterLicense] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAssignment, setFilterAssignment] = useState('');

  // Sorting
  const [sortKey, setSortKey] = useState('displayName');
  const [sortDir, setSortDir] = useState('asc');

  // Edit modal
  const [editUser, setEditUser] = useState(null);
  const [editLicenseType, setEditLicenseType] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConnectionChange = (e) => {
    setSelectedConnectionId(e.target.value);
    setEntitlements([]);
    setTotalCount(0);
    setFetched(false);
    setTestResult(null);
  };

  const handleTestAccess = useCallback(async () => {
    if (!selectedConnectionId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await licensesApi.testAccess(selectedConnectionId);
      setTestResult(result);
      notify(result.success ? 'success' : 'error', result.message);
    } catch (err) {
      setTestResult({ success: false, message: err.message });
      notify('error', `License access test failed: ${err.message}`);
    } finally {
      setTesting(false);
    }
  }, [selectedConnectionId, notify]);

  const handleFetch = useCallback(async () => {
    if (!selectedConnectionId) return;
    setLoading(true);
    try {
      const data = await licensesApi.getEntitlements(selectedConnectionId);
      const items = data.items || [];
      setEntitlements(items);
      setTotalCount(data.totalCount || items.length);
      setFetched(true);
      notify('success', `Fetched ${items.length} user entitlements`);
    } catch (err) {
      notify('error', `Failed to fetch licenses: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [selectedConnectionId, notify]);

  const handleSort = useCallback((key) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
  }, []);

  // Open edit modal
  const handleEditClick = useCallback((entitlement) => {
    if (entitlement.accessLevel?.assignmentSource === 'groupRule') {
      notify('error', `Cannot change license for ${entitlement.user?.displayName} — assigned via group rule. Change the group rule instead.`);
      return;
    }
    setEditUser(entitlement);
    setEditLicenseType(entitlement.accessLevel?.accountLicenseType || 'stakeholder');
  }, [notify]);

  // Save license change
  const handleSaveLicense = useCallback(async () => {
    if (!editUser || !selectedConnectionId) return;
    setSaving(true);
    try {
      const result = await licensesApi.updateLicense(selectedConnectionId, editUser.id, {
        accountLicenseType: editLicenseType,
        licensingSource: 'account',
      });
      if (result.isSuccess) {
        notify('success', `Updated license for ${editUser.user?.displayName} to ${editLicenseType}`);
        // Update local state so table reflects change immediately
        setEntitlements((prev) => prev.map((e) => {
          if (e.id !== editUser.id) return e;
          const updated = result.operationResults?.[0]?.result;
          return updated || { ...e, accessLevel: { ...e.accessLevel, accountLicenseType: editLicenseType } };
        }));
        setEditUser(null);
      } else {
        const errMsg = result.operationResults?.[0]?.errors?.map((er) => er.value).join('; ') || 'Unknown error';
        notify('error', `Failed to update license: ${errMsg}`);
      }
    } catch (err) {
      notify('error', `Failed to update license: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [editUser, editLicenseType, selectedConnectionId, notify]);

  // Unique values for filter dropdowns
  const licenseTypes = useMemo(() => {
    const set = new Set(entitlements.map((e) => e.accessLevel?.licenseDisplayName).filter(Boolean));
    return [...set].sort();
  }, [entitlements]);

  const statusTypes = useMemo(() => {
    const set = new Set(entitlements.map((e) => e.accessLevel?.status).filter(Boolean));
    return [...set].sort();
  }, [entitlements]);

  // Filtered + sorted data
  const filteredData = useMemo(() => {
    let data = entitlements;

    if (filterText) {
      const lower = filterText.toLowerCase();
      data = data.filter((e) => {
        const name = (e.user?.displayName || '').toLowerCase();
        const email = (e.user?.mailAddress || '').toLowerCase();
        const principal = (e.user?.principalName || '').toLowerCase();
        return name.includes(lower) || email.includes(lower) || principal.includes(lower);
      });
    }

    if (filterLicense) {
      data = data.filter((e) => e.accessLevel?.licenseDisplayName === filterLicense);
    }

    if (filterStatus) {
      data = data.filter((e) => e.accessLevel?.status === filterStatus);
    }

    if (filterAssignment) {
      data = data.filter((e) => {
        const isGroup = e.accessLevel?.assignmentSource === 'groupRule';
        return filterAssignment === 'group' ? isGroup : !isGroup;
      });
    }

    const col = COLUMNS.find((c) => c.key === sortKey);
    if (col) {
      data = [...data].sort((a, b) => {
        const aVal = col.accessor(a).toLowerCase();
        const bVal = col.accessor(b).toLowerCase();
        if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return data;
  }, [entitlements, filterText, filterLicense, filterStatus, filterAssignment, sortKey, sortDir]);

  const handleExportCSV = useCallback(() => {
    const conn = connections.find((c) => c.id === selectedConnectionId);
    const orgName = conn ? conn.name.replace(/\s+/g, '_') : 'org';
    const timestamp = new Date().toISOString().slice(0, 10);
    exportToCSV(filteredData, `licenses_${orgName}_${timestamp}.csv`);
    notify('success', `Exported ${filteredData.length} records to CSV`);
  }, [filteredData, connections, selectedConnectionId, notify]);

  const statusBadgeClass = (status) => {
    switch (status) {
      case 'active': return 'badge-success';
      case 'disabled': return 'badge-danger';
      case 'pending': return 'badge-warning';
      default: return '';
    }
  };

  return (
    <div>
      {/* Connection selector */}
      <div className="card">
        <div className="card-header">
          <h2>User Licenses</h2>
        </div>

        <div className="form-group">
          <label htmlFor="lic-connection-select">Connection</label>
          <select
            id="lic-connection-select"
            value={selectedConnectionId}
            onChange={handleConnectionChange}
          >
            <option value="">-- Select a connection --</option>
            {connections.map((conn) => (
              <option key={conn.id} value={conn.id}>
                {conn.name} ({conn.orgUrl})
              </option>
            ))}
          </select>
        </div>

        {selectedConnectionId && (
          <div className="btn-group" style={{ marginTop: 8 }}>
            <button
              className="btn"
              onClick={handleTestAccess}
              disabled={testing}
            >
              {testing ? 'Testing...' : 'Test License Access'}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleFetch}
              disabled={loading}
            >
              {loading ? 'Fetching...' : 'Fetch Licenses'}
            </button>
          </div>
        )}

        {testResult && (
          <div
            className={`notification ${testResult.success ? 'notification-success' : 'notification-error'}`}
            style={{ marginTop: 8 }}
          >
            {testResult.message}
          </div>
        )}
      </div>

      {/* Results */}
      {fetched && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2>Entitlements</h2>
              <span className="badge badge-primary">{totalCount} total</span>
              {filteredData.length !== entitlements.length && (
                <span className="badge">{filteredData.length} shown</span>
              )}
            </div>
            <div className="btn-group">
              <button
                className="btn btn-sm"
                onClick={handleFetch}
                disabled={loading}
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleExportCSV}
                disabled={filteredData.length === 0}
              >
                Export CSV ({filteredData.length})
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="form-row" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label>Search (name / email)</label>
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Type to filter..."
              />
            </div>
            <div className="form-group">
              <label>License Type</label>
              <select value={filterLicense} onChange={(e) => setFilterLicense(e.target.value)}>
                <option value="">All</option>
                {licenseTypes.map((lt) => (
                  <option key={lt} value={lt}>{lt}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All</option>
                {statusTypes.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Assignment</label>
              <select value={filterAssignment} onChange={(e) => setFilterAssignment(e.target.value)}>
                <option value="">All</option>
                <option value="direct">Direct</option>
                <option value="group">Group</option>
              </select>
            </div>
          </div>

          {/* Table */}
          {filteredData.length === 0 ? (
            <div className="empty-state">
              <h3>No Matching Records</h3>
              <p>Try adjusting your filters.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className="th-sortable"
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}
                        {sortKey === col.key && (
                          <span style={{ marginLeft: 4 }}>
                            {sortDir === 'asc' ? '\u25B2' : '\u25BC'}
                          </span>
                        )}
                      </th>
                    ))}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((e, idx) => {
                    const isGroup = e.accessLevel?.assignmentSource === 'groupRule';
                    return (
                      <tr key={e.id || idx}>
                        <td style={{ fontWeight: 600 }}>{e.user?.displayName || '--'}</td>
                        <td>{e.user?.mailAddress || '--'}</td>
                        <td>
                          <span className="badge badge-primary">
                            {e.accessLevel?.licenseDisplayName || '--'}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${isGroup ? 'badge-warning' : 'badge-success'}`}>
                            {isGroup ? 'Group' : 'Direct'}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${statusBadgeClass(e.accessLevel?.status)}`}>
                            {e.accessLevel?.status || '--'}
                          </span>
                        </td>
                        <td>{e.user?.metaType || '--'}</td>
                        <td>
                          {e.lastAccessedDate
                            ? new Date(e.lastAccessedDate).toLocaleDateString()
                            : '--'}
                        </td>
                        <td>
                          <button
                            className="btn btn-sm"
                            onClick={() => handleEditClick(e)}
                            title={isGroup ? 'License assigned via group rule — cannot change directly' : 'Change license type'}
                            style={isGroup ? { opacity: 0.5 } : undefined}
                          >
                            Change
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Edit License Modal */}
      {editUser && (
        <div className="modal-overlay" onClick={() => !saving && setEditUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Change License</h3>
              <button className="modal-close" onClick={() => !saving && setEditUser(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>User</label>
                <input type="text" value={editUser.user?.displayName || ''} disabled />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="text" value={editUser.user?.mailAddress || ''} disabled />
              </div>
              <div className="form-group">
                <label>Current License</label>
                <input type="text" value={editUser.accessLevel?.licenseDisplayName || '--'} disabled />
              </div>
              <div className="form-group">
                <label htmlFor="new-license-select">New License Type</label>
                <select
                  id="new-license-select"
                  value={editLicenseType}
                  onChange={(e) => setEditLicenseType(e.target.value)}
                >
                  {LICENSE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditUser(null)} disabled={saving}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSaveLicense}
                disabled={saving || editLicenseType === editUser.accessLevel?.accountLicenseType}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
