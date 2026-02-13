'use strict';

/**
 * Azure DevOps REST API service for work item process management.
 *
 * Wraps the Work Item Tracking Process API (7.1) and provides methods for
 * managing processes, work item types, fields, states, rules, behaviors,
 * work item type behaviors, and layout configuration.
 *
 * Uses dynamic import for node-fetch (ESM-only v3).
 */
class AzureDevOpsService {
  /**
   * @param {string} orgUrl - Azure DevOps organization URL (e.g. https://dev.azure.com/myorg)
   * @param {string} pat    - Personal Access Token for authentication
   */
  constructor(orgUrl, pat) {
    this.orgUrl = orgUrl;
    this.pat = pat;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the standard authorization and content-type headers.
   * @returns {Record<string, string>} HTTP headers
   */
  _getHeaders() {
    const token = Buffer.from(`:${this.pat}`).toString('base64');
    return {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Return the organization URL with any trailing slash removed.
   * @returns {string} Base API URL
   */
  _getApiBase() {
    return this.orgUrl.replace(/\/+$/, '');
  }

  /**
   * Internal fetch wrapper.
   *
   * - Dynamically imports node-fetch (ESM-only v3).
   * - Merges default headers with caller-supplied options.
   * - Logs the URL for debugging.
   * - Throws on non-OK responses with status and body.
   *
   * @param {string} url              - Fully-qualified URL to call
   * @param {RequestInit} [options={}] - Additional fetch options (method, body, etc.)
   * @returns {Promise<any>} Parsed JSON response
   */
  async _fetch(url, options = {}) {
    const fetch = (await import('node-fetch')).default;

    const headers = { ...this._getHeaders(), ...(options.headers || {}) };
    const fetchOptions = { ...options, headers };

    console.log(`[AzureDevOpsService] ${fetchOptions.method || 'GET'} ${url}`);

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      let errorBody;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = 'Unable to read response body';
      }
      throw new Error(
        `Azure DevOps API error: ${response.status} ${response.statusText} - ${errorBody}`
      );
    }

    // Some DELETE endpoints return 204 No Content
    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  // ---------------------------------------------------------------------------
  // Process endpoints  (api-version=7.1-preview.2)
  // ---------------------------------------------------------------------------

  /**
   * List all inherited processes in the organization.
   * @returns {Promise<object>} List of processes
   * @see https://learn.microsoft.com/en-us/rest/api/azure/devops/processes/processes/list
   */
  async getProcesses() {
    const url = `${this._getApiBase()}/_apis/work/processes?api-version=7.1-preview.2`;
    return this._fetch(url);
  }

  /**
   * Get a single process by ID.
   * @param {string} processId - Process GUID
   * @returns {Promise<object>} Process definition
   * @see https://learn.microsoft.com/en-us/rest/api/azure/devops/processes/processes/get
   */
  async getProcess(processId) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}?api-version=7.1-preview.2`;
    return this._fetch(url);
  }

  /**
   * Create a new inherited process.
   * @param {object} body - Process creation payload (name, parentProcessTypeId, description, etc.)
   * @returns {Promise<object>} Created process
   * @see https://learn.microsoft.com/en-us/rest/api/azure/devops/processes/processes/create
   */
  async createProcess(body) {
    const url = `${this._getApiBase()}/_apis/work/processes?api-version=7.1-preview.2`;
    return this._fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ---------------------------------------------------------------------------
  // Work Item Type endpoints  (api-version=7.1-preview.2)
  // ---------------------------------------------------------------------------

  /**
   * List all work item types in a process.
   * @param {string} processId - Process GUID
   * @returns {Promise<object>} List of work item types
   */
  async getWorkItemTypes(processId) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes?api-version=7.1-preview.2`;
    return this._fetch(url);
  }

