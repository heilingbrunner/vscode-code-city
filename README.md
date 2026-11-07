# Code City

VS Code extension that renders the open folder as a 3D city.

- **Folder → district** (nested plots, squarified treemap by LOC)
- **File → building** (height = lines of code; linear / sqrt / log scale)
- Color by LOC or by file extension; hover for path + lines; click to open the file.

## Develop
    npm install
    npm test          # layout unit tests
    npm run build     # bundles dist/extension.js + dist/webview.js
Press F5 (Run Extension), open a folder in the dev host, run **Code City: Show**.

## Settings
`codeCity.exclude`, `codeCity.heightScale`, `codeCity.maxFileSizeKB`.
