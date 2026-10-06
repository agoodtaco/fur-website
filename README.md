# Fursuit Base Studio — VS Code source

This is the saved website source, exported without changing the application.

## Run in VS Code

1. Extract this ZIP and open the fursuit-base-studio folder in VS Code.
2. Install the VS Code Live Server extension.
3. Right-click dist/index.html and choose Open with Live Server.

Alternatively, with Python 3 installed, run from this folder:

```sh
python -m http.server 5500 --directory dist
```

Open http://localhost:5500 in your browser. On macOS/Linux you may need python3 instead of python.

No npm install or build step is required. Internet access is required for the Three.js CDN imports.

## Editing

All application code is in dist/index.html:
- CSS is inside the style element.
- Page markup is inside body.
- JavaScript is inside the module script.

## Current implementation limits

This is a starter interface with model loading, 3D preview, display controls, and rough estimates. Mesh repair, uniform shelling, boolean cutting, reliable print validation, and STL export are not implemented. The validation button indicates the missing geometry worker.

The saved version still contains gradients and does not include the subsequently requested email/password and two-factor authentication changes. Hosted ChatGPT access controls are not part of these static files.

Source revision: 554150fc7dfbf1b3ea11d14f6a2e3572d67fc11f
