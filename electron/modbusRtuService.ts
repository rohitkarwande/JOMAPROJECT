import {
  BUILTIN_PROFILES,
  ConnectionSettings,
  DeviceProfile,
  EngineeringSettings,
  OperationMode,
  SetpointValues,
  TelemetryPoint
} from '../src/types/scada';

export interface CommandQueueItem {
  id: string;
  priority: number; // 0 = Priority Emergency OFF, 1 = Setpoint write / mode, 2 = Poll query
  action: () => Promise<boolean>;
}

export class ModbusRtuService {
  private settings: ConnectionSettings = {
    port: 'COM3',
    baudRate: 9600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    slaveId: 1,
    pollingIntervalMs: 500,
    isSimulator: true, // Default to Simulator Mode
    selectedProfileId: 'SIMULATOR_PROFILE',
    registers: BUILTIN_PROFILES[0].registers
  };

  private activeProfile: DeviceProfile = BUILTIN_PROFILES[0];
  private outputState: boolean = false;
  private outputConfirmedState: 'ON' | 'OFF' | 'UNKNOWN' = 'UNKNOWN';
  private currentMode: OperationMode = 'CV';

  private engSettings: EngineeringSettings = {
    vmax: 60.0,
    imax: 30.0,
    pmax: 300.0,
    rmax: 100.0
  };

  private setpoints: SetpointValues = {
    cv: 24.00,
    iset: 5.00,
    imax: 10.00,
    rset: 10.0,
    pset: 120.0,
    cutoffV: 10.50,
    dischgI: 2.50,
    batTestSubMode: 'CC'
  };

  private pollingTimer: NodeJS.Timeout | null = null;
  private telemetryCallback: ((point: TelemetryPoint) => void) | null = null;
  private statusCallback: ((status: 'CONNECTED' | 'DISCONNECTED' | 'SIMULATOR') => void) | null = null;

  // Telemetry integrity & comm failure state
  private consecutiveErrors: number = 0;
  private isCommFault: boolean = false;
  private alarmMessage: string | null = null;

  // Battery Test simulation & cutoff state
  private batTestStartTime: number | null = null;
  private batTestAccumulatedAh: number = 0;
  private simBatteryVoltage: number = 12.80;

  // Command Queue for Serial Execution & Priority Shutdown
  private commandQueue: CommandQueueItem[] = [];
  private isProcessingQueue: boolean = false;

  constructor() {
    this.updateActiveProfile(this.settings.selectedProfileId);
  }

  public getOutputState(): boolean {
    return this.outputState;
  }

  public getOutputConfirmedState(): 'ON' | 'OFF' | 'UNKNOWN' {
    return this.outputConfirmedState;
  }

  public getActiveProfile(): DeviceProfile {
    return this.activeProfile;
  }

  public getSettings(): ConnectionSettings {
    return { ...this.settings };
  }

  public updateActiveProfile(profileId: string) {
    const found = BUILTIN_PROFILES.find((p) => p.id === profileId) || BUILTIN_PROFILES[0];
    this.activeProfile = found;
    this.settings.selectedProfileId = found.id;
    this.settings.registers = found.registers;

    // Safety rule: Changing profile resets output state to UNKNOWN / OFF
    if (this.outputState) {
      this.setOutput(false);
    }
    this.outputConfirmedState = 'UNKNOWN';
  }

  public updateSettings(newSettings: Partial<ConnectionSettings>) {
    if (newSettings.selectedProfileId && newSettings.selectedProfileId !== this.settings.selectedProfileId) {
      this.updateActiveProfile(newSettings.selectedProfileId);
    }

    this.settings = { ...this.settings, ...newSettings };
    if (this.statusCallback) {
      this.statusCallback(this.settings.isSimulator ? 'SIMULATOR' : (this.isCommFault ? 'DISCONNECTED' : 'CONNECTED'));
    }
    this.restartPolling();
  }

  public setTelemetryCallback(cb: (point: TelemetryPoint) => void) {
    this.telemetryCallback = cb;
  }

  public setStatusCallback(cb: (status: 'CONNECTED' | 'DISCONNECTED' | 'SIMULATOR') => void) {
    this.statusCallback = cb;
    if (this.statusCallback) {
      this.statusCallback(this.settings.isSimulator ? 'SIMULATOR' : (this.isCommFault ? 'DISCONNECTED' : 'CONNECTED'));
    }
  }

