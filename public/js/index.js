const modelSelect = document.getElementById('modelSelect');
const modelInput = document.getElementById('modelInput');
const loadSchemaBtn = document.getElementById('loadSchemaBtn');
const saveSchemaBtn = document.getElementById('saveSchemaBtn');
const deleteSchemaBtn = document.getElementById('deleteSchemaBtn');
const cancelBtn = document.getElementById('cancelBtn');
const loadRecordsBtn = document.getElementById('loadRecordsBtn');
const viewModelSelect = document.getElementById('viewModelSelect');

// Status tab elements
const statusMinuteEl = document.getElementById('statusMinute');
const statusTotalEl = document.getElementById('statusTotal');
const statusTablesBodyEl = document.getElementById('statusTablesBody');
const statusIPsBodyEl = document.getElementById('statusIPsBody');
const statusMessageEl = document.getElementById('statusMessage');

let aceEditor;
let statusPollInterval = null;

// Trend chart state (client-side only)
let statusTrendChart = null;
const MAX_TREND_POINTS = 360; // 30 minutes at 5-second intervals
const trendHistory = {
  labels: [],       // timestamps
  total: [],        // total TPM values
  tables: {}        // { tableName: [tpm values] }
};

// ---- Auth helpers ----

/**
 * Encode a UTF-8 string to Base64, safely handling non-ASCII characters.
 * Native btoa() throws on strings outside the Latin-1 range.
 */
function utf8ToBase64 (str) {
  return btoa(Array.from(new TextEncoder().encode(str))
    .map(b => String.fromCharCode(b)).join(''));
}

/**
 * Get stored credentials from sessionStorage, or prompt the user.
 * Returns { username, password } or null if the user cancels.
 */
function getCredentials() {
  const stored = sessionStorage.getItem('authCredentials');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      sessionStorage.removeItem('authCredentials');
    }
  }

  const username = prompt('Authentication required.\n\nUsername:');
  if (username === null) return null; // user cancelled
  const password = prompt('Authentication required.\n\nPassword:');
  if (password === null) return null;

  sessionStorage.setItem('authCredentials', JSON.stringify({ username, password }));
  return { username, password };
}

/**
 * Build an Authorization header for Basic auth from stored credentials.
 */
function getAuthHeader() {
  const creds = getCredentials();
  if (!creds) return null;
  const token = utf8ToBase64(`${creds.username}:${creds.password}`);
  return `Basic ${token}`;
}

/**
 * Fetch wrapper that handles 401 by prompting for credentials.
 */
async function authFetch(url, options = {}) {
  // Try with stored credentials first
  const stored = sessionStorage.getItem('authCredentials');
  if (stored) {
    try {
      const creds = JSON.parse(stored);
      const token = utf8ToBase64(`${creds.username}:${creds.password}`);
      options.headers = { ...options.headers, Authorization: `Basic ${token}` };
    } catch {
      sessionStorage.removeItem('authCredentials');
    }
  }

  const response = await fetch(url, options);

  // If 401, prompt for credentials and retry once
  if (response.status === 401) {
    const creds = getCredentials();
    if (!creds) {
      alert('Authentication cancelled.');
      return response;
    }
    const token = utf8ToBase64(`${creds.username}:${creds.password}`);
    options.headers = { ...options.headers, Authorization: `Basic ${token}` };
    return fetch(url, options);
  }

  return response;
}

// Tab switching function
function switchTab(event, tabName) {
  // Hide all tab contents
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  // Remove active class from all buttons
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show selected tab and activate button
  document.getElementById(tabName).classList.add('active');
  event.target.classList.add('active');

  // Handle status tab polling
  if (tabName === 'statusTab') {
    startStatusPolling();
  } else {
    stopStatusPolling();
  }

  // If switching to create tab, load form if model is selected
  if (tabName === 'createTab' && document.getElementById('createModelSelect').value) {
    loadCreateForm();
  }

  // Set focus on create model select when switching to create tab
  if (tabName === 'createTab') {
    setTimeout(() => {
      const createSelect = document.getElementById('createModelSelect');
      if (createSelect) {
        createSelect.focus();
      }
    }, 100);
  }
}

