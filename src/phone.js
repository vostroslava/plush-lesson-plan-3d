import './phone.css';

const query = new URLSearchParams(window.location.search);
const captureMode = query.get('screen') === '1';
if (captureMode) document.body.classList.add('capture-mode');

const defaults = {
  topic: 'Photosynthesis in plants',
  grade: '7th grade',
  time: '45 minutes',
};

const screenFields = {
  topic: document.querySelector('[data-screen-field="topic"]'),
  grade: document.querySelector('[data-screen-field="grade"]'),
  time: document.querySelector('[data-screen-field="time"]'),
};
const editFields = {
  topic: document.querySelector('#edit-topic'),
  grade: document.querySelector('#edit-grade'),
  time: document.querySelector('#edit-time'),
};
const status = document.querySelector('#phone-status');
const generateButton = document.querySelector('#screen-generate');
const inspectorGenerate = document.querySelector('#generate-screen');
const renderedPreview = document.querySelector('#rendered-preview');
const renderedPreviewLink = document.querySelector('#rendered-preview-link');

function syncRenderedPreviewLink() {
  if (renderedPreviewLink && renderedPreview) {
    renderedPreviewLink.href = renderedPreview.currentSrc || renderedPreview.src;
  }
}

syncRenderedPreviewLink();
renderedPreview?.addEventListener('loadedmetadata', syncRenderedPreviewLink);

function setStatus(message) {
  if (status) status.textContent = message;
}

function setField(key, value) {
  const nextValue = String(value ?? '').trim() || defaults[key];
  if (screenFields[key]) screenFields[key].value = nextValue;
  if (editFields[key]) editFields[key].value = nextValue;
}

function syncScreenFromInspector() {
  for (const key of Object.keys(defaults)) setField(key, editFields[key]?.value);
}

function resetScreen() {
  for (const [key, value] of Object.entries(defaults)) setField(key, value);
  setStatus('Screen source ready · local DOM');
}

function showGeneratedState() {
  syncScreenFromInspector();
  generateButton?.classList.add('is-generated');
  if (generateButton) generateButton.textContent = 'Plan ready ✓';
  setStatus('Interaction preview · plan ready');
  window.setTimeout(() => {
    generateButton?.classList.remove('is-generated');
    if (generateButton) generateButton.textContent = 'Generate plan';
  }, 1300);
}

for (const key of Object.keys(defaults)) {
  editFields[key]?.addEventListener('input', () => setField(key, editFields[key].value));
  screenFields[key]?.addEventListener('input', () => setField(key, screenFields[key].value));
}

document.querySelector('#reset-screen')?.addEventListener('click', resetScreen);
inspectorGenerate?.addEventListener('click', showGeneratedState);
generateButton?.addEventListener('click', showGeneratedState);

window.phoneMock = {
  fields: screenFields,
  setCopy(values = {}) {
    for (const key of Object.keys(defaults)) if (key in values) setField(key, values[key]);
  },
  reset: resetScreen,
  generate: showGeneratedState,
};

if (!captureMode) {
  resetScreen();
} else {
  resetScreen();
  for (const key of Object.keys(defaults)) {
    if (query.has(key)) setField(key, query.get(key));
  }
  document.documentElement.dataset.captureReady = 'true';
}
