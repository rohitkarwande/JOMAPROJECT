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
  ah?: number;        // Ah capacity setpoint/value
  hrs?: number;       // Hours setpoint/value
  min?: number;       // Minutes setpoint/value
}

export interface TelemetryPoint {
  timestamp: string;  // HH:mm:ss format or ISO
  timeSeconds: number;
  vmon: number;       // Volts
  imon: number;       // Amperes
  pmon: number;       // Watts (V * I)
  isOutputOn?: boolean;
  capacityAh?: number; // Ah (for BAT TEST)
  hrs?: number;        // Elapsed/Modbus Hours
  min?: number;        // Elapsed/Modbus Minutes
  isStale?: boolean;   // True if telemetry is unconfirmed or comm error
  crcError?: boolean;
  activeSetpoint?: string; // Exact setpoint active at this timestamp
  setpointValue?: number;  // Active numeric setpoint for Red line graph plotting
  popPowerExceed?: boolean; // Popup alarm 0X3
  popVoltExceed?: boolean;  // Popup alarm 0X4
  hardwareMode?: OperationMode; // Active Mode read from HMI (4X 29)
}

export interface EngineeringSettings {
  vmax: number; // Maximum Voltage Safety Limit (V)
  imax: number; // Maximum Current Safety Limit (A)
  pmax: number; // Maximum Power Safety Limit (W)
  rmax: number; // Maximum Resistance Safety Limit (Ω)
  logIntervalMinutes?: number; // Data Logging Interval (minutes)
  logIntervalSeconds: number;  // Data Logging Interval (seconds)
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
  customVoltageScale?: number;
  customCurrentScale?: number;
  customOutputControlFc?: 5 | 6;
}

export interface RegisterOffsets {
  mode: number;               // 4X 29 (Offset 28) INT (6=CV, 7=CC, 8=CR, 9=CP, 14=BAT TEST)
  vset: number;               // 4X 5 (Offset 4) FLOAT
  vmaxLimit: number;          // 4X 7 (Offset 6) FLOAT
  imaxLimit: number;          // 4X 9 (Offset 8) FLOAT
  pmaxLimit: number;          // 4X 11 (Offset 10) FLOAT
  rmaxLimit?: number;         // 4X 30 (Offset 29) FLOAT
  iset: number;               // 4X 13 (Offset 12) FLOAT
  isetRow?: number;           // 4X 15 (Offset 14) FLOAT
  rset: number;               // 4X 17 (Offset 16) FLOAT
  pset: number;               // 4X 19 (Offset 18) FLOAT
  cutoffV: number;            // 4X 21 (Offset 20) FLOAT
  hrs?: number;               // 4X 23 (Offset 22) FLOAT
  min?: number;               // 4X 25 (Offset 24) FLOAT
  ah?: number;                // 4X 27 (Offset 26) FLOAT
  vmon: number;               // 4X 1 (Offset 0) FLOAT
  imon: number;               // 4X 3 (Offset 2) FLOAT
  outputCoil: number;         // 0X 1 (Coil 0) Bit
  batSubModeCoil?: number;    // 0X 2 (Coil 1) Bit
  popPowerExceedCoil?: number;// 0X 3 (Coil 2) Bit
  popVoltExceedCoil?: number; // 0X 4 (Coil 3) Bit
  imax?: number;              // Legacy fallback
}

export type SequenceStepMode = 'CV' | 'CC' | 'CR' | 'CP';

export interface SequenceStep {
  id: string;
  stepNumber: number;
  durationHours: number;
  durationMinutes: number;
  durationSeconds: number;
  totalDurationSeconds: number;
  mode: SequenceStepMode;
  setpointV?: number;
  setpointI?: number;
  setpointR?: number;
  setpointP?: number;
}

export interface SequenceConfig {
  id: string;
  name: string;
  mode?: SequenceStepMode;
  cycles: number;
  steps: SequenceStep[];
  totalProgrammedDurationSeconds: number;
}

export interface SequencePreset {
  id: string;
  name: string;
  config: SequenceConfig;
  createdAt: string;
}

export type SequenceState = 
  | 'IDLE'
  | 'VALIDATING'
  | 'STARTING'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPING'
  | 'COMPLETED'
  | 'ABORTED'
  | 'FAULT';