// Initialize ACE editor
function initAceEditor() {
  aceEditor = ace.edit('schemaEditor');
  aceEditor.setTheme('ace/theme/chrome');
  aceEditor.session.setMode('ace/mode/json');
  aceEditor.setValue('{}', 1);
}

// Fetch models from the database and populate dropdowns
async function loadModels() {
  try {
    const response = await authFetch('/api/models');
    const models = await response.json();

    // Schema tab: select with ability to type new names
    modelSelect.innerHTML = '<option value="">Select a model...</option><option value="__other__">Other (type below)</option>';
    models.forEach(function(model) {
      const option = document.createElement('option');
      option.value = model.model;
      option.textContent = model.model;
      modelSelect.appendChild(option);
    });

    // Keep the "Select a model" placeholder as the first option in the dropdowns
    const createModelSelect = document.getElementById('createModelSelect');
    createModelSelect.innerHTML = '<option value="">Select a model</option>';

    const viewModelSelect = document.getElementById('viewModelSelect');
    viewModelSelect.innerHTML = '<option value="">Select a model</option>';

    models.forEach(function(model) {
      const createOption = document.createElement('option');
      createOption.value = model.model;
      createOption.textContent = model.model;
      createModelSelect.appendChild(createOption);

      const viewOption = document.createElement('option');
      viewOption.value = model.model;
      viewOption.textContent = model.model;
      viewModelSelect.appendChild(viewOption);
    });
  } catch (error) {
    console.error('Error loading models:', error);
    modelSelect.innerHTML = '<option>Error loading models</option>';
  }
}

// Get the current model name from either the select or the custom input
function getCurrentModelName() {
  if (modelSelect.value === '__other__') {
    return modelInput.value.trim();
  }
  return modelSelect.value.trim();
}

// Load schema for selected model
async function loadSchema() {
  const selectedModel = getCurrentModelName();

  if (!selectedModel) {
    aceEditor.setValue('Please enter or select a model name.', 1);
    return;
  }

  try {
    const response = await authFetch(`/api/schema/${encodeURIComponent(selectedModel)}`);

    // Check if schema exists (404 means not found)
    if (response.status === 404) {
      aceEditor.setValue('{}', 1);
      return;
    }

    const schema = await response.json();

    // Set ACE editor to read-only mode
    // aceEditor.setReadOnly(true);

    // Format JSON with indentation
    aceEditor.setValue(JSON.stringify(schema, null, 2), 1);
  } catch (error) {
    console.error('Error loading schema:', error);
    aceEditor.setValue('Error loading schema.', 1);
  }
}

