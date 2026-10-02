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
  hardwareIlimit?: number;      // Active I_SET_ROW_CC (I Target / I Limit) read from HMI (4X 15)
  hardwareIrange?: number;      // Active I_SET_RANGE_CC (I MAX CC Mode) read from HMI (4X 13)
  hardwareCvSet?: number;       // Active CV SET read from HMI (4X 5)
  hardwareRset?: number;        // Active R SET read from HMI (4X 17)
  hardwarePset?: number;        // Active P SET read from HMI (4X 19)
  hardwareVmax?: number;        // Active V_MAX read from HMI (4X 7)
  hardwareImax?: number;        // Active I_MAX read from HMI (4X 9)
  hardwarePmax?: number;        // Active P_MAX read from HMI (4X 11)
  hardwareRmax?: number;        // Active R_MAX read from HMI (4X 30)
  hardwareCutoffV?: number;     // Active VCUTOFF read from HMI (4X 21)
  hardwareAh?: number;          // Active AH read from HMI (4X 27)
  hardwareHrs?: number;         // Active HRS read from HMI (4X 23)
  hardwareMin?: number;         // Active MIN read from HMI (4X 25)
  hardwareBatSubMode?: 'CC' | 'CR'; // Active CC_CR_BAT_MODE read from HMI (0X 2)
  deviceResponding?: boolean; // True if slave device is acknowledging Modbus queries
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
  wordSwap?: boolean; // true = Word-Swapped (Low Word First / CDAB), false = Big Endian (High Word First / ABCD)
  protocolType?: 'RS485' | 'RS232';
}

