export type OperationMode = 'CV' | 'CC' | 'CR' | 'CP' | 'BAT TEST';
export type DeviceType = 'POWER_SUPPLY' | 'ELECTRONIC_LOAD';

export type ProfileValidationStatus =
  | 'SOFTWARE_BUILD_SUCCESS'
  | 'SIMULATOR_TESTED'
  | 'REGISTER_MAP_DOCUMENTATION_VERIFIED'
  | 'HARDWARE_VALIDATION_PENDING'
  | 'HARDWARE_VALIDATED';

export interface DeviceProfile {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  deviceType: DeviceType;
  validationStatus: ProfileValidationStatus;
  firmwareVersion?: string;
  outputControlFc: 5 | 6; // FC05 (Coil) or FC06 (Holding Reg)
  watchdogSupported: boolean;
  watchdogRegisterAddress?: number | null;
  watchdogDefaultTimeoutMs?: number;
  voltageScale: number; // e.g. 100 for 0.01V
  currentScale: number; // e.g. 100 for 0.01A
  registers: RegisterOffsets;
  notes: string;
}

export interface SetpointValues {
  cv: number;        // V (Constant Voltage)
  iset: number;      // A (Current limit / target)
  imax: number;      // A/V upper limit
  rset: number;      // Ω (Constant Resistance)
  pset: number;      // W (Constant Power)
  cutoffV: number;   // V (Cutoff Voltage for Bat Test)
  dischgI: number;   // A (Discharge Current for Bat Test)
  batTestSubMode: 'CC' | 'CR'; // Sub-mode for Battery Test: CC or CR
}

export interface TelemetryPoint {
  timestamp: string;  // HH:mm:ss format or ISO
  timeSeconds: number;
  vmon: number;       // Volts
  imon: number;       // Amperes
  pmon: number;       // Watts (V * I)
  capacityAh?: number; // Ah (for BAT TEST)
  isStale?: boolean;   // True if telemetry is unconfirmed or comm error
  crcError?: boolean;
}

export interface EngineeringSettings {
  vmax: number; // Maximum Voltage Safety Limit (V)
  imax: number; // Maximum Current Safety Limit (A)
  pmax: number; // Maximum Power Safety Limit (W)
  rmax: number; // Maximum Resistance Safety Limit (Ω)
}

export interface ConnectionSettings {
  port: string;
  baudRate: number;
  dataBits: number;
  parity: 'none' | 'even' | 'odd';
  stopBits: number;
  slaveId: number;
  pollingIntervalMs: number;
  isSimulator: boolean;
  selectedProfileId: string;
  registers: RegisterOffsets;
}

export interface RegisterOffsets {
  mode: number;      // 0x0000
  vset: number;      // 0x0002
  iset: number;      // 0x0004
  rset: number;      // 0x0006
  pset: number;      // 0x0008
  imax: number;      // 0x000A
  cutoffV: number;   // 0x000C
  vmaxLimit: number; // 0x0014
  imaxLimit: number; // 0x0016
  pmaxLimit: number; // 0x0018
  rmaxLimit: number; // 0x001A
  vmon: number;      // 0x0010
  imon: number;      // 0x0012
  outputCoil: number;// 0x0000
}

export interface TestSession {
  id: string;
  mode: OperationMode;
  startTime: string;
  endTime?: string;
  durationSeconds: number;
  setpointV: number;
  setpointI: number;
  setpointR?: number;
  setpointP?: number;
  cutoffV?: number;
  maxVoltage: number;
  minVoltage: number;
  maxCurrent: number;
  avgCurrent: number;
  avgPower: number;
  capacityAh?: number;
  status: 'COMPLETED' | 'STOPPED' | 'SAFETY_CUTOFF' | 'COMMUNICATION_FAULT';
  logs: TelemetryPoint[];
  deviceProfileName?: string;
  serialSettingsInfo?: string;
  commGapsCount?: number;
  cutoffDetectTime?: string;
  offRequestTime?: string;
  shutdownConfirmTime?: string;
}

