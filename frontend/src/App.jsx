import { useState, useCallback, useEffect } from 'react';
import { connections as connectionsApi, processes } from './services/api';
import ConnectionManager from './components/ConnectionManager/ConnectionManager';
import ProcessDiscovery from './components/ProcessDiscovery/ProcessDiscovery';
import ProcessComparison from './components/ProcessComparison/ProcessComparison';

const TABS = [
  { id: 'connections', label: 'Connections' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'comparison', label: 'Comparison' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('discovery');
  const [connections, setConnections] = useState([]);
  const [pulledProcesses, setPulledProcesses] = useState([]);
  const [comparisonResult, setComparisonResult] = useState(null);
  const [notification, setNotification] = useState(null);

  const notify = useCallback((type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  // Restore connections and pulled processes from backend on mount
  useEffect(() => {
    connectionsApi.list()
      .then((result) => setConnections(result.connections || []))
      .catch(() => {});
    processes.getSessionData()
      .then((entries) => {
        const restored = (entries || []).map((entry) => {
          if (!entry.data) return null;
          // Ensure connectionId/orgUrl are set (may be missing from older temp files)
          if (!entry.data.connectionId && entry.connectionId) {
            entry.data.connectionId = entry.connectionId;
          }
          return entry.data;
        }).filter(Boolean);
        if (restored.length > 0) {
          setPulledProcesses(restored);
        }
      })
      .catch(() => {});
  }, []);

  const handleProcessPulled = useCallback((processData) => {
    setPulledProcesses((prev) => {
      const idx = prev.findIndex(
        (p) => p.connectionId === processData.connectionId && p.process.typeId === processData.process.typeId
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = processData;
        return next;
      }
      return [...prev, processData];
    });
    notify('success', `Pulled process: ${processData.process.name}`);
  }, [notify]);

  const handleProcessRemoved = useCallback((connectionId, processTypeId) => {
    setPulledProcesses((prev) =>
      prev.filter((p) => !(p.connectionId === connectionId && p.process.typeId === processTypeId))
    );
  }, []);

  const handleComparisonDone = useCallback((result) => {
    setComparisonResult(result);
    setActiveTab('comparison');
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Azure DevOps Process Manager</h1>
        <nav className="app-nav">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {notification && (
        <div className={`notification notification-${notification.type}`} style={{ margin: '12px 24px 0' }}>
          {notification.message}
          <button className="modal-close" style={{ marginLeft: 'auto' }} onClick={() => setNotification(null)}>&times;</button>
        </div>
      )}

      <main className="app-content">
        {activeTab === 'connections' && (
          <ConnectionManager
            connections={connections}
            setConnections={setConnections}
            notify={notify}
          />
        )}
        {activeTab === 'discovery' && (
          <ProcessDiscovery
            connections={connections}
            pulledProcesses={pulledProcesses}
            onProcessPulled={handleProcessPulled}
            onProcessRemoved={handleProcessRemoved}
            onCompare={handleComparisonDone}
            notify={notify}
          />
        )}
        {activeTab === 'comparison' && (
          <ProcessComparison
            comparisonResult={comparisonResult}
            pulledProcesses={pulledProcesses}
            onCompare={handleComparisonDone}
            onProcessPulled={handleProcessPulled}
            notify={notify}
          />
        )}
      </main>
    </div>
  );
}
