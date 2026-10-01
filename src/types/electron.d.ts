import { ConnectionSettings, EngineeringSettings, OperationMode, SequenceConfig, SequencePreset, SequenceProgress, SetpointValues, TelemetryPoint, TestSession } from './scada';

export interface CommandResult {
  success: boolean;
  error?: string;
}

export interface ElectronAPI {
  serial: {
    getPorts: () => Promise<{ path: string; manufacturer?: string }[]>;
  };
  modbus: {
    connect: (config: ConnectionSettings) => Promise<CommandResult | boolean>;
    disconnect: () => Promise<CommandResult | boolean>;
    setMode: (mode: OperationMode) => Promise<CommandResult | boolean>;
    writeSetpoints: (setpoints: Partial<SetpointValues>) => Promise<CommandResult | boolean>;
    writeEngSettings: (engSettings: EngineeringSettings) => Promise<CommandResult | boolean>;
    setOutput: (state: boolean) => Promise<CommandResult | boolean>;
    resetBatTest: () => Promise<CommandResult | boolean>;
    triggerSimAlarm: (type: 'power' | 'volt') => Promise<CommandResult | boolean>;
    clearAlarmCoil: (coilIndex: number) => Promise<CommandResult | boolean>;
    diagReadRegister: (params: { type: 'FLOAT' | 'COIL' | 'INT'; address: number }) => Promise<{ success: boolean; value?: number | boolean; error?: string }>;
    diagWriteRegister: (params: { type: 'FLOAT' | 'COIL' | 'INT'; address: number; value: number | boolean }) => Promise<{ success: boolean; error?: string }>;
    diagReadAllRegisters: () => Promise<{ success: boolean; registers?: Record<string, { value: number | boolean; formatted: string }>; error?: string }>;
    onTelemetry: (callback: (data: TelemetryPoint) => void) => () => void;
    onStatusChange: (callback: (status: 'CONNECTED' | 'DISCONNECTED' | 'SIMULATOR') => void) => () => void;
  };
  sequence: {
    start: (config: SequenceConfig) => Promise<CommandResult>;
    pause: () => Promise<CommandResult>;
    resume: () => Promise<CommandResult>;
    stop: () => Promise<CommandResult>;
    getProgress: () => Promise<SequenceProgress>;
    onProgress: (callback: (progress: SequenceProgress) => void) => () => void;
  };
  db: {
    getSessions: () => Promise<TestSession[]>;
    saveSession: (session: TestSession) => Promise<boolean>;
    deleteSession: (id: string) => Promise<boolean>;
    getPresets: () => Promise<SequencePreset[]>;
    savePreset: (preset: SequencePreset) => Promise<boolean>;
    deletePreset: (id: string) => Promise<boolean>;
  };
  pdf: {
    savePdf: (filename: string, pdfBufferBase64: string) => Promise<{ success: boolean; filePath?: string }>;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