  /**
   * Get a single work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @returns {Promise<object>} Work item type definition
   */
  async getWorkItemType(processId, witRefName) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}?api-version=7.1-preview.2`;
    return this._fetch(url);
  }

  /**
   * Create a new work item type in a process.
   * @param {string} processId - Process GUID
   * @param {object} body      - Work item type creation payload
   * @returns {Promise<object>} Created work item type
   */
  async createWorkItemType(processId, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes?api-version=7.1-preview.2`;
    return this._fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Update an existing work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {object} body        - Fields to update
   * @returns {Promise<object>} Updated work item type
   */
  async updateWorkItemType(processId, witRefName, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}?api-version=7.1-preview.2`;
    return this._fetch(url, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /**
   * Delete a work item type from a process.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @returns {Promise<null>} Resolves on success
   */
  async deleteWorkItemType(processId, witRefName) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}?api-version=7.1-preview.2`;
    return this._fetch(url, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Field endpoints  (api-version=7.1-preview.2)
  // ---------------------------------------------------------------------------

  /**
   * List fields on a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @returns {Promise<object>} List of fields
   */
  async getFields(processId, witRefName) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/fields?api-version=7.1-preview.2`;
    return this._fetch(url);
  }

  /**
   * Add a field to a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {object} body        - Field addition payload (referenceName, required, etc.)
   * @returns {Promise<object>} Added field
   */
  async addField(processId, witRefName, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/fields?api-version=7.1-preview.2`;
    return this._fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Update a field on a work item type.
   * @param {string} processId     - Process GUID
   * @param {string} witRefName    - Work item type reference name
   * @param {string} fieldRefName  - Field reference name
   * @param {object} body          - Fields to update
   * @returns {Promise<object>} Updated field
   */
  async updateField(processId, witRefName, fieldRefName, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/fields/${fieldRefName}?api-version=7.1-preview.2`;
    return this._fetch(url, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /**
   * Remove a field from a work item type.
   * @param {string} processId     - Process GUID
   * @param {string} witRefName    - Work item type reference name
   * @param {string} fieldRefName  - Field reference name
   * @returns {Promise<null>} Resolves on success
   */
  async removeField(processId, witRefName, fieldRefName) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/fields/${fieldRefName}?api-version=7.1-preview.2`;
    return this._fetch(url, { method: 'DELETE' });
  }

  /**
   * List all fields defined in the organization (not process-scoped).
   * @returns {Promise<object>} List of organization-level fields
   * @see https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/fields/list
   */
  async getOrganizationFields() {
    const url = `${this._getApiBase()}/_apis/wit/fields?api-version=7.1`;
    return this._fetch(url);
  }

  /**
   * Create a new field at the organization level.
   * @param {object} body - Field creation payload (name, referenceName, type, description, usage, readOnly)
   * @returns {Promise<object>} Created field
   * @see https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/fields/create
   */
  async createOrganizationField(body) {
    const url = `${this._getApiBase()}/_apis/wit/fields?api-version=7.1`;
    return this._fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ---------------------------------------------------------------------------
  // State endpoints  (api-version=7.1-preview.1)
  // ---------------------------------------------------------------------------

  /**
   * List states on a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @returns {Promise<object>} List of states
   */
  async getStates(processId, witRefName) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/states?api-version=7.1-preview.1`;
    return this._fetch(url);
  }

  /**
   * Create a new state on a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {object} body        - State creation payload (name, color, stateCategory, order)
   * @returns {Promise<object>} Created state
   */
  async createState(processId, witRefName, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/states?api-version=7.1-preview.1`;
    return this._fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Update an existing state on a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} stateId     - State GUID
   * @param {object} body        - Fields to update
   * @returns {Promise<object>} Updated state
   */
  async updateState(processId, witRefName, stateId, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/states/${stateId}?api-version=7.1-preview.1`;
    return this._fetch(url, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /**
   * Delete a state from a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} stateId     - State GUID
   * @returns {Promise<null>} Resolves on success
   */
  async deleteState(processId, witRefName, stateId) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/states/${stateId}?api-version=7.1-preview.1`;
    return this._fetch(url, { method: 'DELETE' });
  }

  /**
   * Hide or unhide an inherited state on a work item type.
   * Uses PUT to set the hidden flag on an existing state.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} stateId     - State GUID
   * @param {object} body        - Payload with hidden flag (e.g. { hidden: true })
   * @returns {Promise<object>} Updated state
   */
  async hideState(processId, witRefName, stateId, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/states/${stateId}?api-version=7.1-preview.1`;
    return this._fetch(url, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  // ---------------------------------------------------------------------------
  // Rule endpoints  (api-version=7.1-preview.2)
  // ---------------------------------------------------------------------------

  /**
   * List rules on a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @returns {Promise<object>} List of rules
   */
  async getRules(processId, witRefName) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/rules?api-version=7.1-preview.2`;
    return this._fetch(url);
  }

  /**
   * Create a new rule on a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {object} body        - Rule creation payload (conditions, actions, etc.)
   * @returns {Promise<object>} Created rule
   */
  async createRule(processId, witRefName, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/rules?api-version=7.1-preview.2`;
    return this._fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Update an existing rule on a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} ruleId      - Rule GUID
   * @param {object} body        - Updated rule payload
   * @returns {Promise<object>} Updated rule
   */
  async updateRule(processId, witRefName, ruleId, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/rules/${ruleId}?api-version=7.1-preview.2`;
    return this._fetch(url, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  /**
   * Delete a rule from a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} ruleId      - Rule GUID
   * @returns {Promise<null>} Resolves on success
   */
  async deleteRule(processId, witRefName, ruleId) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/rules/${ruleId}?api-version=7.1-preview.2`;
    return this._fetch(url, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Behavior endpoints  (api-version=7.1-preview.2)
  // ---------------------------------------------------------------------------

  /**
   * List behaviors in a process.
   * @param {string} processId - Process GUID
   * @returns {Promise<object>} List of behaviors
   */
  async getBehaviors(processId) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/behaviors?api-version=7.1-preview.2`;
    return this._fetch(url);
  }

  /**
   * Get a single behavior by ID.
   * @param {string} processId  - Process GUID
   * @param {string} behaviorId - Behavior reference name / ID
   * @returns {Promise<object>} Behavior definition
   */
  async getBehavior(processId, behaviorId) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/behaviors/${behaviorId}?api-version=7.1-preview.2`;
    return this._fetch(url);
  }

  /**
   * Create a new behavior in a process.
   * @param {string} processId - Process GUID
   * @param {object} body      - Behavior creation payload
   * @returns {Promise<object>} Created behavior
   */
  async createBehavior(processId, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/behaviors?api-version=7.1-preview.2`;
    return this._fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Update an existing behavior in a process.
   * @param {string} processId  - Process GUID
   * @param {string} behaviorId - Behavior reference name / ID
   * @param {object} body       - Updated behavior payload
   * @returns {Promise<object>} Updated behavior
   */
  async updateBehavior(processId, behaviorId, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/behaviors/${behaviorId}?api-version=7.1-preview.2`;
    return this._fetch(url, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  /**
   * Delete a behavior from a process.
   * @param {string} processId  - Process GUID
   * @param {string} behaviorId - Behavior reference name / ID
   * @returns {Promise<null>} Resolves on success
   */
  async deleteBehavior(processId, behaviorId) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/behaviors/${behaviorId}?api-version=7.1-preview.2`;
    return this._fetch(url, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Work Item Type Behavior endpoints  (api-version=7.1-preview.1)
  // ---------------------------------------------------------------------------

  /**
   * List behaviors associated with a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @returns {Promise<object>} List of work item type behaviors
   */
  async getWorkItemTypeBehaviors(processId, witRefName) {
    // The dedicated /behaviors sub-endpoint may not exist in all orgs.
    // Fall back to $expand=behaviors on the WIT endpoint.
    try {
      const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/behaviors?api-version=7.1-preview.1`;
      return await this._fetch(url);
    } catch {
      const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}?api-version=7.1-preview.2&$expand=behaviors`;
      const wit = await this._fetch(url);
      return { value: wit.behaviors || [] };
    }
  }

  /**
   * Add a behavior to a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {object} body        - Payload with behavior reference (behavior.id, isDefault)
   * @returns {Promise<object>} Added behavior association
   */
  async addWorkItemTypeBehavior(processId, witRefName, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/behaviors?api-version=7.1-preview.1`;
    return this._fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Update a behavior on a work item type (e.g. change isDefault).
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} behaviorId  - Behavior reference name / ID
   * @param {object} body        - Fields to update
   * @returns {Promise<object>} Updated behavior association
   */
  async updateWorkItemTypeBehavior(processId, witRefName, behaviorId, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/behaviors/${behaviorId}?api-version=7.1-preview.1`;
    return this._fetch(url, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /**
   * Remove a behavior from a work item type.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} behaviorId  - Behavior reference name / ID
   * @returns {Promise<null>} Resolves on success
   */
  async removeWorkItemTypeBehavior(processId, witRefName, behaviorId) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/behaviors/${behaviorId}?api-version=7.1-preview.1`;
    return this._fetch(url, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Layout endpoints  (api-version=7.1-preview.1)
  // ---------------------------------------------------------------------------

  /**
   * Get the full layout for a work item type (pages, sections, groups, controls).
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @returns {Promise<object>} Layout definition
   */
  async getLayout(processId, witRefName) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/layout?api-version=7.1-preview.1`;
    return this._fetch(url);
  }

  /**
   * List pages in a work item type layout.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @returns {Promise<object>} List of layout pages
   */
  async getPages(processId, witRefName) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/layout/pages?api-version=7.1-preview.1`;
    return this._fetch(url);
  }

  /**
   * Create a new page in a work item type layout.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {object} body        - Page creation payload (label, sections, etc.)
   * @returns {Promise<object>} Created page
   */
  async createPage(processId, witRefName, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/layout/pages?api-version=7.1-preview.1`;
    return this._fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Update an existing page in a work item type layout.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {object} body        - Updated page payload (must include id)
   * @returns {Promise<object>} Updated page
   */
  async updatePage(processId, witRefName, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/layout/pages?api-version=7.1-preview.1`;
    return this._fetch(url, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /**
   * Delete a page from a work item type layout.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} pageId      - Page GUID
   * @returns {Promise<null>} Resolves on success
   */
  async deletePage(processId, witRefName, pageId) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/layout/pages/${pageId}?api-version=7.1-preview.1`;
    return this._fetch(url, { method: 'DELETE' });
  }

  /**
   * Get sections for a page. There is no direct REST endpoint; use getLayout()
   * and filter the sections from the desired page.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} pageId      - Page GUID
   * @returns {Promise<Array>} Sections within the specified page
   */
  async getSections(processId, witRefName, pageId) {
    const layout = await this.getLayout(processId, witRefName);
    const page = (layout.pages || []).find((p) => p.id === pageId);
    return page ? page.sections || [] : [];
  }

  /**
   * Create a new section in a page.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} pageId      - Page GUID
   * @param {object} body        - Section creation payload
   * @returns {Promise<object>} Created section
   */
  async createSection(processId, witRefName, pageId, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/layout/pages/${pageId}/sections?api-version=7.1-preview.1`;
    return this._fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Delete a section from a page.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} pageId      - Page GUID
   * @param {string} sectionId   - Section GUID
   * @returns {Promise<null>} Resolves on success
   */
  async deleteSection(processId, witRefName, pageId, sectionId) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/layout/pages/${pageId}/sections/${sectionId}?api-version=7.1-preview.1`;
    return this._fetch(url, { method: 'DELETE' });
  }

  /**
   * Get groups for a section. There is no direct REST endpoint; use getLayout()
   * and filter the groups from the desired page and section.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} pageId      - Page GUID
   * @param {string} sectionId   - Section GUID
   * @returns {Promise<Array>} Groups within the specified section
   */
  async getGroups(processId, witRefName, pageId, sectionId) {
    const layout = await this.getLayout(processId, witRefName);
    const page = (layout.pages || []).find((p) => p.id === pageId);
    if (!page) return [];
    const section = (page.sections || []).find((s) => s.id === sectionId);
    return section ? section.groups || [] : [];
  }

  /**
   * Create a new group in a section.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} pageId      - Page GUID
   * @param {string} sectionId   - Section GUID
   * @param {object} body        - Group creation payload (label, controls, etc.)
   * @returns {Promise<object>} Created group
   */
  async createGroup(processId, witRefName, pageId, sectionId, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/layout/pages/${pageId}/sections/${sectionId}/groups?api-version=7.1-preview.1`;
    return this._fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Update an existing group in a section.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} pageId      - Page GUID
   * @param {string} sectionId   - Section GUID
   * @param {string} groupId     - Group GUID
   * @param {object} body        - Fields to update
   * @returns {Promise<object>} Updated group
   */
  async updateGroup(processId, witRefName, pageId, sectionId, groupId, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/layout/pages/${pageId}/sections/${sectionId}/groups/${groupId}?api-version=7.1-preview.1`;
    return this._fetch(url, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /**
   * Delete a group from a section.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} pageId      - Page GUID
   * @param {string} sectionId   - Section GUID
   * @param {string} groupId     - Group GUID
   * @returns {Promise<null>} Resolves on success
   */
  async deleteGroup(processId, witRefName, pageId, sectionId, groupId) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/layout/pages/${pageId}/sections/${sectionId}/groups/${groupId}?api-version=7.1-preview.1`;
    return this._fetch(url, { method: 'DELETE' });
  }

  /**
   * Move a group to a different section/page.
   * Uses PUT with removeFromSectionId and removeFromPageId in the body.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} pageId      - Target page GUID
   * @param {string} sectionId   - Target section GUID
   * @param {string} groupId     - Group GUID to move
   * @param {object} body        - Move payload including removeFromSectionId and removeFromPageId
   * @returns {Promise<object>} Moved group
   */
  async moveGroup(processId, witRefName, pageId, sectionId, groupId, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${witRefName}/layout/pages/${pageId}/sections/${sectionId}/groups/${groupId}?api-version=7.1-preview.1`;
    return this._fetch(url, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  // ---------------------------------------------------------------------------
  // Layout control endpoints  (api-version=7.1)
  // Docs: https://learn.microsoft.com/en-us/rest/api/azure/devops/processes/controls
  // ---------------------------------------------------------------------------

  /**
   * Add or move a field control into a group on the layout.
   * Uses PUT (Move Control To Group) which creates-or-moves, matching the
   * Azure DevOps web UI behavior.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} groupId     - Group ID
   * @param {object} body        - Control payload (id = field referenceName, visible, label, etc.)
   * @returns {Promise<object>} Created/moved control
   */
  async addControl(processId, witRefName, groupId, body) {
    const controlId = body.id;
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${encodeURIComponent(witRefName)}/layout/groups/${encodeURIComponent(groupId)}/controls/${encodeURIComponent(controlId)}?api-version=7.1`;
    return this._fetch(url, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  /**
   * Edit an existing field control in a group (update properties like visible, label, etc.).
   * Uses PATCH which updates the control in place without moving it.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} groupId     - Group ID
   * @param {string} controlId   - Control ID (usually the field referenceName)
   * @param {object} body        - Properties to update (visible, label, readOnly, etc.)
   * @returns {Promise<object>} Updated control
   */
  async editControl(processId, witRefName, groupId, controlId, body) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${encodeURIComponent(witRefName)}/layout/groups/${encodeURIComponent(groupId)}/controls/${encodeURIComponent(controlId)}?api-version=7.1`;
    return this._fetch(url, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /**
   * Remove a field control from a group on the layout.
   * @param {string} processId   - Process GUID
   * @param {string} witRefName  - Work item type reference name
   * @param {string} groupId     - Group ID
   * @param {string} controlId   - Control ID (usually the field referenceName)
   * @returns {Promise<null>} Resolves on success
   */
  async removeControl(processId, witRefName, groupId, controlId) {
    const url = `${this._getApiBase()}/_apis/work/processes/${processId}/workItemTypes/${encodeURIComponent(witRefName)}/layout/groups/${encodeURIComponent(groupId)}/controls/${encodeURIComponent(controlId)}?api-version=7.1`;
    return this._fetch(url, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Connection test
  // ---------------------------------------------------------------------------

  /**
   * Test the connection to Azure DevOps by attempting to list processes.
   * @returns {Promise<boolean>} true if the connection succeeds, false otherwise
   */
  async testConnection() {
    try {
      await this.getProcesses();
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = AzureDevOpsService;
