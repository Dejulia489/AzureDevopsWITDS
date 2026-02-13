import { useState, useEffect, useCallback, useMemo } from 'react';
import { processes, comparison } from '../../services/api';

export default function ProcessDiscovery({
  connections,
  pulledProcesses,
  onProcessPulled,
  onProcessRemoved,
  onCompare,
  notify,
}) {
  // --- Connection & process list state ---
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [processList, setProcessList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  // --- Per-process pull loading: Set of processId strings currently being pulled ---
  const [pullingIds, setPullingIds] = useState(new Set());

  // --- Pulled processes section state ---
  const [selectedForCompare, setSelectedForCompare] = useState(new Set());
  const [comparing, setComparing] = useState(false);

  // --- Expanded pulled processes (quick overview) ---
  const [expandedPulledIds, setExpandedPulledIds] = useState(new Set());

  // =========================================================================
  // Fetch process list when a connection is selected
  // =========================================================================
  useEffect(() => {
    if (!selectedConnectionId) {
      setProcessList([]);
      return;
    }

    let cancelled = false;
    setLoadingList(true);
    setProcessList([]);

    processes
      .list(selectedConnectionId)
      .then((data) => {
        if (!cancelled) {
          setProcessList(data.processes || []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          notify('error', `Failed to list processes: ${err.message}`);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingList(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedConnectionId, notify]);

  // =========================================================================
  // Helpers
  // =========================================================================

  /** Look up the connection object for a given id. */
  const connectionById = useCallback(
    (id) => connections.find((c) => c.id === id),
    [connections],
  );

  /** Find pulled data for a given connection + process. */
  const findPulled = useCallback(
    (connectionId, processTypeId) =>
      pulledProcesses.find(
        (p) => p.connectionId === connectionId && p.process.typeId === processTypeId,
      ),
    [pulledProcesses],
  );

  /** Build a unique key for a pulled process entry. */
  const pulledKey = (p) => `${p.connectionId}::${p.process.typeId}`;

  // =========================================================================
  // Handlers
  // =========================================================================

  const handleConnectionChange = (e) => {
    setSelectedConnectionId(e.target.value);
  };

  const handlePull = async (processId) => {
    setPullingIds((prev) => new Set(prev).add(processId));
    try {
      const data = await processes.pull(selectedConnectionId, processId);
      onProcessPulled(data);
    } catch (err) {
      notify('error', `Failed to pull process: ${err.message}`);
    } finally {
      setPullingIds((prev) => {
        const next = new Set(prev);
        next.delete(processId);
        return next;
      });
    }
  };

  const handleToggleCompare = (key) => {
    setSelectedForCompare((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleCompareSelected = async () => {
    const selected = pulledProcesses.filter((p) =>
      selectedForCompare.has(pulledKey(p)),
    );

    if (selected.length < 2) {
      notify('warning', 'Select at least two processes to compare.');
      return;
    }

    setComparing(true);
    try {
      const processPairs = selected.map((p) => ({
        connectionId: p.connectionId,
        processId: p.process.typeId,
      }));
      const result = await comparison.compare(processPairs);
      onCompare(result);
    } catch (err) {
      notify('error', `Comparison failed: ${err.message}`);
    } finally {
      setComparing(false);
    }
  };

  const handleClearPulled = async (key) => {
    // Deselect if it was selected for comparison
    setSelectedForCompare((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

    // Find the pulled process and clean up temp storage on the backend
    const entry = pulledProcesses.find((p) => pulledKey(p) === key);
    if (entry) {
      try {
        await processes.clearTemp(entry.connectionId, entry.process.typeId);
      } catch {
        // Temp file may already be gone — not critical
      }
      onProcessRemoved(entry.connectionId, entry.process.typeId);
      notify('info', `Cleared local data for ${entry.process.name}`);
    }
  };

  const handleToggleExpand = (key) => {
    setExpandedPulledIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // =========================================================================
  // Derived data
  // =========================================================================

  /** Summarise a pulled process for the quick overview. */
  const summarize = (processData) => {
    const workItemTypes = processData.workItemTypes || [];
    const witCount = workItemTypes.length;

    let totalFields = 0;
    let stateCategories = {};

    workItemTypes.forEach((wit) => {
      totalFields += (wit.fields || []).length;
      (wit.states || []).forEach((s) => {
        const cat = s.stateCategory || 'Unknown';
        stateCategories[cat] = (stateCategories[cat] || 0) + 1;
      });
    });

    return { witCount, totalFields, stateCategories };
  };

  /** Determine the process type label. */
  const processTypeLabel = (proc) => {
    if (proc.isDefault) return 'System';
    if (proc.parentProcessTypeId) return 'Inherited';
    return 'Custom';
  };

  /** Badge class for process type. */
  const processTypeBadge = (proc) => {
    if (proc.isDefault) return 'badge-neutral';
    if (proc.parentProcessTypeId) return 'badge-primary';
    return 'badge-warning';
  };

  // Number of processes currently selected for comparison.
  const compareCount = selectedForCompare.size;

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <div className="process-discovery">
      {/* ----------------------------------------------------------------- */}
      {/* Section 1: Connection Selector                                     */}
      {/* ----------------------------------------------------------------- */}
      <div className="card">
        <div className="card-header">
          <h2>Discover Processes</h2>
        </div>

        <div className="form-group">
          <label htmlFor="pd-connection-select">Connection</label>
          <select
            id="pd-connection-select"
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

        {/* Loading indicator for process list */}
        {loadingList && (
          <div className="loading-overlay">
            <span className="spinner" />
            <span>Loading processes...</span>
          </div>
        )}

        {/* Empty state when a connection is selected but list is empty */}
        {!loadingList && selectedConnectionId && processList.length === 0 && (
          <div className="empty-state">
            <h3>No Processes Found</h3>
            <p>This organization has no accessible processes, or the connection may lack permissions.</p>
          </div>
        )}

        {/* -------------------------------------------------------------- */}
        {/* Section 2: Process List for selected connection                  */}
        {/* -------------------------------------------------------------- */}
        {!loadingList && processList.length > 0 && (
          <div className="table-wrap scroll-panel mt-2">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {processList.map((proc) => {
                  const pulled = findPulled(selectedConnectionId, proc.typeId);
                  const isPulling = pullingIds.has(proc.typeId);

                  return (
                    <tr key={proc.typeId}>
                      <td style={{ fontWeight: 600 }}>{proc.name}</td>
                      <td className="text-secondary text-sm truncate" style={{ maxWidth: 260 }}>
                        {proc.description || '--'}
                      </td>
                      <td>
                        <span className={`badge ${processTypeBadge(proc)}`}>
                          {processTypeLabel(proc)}
                        </span>
                      </td>
                      <td>
                        {pulled ? (
                          <span className="badge badge-success">Pulled</span>
                        ) : (
                          <span className="badge badge-neutral">Not pulled</span>
                        )}
                      </td>
                      <td>
                        <div className="btn-group">
                          {/* Pull / Re-pull button */}
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={isPulling}
                            onClick={() => handlePull(proc.typeId)}
                            title={
                              pulled
                                ? `Last pulled: ${new Date(pulled.pulledAt).toLocaleString()}`
                                : 'Pull full process data'
                            }
                          >
                            {isPulling ? (
                              <>
                                <span className="spinner" /> Pulling...
                              </>
                            ) : pulled ? (
                              'Re-pull'
                            ) : (
                              'Pull'
                            )}
                          </button>

                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Section 3: Pulled Processes (across all connections)               */}
      {/* ----------------------------------------------------------------- */}
      <div className="card mt-4">
        <div className="card-header">
          <h2>Pulled Processes</h2>
          <div className="btn-group">
            <button
              className="btn btn-primary btn-sm"
              disabled={compareCount < 2 || comparing}
              onClick={handleCompareSelected}
            >
              {comparing ? (
                <>
                  <span className="spinner" /> Comparing...
                </>
              ) : (
                `Compare Selected (${compareCount})`
              )}
            </button>
          </div>
        </div>

        {pulledProcesses.length === 0 ? (
          <div className="empty-state">
            <h3>No Pulled Processes</h3>
            <p>Select a connection above and pull one or more processes to get started.</p>
          </div>
        ) : (
          <div className="scroll-panel scroll-panel-lg">
            {pulledProcesses.map((entry) => {
              const key = pulledKey(entry);
              const conn = connectionById(entry.connectionId);
              const orgName = conn ? conn.name : entry.connectionId;
              const isExpanded = expandedPulledIds.has(key);
              const summary = isExpanded ? summarize(entry) : null;
              const witCount = (entry.workItemTypes || []).length;

              return (
                <div
                  key={key}
                  className="toggle-row flex-col"
                  style={{ padding: '10px 0' }}
                >
                  <div className="flex items-center justify-between" style={{ width: '100%' }}>
                    {/* Left side: checkbox + expand toggle + info */}
                    <div className="flex items-center gap-2" style={{ flex: 1, minWidth: 0 }}>
                      <input
                        type="checkbox"
                        checked={selectedForCompare.has(key)}
                        onChange={() => handleToggleCompare(key)}
                        title="Select for comparison"
                      />
                      <span
                        className="collapsible-header"
                        style={{ padding: 0, margin: 0 }}
                        onClick={() => handleToggleExpand(key)}
                      >
                        <span
                          className={`collapsible-arrow ${isExpanded ? 'open' : ''}`}
                        >
                          &#9654;
                        </span>
                        <strong className="truncate">{entry.process.name}</strong>
                      </span>
                      <span className="badge badge-neutral text-sm">{orgName}</span>
                      <span className="text-secondary text-sm">
                        {witCount} work item type{witCount !== 1 ? 's' : ''}
                      </span>
                      <span className="text-secondary text-sm">
                        Pulled {new Date(entry.pulledAt).toLocaleString()}
                      </span>
                    </div>

                    {/* Right side: actions */}
                    <div className="btn-group" style={{ flexShrink: 0 }}>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleClearPulled(key)}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Expanded quick overview */}
                  {isExpanded && summary && (
                    <div className="mt-2" style={{ paddingLeft: 28, width: '100%' }}>
                      <div className="flex gap-2 flex-wrap mb-2">
                        <span className="badge badge-primary">
                          {summary.witCount} Work Item Type{summary.witCount !== 1 ? 's' : ''}
                        </span>
                        <span className="badge badge-primary">
                          {summary.totalFields} Total Field{summary.totalFields !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {Object.keys(summary.stateCategories).length > 0 && (
                        <div className="text-sm text-secondary">
                          <strong>States:</strong>{' '}
                          {Object.entries(summary.stateCategories)
                            .map(
                              ([cat, count]) =>
                                `${cat} (${count})`,
                            )
                            .join(' | ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
