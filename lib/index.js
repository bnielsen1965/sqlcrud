// DOM elements
const modelSelect = document.getElementById('modelSelect');
const schemaOutput = document.getElementById('schemaOutput');
const loadSchemaBtn = document.getElementById('loadSchemaBtn');
const modelName = document.getElementById('modelName');
const schemaEditor = document.getElementById('schemaEditor');
const saveSchemaBtn = document.getElementById('saveSchemaBtn');
const cancelBtn = document.getElementById('cancelBtn');

let aceEditor;

// Initialize ACE editor
function initAceEditor() {
  aceEditor = ace.edit('schemaEditor');
  aceEditor.setTheme('ace/theme/chrome');
  aceEditor.session.setMode('ace/mode/json');
  aceEditor.setValue('{}', 1);
}

// Switch between tabs
function switchTab(tab) {
  // Update tab buttons
  const buttons = document.querySelectorAll('.tab-button');
  buttons.forEach(function(btn) {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');

  // Update tab content
  const contents = document.querySelectorAll('.tab-content');
  contents.forEach(function(content) {
    content.classList.remove('active');
  });
  document.getElementById(tab).classList.add('active');
}

// Fetch models from the database and populate dropdown
async function loadModels() {
  try {
    const response = await fetch('/api/models');
    const models = await response.json();

    models.forEach(function(model) {
      const option = document.createElement('option');
      option.value = model.model;
      option.textContent = model.model;
      modelSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading models:', error);
    modelSelect.innerHTML = '<option value="">Error loading models</option>';
  }
}

// Load schema for selected model
async function loadSchema() {
  const selectedModel = modelSelect.value;

  if (!selectedModel) {
    schemaOutput.value = 'Please select a model first.';
    return;
  }

  try {
    const response = await fetch(`/api/models/${selectedModel}`);
    const schema = await response.json();

    // Format JSON with indentation
    schemaOutput.value = JSON.stringify(schema, null, 2);
  } catch (error) {
    console.error('Error loading schema:', error);
    schemaOutput.value = 'Error loading schema.';
  }
}

// Save schema to database
async function saveSchema() {
  const model = modelName.value.trim();
  const schema = aceEditor.getValue();

  if (!model) {
    alert('Please enter a model name.');
    return;
  }

  if (!schema.trim()) {
    alert('Please enter a schema.');
    return;
  }

  try {
    const response = await fetch(`/api/models/${model}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: schema
    });

    const result = await response.json();

    if (response.ok) {
      alert('Schema saved successfully!');
      modelName.value = '';
      aceEditor.setValue('{}', 1);
    } else {
      alert('Error saving schema: ' + result.error);
    }
  } catch (error) {
    console.error('Error saving schema:', error);
    alert('Error saving schema.');
  }
}

// Event listeners
loadSchemaBtn.addEventListener('click', loadSchema);
modelSelect.addEventListener('change', loadSchema);
saveSchemaBtn.addEventListener('click', saveSchema);
cancelBtn.addEventListener('click', () => {
  modelName.value = '';
  aceEditor.setValue('{}', 1);
});

// Initialize on page load
initAceEditor();
loadModels();