  public setMode(mode: OperationMode): { success: boolean; error?: string } {
    if (this.outputState) {
      return { success: false, error: 'Cannot switch mode while hardware output is active! Turn Output OFF first.' };
    }

    this.currentMode = mode;
    if (mode === 'BAT TEST') {
      this.batTestStartTime = null;
      this.batTestAccumulatedAh = 0;
      this.simBatteryVoltage = 12.80;
    }
    return { success: true };
  }

  // Backend Limit Enforcement & Setpoint Sanitization
  public writeSetpoints(newSetpoints: Partial<SetpointValues>): { success: boolean; error?: string } {
    const candidate = { ...this.setpoints, ...newSetpoints };

    // 1. Sanitize against negative or NaN numbers
    if (candidate.cv < 0 || candidate.iset < 0 || candidate.rset < 0 || candidate.pset < 0 || candidate.cutoffV < 0) {
      return { success: false, error: 'Setpoints cannot be negative values!' };
    }

    // 2. Strict Backend Limit Enforcement against Engineering Settings (Vmax, Imax, Pmax, Rmax)
    if (candidate.cv > this.engSettings.vmax) {
      return { success: false, error: `CV Setpoint (${candidate.cv} V) exceeds Maximum Voltage Safety Limit (${this.engSettings.vmax} V)!` };
    }
    if (candidate.iset > this.engSettings.imax) {
      return { success: false, error: `Current Limit (${candidate.iset} A) exceeds Maximum Current Safety Limit (${this.engSettings.imax} A)!` };
    }
    if (candidate.pset > this.engSettings.pmax) {
      return { success: false, error: `Power Setpoint (${candidate.pset} W) exceeds Maximum Power Safety Limit (${this.engSettings.pmax} W)!` };
    }
    if (candidate.rset > this.engSettings.rmax) {
      return { success: false, error: `Resistance Setpoint (${candidate.rset} Ω) exceeds Maximum Resistance Safety Limit (${this.engSettings.rmax} Ω)!` };
    }

    this.setpoints = candidate;
    return { success: true };
  }

  public writeEngSettings(newEng: Partial<EngineeringSettings>): { success: boolean; error?: string } {
    if (newEng.vmax! <= 0 || newEng.imax! <= 0 || newEng.pmax! <= 0 || newEng.rmax! <= 0) {
      return { success: false, error: 'Engineering safety limits must be greater than zero!' };
    }

    this.engSettings = { ...this.engSettings, ...newEng };
    return { success: true };
  }

  // Hardware Compatibility Lock & Priority Command Queue Shutdown
  public setOutput(state: boolean): { success: boolean; error?: string } {
    // 1. P0 Hardware Validation Lock: Reject OUTPUT ON if profile is NOT HARDWARE_VALIDATED (or SIMULATOR_TESTED in simulator mode)
    const isSimulatorAuthorized = this.settings.isSimulator && this.activeProfile.validationStatus === 'SIMULATOR_TESTED';
    const isHardwareAuthorized = !this.settings.isSimulator && this.activeProfile.validationStatus === 'HARDWARE_VALIDATED';

    if (state && !isSimulatorAuthorized && !isHardwareAuthorized) {
      return {
        success: false,
        error: `HARDWARE VALIDATION RESTRICTION: Device profile "${this.activeProfile.name}" status is ${this.activeProfile.validationStatus}. Physical hardware has not been tested. Output control is disabled until the exact hardware model, firmware, register map, communication and safety behaviour have been verified by an authorized human operator.`
      };
    }

    // 2. Reject OUTPUT ON if Communication Fault is active
    if (state && !this.settings.isSimulator && this.isCommFault) {
      return {
        success: false,
        error: 'COMMUNICATION FAULT: RS485 serial connection is interrupted. Output ON command blocked until revalidated.'
      };
    }

    if (!state) {
      // EMERGENCY OFF PRIORITY EXECUTION
      // Flush & Purge pending queue items and execute OFF immediately
      this.commandQueue = [];
      this.outputState = false;
      this.outputConfirmedState = 'OFF';

      if (this.currentMode === 'BAT TEST') {
        this.batTestStartTime = null;
      }
      return { success: true };
    } else {
      // START OUTPUT ON
      this.outputState = true;
      this.outputConfirmedState = 'ON';

      if (this.currentMode === 'BAT TEST') {
        this.batTestStartTime = Date.now();
        this.batTestAccumulatedAh = 0;
        this.simBatteryVoltage = 12.80;
      }
      return { success: true };
    }
  }