// Save schema to database
async function saveSchema() {
  const model = getCurrentModelName();
  const schema = aceEditor.getValue();

  if (!model) {
    alert('Please enter a model name.');
    return;
  }

  if (!schema.trim()) {
    alert('Please enter a schema.');
    return;
  }

  // Validate schema before submitting
  try {
    const parsedSchema = JSON.parse(schema);

    // Check that schema is an object
    if (typeof parsedSchema !== 'object' || parsedSchema === null || Array.isArray(parsedSchema)) {
      alert('Schema must be a JSON object.');
      return;
    }

    // Check that all fields have a 'type' property
    for (const field in parsedSchema) {
      if (typeof parsedSchema[field] !== 'object' || parsedSchema[field] === null || Array.isArray(parsedSchema[field])) {
        alert(`Field '${field}' must be an object.`);
        return;
      }
      if (!parsedSchema[field].type) {
        alert(`Field '${field}' must have a 'type' property.`);
        return;
      }
      // Check for valid types
      const validTypes = ['string', 'integer', 'float', 'boolean', 'json', 'datetime'];
      if (!validTypes.includes(parsedSchema[field].type.toLowerCase())) {
        alert(`Invalid type '${parsedSchema[field].type}' for field '${field}'. Valid types: ${validTypes.join(', ')}`);
        return;
      }
    }
  } catch (error) {
    alert('Invalid JSON schema: ' + error.message);
    return;
  }

  try {
    const response = await authFetch(`/api/schema/${encodeURIComponent(model)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: schema
    });

    const result = await response.json();

    if (response.ok) {
      alert('Schema saved successfully!');
      modelSelect.value = '';
      aceEditor.setValue('{}', 1);
      await loadModels();
    } else {
      alert('Error saving schema: ' + result.error);
    }
  } catch (error) {
    console.error('Error saving schema:', error);
    alert('Error saving schema.');
  }
}

async function deleteSchema() {
  const model = getCurrentModelName();
  const schema = aceEditor.getValue();

  if (!model) {
    alert('Please enter a model name.');
    return;
  }

  try {
    const response = await authFetch(`/api/schema/${encodeURIComponent(model)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (response.ok) {
      alert('Schema deleted successfully!');
      modelSelect.value = '';
      aceEditor.setValue('{}', 1);
      await loadModels();
    } else {
      alert('Error deleting schema: ' + result.error);
    }
  } catch (error) {
    console.error('Error deleting schema:', error);
    alert('Error deleting schema.');
  }
}

// Cancel: clear model and editor
function cancel() {
  modelSelect.value = '';
  modelSelect.style.display = 'block';
  modelInput.value = '';
  modelInput.style.display = 'none';
  aceEditor.setValue('{}', 1);
}

// Load create record form based on schema
async function loadCreateForm() {
  const selectedModel = document.getElementById('createModelSelect').value.trim();
  const formContainer = document.getElementById('createFormContainer');
  const formFields = document.getElementById('formFields');
  const placeholder = document.getElementById('createPlaceholder');

  if (!selectedModel) {
    formContainer.style.display = 'none';
    placeholder.style.display = 'block';
    return;
  }

  try {
    const response = await authFetch(`/api/schema/${encodeURIComponent(selectedModel)}`);

    if (response.status === 404) {
      alert('No schema found for this model. Please save a schema first.');
      return;
    }

    const schema = await response.json();

    // Hide placeholder and show form
    placeholder.style.display = 'none';
    formContainer.style.display = 'block';

    // Clear existing fields
    formFields.innerHTML = '';

    // Generate form fields based on schema
    Object.keys(schema).forEach(fieldName => {
      const field = schema[fieldName];
      const fieldGroup = document.createElement('div');
      fieldGroup.className = 'form-group';

      const label = document.createElement('label');
      label.htmlFor = `field_${fieldName}`;
      label.textContent = fieldName + (field.primary ? ' (Primary Key)' : '');
      label.style.fontWeight = field.primary ? 'bold' : 'normal';

      const input = document.createElement('input');
      input.type = 'text';
      input.id = `field_${fieldName}`;
      input.name = `field_${fieldName}`;

      // Set appropriate input type based on field type
      if (field.type === 'integer') {
        input.type = 'number';
      } else if (field.type === 'boolean') {
        input.type = 'checkbox';
      } else if (field.type === 'datetime') {
        input.type = 'datetime-local';
      } else {
        input.placeholder = `Enter ${fieldName}`;
      }

      // Add required attribute for primary keys
      if (field.primary) {
        input.required = true;
      }

      // Add max length attribute if specified
      if (field.length) {
        input.maxLength = field.length;
      }

      fieldGroup.appendChild(label);
      fieldGroup.appendChild(input);
      formFields.appendChild(fieldGroup);
    });

  } catch (error) {
    console.error('Error loading create form:', error);
    alert('Error loading create form.');
  }
}

// Submit record creation
async function submitRecord() {
  const selectedModel = document.getElementById('createModelSelect').value.trim();
  const formFields = document.getElementById('formFields');
  const messageDiv = document.getElementById('recordMessage');

  if (!selectedModel) {
    alert('Please select a model.');
    return;
  }

  // Collect form data
  const formData = {};
  const inputs = formFields.querySelectorAll('input');

  inputs.forEach(input => {
    const fieldName = input.id.replace('field_', '');

    // Handle checkbox type
    if (input.type === 'checkbox') {
      formData[fieldName] = input.checked ? 'true' : 'false';
    } else {
      formData[fieldName] = input.value;
    }
  });

  try {
    const response = await authFetch(`/api/record/${encodeURIComponent(selectedModel)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });

    const result = await response.json();

    if (response.ok) {
      messageDiv.textContent = 'Record created successfully!';
      messageDiv.style.color = 'green';

      // Clear form
      inputs.forEach(input => {
        if (input.type !== 'checkbox') {
          input.value = '';
        }
      });
    } else {
      messageDiv.textContent = 'Error creating record: ' + result.error;
      messageDiv.style.color = 'red';
    }
  } catch (error) {
    console.error('Error creating record:', error);
    messageDiv.textContent = 'Error creating record. Please try again.';
    messageDiv.style.color = 'red';
  }
}

// Cache for schema so we know field types / primary keys when editing cells
let recordsSchema = null;

// Pagination state
let currentPage = 1;
const recordsPerPage = 25;

// Load records for selected model
async function loadRecords(page) {
  const selectedModel = viewModelSelect.value.trim();
  const recordsHead = document.getElementById('recordsHead');
  const recordsBody = document.getElementById('recordsBody');
  const recordsMessage = document.getElementById('recordsMessage');
  const paginationContainer = document.getElementById('paginationContainer');

  if (!selectedModel) {
    alert('Please select a model.');
    return;
  }

  // Update current page if provided
  if (page !== undefined) {
    currentPage = page;
  }

  try {
    // Fetch records (with pagination via POST) and schema in parallel
    const [searchResp, schemaResp] = await Promise.all([
      authFetch(`/api/search/${encodeURIComponent(selectedModel)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: currentPage, limit: recordsPerPage })
      }),
      authFetch(`/api/schema/${encodeURIComponent(selectedModel)}`).catch(() => null),
    ]);

    // Cache schema for later field-type lookups when editing
    if (schemaResp && schemaResp.ok) {
      recordsSchema = await schemaResp.json();
    } else {
      recordsSchema = null;
    }

    if (!searchResp.ok) {
      const result = await searchResp.json();
      recordsMessage.textContent = 'Error loading records: ' + (result.error || 'Unknown error');
      recordsMessage.style.color = 'red';
      paginationContainer.style.display = 'none';
      document.getElementById('paginationContainerTop').style.display = 'none';
      return;
    }

    const searchData = await searchResp.json();
    const records = searchData.records || [];
    const totalCount = searchData.totalCount || 0;

    // Handle empty result set
    if (!records || records.length === 0) {
      recordsHead.innerHTML = '';
      recordsBody.innerHTML = '';
      recordsMessage.textContent = 'No records found.';
      recordsMessage.style.color = '#666';
      paginationContainer.style.display = 'none';
      document.getElementById('paginationContainerTop').style.display = 'none';
      return;
    }

    // Determine primary key fields
    const pkFields = [];
    if (recordsSchema) {
      for (const f in recordsSchema) {
        if (recordsSchema[f].primary) pkFields.push(f);
      }
    }

    // Build table headers from keys of first record plus an Actions column
    const headers = Object.keys(records[0]);
    let headHtml = '<tr>';
    headers.forEach(h => {
      headHtml += `<th style="padding: 8px; border: 1px solid #ddd; text-align: left; background: #f5f5f5;">${h}</th>`;
    });
    headHtml += '<th style="padding: 8px; border: 1px solid #ddd; text-align: center; background: #f5f5f5;">Actions</th>';
    headHtml += '</tr>';
    recordsHead.innerHTML = headHtml;

    // Build table rows — each cell is clickable for inline editing
    recordsBody.innerHTML = '';
    records.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.style.backgroundColor = index % 2 === 0 ? '#ffffff' : '#e8f4fd';
      headers.forEach(h => {
        const td = document.createElement('td');
        td.style.padding = '8px';
        td.style.border = '1px solid #ddd';
        td.style.cursor = 'pointer';
        const fieldType = recordsSchema && recordsSchema[h] ? recordsSchema[h].type : 'string';
        const cellValue = row[h];
        if (fieldType === 'json' && cellValue !== null && cellValue !== undefined) {
          td.textContent = JSON.stringify(cellValue);
        } else {
          td.textContent = cellValue ?? '';
        }
        const clickHandler = function () {
          editCell(td, selectedModel, h, td.textContent ?? '');
        };
        td.addEventListener('click', clickHandler);
        tr.appendChild(td);
      });

      // Actions cell (Copy + Delete buttons)
      const actionsTd = document.createElement('td');
      actionsTd.style.padding = '8px';
      actionsTd.style.border = '1px solid #ddd';
      actionsTd.style.textAlign = 'center';
      actionsTd.style.whiteSpace = 'nowrap';

      const copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy';
      copyBtn.style.padding = '4px 8px';
      copyBtn.style.cursor = 'pointer';
      copyBtn.style.marginRight = '4px';
      copyBtn.title = 'Copy record as JSON';
      copyBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        copyRecord(row);
      });
      actionsTd.appendChild(copyBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.style.padding = '4px 8px';
      deleteBtn.style.cursor = 'pointer';
      deleteBtn.style.color = 'red';
      deleteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteRecord(selectedModel, row, pkFields, tr);
      });
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);

      recordsBody.appendChild(tr);
    });

    // Update pagination UI (top and bottom)
    const totalPages = Math.ceil(totalCount / recordsPerPage);
    const startRecord = (currentPage - 1) * recordsPerPage + 1;
    const endRecord = Math.min(currentPage * recordsPerPage, totalCount);
    const pageText = `Page ${currentPage} of ${totalPages} (${startRecord}-${endRecord} of ${totalCount} records)`;

    const prevDisabled = currentPage <= 1;
    const nextDisabled = currentPage >= totalPages;

    // Bottom pagination
    document.getElementById('pageInfo').textContent = pageText;
    document.getElementById('prevPageBtn').disabled = prevDisabled;
    document.getElementById('nextPageBtn').disabled = nextDisabled;
    paginationContainer.style.display = 'flex';

    // Top pagination
    document.getElementById('pageInfoTop').textContent = pageText;
    document.getElementById('prevPageBtnTop').disabled = prevDisabled;
    document.getElementById('nextPageBtnTop').disabled = nextDisabled;
    document.getElementById('paginationContainerTop').style.display = 'flex';

    recordsMessage.textContent = 'Click a cell to edit.';
    recordsMessage.style.color = 'green';

  } catch (error) {
    console.error('Error loading records:', error);
    recordsMessage.textContent = 'Error loading records. Please try again.';
    recordsMessage.style.color = 'red';
    document.getElementById('paginationContainer').style.display = 'none';
    document.getElementById('paginationContainerTop').style.display = 'none';
  }
}

