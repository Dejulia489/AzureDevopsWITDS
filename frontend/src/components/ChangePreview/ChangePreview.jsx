import { useState } from 'react';

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

function ChangeList({ items, type }) {
  if (!items || items.length === 0) return null;
  const cls = type === 'add' ? 'diff-added' : type === 'remove' ? 'diff-removed' : 'diff-changed';
  const label = type === 'add' ? 'Add' : type === 'remove' ? 'Remove' : 'Update';
  return (
    <div style={{ marginBottom: 8 }}>
      {items.map((item, i) => (
        <div key={i} className={cls} style={{ padding: '4px 8px', borderRadius: 'var(--radius)', marginBottom: 2, fontSize: 13 }}>
          <span className="badge badge-neutral" style={{ marginRight: 6 }}>{label}</span>
          {typeof item === 'string' ? item : item.name || item.referenceName || item.fieldRefName || item.stateId || item.behaviorId || JSON.stringify(item)}
          {item.type && <span className="text-secondary" style={{ marginLeft: 8 }}>({item.type})</span>}
          {item.stateCategory && <span className="text-secondary" style={{ marginLeft: 8 }}>Category: {item.stateCategory}</span>}
        </div>
      ))}
    </div>
  );
}

export default function ChangePreview({ preview, onConfirm, onCancel, loading, results }) {
  const p = preview?.preview;

  const totalAdds = countItems(p, 'toAdd');
  const totalUpdates = countItems(p, 'toUpdate');
  const totalRemoves = countItems(p, 'toRemove');

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 700, maxHeight: '85vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{results ? 'Apply Results' : 'Change Preview'}</h2>
          <button className="modal-close" onClick={onCancel}>&times;</button>
        </div>

        <div className="modal-body">
          {/* Loading state */}
          {loading && (
            <div className="loading-overlay">
              <span className="spinner spinner-lg" />
              Applying changes...
            </div>
          )}

          {/* Results view */}
          {results && !loading && (
            <div>
              <div className={`notification ${results.success ? 'notification-success' : 'notification-error'}`}>
                {results.success ? 'Changes applied successfully' : 'Some changes failed'}
              </div>
              {results.summary && (
                <div className="flex gap-2 flex-wrap mb-4">
                  <span className="badge badge-success">{results.summary.applied} applied</span>
                  <span className="badge badge-neutral">{results.summary.skipped} skipped</span>
                  {results.summary.errors > 0 && <span className="badge badge-danger">{results.summary.errors} errors</span>}
                </div>
              )}
              {results.results?.applied?.length > 0 && (
                <CollapsibleSection title="Applied" badge={<span className="badge badge-success" style={{ marginLeft: 8 }}>{results.results.applied.length}</span>} defaultOpen>
                  {results.results.applied.map((item, i) => (
                    <div key={i} className="diff-added" style={{ padding: '4px 8px', borderRadius: 'var(--radius)', marginBottom: 2, fontSize: 13 }}>
                      {item.operation || item.type}: {item.name || item.target || JSON.stringify(item)}
                    </div>
                  ))}
                </CollapsibleSection>
              )}
              {results.results?.skipped?.length > 0 && (
                <CollapsibleSection title="Skipped" badge={<span className="badge badge-neutral" style={{ marginLeft: 8 }}>{results.results.skipped.length}</span>}>
                  {results.results.skipped.map((item, i) => (
                    <div key={i} style={{ padding: '4px 8px', background: '#f3f2f1', borderRadius: 'var(--radius)', marginBottom: 2, fontSize: 13 }}>
                      {item.operation || item.type}: {item.name || item.target || item.reason || JSON.stringify(item)}
                    </div>
                  ))}
                </CollapsibleSection>
              )}
              {results.results?.errors?.length > 0 && (
                <CollapsibleSection title="Errors" badge={<span className="badge badge-danger" style={{ marginLeft: 8 }}>{results.results.errors.length}</span>} defaultOpen>
                  {results.results.errors.map((item, i) => (
                    <div key={i} className="diff-removed" style={{ padding: '4px 8px', borderRadius: 'var(--radius)', marginBottom: 2, fontSize: 13 }}>
                      {item.operation || item.type}: {item.name || item.target} - {item.error || item.message}
                    </div>
                  ))}
                </CollapsibleSection>
              )}
            </div>
          )}

          {/* Preview view */}
          {!results && !loading && p && (
            <div>
              {/* Warnings */}
              {p.warnings?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {p.warnings.map((w, i) => (
                    <div key={i} className="notification notification-warning">{w}</div>
                  ))}
                </div>
              )}

              {/* Summary */}
              <div className="flex gap-2 flex-wrap mb-4">
                <span className="badge badge-primary">{p.totalOperations} total operations</span>
                {totalAdds > 0 && <span className="badge badge-success">{totalAdds} additions</span>}
                {totalUpdates > 0 && <span className="badge badge-warning">{totalUpdates} updates</span>}
                {totalRemoves > 0 && <span className="badge badge-danger">{totalRemoves} removals</span>}
              </div>

              {/* Work Item Types */}
              {hasItems(p.workItemTypes) && (
                <CollapsibleSection title="Work Item Types" defaultOpen badge={
                  <span className="badge badge-primary" style={{ marginLeft: 8 }}>
                    {(p.workItemTypes.toAdd?.length || 0) + (p.workItemTypes.toUpdate?.length || 0) + (p.workItemTypes.toRemove?.length || 0)}
                  </span>
                }>
                  <ChangeList items={p.workItemTypes.toAdd} type="add" />
                  <ChangeList items={p.workItemTypes.toUpdate} type="update" />
                  <ChangeList items={p.workItemTypes.toRemove} type="remove" />
                </CollapsibleSection>
              )}

              {/* Fields by WIT */}
              {p.fields && Object.keys(p.fields).length > 0 && (
                <CollapsibleSection title="Fields" defaultOpen>
                  {Object.entries(p.fields).map(([wit, changes]) => (
                    hasItems(changes) && (
                      <CollapsibleSection key={wit} title={wit} defaultOpen badge={
                        <span className="badge badge-primary" style={{ marginLeft: 8 }}>
                          {(changes.toAdd?.length || 0) + (changes.toUpdate?.length || 0) + (changes.toRemove?.length || 0)}
                        </span>
                      }>
                        <ChangeList items={changes.toAdd} type="add" />
                        <ChangeList items={changes.toUpdate} type="update" />
                        <ChangeList items={changes.toRemove} type="remove" />
                      </CollapsibleSection>
                    )
                  ))}
                </CollapsibleSection>
              )}

              {/* States by WIT */}
              {p.states && Object.keys(p.states).length > 0 && (
                <CollapsibleSection title="States" defaultOpen>
                  {Object.entries(p.states).map(([wit, changes]) => (
                    hasItems(changes) && (
                      <CollapsibleSection key={wit} title={wit} defaultOpen badge={
                        <span className="badge badge-primary" style={{ marginLeft: 8 }}>
                          {(changes.toAdd?.length || 0) + (changes.toUpdate?.length || 0) + (changes.toRemove?.length || 0)}
                        </span>
                      }>
                        <ChangeList items={changes.toAdd} type="add" />
                        <ChangeList items={changes.toUpdate} type="update" />
                        <ChangeList items={changes.toRemove} type="remove" />
                      </CollapsibleSection>
                    )
                  ))}
                </CollapsibleSection>
              )}

              {/* Behaviors */}
              {hasItems(p.behaviors) && (
                <CollapsibleSection title="Behaviors" badge={
                  <span className="badge badge-primary" style={{ marginLeft: 8 }}>
                    {(p.behaviors.toAdd?.length || 0) + (p.behaviors.toUpdate?.length || 0) + (p.behaviors.toRemove?.length || 0)}
                  </span>
                }>
                  <ChangeList items={p.behaviors.toAdd} type="add" />
                  <ChangeList items={p.behaviors.toUpdate} type="update" />
                  <ChangeList items={p.behaviors.toRemove} type="remove" />
                </CollapsibleSection>
              )}

              {/* WIT Behaviors */}
              {p.workItemTypeBehaviors && Object.keys(p.workItemTypeBehaviors).length > 0 && (
                <CollapsibleSection title="WIT Behavior Assignments">
                  {Object.entries(p.workItemTypeBehaviors).map(([wit, changes]) => (
                    hasItems(changes) && (
                      <CollapsibleSection key={wit} title={wit} defaultOpen>
                        <ChangeList items={changes.toAdd} type="add" />
                        <ChangeList items={changes.toUpdate} type="update" />
                        <ChangeList items={changes.toRemove} type="remove" />
                      </CollapsibleSection>
                    )
                  ))}
                </CollapsibleSection>
              )}

              {p.totalOperations === 0 && (
                <div className="notification notification-info">No changes to apply.</div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {!results ? (
            <>
              <button className="btn" onClick={onCancel} disabled={loading}>Cancel</button>
              <button className="btn btn-primary" onClick={onConfirm} disabled={loading || (p?.totalOperations || 0) === 0}>
                {loading ? <><span className="spinner" /> Applying...</> : 'Apply Changes'}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={onCancel}>Close</button>
          )}
        </div>
      </div>
    </div>
  );
}

function hasItems(obj) {
  if (!obj) return false;
  return (obj.toAdd?.length || 0) + (obj.toUpdate?.length || 0) + (obj.toRemove?.length || 0) > 0;
}

function countItems(preview, key) {
  if (!preview) return 0;
  let count = 0;
  // Top level sections
  ['workItemTypes', 'behaviors'].forEach((section) => {
    if (preview[section]?.[key]) count += preview[section][key].length;
  });
  // Per-WIT sections
  ['fields', 'states', 'workItemTypeBehaviors'].forEach((section) => {
    if (preview[section]) {
      Object.values(preview[section]).forEach((wit) => {
        if (wit?.[key]) count += wit[key].length;
      });
    }
  });
  return count;
}