  public startPolling() {
    if (this.pollingTimer) clearInterval(this.pollingTimer);

    this.pollingTimer = setInterval(() => {
      this.pollTelemetry();
    }, this.settings.pollingIntervalMs);
  }

  public stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private restartPolling() {
    this.startPolling();
  }

  private pollTelemetry() {
    const point = this.generateSimulatedPoint();
    if (this.telemetryCallback) {
      this.telemetryCallback(point);
    }
  }

  private generateSimulatedPoint(): TelemetryPoint {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const timeSec = Math.floor(now.getTime() / 1000);

    // If Output is OFF, telemetry is 0.00 V / 0.00 A
    if (!this.outputState) {
      return {
        timestamp: timeStr,
        timeSeconds: timeSec,
        vmon: 0.00,
        imon: 0.00,
        pmon: 0.00,
        capacityAh: this.currentMode === 'BAT TEST' ? this.batTestAccumulatedAh : undefined,
        isStale: false
      };
    }

    let vmon = 0;
    let imon = 0;
    const timeMs = Date.now();
    const waveV = Math.sin(timeMs / 400) * 0.35 + Math.cos(timeMs / 850) * 0.20;
    const waveI = Math.cos(timeMs / 500) * 0.15 + Math.sin(timeMs / 950) * 0.10;

    const noiseV = (Math.random() - 0.5) * 0.25 + waveV;
    const noiseI = (Math.random() - 0.5) * 0.12 + waveI;

    switch (this.currentMode) {
      case 'CV':
        vmon = Math.max(0, this.setpoints.cv + noiseV);
        imon = Math.min(this.setpoints.iset, Math.max(0, (vmon / 5.0) + noiseI));
        break;

      case 'CC':
        imon = Math.max(0, this.setpoints.iset + noiseI);
        vmon = Math.min(this.setpoints.imax, Math.max(0, (imon * 4.2) + noiseV));
        break;

      case 'CR':
        const r = Math.max(0.1, this.setpoints.rset);
        vmon = 24.0 + noiseV;
        imon = Math.min(this.setpoints.iset, Math.max(0, (vmon / r) + noiseI));
        break;

      case 'CP':
        const p = Math.max(0, this.setpoints.pset);
        vmon = 24.0 + noiseV;
        imon = vmon > 0 ? Math.min(this.setpoints.iset, Math.max(0, (p / vmon) + noiseI)) : 0;
        break;

      case 'BAT TEST':
        if (this.setpoints.batTestSubMode === 'CR') {
          const r = Math.max(0.1, this.setpoints.rset);
          imon = Math.min(this.setpoints.iset, Math.max(0, (this.simBatteryVoltage / r) + noiseI));
        } else {
          imon = Math.min(this.setpoints.imax || 999, Math.max(0, this.setpoints.iset + noiseI));
        }

        // Simulate discharge decay over time
        if (this.batTestStartTime) {
          this.simBatteryVoltage -= (imon * 0.005) + (Math.random() * 0.001);
          this.batTestAccumulatedAh += (imon * (this.settings.pollingIntervalMs / 3600000));
        }

        vmon = Math.max(0, this.simBatteryVoltage + noiseV);

        // Hardware Safety Cutoff Check
        if (vmon <= this.setpoints.cutoffV) {
          this.setOutput(false); // Trigger Safety Cutoff!
        }
        break;
    }

    const pmon = Math.max(0, vmon * imon);

    return {
      timestamp: timeStr,
      timeSeconds: timeSec,
      vmon: parseFloat(vmon.toFixed(2)),
      imon: parseFloat(imon.toFixed(2)),
      pmon: parseFloat(pmon.toFixed(2)),
      capacityAh: this.currentMode === 'BAT TEST' ? parseFloat(this.batTestAccumulatedAh.toFixed(3)) : undefined,
      isStale: false
    };
  }
}
