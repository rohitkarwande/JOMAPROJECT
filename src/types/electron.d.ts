import { ConnectionSettings, EngineeringSettings, OperationMode, SetpointValues, TelemetryPoint, TestSession } from './scada';

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
    onTelemetry: (callback: (data: TelemetryPoint) => void) => () => void;
    onStatusChange: (callback: (status: 'CONNECTED' | 'DISCONNECTED' | 'SIMULATOR') => void) => () => void;
  };
  db: {
    getSessions: () => Promise<TestSession[]>;
    saveSession: (session: TestSession) => Promise<boolean>;
    deleteSession: (id: string) => Promise<boolean>;
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
