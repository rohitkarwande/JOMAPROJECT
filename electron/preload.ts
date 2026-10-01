import { contextBridge, ipcRenderer } from 'electron';
import { ConnectionSettings, OperationMode, SequenceConfig, SequencePreset, SetpointValues, TestSession } from '../src/types/scada';

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
    resetBatTest: () => ipcRenderer.invoke('modbus:resetBatTest'),
    triggerSimAlarm: (type: 'power' | 'volt') => ipcRenderer.invoke('modbus:triggerSimAlarm', type),
    clearAlarmCoil: (coilIndex: number) => ipcRenderer.invoke('modbus:clearAlarmCoil', coilIndex),
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
  sequence: {
    start: (config: SequenceConfig) => ipcRenderer.invoke('sequence:start', config),
    pause: () => ipcRenderer.invoke('sequence:pause'),
    resume: () => ipcRenderer.invoke('sequence:resume'),
    stop: () => ipcRenderer.invoke('sequence:stop'),
    getProgress: () => ipcRenderer.invoke('sequence:getProgress'),
    onProgress: (callback: (progress: any) => void) => {
      const listener = (_: any, value: any) => callback(value);
      ipcRenderer.on('sequence:progress', listener);
      return () => ipcRenderer.removeListener('sequence:progress', listener);
    }
  },
  db: {
    getSessions: () => ipcRenderer.invoke('db:getSessions'),
    saveSession: (session: TestSession) => ipcRenderer.invoke('db:saveSession', session),
    deleteSession: (id: string) => ipcRenderer.invoke('db:deleteSession', id),
    getPresets: () => ipcRenderer.invoke('db:getPresets'),
    savePreset: (preset: SequencePreset) => ipcRenderer.invoke('db:savePreset', preset),
    deletePreset: (id: string) => ipcRenderer.invoke('db:deletePreset', id)
  },
  pdf: {
    savePdf: (filename: string, pdfBase64: string) => ipcRenderer.invoke('pdf:savePdf', { filename, pdfBase64 })
  }
});
