import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { ModbusRtuService } from './modbusRtuService';
import { DatabaseService } from './databaseService';

// Prevent Chromium GPU cache file-locking warnings on Windows
app.commandLine.appendSwitch('disable-gpu-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

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
    title: 'Joma Next Gen Power',
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
        title: 'Active Test Running - JOMA Power',
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

  modbusService.setSequenceCallback((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sequence:progress', progress);
    }
  });

  // No auto-connection on startup: starts in clean DISCONNECTED state until user clicks Connect
});

app.on('window-all-closed', () => {
  modbusService.stopPolling();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('serial:getPorts', async () => {
  const portsList: { path: string; manufacturer: string }[] = [];
  const addedPaths = new Set<string>();

  // Strategy 1: Use node 'serialport' package (native device enumeration)
  try {
    const { SerialPort } = require('serialport');
    const systemPorts = await SerialPort.list();
    if (Array.isArray(systemPorts)) {
      systemPorts.forEach((p: any) => {
        if (p && p.path) {
          const pathUpper = p.path.toUpperCase();
          if (!addedPaths.has(pathUpper)) {
            const mfr = p.friendlyName || (p.manufacturer ? `${p.manufacturer} (${p.path})` : `Serial Port (${p.path})`);
            portsList.push({ path: p.path, manufacturer: mfr });
            addedPaths.add(pathUpper);
          }
        }
      });
    }
  } catch (err) {
    console.warn('SerialPort.list() query error:', err);
  }

  // Strategy 2: PowerShell GetPortNames for Windows OS registry enumeration
  if (process.platform === 'win32') {
    try {
      const output = require('child_process')
        .execSync('powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames()"')
        .toString();

      const lines = output.split(/\r?\n/).map((s: string) => s.trim()).filter((s: string) => s.length > 0);
      lines.forEach((portName: string) => {
        const pathUpper = portName.toUpperCase();
        if (!addedPaths.has(pathUpper)) {
          portsList.push({
            path: portName,
            manufacturer: `Hardware COM Port (${portName})`
          });
          addedPaths.add(pathUpper);
        }
      });
    } catch (err) {
      console.warn('PowerShell GetPortNames error:', err);
    }
  }

  // Prioritize USB / Hardware adapters (e.g. CH340, FTDI) over virtual Bluetooth ports
  portsList.sort((a, b) => {
    const isUsbA = /USB|CH340|FTDI|CP210|Silicon/i.test(a.manufacturer);
    const isUsbB = /USB|CH340|FTDI|CP210|Silicon/i.test(b.manufacturer);
    if (isUsbA && !isUsbB) return -1;
    if (!isUsbA && isUsbB) return 1;
    return a.path.localeCompare(b.path);
  });

  return portsList;
});

ipcMain.handle('modbus:connect', async (_, config) => {
  return modbusService.updateSettings(config);
});

ipcMain.handle('modbus:disconnect', async () => {
  await modbusService.disconnectHardware();
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

ipcMain.handle('modbus:resetBatTest', async () => {
  return modbusService.resetBatTest();
});

ipcMain.handle('modbus:triggerSimAlarm', async (_, type) => {
  modbusService.triggerSimAlarm(type);
  return true;
});

ipcMain.handle('modbus:clearAlarmCoil', async (_, coilIndex) => {
  return modbusService.clearAlarmCoil(coilIndex);
});

ipcMain.handle('modbus:diagReadRegister', async (_, params) => {
  return modbusService.diagReadRegister(params);
});

ipcMain.handle('modbus:diagWriteRegister', async (_, params) => {
  return modbusService.diagWriteRegister(params);
});

ipcMain.handle('modbus:diagReadAllRegisters', async () => {
  return modbusService.diagReadAllRegisters();
});

// Automated Test Sequence IPC Handlers
ipcMain.handle('sequence:start', async (_, config) => {
  return modbusService.startSequence(config);
});

ipcMain.handle('sequence:pause', async () => {
  return modbusService.pauseSequence();
});

ipcMain.handle('sequence:resume', async () => {
  return modbusService.resumeSequence();
});

ipcMain.handle('sequence:stop', async () => {
  return modbusService.stopSequence('STOPPED');
});

ipcMain.handle('sequence:getProgress', async () => {
  return modbusService.getSequenceProgress();
});

// Database Sessions & Presets IPC Handlers
ipcMain.handle('db:getSessions', async () => {
  return dbService.getSessions();
});

ipcMain.handle('db:saveSession', async (_, session) => {
  return dbService.saveSession(session);
});

ipcMain.handle('db:deleteSession', async (_, id) => {
  return dbService.deleteSession(id);
});

ipcMain.handle('db:getPresets', async () => {
  return dbService.getPresets();
});

ipcMain.handle('db:savePreset', async (_, preset) => {
  return dbService.savePreset(preset);
});

ipcMain.handle('db:deletePreset', async (_, id) => {
  return dbService.deletePreset(id);
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
