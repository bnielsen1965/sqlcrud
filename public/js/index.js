const modelSelect = document.getElementById('modelSelect');
const loadSchemaBtn = document.getElementById('loadSchemaBtn');
const saveSchemaBtn = document.getElementById('saveSchemaBtn');
const deleteSchemaBtn = document.getElementById('deleteSchemaBtn');
const cancelBtn = document.getElementById('cancelBtn');

let aceEditor;

// ---- Auth helpers ----

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
  const token = btoa(`${creds.username}:${creds.password}`);
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
      const token = btoa(`${creds.username}:${creds.password}`);
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
    const token = btoa(`${creds.username}:${creds.password}`);
    options.headers = { ...options.headers, Authorization: `Basic ${token}` };
    return fetch(url, options);
  }

  return response;
}

// Tab switching function
function switchTab(tabName) {
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

// Fetch models from the database and populate autocomplete suggestions
async function loadModels() {
  try {
    const response = await authFetch('/api/models');
    const models = await response.json();

    document.getElementById('modelList').replaceChildren();
    document.getElementById('createModelList').replaceChildren();

    models.forEach(function(model) {
      const option = document.createElement('option');
      option.value = model.model;
      document.getElementById('modelList').appendChild(option);
      document.getElementById('createModelList').appendChild(option.cloneNode(true));
    });
  } catch (error) {
    console.error('Error loading models:', error);
    modelSelect.setAttribute('placeholder', 'Error loading models');
    document.getElementById('createModelSelect').setAttribute('placeholder', 'Error loading models');
  }
}

// Load schema for selected model
async function loadSchema() {
  const selectedModel = modelSelect.value.trim();

  if (!selectedModel) {
    aceEditor.setValue('Please enter or select a model name.', 1);
    return;
  }

  try {
    const response = await authFetch(`/api/schema/${selectedModel}`);

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
  const model = modelSelect.value.trim();
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
    const response = await authFetch(`/api/schema/${model}`, {
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
  const model = modelSelect.value.trim();
  const schema = aceEditor.getValue();

  if (!model) {
    alert('Please enter a model name.');
    return;
  }

  try {
    const response = await authFetch(`/api/schema/${model}`, {
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
    const response = await authFetch(`/api/schema/${selectedModel}`);

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
    const response = await authFetch(`/api/record/${selectedModel}`, {
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
modelSelect.addEventListener('change', loadSchema);
saveSchemaBtn.addEventListener('click', saveSchema);
deleteSchemaBtn.addEventListener('click', deleteSchema);
cancelBtn.addEventListener('click', cancel);
submitRecordBtn.addEventListener('click', submitRecord);
cancelRecordBtn.addEventListener('click', cancelRecord);

// Initialize on page load
initAceEditor();
loadModels();

// Load create form when model selection changes
const createModelSelect = document.getElementById('createModelSelect');
createModelSelect.addEventListener('change', loadCreateForm);