/**
 * Copy the entire record as formatted JSON to the clipboard.
 * @param {object} row - the record data
 */
function copyRecord(row) {
  const json = JSON.stringify(row, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    document.getElementById('recordsMessage').textContent = 'Record copied to clipboard.';
    document.getElementById('recordsMessage').style.color = 'green';
  }).catch(err => {
    console.error('Error copying to clipboard:', err);
    document.getElementById('recordsMessage').textContent = 'Failed to copy to clipboard.';
    document.getElementById('recordsMessage').style.color = 'red';
  });
}

/**
 * Delete a record, confirming with the user first.
 * @param {string} model - model name
 * @param {object} row - the record data (used to identify via primary keys)
 * @param {string[]} pkFields - array of primary key field names
 * @param {HTMLTableRowElement} tr - the table row to remove from DOM
 */
function deleteRecord(model, row, pkFields, tr) {
  // Build confirmation message from primary key values
  const pkDesc = pkFields.map(f => `${f}: ${row[f] ?? ''}`).join(', ');
  if (!confirm(`Delete record (${pkDesc})?`)) return;

  const query = {};
  pkFields.forEach(f => { query[f] = row[f] ?? ''; });
  const queryString = new URLSearchParams(query).toString();

  authFetch(
    `/api/record/${encodeURIComponent(model)}${queryString ? '?' + queryString : ''}`,
    { method: 'DELETE' }
  ).then(async response => {
    if (!response.ok) {
      const result = await response.json();
      alert('Error deleting record: ' + (result.error || 'Unknown error'));
      return;
    }
    // Reload current page to keep pagination in sync
    loadRecords(currentPage);
  }).catch(err => {
    console.error('Error deleting record:', err);
    alert('Error deleting record. Please try again.');
  });
}