export interface SystemState {
  outputState: boolean;       // ON / OFF
  outputConfirmedState: 'ON' | 'OFF' | 'UNKNOWN';
  currentMode: OperationMode;
  isLogging: boolean;
  activeSessionId: string | null;
  connectionStatus: 'CONNECTED' | 'DISCONNECTED' | 'SIMULATOR';
  activeProfile: DeviceProfile;
  alarmMessage?: string | null;
}

// Built-in Supported Profiles
export const BUILTIN_PROFILES: DeviceProfile[] = [
  {
    id: 'SIMULATOR_PROFILE',
    name: 'JOMA SCADA Simulator Mode (Virtual Bench)',
    manufacturer: 'JOMA SCADA Simulator',
    model: 'Virtual Power & Load Simulator v1.0',
    deviceType: 'POWER_SUPPLY',
    validationStatus: 'SIMULATOR_TESTED',
    firmwareVersion: 'v1.0.0-SIM',
    outputControlFc: 5,
    watchdogSupported: true,
    watchdogRegisterAddress: 0x030A,
    watchdogDefaultTimeoutMs: 1000,
    voltageScale: 100,
    currentScale: 100,
    registers: {
      mode: 0x0000,
      vset: 0x0002,
      iset: 0x0004,
      rset: 0x0006,
      pset: 0x0008,
      imax: 0x000A,
      cutoffV: 0x000C,
      vmaxLimit: 0x0014,
      imaxLimit: 0x0016,
      pmaxLimit: 0x0018,
      rmaxLimit: 0x001A,
      vmon: 0x0010,
      imon: 0x0012,
      outputCoil: 0x0000
    },
    notes: 'Safe offline software simulation engine for UI development and workflow testing.'
  },
  {
    id: 'JOMA_NG_POWER_DEFAULT',
    name: 'JOMA Next Gen DC Controller — Hardware Validation Pending',
    manufacturer: 'JOMA Power Systems',
    model: 'JOMA Next Gen Power Series',
    deviceType: 'POWER_SUPPLY',
    validationStatus: 'HARDWARE_VALIDATION_PENDING',
    firmwareVersion: 'Unverified',
    outputControlFc: 5,
    watchdogSupported: true,
    watchdogRegisterAddress: 0x030A,
    watchdogDefaultTimeoutMs: 1000,
    voltageScale: 100,
    currentScale: 100,
    registers: {
      mode: 0x0000,
      vset: 0x0002,
      iset: 0x0004,
      rset: 0x0006,
      pset: 0x0008,
      imax: 0x000A,
      cutoffV: 0x000C,
      vmaxLimit: 0x0014,
      imaxLimit: 0x0016,
      pmaxLimit: 0x0018,
      rmaxLimit: 0x001A,
      vmon: 0x0010,
      imon: 0x0012,
      outputCoil: 0x0000
    },
    notes: 'Physical hardware has not been tested. Output control is disabled until the exact hardware model, firmware, register map, communication and safety behaviour have been verified.'
  },
  {
    id: 'CUSTOM_UNVALIDATED',
    name: 'Custom Generic Device Profile — Hardware Validation Pending',
    manufacturer: 'Custom / Generic RS485 Instrument',
    model: 'Unverified RS485 Modbus Unit',
    deviceType: 'POWER_SUPPLY',
    validationStatus: 'HARDWARE_VALIDATION_PENDING',
    firmwareVersion: 'Unknown',
    outputControlFc: 5,
    watchdogSupported: false,
    watchdogRegisterAddress: null,
    voltageScale: 100,
    currentScale: 100,
    registers: {
      mode: 0x0000,
      vset: 0x0002,
      iset: 0x0004,
      rset: 0x0006,
      pset: 0x0008,
      imax: 0x000A,
      cutoffV: 0x000C,
      vmaxLimit: 0x0014,
      imaxLimit: 0x0016,
      pmaxLimit: 0x0018,
      rmaxLimit: 0x001A,
      vmon: 0x0010,
      imon: 0x0012,
      outputCoil: 0x0000
    },
    notes: 'Physical hardware has not been tested. Output control is disabled until verified.'
  }
];
