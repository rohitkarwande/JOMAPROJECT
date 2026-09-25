import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { ModbusRtuService } from './modbusRtuService';
import { DatabaseService } from './databaseService';

let mainWindow: BrowserWindow | null = null;
const modbusService = new ModbusRtuService();
const dbService = new DatabaseService();

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'JOMA Next Gen Power - SCADA Control Center',
    autoHideMenuBar: true,
    backgroundColor: '#f1f5f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const appPath = app.getAppPath();
    const pathsToTry = [
      path.join(appPath, 'dist/index.html'),
      path.join(__dirname, '../dist/index.html'),
      path.join(__dirname, '../../dist/index.html')
    ];

    let loaded = false;
    for (const p of pathsToTry) {
      if (fs.existsSync(p)) {
        mainWindow.loadFile(p);
        loaded = true;
        break;
      }
    }

    if (!loaded) {
      mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    }
  }

  let isQuitting = false;

  mainWindow.on('close', (e) => {
    if (!isQuitting && modbusService.getOutputState()) {
      e.preventDefault();

      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'warning',
        buttons: ['Keep Running (Cancel)', 'Stop Test & Close Application'],
        defaultId: 0,
        cancelId: 0,
        title: 'Active Test Running - JOMA SCADA',
        message: 'An active hardware test session is currently running!',
        detail: 'Closing the application will automatically disable hardware output. Are you sure you want to stop the test and close?'
      });

      if (choice === 1) {
        isQuitting = true;
        modbusService.setOutput(false);
        if (mainWindow) {
          mainWindow.destroy();
        }
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // Setup Modbus telemetry listener
  modbusService.setTelemetryCallback((point) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('modbus:telemetry', point);
    }
  });

  modbusService.setStatusCallback((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('modbus:statusChange', status);
    }
  });

  modbusService.startPolling();
});

app.on('window-all-closed', () => {
  modbusService.stopPolling();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('serial:getPorts', async () => {
  return [
    { path: 'COM1', manufacturer: 'System Serial Port' },
    { path: 'COM3', manufacturer: 'FTDI USB-to-RS485 Converter' },
    { path: 'COM4', manufacturer: 'CH340 USB-Serial' },
    { path: '/dev/ttyUSB0', manufacturer: 'Linux RS485 USB Adapter' }
  ];
});

ipcMain.handle('modbus:connect', async (_, config) => {
  modbusService.updateSettings(config);
  return true;
});

ipcMain.handle('modbus:disconnect', async () => {
  modbusService.updateSettings({ isSimulator: true });
  return true;
});

ipcMain.handle('modbus:setMode', async (_, mode) => {
  return modbusService.setMode(mode);
});

ipcMain.handle('modbus:writeSetpoints', async (_, setpoints) => {
  return modbusService.writeSetpoints(setpoints);
});

ipcMain.handle('modbus:writeEngSettings', async (_, engSettings) => {
  return modbusService.writeEngSettings(engSettings);
});

ipcMain.handle('modbus:setOutput', async (_, state) => {
  return modbusService.setOutput(state);
});

ipcMain.handle('db:getSessions', async () => {
  return dbService.getSessions();
});

ipcMain.handle('db:saveSession', async (_, session) => {
  return dbService.saveSession(session);
});

ipcMain.handle('db:deleteSession', async (_, id) => {
  return dbService.deleteSession(id);
});

ipcMain.handle('pdf:savePdf', async (_, { filename, pdfBase64 }) => {
  try {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export PDF Report',
      defaultPath: filename || `JOMA_SCADA_Report_${Date.now()}.pdf`,
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
    });

    if (filePath) {
      const buffer = Buffer.from(pdfBase64, 'base64');
      fs.writeFileSync(filePath, buffer);
      return { success: true, filePath };
    }
    return { success: false };
  } catch (err: any) {
    console.error('PDF save error:', err);
    return { success: false, error: err.message };
  }
});