/**
 * Replace a table cell's text with an inline editor (input + Save/Cancel).
 * @param {HTMLTableCellElement} cell - the <td> being edited
 * @param {string} model - model name
 * @param {string} field - field name
 * @param {*} value - current value
 */
function editCell(cell, model, field, value) {
  // Don't re-enter edit mode if already editing
  if (cell.querySelector('input')) return;

  const fieldType = recordsSchema && recordsSchema[field] ? recordsSchema[field].type : 'string';

  // JSON fields cannot be edited in the viewer
  if (fieldType === 'json') {
    alert('JSON type fields cannot be modified in the viewer.');
    return;
  }

  const editor = document.createElement('div');
  editor.style.display = 'flex';
  editor.style.flexDirection = 'column';
  editor.style.gap = '2px';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = value === null ? '' : String(value);
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.style.padding = '4px';

  // Adjust input type by field schema
  if (fieldType === 'integer') input.type = 'number';
  else if (fieldType === 'boolean') input.type = 'checkbox';
  else if (fieldType === 'datetime') input.type = 'datetime-local';

  if (fieldType === 'boolean') {
    input.checked = value === 'true' || value === true || value === 1;
  }

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '4px';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '✓';
  saveBtn.title = 'Save';
  saveBtn.style.cursor = 'pointer';
  saveBtn.style.fontSize = '11px';
  saveBtn.style.padding = '1px 4px';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '✗';
  cancelBtn.title = 'Cancel';
  cancelBtn.style.cursor = 'pointer';
  cancelBtn.style.fontSize = '11px';
  cancelBtn.style.padding = '1px 4px';

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);

  editor.appendChild(input);
  editor.appendChild(btnRow);

  // Capture original text BEFORE modifying the cell
  const originalText = value !== null ? String(value) : '';

  cell.textContent = '';
  cell.appendChild(editor);
  input.focus();

  // Gather primary-key values from sibling cells to identify the row
  const row = cell.parentElement;
  const headers = Array.from(document.getElementById('recordsHead').querySelectorAll('th')).map(th => th.textContent);
  const pkFields = [];
  if (recordsSchema) {
    for (const f in recordsSchema) {
      if (recordsSchema[f].primary) pkFields.push(f);
    }
  }

  const restoreCell = () => { cell.textContent = originalText; };

  const getQueryParams = () => {
    const params = {};
    pkFields.forEach((pk, i) => {
      const td = row.children[i];
      params[pk] = td ? (td.textContent ?? '') : '';
    });
    return params;
  };

  const saveAndRefresh = async () => {
    let newValue;
    if (fieldType === 'boolean') {
      newValue = input.checked ? 'true' : 'false';
    } else {
      newValue = input.value;
    }

    const query = getQueryParams();
    const queryString = new URLSearchParams(query).toString();

    try {
      const response = await authFetch(
        `/api/record/${encodeURIComponent(model)}${queryString ? '?' + queryString : ''}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: newValue })
        }
      );
      const result = await response.json();

      if (!response.ok) {
        alert('Error updating record: ' + (result.error || 'Unknown error'));
        restoreCell();
        return;
      }

      // Update cell with new value
      cell.textContent = newValue;

      // Update message
      document.getElementById('recordsMessage').textContent = 'Record updated.';
      document.getElementById('recordsMessage').style.color = 'green';
    } catch (err) {
      console.error('Error saving cell:', err);
      restoreCell();
    }
  };

  cancelBtn.addEventListener('click', e => {
    e.stopPropagation();  // prevent cell's click handler from re-entering edit mode
    restoreCell();
  });

  saveBtn.addEventListener('click', e => {
    e.stopPropagation();
    saveAndRefresh();
  });

  // Save on Enter, cancel on Escape
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveAndRefresh();
    if (e.key === 'Escape') {
      restoreCell();
    }
  });
}

// ---- Status tab functions ----

/**
 * Initialize the trend chart.
 */
function initTrendChart() {
  const canvas = document.getElementById('statusTrendChart');
  if (!canvas) return;

  statusTrendChart = new LineChart(canvas);
}

/**
 * Update the trend history with new data and refresh the chart.
 * @param {object} data - Status data from /api/status
 */
function updateTrendHistory(data) {
  const now = Date.now();

  // Append new data point
  trendHistory.labels.push(now);
  trendHistory.total.push(data.totalTransactionsPerMinute || 0);

  // Track per-table data
  if (data.tablesPerMinute) {
    data.tablesPerMinute.forEach(entry => {
      if (!trendHistory.tables[entry.name]) {
        trendHistory.tables[entry.name] = [];
      }
      // Fill in zeros for previous points if this is a new table
      while (trendHistory.tables[entry.name].length < trendHistory.labels.length - 1) {
        trendHistory.tables[entry.name].push(0);
      }
      trendHistory.tables[entry.name].push(entry.tpm || 0);
    });
  }

  // Trim to max points
  if (trendHistory.labels.length > MAX_TREND_POINTS) {
    trendHistory.labels = trendHistory.labels.slice(-MAX_TREND_POINTS);
    trendHistory.total = trendHistory.total.slice(-MAX_TREND_POINTS);
    for (const tableName in trendHistory.tables) {
      trendHistory.tables[tableName] = trendHistory.tables[tableName].slice(-MAX_TREND_POINTS);
    }
  }

  // Update chart
  if (!statusTrendChart) return;

  // Build datasets array
  const datasets = [
    {
      label: 'Total',
      data: trendHistory.total,
      borderColor: '#2196F3',
      backgroundColor: 'rgba(33, 150, 243, 0.1)',
      fill: true,
      lineWidth: 2
    }
  ];

  // Sync table datasets
  const currentTables = data.tablesPerMinute ? data.tablesPerMinute.map(e => e.name) : [];

  const tableColors = [
    '#4CAF50', '#FF9800', '#9C27B0', '#F44336', '#00BCD4',
    '#795548', '#607D8B', '#E91E63', '#3F51B5', '#CDDC39'
  ];

  let colorIndex = 0;
  for (const tableName of currentTables) {
    if (!trendHistory.tables[tableName]) continue;

    datasets.push({
      label: tableName,
      data: trendHistory.tables[tableName],
      borderColor: tableColors[colorIndex % tableColors.length],
      lineWidth: 1.5
    });

    colorIndex++;
  }

  // Clean up history for tables no longer in the data
  for (const tableName in trendHistory.tables) {
    if (!currentTables.includes(tableName)) {
      delete trendHistory.tables[tableName];
    }
  }

  statusTrendChart.update({
    labels: trendHistory.labels,
    datasets: datasets
  });
}

/**
 * Fetch and display status data from /api/status.
 */
async function loadStatus() {
  try {
    const response = await authFetch('/api/status');

    if (!response.ok) {
      const result = await response.json();
      statusMessageEl.textContent = 'Error loading status: ' + (result.error || 'Unknown error');
      statusMessageEl.style.color = 'red';
      return;
    }

    const data = await response.json();

    // Update trend history and chart
    updateTrendHistory(data);

    // Show the rolling window label
    statusMinuteEl.textContent = 'Rolling 1-minute window';

    // Update total
    statusTotalEl.textContent = data.totalTransactionsPerMinute;

    // Update tables table
    statusTablesBodyEl.innerHTML = '';
    if (data.tablesPerMinute && data.tablesPerMinute.length > 0) {
      data.tablesPerMinute.forEach(entry => {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.style.padding = '8px';
        tdName.style.border = '1px solid #ddd';
        tdName.textContent = entry.name;
        const tdCount = document.createElement('td');
        tdCount.style.padding = '8px';
        tdCount.style.border = '1px solid #ddd';
        tdCount.style.textAlign = 'right';
        tdCount.textContent = entry.tpm;
        tr.appendChild(tdName);
        tr.appendChild(tdCount);
        statusTablesBodyEl.appendChild(tr);
      });
    } else {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.style.padding = '8px';
      td.style.border = '1px solid #ddd';
      td.style.textAlign = 'center';
      td.style.color = '#999';
      td.textContent = 'No table-specific transactions in the last minute';
      tr.appendChild(td);
      statusTablesBodyEl.appendChild(tr);
    }

    // Update IPs table
    statusIPsBodyEl.innerHTML = '';
    if (data.ipsPerMinute && data.ipsPerMinute.length > 0) {
      data.ipsPerMinute.forEach(entry => {
        const tr = document.createElement('tr');
        const tdIp = document.createElement('td');
        tdIp.style.padding = '8px';
        tdIp.style.border = '1px solid #ddd';
        tdIp.textContent = entry.ip;
        const tdCount = document.createElement('td');
        tdCount.style.padding = '8px';
        tdCount.style.border = '1px solid #ddd';
        tdCount.style.textAlign = 'right';
        tdCount.textContent = entry.tpm;
        tr.appendChild(tdIp);
        tr.appendChild(tdCount);
        statusIPsBodyEl.appendChild(tr);
      });
    } else {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.style.padding = '8px';
      td.style.border = '1px solid #ddd';
      td.style.textAlign = 'center';
      td.style.color = '#999';
      td.textContent = 'No IP data in the last minute';
      tr.appendChild(td);
      statusIPsBodyEl.appendChild(tr);
    }

    statusMessageEl.textContent = 'Auto-refreshing every 5 seconds...';
    statusMessageEl.style.color = '#666';

  } catch (error) {
    console.error('Error loading status:', error);
    statusMessageEl.textContent = 'Error loading status. Please try again.';
    statusMessageEl.style.color = 'red';
  }
}

/**
 * Start polling the status endpoint every 5 seconds.
 */
function startStatusPolling() {
  // Load immediately, then poll
  loadStatus();
  if (!statusPollInterval) {
    statusPollInterval = setInterval(loadStatus, 5000);
  }
}

/**
 * Stop polling the status endpoint.
 */
function stopStatusPolling() {
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }
}

// Cancel record creation
function cancelRecord() {
  const selectedModel = document.getElementById('createModelSelect').value.trim();
  const formContainer = document.getElementById('createFormContainer');
  const placeholder = document.getElementById('createPlaceholder');
  const messageDiv = document.getElementById('recordMessage');

  // Reset form
  messageDiv.textContent = '';

  // Hide form and show placeholder
  formContainer.style.display = 'none';
  placeholder.style.display = 'block';
}

// Event listeners
loadSchemaBtn.addEventListener('click', loadSchema);
modelSelect.addEventListener('change', () => {
  if (modelSelect.value === '__other__') {
    modelSelect.style.display = 'none';
    modelInput.style.display = 'block';
    modelInput.focus();
  } else {
    loadSchema();
  }
});
modelInput.addEventListener('blur', () => {
  if (!modelInput.value.trim()) {
    modelInput.style.display = 'none';
    modelSelect.style.display = 'block';
    modelSelect.value = '';
  }
});
modelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadSchema();
  }
});
saveSchemaBtn.addEventListener('click', saveSchema);
deleteSchemaBtn.addEventListener('click', deleteSchema);
cancelBtn.addEventListener('click', cancel);
submitRecordBtn.addEventListener('click', submitRecord);
cancelRecordBtn.addEventListener('click', cancelRecord);
loadRecordsBtn.addEventListener('click', () => loadRecords(1));
viewModelSelect.addEventListener('change', () => {
  currentPage = 1;
  loadRecords(1);
});
document.getElementById('prevPageBtn').addEventListener('click', () => {
  if (currentPage > 1) {
    loadRecords(currentPage - 1);
  }
});
document.getElementById('nextPageBtn').addEventListener('click', () => {
  loadRecords(currentPage + 1);
});
document.getElementById('prevPageBtnTop').addEventListener('click', () => {
  if (currentPage > 1) {
    loadRecords(currentPage - 1);
  }
});
document.getElementById('nextPageBtnTop').addEventListener('click', () => {
  loadRecords(currentPage + 1);
});

// Initialize on page load
initAceEditor();
loadModels();

// Initialize trend chart
initTrendChart();

// Start status polling since Status tab is the default active tab
startStatusPolling();

// Load create form when model selection changes
const createModelSelect = document.getElementById('createModelSelect');
createModelSelect.addEventListener('change', loadCreateForm);
