const API_BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

// === Connections ===
export const connections = {
  list: () => request('/connections'),
  get: (id) => request(`/connections/${id}`),
  create: (data) => request('/connections', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/connections/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id) => request(`/connections/${id}`, { method: 'DELETE' }),
  test: (id) => request(`/connections/${id}/test`, { method: 'POST' }),
};

// === Processes ===
export const processes = {
  list: (connectionId) => request(`/processes/${connectionId}`),
  get: (connectionId, processId) => request(`/processes/${connectionId}/${processId}`),
  pull: (connectionId, processId) => request(`/processes/${connectionId}/${processId}/pull`, { method: 'POST' }),
  getData: (connectionId, processId) => request(`/processes/${connectionId}/${processId}/data`),
  getOrgFields: (connectionId) => request(`/processes/${connectionId}/fields/all`),
  getSessionData: () => request('/processes/session/data'),
  clearAllTemp: () => request('/processes/temp/all', { method: 'DELETE' }),
  clearTemp: (connectionId, processId) => request(`/processes/temp/${connectionId}/${processId}`, { method: 'DELETE' }),
};

// === Comparison ===
export const comparison = {
  compare: (processList) => request('/comparison/compare', { method: 'POST', body: JSON.stringify({ processes: processList }) }),
  summary: (processList) => request('/comparison/compare/summary', { method: 'POST', body: JSON.stringify({ processes: processList }) }),
};

// === Editor ===
export const editor = {
  preview: (data) => request('/editor/preview', { method: 'POST', body: JSON.stringify(data) }),
  apply: (data) => request('/editor/apply', { method: 'POST', body: JSON.stringify(data) }),
  applyBatch: (data) => request('/editor/apply-batch', { method: 'POST', body: JSON.stringify(data) }),

  // Direct edit endpoints
  createWorkItemType: (connId, procId, body) =>
    request(`/editor/${connId}/${procId}/workitemtype`, { method: 'POST', body: JSON.stringify(body) }),
  updateWorkItemType: (connId, procId, witRefName, body) =>
    request(`/editor/${connId}/${procId}/workitemtype/${witRefName}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteWorkItemType: (connId, procId, witRefName) =>
    request(`/editor/${connId}/${procId}/workitemtype/${witRefName}`, { method: 'DELETE' }),

  addField: (connId, procId, witRefName, body) =>
    request(`/editor/${connId}/${procId}/${witRefName}/field`, { method: 'POST', body: JSON.stringify(body) }),
  updateField: (connId, procId, witRefName, fieldRefName, body) =>
    request(`/editor/${connId}/${procId}/${witRefName}/field/${fieldRefName}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeField: (connId, procId, witRefName, fieldRefName) =>
    request(`/editor/${connId}/${procId}/${witRefName}/field/${fieldRefName}`, { method: 'DELETE' }),

  createState: (connId, procId, witRefName, body) =>
    request(`/editor/${connId}/${procId}/${witRefName}/state`, { method: 'POST', body: JSON.stringify(body) }),
  updateState: (connId, procId, witRefName, stateId, body) =>
    request(`/editor/${connId}/${procId}/${witRefName}/state/${stateId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteState: (connId, procId, witRefName, stateId) =>
    request(`/editor/${connId}/${procId}/${witRefName}/state/${stateId}`, { method: 'DELETE' }),

  addBehavior: (connId, procId, witRefName, body) =>
    request(`/editor/${connId}/${procId}/${witRefName}/behavior`, { method: 'POST', body: JSON.stringify(body) }),
  updateBehavior: (connId, procId, witRefName, behaviorId, body) =>
    request(`/editor/${connId}/${procId}/${witRefName}/behavior/${behaviorId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeBehavior: (connId, procId, witRefName, behaviorId) =>
    request(`/editor/${connId}/${procId}/${witRefName}/behavior/${behaviorId}`, { method: 'DELETE' }),

  addControl: (connId, procId, witRefName, groupId, body) =>
    request(`/editor/${connId}/${procId}/${witRefName}/control/${encodeURIComponent(groupId)}`, { method: 'PUT', body: JSON.stringify(body) }),
  removeControl: (connId, procId, witRefName, groupId, controlId) =>
    request(`/editor/${connId}/${procId}/${witRefName}/control/${encodeURIComponent(groupId)}/${encodeURIComponent(controlId)}`, { method: 'DELETE' }),
};
