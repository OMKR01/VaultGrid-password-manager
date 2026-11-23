const { app: electronApp, BrowserWindow } = require('electron');
const path = require('path');

// Point the server at a per-user, writable data folder BEFORE requiring
// server.js (server.js reads this env var once, at module load time).
// On Windows this resolves to something like:
//   C:\Users\<you>\AppData\Roaming\VaultGrid\data\vault.json
process.env.VAULTGRID_DATA_DIR = path.join(electronApp.getPath('userData'), 'data');

const { start } = require('./server');

const PORT = 4300;
let mainWindow;
let server;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#e6e9ef', // matches the app's own background to avoid a white flash on load
    title: 'VaultGrid',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false); // skip the default File/Edit/View menu for a cleaner app feel
  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on('closed', () => { mainWindow = null; });
}

electronApp.whenReady().then(() => {
  server = start(PORT);
  createWindow();

  electronApp.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

electronApp.on('window-all-closed', () => {
  if (server) server.close();
  electronApp.quit(); // this is a single-window utility app, so quit fully even on macOS
});
