import { contextBridge, ipcRenderer } from 'electron';
import { ConnectionSettings, OperationMode, SetpointValues, TestSession } from '../src/types/scada';

contextBridge.exposeInMainWorld('electronAPI', {
  serial: {
    getPorts: () => ipcRenderer.invoke('serial:getPorts')
  },
  modbus: {
    connect: (config: ConnectionSettings) => ipcRenderer.invoke('modbus:connect', config),
    disconnect: () => ipcRenderer.invoke('modbus:disconnect'),
    setMode: (mode: OperationMode) => ipcRenderer.invoke('modbus:setMode', mode),
    writeSetpoints: (setpoints: Partial<SetpointValues>) => ipcRenderer.invoke('modbus:writeSetpoints', setpoints),
    writeEngSettings: (engSettings: any) => ipcRenderer.invoke('modbus:writeEngSettings', engSettings),
    setOutput: (state: boolean) => ipcRenderer.invoke('modbus:setOutput', state),
    onTelemetry: (callback: (data: any) => void) => {
      const listener = (_: any, value: any) => callback(value);
      ipcRenderer.on('modbus:telemetry', listener);
      return () => ipcRenderer.removeListener('modbus:telemetry', listener);
    },
    onStatusChange: (callback: (status: string) => void) => {
      const listener = (_: any, value: string) => callback(value);
      ipcRenderer.on('modbus:statusChange', listener);
      return () => ipcRenderer.removeListener('modbus:statusChange', listener);
    }
  },
  db: {
    getSessions: () => ipcRenderer.invoke('db:getSessions'),
    saveSession: (session: TestSession) => ipcRenderer.invoke('db:saveSession', session),
    deleteSession: (id: string) => ipcRenderer.invoke('db:deleteSession', id)
  },
  pdf: {
    savePdf: (filename: string, pdfBase64: string) => ipcRenderer.invoke('pdf:savePdf', { filename, pdfBase64 })
  }
});