export interface SequenceProgress {
  state: SequenceState;
  testName: string;
  currentCycle: number;
  totalCycles: number;
  currentStepIndex: number;
  totalSteps: number;
  currentStep?: SequenceStep;
  currentMode: SequenceStepMode;
  currentSetpoints: {
    v?: number;
    i?: number;
    r?: number;
    p?: number;
  };
  stepDurationSeconds: number;
  stepRemainingSeconds: number;
  totalElapsedSeconds: number;
  totalProgrammedDurationSeconds: number;
  overallProgressPercent: number;
  errorMessage?: string;
  sequenceStepsConfig?: SequenceStep[];
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
  status: 'COMPLETED' | 'STOPPED' | 'SAFETY_CUTOFF' | 'COMMUNICATION_FAULT' | 'ABORTED';
  logs: TelemetryPoint[];
  deviceProfileName?: string;
  serialSettingsInfo?: string;
  commGapsCount?: number;
  cutoffDetectTime?: string;
  offRequestTime?: string;
  shutdownConfirmTime?: string;
  isSequenceTest?: boolean;
  sequenceName?: string;
  sequenceCycles?: number;
  sequenceStepsConfig?: SequenceStep[];
  completedCycles?: number;
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

// Default Client CSV Register Map Configuration
export const CLIENT_CSV_REGISTERS: RegisterOffsets = {
  vmon: 0,                // 4X 1 (Offset 0, FLOAT, 2 Regs)
  imon: 2,                // 4X 3 (Offset 2, FLOAT, 2 Regs)
  outputCoil: 0,          // 0X 1 (Coil 0, Bit)
  vset: 4,                // 4X 5 (Offset 4, FLOAT, 2 Regs)
  vmaxLimit: 6,           // 4X 7 (Offset 6, FLOAT, 2 Regs)
  imaxLimit: 8,           // 4X 9 (Offset 8, FLOAT, 2 Regs)
  pmaxLimit: 10,          // 4X 11 (Offset 10, FLOAT, 2 Regs)
  iset: 12,               // 4X 13 (Offset 12, FLOAT, 2 Regs)
  isetRow: 14,            // 4X 15 (Offset 14, FLOAT, 2 Regs)
  rset: 16,               // 4X 17 (Offset 16, FLOAT, 2 Regs)
  pset: 18,               // 4X 19 (Offset 18, FLOAT, 2 Regs)
  cutoffV: 20,            // 4X 21 (Offset 20, FLOAT, 2 Regs)
  hrs: 22,                // 4X 23 (Offset 22, FLOAT, 2 Regs)
  min: 24,                // 4X 25 (Offset 24, FLOAT, 2 Regs)
  ah: 26,                 // 4X 27 (Offset 26, FLOAT, 2 Regs)
  batSubModeCoil: 1,      // 0X 2 (Coil 1, Bit: 0=CC, 1=CR)
  popPowerExceedCoil: 2,  // 0X 3 (Coil 2, Bit)
  popVoltExceedCoil: 3,   // 0X 4 (Coil 3, Bit)
  mode: 28,               // 4X 29 (Offset 28, INT, 1 Reg: 6=CV, 7=CC, 8=CR, 9=CP, 14=BAT TEST)
  rmaxLimit: 29           // 4X 30 (Offset 29, FLOAT, 2 Regs)
};

// Built-in Supported Profiles
export const BUILTIN_PROFILES: DeviceProfile[] = [
  {
    id: 'CLIENT_CSV_PROFILE',
    name: 'Client Custom CSV Profile (RS485 Modbus RTU)',
    manufacturer: 'Client Custom RS485 Controller',
    model: '32-Bit Float SCADA Register Map v1.0',
    deviceType: 'POWER_SUPPLY',
    validationStatus: 'HARDWARE_VALIDATED',
    firmwareVersion: 'v1.0.0',
    outputControlFc: 5,
    watchdogSupported: true,
    watchdogRegisterAddress: 0x030A,
    watchdogDefaultTimeoutMs: 1000,
    voltageScale: 1,
    currentScale: 1,
    registers: CLIENT_CSV_REGISTERS,
    notes: 'Official Client Specification 32-Bit IEEE 754 Float Register Map.'
  }
];

/**
 * Dynamic Voltage (Vmon) Formatter throughout system:
 * 0V - <30V: 3 decimal places (0.001 precision)
 * 30V - <60V: 2 decimal places (0.01 precision)
 * 60V+: 1 decimal place (0.1 precision)
 */
export function formatVoltage(v: number | undefined | null): string {
  if (v === undefined || v === null || isNaN(v)) return '0.000';
  const absV = Math.abs(v);
  if (absV < 30) {
    return v.toFixed(3);
  } else if (absV < 60) {
    return v.toFixed(2);
  } else {
    return v.toFixed(1);
  }
}

/**
 * Dynamic Current (Imon) Formatter throughout system:
 * 0A - <30A: 3 decimal places (0.001 precision)
 * 30A - <60A: 2 decimal places (0.01 precision)
 * 60A+: 1 decimal place (0.1 precision)
 */
export function formatCurrent(i: number | undefined | null): string {
  if (i === undefined || i === null || isNaN(i)) return '0.000';
  const absI = Math.abs(i);
  if (absI < 30) {
    return i.toFixed(3);
  } else if (absI < 60) {
    return i.toFixed(2);
  } else {
    return i.toFixed(1);
  }
}