export interface RegisterOffsets {
  mode: number;               // 4X 29 (INT, 1 Reg: 6=CV, 7=CC, 8=CR, 9=CP, 14=BAT TEST)
  vset: number;               // 4X 5 (FLOAT, 2 Regs) - CV_VOLT
  vmaxLimit: number;          // 4X 7 (FLOAT, 2 Regs) - V_MAX
  imaxLimit: number;          // 4X 9 (FLOAT, 2 Regs) - I_MAX (ENG SETTINGS)
  pmaxLimit: number;          // 4X 11 (FLOAT, 2 Regs) - P_MAX
  rmaxLimit?: number;         // 4X 30 (FLOAT, 2 Regs) - R_MAX
  ccImaxRange?: number;       // 4X 13 (FLOAT, 2 Regs) - I_SET_RANGE_CC (I MAX CC MODE)
  iset: number;               // 4X 15 (FLOAT, 2 Regs) - I_SET_ROW_CC (I TARGET / I LIMIT)
  isetRow?: number;           // 4X 15 (FLOAT, 2 Regs)
  rset: number;               // 4X 17 (FLOAT, 2 Regs) - RESISTOR_CR_MODE
  pset: number;               // 4X 19 (FLOAT, 2 Regs) - POWER_CP_MODE
  cutoffV: number;            // 4X 21 (FLOAT, 2 Regs) - VCUTOFF
  hrs?: number;               // 4X 23 (FLOAT, 2 Regs) - HRS
  min?: number;               // 4X 25 (FLOAT, 2 Regs) - MIN
  ah?: number;                // 4X 27 (FLOAT, 2 Regs) - AH
  vmon: number;               // 4X 1 (FLOAT, 2 Regs) - V MON
  imon: number;               // 4X 3 (FLOAT, 2 Regs) - I MON
  outputCoil: number;         // 0X 1 (Bit) - START_STOP
  batSubModeCoil?: number;    // 0X 2 (Bit: 1=CR, 0=CC) - CC_CR_BAT_MODE
  popPowerExceedCoil?: number;// 0X 3 (Bit) - POP_POWER_exceed
  popVoltExceedCoil?: number; // 0X 4 (Bit) - POP_VOLT_exceed
  imax?: number;              // Legacy fallback
  addressBase?: 0 | 1;        // 1 = Direct CSV MainAddress (Base 1), 0 = Wire Offset (Base 0)
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

// Base 1: Direct CSV MainAddress (1-indexed matching user CSV file exactly)
export const CLIENT_CSV_REGISTERS_BASE1: RegisterOffsets = {
  vmon: 1,                // 4X 1 (FLOAT, 2 Regs: 1 & 2) - V MON
  imon: 3,                // 4X 3 (FLOAT, 2 Regs: 3 & 4) - I MON
  outputCoil: 1,          // 0X 1 (Bit) - START_STOP (1=ON, 0=OFF)
  vset: 5,                // 4X 5 (FLOAT, 2 Regs: 5 & 6) - CV_VOLT (CV SET in cv mode)
  vmaxLimit: 7,           // 4X 7 (FLOAT, 2 Regs: 7 & 8) - V_MAX (ENG SETTINGS)
  imaxLimit: 9,           // 4X 9 (FLOAT, 2 Regs: 9 & 10) - I_MAX (ENG SETTINGS)
  pmaxLimit: 11,          // 4X 11 (FLOAT, 2 Regs: 11 & 12) - P_MAX (ENG SETTINGS)
  ccImaxRange: 13,        // 4X 13 (FLOAT, 2 Regs: 13 & 14) - I_SET_RANGE_CC (I MAX CC MODE)
  iset: 15,               // 4X 15 (FLOAT, 2 Regs: 15 & 16) - I_SET_ROW_CC (I TARGET CC MODE / SETTABLE)
  isetRow: 15,            // 4X 15 (FLOAT, 2 Regs: 15 & 16)
  rset: 17,               // 4X 17 (FLOAT, 2 Regs: 17 & 18) - RESISTOR_CR_MODE (Rset CR mode)
  pset: 19,               // 4X 19 (FLOAT, 2 Regs: 19 & 20) - POWER_CP_MODE (CP W range)
  cutoffV: 21,            // 4X 21 (FLOAT, 2 Regs: 21 & 22) - VCUTOFF (Vcutoff battery test mode)
  hrs: 23,                // 4X 23 (FLOAT, 2 Regs: 23 & 24) - HRS
  min: 25,                // 4X 25 (FLOAT, 2 Regs: 25 & 26) - MIN
  ah: 27,                 // 4X 27 (FLOAT, 2 Regs: 27 & 28) - AH
  batSubModeCoil: 2,      // 0X 2 (Bit: 1=CR mode, 0=CC mode) - CC_CR_BAT_MODE
  popPowerExceedCoil: 3,  // 0X 3 (Bit: 1=HIGH POWER alarm popup) - POP_POWER_exceed
  popVoltExceedCoil: 4,   // 0X 4 (Bit: 1=HIGH VOLTAGE alarm popup) - POP_VOLT_exceed
  mode: 29,               // 4X 29 (INT, 1 Reg: 6=CV, 7=CC, 8=CR, 9=CP, 14=BAT TEST) - MODE_SELECTION
  rmaxLimit: 30,          // 4X 30 (FLOAT, 2 Regs: 30 & 31) - R_MAX (ENG SETTINGS)
  addressBase: 1
};

// Base 0: Wire Protocol Address Offset (0-indexed where PDU Address = MainAddress - 1)
export const CLIENT_CSV_REGISTERS_BASE0: RegisterOffsets = {
  vmon: 0,                // 4X 1 -> Wire PDU 0
  imon: 2,                // 4X 3 -> Wire PDU 2
  outputCoil: 0,          // 0X 1 -> Wire PDU 0
  vset: 4,                // 4X 5 -> Wire PDU 4
  vmaxLimit: 6,           // 4X 7 -> Wire PDU 6
  imaxLimit: 8,           // 4X 9 -> Wire PDU 8
  pmaxLimit: 10,          // 4X 11 -> Wire PDU 10
  ccImaxRange: 12,        // 4X 13 -> Wire PDU 12
  iset: 14,               // 4X 15 -> Wire PDU 14
  isetRow: 14,            // 4X 15 -> Wire PDU 14
  rset: 16,               // 4X 17 -> Wire PDU 16
  pset: 18,               // 4X 19 -> Wire PDU 18
  cutoffV: 20,            // 4X 21 -> Wire PDU 20
  hrs: 22,                // 4X 23 -> Wire PDU 22
  min: 24,                // 4X 25 -> Wire PDU 24
  ah: 26,                 // 4X 27 -> Wire PDU 26
  batSubModeCoil: 1,      // 0X 2 -> Wire PDU 1
  popPowerExceedCoil: 2,  // 0X 3 -> Wire PDU 2
  popVoltExceedCoil: 3,   // 0X 4 -> Wire PDU 3
  mode: 28,               // 4X 29 -> Wire PDU 28
  rmaxLimit: 29,          // 4X 30 -> Wire PDU 29
  addressBase: 0
};

// Default Register Map matches Hardware Wire Protocol (Base 0 Wire Offset)
export const CLIENT_CSV_REGISTERS: RegisterOffsets = CLIENT_CSV_REGISTERS_BASE0;

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
  const val = Math.max(0, v);
  if (val < 30) {
    return val.toFixed(3);
  } else if (val < 60) {
    return val.toFixed(2);
  } else {
    return val.toFixed(1);
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
  const val = Math.max(0, i);
  if (val < 30) {
    return val.toFixed(3);
  } else if (val < 60) {
    return val.toFixed(2);
  } else {
    return val.toFixed(1);
  }
}

