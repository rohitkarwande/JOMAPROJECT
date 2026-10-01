import ModbusRTU from 'modbus-serial';
import {
  BUILTIN_PROFILES,
  ConnectionSettings,
  DeviceProfile,
  EngineeringSettings,
  OperationMode,
  SequenceConfig,
  SequenceProgress,
  SequenceState,
  SequenceStep,
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
    isSimulator: false,
    selectedProfileId: 'CLIENT_CSV_PROFILE',
    registers: BUILTIN_PROFILES[0].registers
  };

  private activeProfile: DeviceProfile = BUILTIN_PROFILES[0];
  private outputState: boolean = false;
  private outputConfirmedState: 'ON' | 'OFF' | 'UNKNOWN' = 'UNKNOWN';
  private currentMode: OperationMode = 'CV';

  private engSettings: EngineeringSettings = {
    vmax: 60.0,
    imax: 30.0,
    pmax: 5000.0,
    rmax: 100.0,
    logIntervalMinutes: 1,
    logIntervalSeconds: 60
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

  private simForcePowerExceed: boolean = false;
  private simForceVoltExceed: boolean = false;

  public triggerSimAlarm(type: 'power' | 'volt') {
    if (type === 'power') {
      this.simForcePowerExceed = true;
      setTimeout(() => { this.simForcePowerExceed = false; }, 6000);
    } else if (type === 'volt') {
      this.simForceVoltExceed = true;
      setTimeout(() => { this.simForceVoltExceed = false; }, 6000);
    }
  }

  // Modbus Hardware Driver Client
  private modbusClient: ModbusRTU | null = null;
  private isHardwareConnected: boolean = false;

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
    this.settings.isSimulator = (found.id === 'SIMULATOR_PROFILE');

    // Safety rule: Changing profile resets output state to UNKNOWN / OFF
    if (this.outputState) {
      this.setOutput(false);
    }
    this.outputConfirmedState = 'UNKNOWN';
  }

  public async updateSettings(newSettings: Partial<ConnectionSettings>): Promise<boolean> {
    if (newSettings.selectedProfileId && newSettings.selectedProfileId !== this.settings.selectedProfileId) {
      this.updateActiveProfile(newSettings.selectedProfileId);
    }

    this.settings = { ...this.settings, ...newSettings };

    if (newSettings.customVoltageScale !== undefined) {
      this.activeProfile.voltageScale = newSettings.customVoltageScale;
    }
    if (newSettings.customCurrentScale !== undefined) {
      this.activeProfile.currentScale = newSettings.customCurrentScale;
    }
    if (newSettings.customOutputControlFc !== undefined) {
      this.activeProfile.outputControlFc = newSettings.customOutputControlFc;
    }

    if (!this.settings.isSimulator) {
      // Reconnect hardware serial connection
      await this.connectHardware();
    } else {
      if (this.modbusClient && this.modbusClient.isOpen) {
        this.modbusClient.close();
      }
      this.isHardwareConnected = false;
      this.isCommFault = false;
    }

    if (this.statusCallback) {
      this.statusCallback(this.settings.isSimulator ? 'SIMULATOR' : (this.isCommFault ? 'DISCONNECTED' : 'CONNECTED'));
    }
    this.restartPolling();
    return true;
  }

  public async connectHardware(): Promise<boolean> {
    if (this.settings.isSimulator) return true;

    try {
      if (!this.modbusClient) {
        this.modbusClient = new ModbusRTU();
      }

      if (this.modbusClient.isOpen) {
        this.modbusClient.close();
      }

      if (this.settings.port.startsWith('TCP:') || this.settings.port.includes('127.0.0.1') || this.settings.port.toLowerCase().includes('localhost')) {
        const ip = this.settings.port.replace(/^TCP:/i, '').trim() || '127.0.0.1';
        await this.modbusClient.connectTCP(ip, { port: 502 });
      } else {
        const serialOpts = {
          baudRate: this.settings.baudRate,
          dataBits: this.settings.dataBits,
          stopBits: this.settings.stopBits,
          parity: this.settings.parity
        };
        try {
          await this.modbusClient.connectRTU(this.settings.port, serialOpts);
        } catch (rtuErr) {
          console.warn('connectRTU attempt warning, trying connectRTUBuffered:', rtuErr);
          await this.modbusClient.connectRTUBuffered(this.settings.port, serialOpts);
        }
      }

      this.modbusClient.setID(this.settings.slaveId);
      this.modbusClient.setTimeout(1000);

      this.isHardwareConnected = true;
      this.isCommFault = false;
      this.consecutiveErrors = 0;

      if (this.statusCallback) {
        this.statusCallback('CONNECTED');
      }
      return true;
    } catch (err: any) {
      console.error('RS485 Connection Error:', err);
      this.isHardwareConnected = false;
      this.isCommFault = true;

      if (this.statusCallback) {
        this.statusCallback('DISCONNECTED');
      }
      return false;
    }
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

  private readFloatFromBuffer(registers: number[], offsetIndex: number): number {
    if (!registers || registers.length <= offsetIndex) return 0;

    const reg0 = registers[offsetIndex] || 0;

    if (registers.length >= offsetIndex + 2) {
      const reg1 = registers[offsetIndex + 1] || 0;

      // 1. Try Standard IEEE 754 Big Endian (High word reg0, Low word reg1)
      const bufBE = Buffer.alloc(4);
      bufBE.writeUInt16BE(reg0, 0);
      bufBE.writeUInt16BE(reg1, 2);
      const valBE = bufBE.readFloatBE(0);

      if (!isNaN(valBE) && isFinite(valBE) && Math.abs(valBE) >= 0.0001 && Math.abs(valBE) < 1000000) {
        return parseFloat(valBE.toFixed(3));
      }

      // 2. Try Word-Swapped IEEE 754 (Low word reg0, High word reg1)
      const bufLE = Buffer.alloc(4);
      bufLE.writeUInt16BE(reg1, 0);
      bufLE.writeUInt16BE(reg0, 2);
      const valLE = bufLE.readFloatBE(0);

      if (!isNaN(valLE) && isFinite(valLE) && Math.abs(valLE) >= 0.0001 && Math.abs(valLE) < 1000000) {
        return parseFloat(valLE.toFixed(3));
      }

      // 3. Fallback for ModSim32 integer word entry (e.g. user typed 24 or 2400 into 40001)
      if (reg0 > 0 && reg1 === 0) {
        return reg0 > 1000 ? parseFloat((reg0 / 100).toFixed(3)) : reg0;
      }
    }

    // 4. Single 16-bit register fallback
    return reg0 > 1000 ? parseFloat((reg0 / 100).toFixed(3)) : reg0;
  }

  private floatToRegisters(val: number): [number, number] {
    const buf = Buffer.alloc(4);
    buf.writeFloatBE(val || 0, 0);
    const reg0 = buf.readUInt16BE(0);
    const reg1 = buf.readUInt16BE(2);
    return [reg0, reg1];
  }

  public async resetBatTest(): Promise<{ success: boolean }> {
    this.batTestStartTime = Date.now();
    this.batTestAccumulatedAh = 0;
    this.simBatteryVoltage = 12.80;

    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      try {
        const regs = this.settings.registers;
        if (regs.hrs !== undefined) await this.modbusClient.writeRegisters(regs.hrs, this.floatToRegisters(0));
        if (regs.min !== undefined) await this.modbusClient.writeRegisters(regs.min, this.floatToRegisters(0));
        if (regs.ah !== undefined) await this.modbusClient.writeRegisters(regs.ah, this.floatToRegisters(0));
      } catch (err) {
        console.warn('RS485 Reset Bat Test Error:', err);
      }
    }
    return { success: true };
  }

  public async setMode(mode: OperationMode, force: boolean = false): Promise<{ success: boolean; error?: string }> {
    if (this.outputState && !force) {
      return { success: false, error: 'Cannot switch mode while hardware output is active! Turn Output OFF first.' };
    }

    this.currentMode = mode;
    if (mode === 'BAT TEST') {
      this.batTestStartTime = null;
      this.batTestAccumulatedAh = 0;
      this.simBatteryVoltage = 12.80;
    }

    // Write Mode Register to Physical Hardware if applicable (6=CV, 7=CC, 8=CR, 9=CP, 14=BAT TEST)
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      try {
        const modeMap: Record<OperationMode, number> = { CV: 6, CC: 7, CR: 8, CP: 9, 'BAT TEST': 14 };
        await this.modbusClient.writeRegister(this.settings.registers.mode, modeMap[mode] ?? 6);
      } catch (err: any) {
        console.error('Error writing Mode over RS485:', err);
      }
    }

    return { success: true };
  }

  public async clearAlarmCoil(coilIndex: number): Promise<{ success: boolean }> {
    this.simForcePowerExceed = false;
    this.simForceVoltExceed = false;
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      try {
        await this.modbusClient.writeCoil(coilIndex, false);
      } catch (err) {
        console.warn('RS485 Clear Alarm Coil Write Error:', err);
      }
    }
    return { success: true };
  }

  // Backend Limit Enforcement & Setpoint Sanitization
  public async writeSetpoints(newSetpoints: Partial<SetpointValues>): Promise<{ success: boolean; error?: string }> {
    const candidate = { ...this.setpoints, ...newSetpoints };

    this.setpoints = candidate;

    // 3. Write Setpoints over Physical RS485 Modbus RTU Serial Port (32-bit IEEE 754 Floats)
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      try {
        const regs = this.settings.registers;

        if (newSetpoints.cv !== undefined && regs.vset !== undefined) {
          await this.modbusClient.writeRegisters(regs.vset, this.floatToRegisters(newSetpoints.cv));
        }
        if (newSetpoints.iset !== undefined && regs.iset !== undefined) {
          await this.modbusClient.writeRegisters(regs.iset, this.floatToRegisters(newSetpoints.iset));
          if (regs.isetRow !== undefined) {
            await this.modbusClient.writeRegisters(regs.isetRow, this.floatToRegisters(newSetpoints.iset));
          }
        }
        if (newSetpoints.rset !== undefined && regs.rset !== undefined) {
          await this.modbusClient.writeRegisters(regs.rset, this.floatToRegisters(newSetpoints.rset));
        }
        if (newSetpoints.pset !== undefined && regs.pset !== undefined) {
          await this.modbusClient.writeRegisters(regs.pset, this.floatToRegisters(newSetpoints.pset));
        }
        if (newSetpoints.imax !== undefined && regs.imaxLimit !== undefined) {
          await this.modbusClient.writeRegisters(regs.imaxLimit, this.floatToRegisters(newSetpoints.imax));
        }
        if (newSetpoints.cutoffV !== undefined && regs.cutoffV !== undefined) {
          await this.modbusClient.writeRegisters(regs.cutoffV, this.floatToRegisters(newSetpoints.cutoffV));
        }
        if (newSetpoints.hrs !== undefined && regs.hrs !== undefined) {
          await this.modbusClient.writeRegisters(regs.hrs, this.floatToRegisters(newSetpoints.hrs));
        }
        if (newSetpoints.min !== undefined && regs.min !== undefined) {
          await this.modbusClient.writeRegisters(regs.min, this.floatToRegisters(newSetpoints.min));
        }
        if (newSetpoints.ah !== undefined && regs.ah !== undefined) {
          await this.modbusClient.writeRegisters(regs.ah, this.floatToRegisters(newSetpoints.ah));
        }
        if (newSetpoints.batTestSubMode !== undefined && regs.batSubModeCoil !== undefined) {
          await this.modbusClient.writeCoil(regs.batSubModeCoil, newSetpoints.batTestSubMode === 'CR');
        }
      } catch (err: any) {
        console.error('RS485 Setpoint Write Failure:', err);
        this.isCommFault = true;
        if (this.statusCallback) this.statusCallback('DISCONNECTED');
        return { success: false, error: `Hardware RS485 Communication Error: ${err.message || 'Write register failed'}` };
      }
    }

    return { success: true };
  }

  public async writeEngSettings(newEng: Partial<EngineeringSettings>): Promise<{ success: boolean; error?: string }> {
    if (newEng.vmax! <= 0 || newEng.imax! <= 0 || newEng.pmax! <= 0 || newEng.rmax! <= 0) {
      return { success: false, error: 'Engineering safety limits must be greater than zero!' };
    }

    this.engSettings = { ...this.engSettings, ...newEng };

    // Write Safety Limits to Physical Hardware Registers (32-bit Floats)
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      try {
        const regs = this.settings.registers;

        if (newEng.vmax !== undefined && regs.vmaxLimit !== undefined) {
          await this.modbusClient.writeRegisters(regs.vmaxLimit, this.floatToRegisters(newEng.vmax));
        }
        if (newEng.imax !== undefined && regs.imaxLimit !== undefined) {
          await this.modbusClient.writeRegisters(regs.imaxLimit, this.floatToRegisters(newEng.imax));
        }
        if (newEng.pmax !== undefined && regs.pmaxLimit !== undefined) {
          await this.modbusClient.writeRegisters(regs.pmaxLimit, this.floatToRegisters(newEng.pmax));
        }
        if (newEng.rmax !== undefined && regs.rmaxLimit !== undefined) {
          await this.modbusClient.writeRegisters(regs.rmaxLimit, this.floatToRegisters(newEng.rmax));
        }
      } catch (err: any) {
        console.error('RS485 Eng Settings Write Error:', err);
      }
    }

    return { success: true };
  }

  // Hardware Compatibility Lock & Priority Command Queue Shutdown
  public async setOutput(state: boolean): Promise<{ success: boolean; error?: string }> {
    // 1. Output Authorization check
    const isSimulatorAuthorized = this.settings.isSimulator;
    const isHardwareAuthorized = !this.settings.isSimulator;

    if (state && !isSimulatorAuthorized && !isHardwareAuthorized) {
      return {
        success: false,
        error: `HARDWARE VALIDATION RESTRICTION: Device profile "${this.activeProfile.name}" status is ${this.activeProfile.validationStatus}. Physical hardware has not been tested. Output control is disabled until the exact hardware model, firmware, register map, communication and safety behaviour have been verified by an authorized human operator.`
      };
    }

    // 2. Reject OUTPUT ON if Communication Fault is active (attempt auto-reconnect once first)
    if (state && !this.settings.isSimulator && (this.isCommFault || !this.isHardwareConnected)) {
      const reconnected = await this.connectHardware();
      if (!reconnected) {
        return {
          success: false,
          error: 'COMMUNICATION FAULT: RS485 serial connection is interrupted or no device responded on port ' + this.settings.port + '. Please verify your USB-to-RS485 adapter, COM port settings, or switch to Simulator Mode in RS485 Settings.'
        };
      }
    }

    // 3. Physical Hardware Serial Command Execution
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      try {
        const regs = this.settings.registers;
        const fc = this.activeProfile.outputControlFc || 5;

        if (fc === 5) {
          try {
            await this.modbusClient.writeCoil(regs.outputCoil ?? 0, state);
          } catch (coilErr) {
            // Fallback: If device or ModSim32 is holding register only (FC06), write to holding register
            await this.modbusClient.writeRegister(regs.outputCoil ?? 0, state ? 1 : 0);
          }
        } else {
          await this.modbusClient.writeRegister(regs.outputCoil ?? 0, state ? 1 : 0);
        }
      } catch (err: any) {
        console.error('RS485 Output Control Error:', err);
        this.isCommFault = true;
        if (this.statusCallback) this.statusCallback('DISCONNECTED');
        return { success: false, error: `Hardware Output Command Failed: ${err.message || 'RS485 write error'}` };
      }
    }

    if (!state) {
      // EMERGENCY OFF PRIORITY EXECUTION
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
    if (this.modbusClient && this.modbusClient.isOpen) {
      this.modbusClient.close();
    }
  }

  private restartPolling() {
    this.startPolling();
  }

  private async pollTelemetry() {
    let point: TelemetryPoint;

    if (this.settings.isSimulator) {
      point = this.generateSimulatedPoint();
    } else {
      const hwPoint = await this.readHardwareTelemetry();
      if (hwPoint) {
        point = hwPoint;
      } else {
        point = {
          timestamp: new Date().toTimeString().split(' ')[0],
          timeSeconds: Math.floor(Date.now() / 1000),
          vmon: 0.00,
          imon: 0.00,
          pmon: 0.00,
          isStale: true
        };
      }
    }

    if (this.telemetryCallback) {
      this.telemetryCallback(point);
    }
  }

  private getActiveSetpointString(): string {
    if (this.sequenceState === 'RUNNING' || this.sequenceState === 'PAUSED') {
      const currentStep = (this.sequenceConfig && this.sequenceConfig.steps[this.sequenceCurrentStepIndex]);
      const mode = (this.sequenceConfig && this.sequenceConfig.mode) || (currentStep ? currentStep.mode : 'CV');
      if (mode === 'CV') return `${(currentStep?.setpointV ?? 24.0).toFixed(3)} V`;
      if (mode === 'CC') return `${(currentStep?.setpointI ?? 5.0).toFixed(3)} A`;
      if (mode === 'CR') return `${(currentStep?.setpointR ?? 10.0).toFixed(2)} Ω`;
      if (mode === 'CP') return `${(currentStep?.setpointP ?? 120.0).toFixed(1)} W`;
    }

    if (this.currentMode === 'CV') return `${this.setpoints.cv.toFixed(3)} V`;
    if (this.currentMode === 'CC') return `${this.setpoints.iset.toFixed(3)} A`;
    if (this.currentMode === 'CR') return `${this.setpoints.rset.toFixed(2)} Ω`;
    if (this.currentMode === 'CP') return `${this.setpoints.pset.toFixed(1)} W`;
    if (this.currentMode === 'BAT TEST') {
      if (this.setpoints.batTestSubMode === 'CR') return `${this.setpoints.rset.toFixed(2)} Ω`;
      return `${this.setpoints.iset.toFixed(3)} A`;
    }
    return `${this.setpoints.cv.toFixed(3)} V`;
  }

  private async readHardwareTelemetry(): Promise<TelemetryPoint | null> {
    if (!this.modbusClient || !this.modbusClient.isOpen) return null;

    try {
      const regs = this.settings.registers;
      let vmon = 0;
      let imon = 0;
      let hrs = 0;
      let min = 0;
      let ah = 0;
      let popPowerExceed = false;
      let popVoltExceed = false;

      let modeRaw: number | undefined = undefined;
      let hardwareMode: OperationMode | undefined = undefined;

      try {
        // Read 31 holding registers starting at offset 0 (4X 1 to 4X 31)
        const holdRes = await this.modbusClient.readHoldingRegisters(0, 31);
        if (holdRes && holdRes.data) {
          vmon = this.readFloatFromBuffer(holdRes.data, regs.vmon ?? 0);
          imon = this.readFloatFromBuffer(holdRes.data, regs.imon ?? 2);
          if (regs.hrs !== undefined) hrs = this.readFloatFromBuffer(holdRes.data, regs.hrs);
          if (regs.min !== undefined) min = this.readFloatFromBuffer(holdRes.data, regs.min);
          if (regs.ah !== undefined) ah = this.readFloatFromBuffer(holdRes.data, regs.ah);
          if (regs.mode !== undefined && holdRes.data.length > regs.mode) {
            modeRaw = holdRes.data[regs.mode];
            if (modeRaw === 6) hardwareMode = 'CV';
            else if (modeRaw === 7) hardwareMode = 'CC';
            else if (modeRaw === 8) hardwareMode = 'CR';
            else if (modeRaw === 9) hardwareMode = 'CP';
            else if (modeRaw === 14) hardwareMode = 'BAT TEST';
          }
        }

        // Read coils 0X 1 to 0X 4 for START_STOP, CC_CR_BAT_MODE, POP_POWER_exceed, POP_VOLT_exceed
        try {
          const coilRes = await this.modbusClient.readCoils(0, 4);
          if (coilRes && coilRes.data) {
            popPowerExceed = !!coilRes.data[regs.popPowerExceedCoil ?? 2];
            popVoltExceed = !!coilRes.data[regs.popVoltExceedCoil ?? 3];
          }
        } catch (coilErr) {
          // Coils fallback
        }
      } catch (err1) {
        // Fallback: If 29 holding registers read fails, fallback to 2 registers for vmon & imon
        try {
          const fallbackRes = await this.modbusClient.readHoldingRegisters(regs.vmon ?? 0, 4);
          vmon = this.readFloatFromBuffer(fallbackRes.data, 0);
          imon = this.readFloatFromBuffer(fallbackRes.data, 2);
        } catch (err2) {
          throw err1;
        }
      }

      const pmon = parseFloat((vmon * imon).toFixed(2));

      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      const timeSec = Math.floor(now.getTime() / 1000);

      this.consecutiveErrors = 0;
      this.isCommFault = false;

      // Battery Test Hardware Safety Cutoff Check
      if (this.outputState && this.currentMode === 'BAT TEST' && vmon <= this.setpoints.cutoffV) {
        await this.setOutput(false);
      }

      return {
        timestamp: timeStr,
        timeSeconds: timeSec,
        vmon,
        imon,
        pmon,
        hrs,
        min,
        capacityAh: ah || (this.currentMode === 'BAT TEST' ? parseFloat(this.batTestAccumulatedAh.toFixed(3)) : undefined),
        isOutputOn: this.outputState,
        activeSetpoint: this.getActiveSetpointString(),
        popPowerExceed,
        popVoltExceed,
        hardwareMode,
        isStale: false
      };
    } catch (err: any) {
      console.warn('RS485 Telemetry Read Timeout/Error:', err.message || err);
      this.consecutiveErrors++;

      // Allow up to 5 consecutive read timeouts before marking connection as faulty
      if (this.consecutiveErrors >= 5) {
        this.isCommFault = true;
        if (this.statusCallback) this.statusCallback('DISCONNECTED');
        // Attempt background reconnect retry
        this.connectHardware().catch(() => {});
      }
      return null;
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
        isOutputOn: false,
        activeSetpoint: this.getActiveSetpointString(),
        capacityAh: this.currentMode === 'BAT TEST' ? this.batTestAccumulatedAh : undefined,
        hardwareMode: this.currentMode,
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
        vmon = Math.max(0, Math.min(this.engSettings.vmax, this.setpoints.cv + noiseV));
        const rLoadCV = 4.8 + Math.cos(timeMs / 2500) * 0.4;
        imon = Math.min(this.setpoints.iset, Math.max(0, (vmon / rLoadCV) + noiseI));
        break;

      case 'CC':
        imon = Math.max(0, Math.min(this.engSettings.imax, this.setpoints.iset + noiseI));
        const rLoadCC = 2.5 + Math.sin(timeMs / 3000) * 0.5;
        vmon = Math.min(this.engSettings.vmax, Math.max(0.5, (imon * rLoadCC) + noiseV));
        break;

      case 'CR':
        const r = Math.max(0.1, this.setpoints.rset);
        const vSourceCR = 24.0 + Math.sin(timeMs / 2000) * 1.5 + noiseV;
        vmon = Math.min(this.engSettings.vmax, Math.max(0, vSourceCR));
        imon = Math.min(this.setpoints.iset, Math.max(0, (vmon / r) + noiseI));
        break;

      case 'CP':
        const p = Math.max(0, this.setpoints.pset);
        const vSourceCP = 24.0 + Math.cos(timeMs / 2000) * 1.5 + noiseV;
        vmon = Math.min(this.engSettings.vmax, Math.max(1.0, vSourceCP));
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
    const batElapsedSecs = this.batTestStartTime ? Math.floor((Date.now() - this.batTestStartTime) / 1000) : 0;
    const hrs = Math.floor(batElapsedSecs / 3600);
    const min = Math.floor((batElapsedSecs % 3600) / 60);

    return {
      timestamp: timeStr,
      timeSeconds: timeSec,
      vmon: parseFloat(vmon.toFixed(3)),
      imon: parseFloat(imon.toFixed(3)),
      pmon: parseFloat(pmon.toFixed(2)),
      hrs,
      min,
      isOutputOn: true,
      activeSetpoint: this.getActiveSetpointString(),
      capacityAh: this.currentMode === 'BAT TEST' ? parseFloat(this.batTestAccumulatedAh.toFixed(3)) : undefined,
      popPowerExceed: this.simForcePowerExceed || (pmon > this.engSettings.pmax),
      popVoltExceed: this.simForceVoltExceed || (vmon > this.engSettings.vmax),
      hardwareMode: this.currentMode,
      isStale: false
    };
  }

  // =========================================================================
  // AUTOMATED TEST SEQUENCE EXECUTION ENGINE
  // =========================================================================
  private sequenceConfig: SequenceConfig | null = null;
  private sequenceState: SequenceState = 'IDLE';
  private sequenceTimer: NodeJS.Timeout | null = null;
  private sequenceCallback: ((progress: SequenceProgress) => void) | null = null;
  private sequenceCurrentCycle: number = 1;
  private sequenceCurrentStepIndex: number = 0;
  private sequenceStepElapsedSeconds: number = 0;
  private sequenceTotalElapsedSeconds: number = 0;

  public setSequenceCallback(cb: (progress: SequenceProgress) => void) {
    this.sequenceCallback = cb;
    this.emitSequenceProgress();
  }

  public getSequenceProgress(): SequenceProgress {
    const currentStep = (this.sequenceConfig && this.sequenceConfig.steps[this.sequenceCurrentStepIndex]) || undefined;
    const targetMode = (this.sequenceConfig && this.sequenceConfig.mode) ? this.sequenceConfig.mode : (currentStep ? currentStep.mode : 'CV');
    const stepDuration = currentStep ? currentStep.totalDurationSeconds : 0;
    const stepRemaining = Math.max(0, stepDuration - this.sequenceStepElapsedSeconds);
    const totalProg = this.sequenceConfig ? this.sequenceConfig.totalProgrammedDurationSeconds : 0;
    const progressPct = totalProg > 0 ? Math.min(100, Math.round((this.sequenceTotalElapsedSeconds / totalProg) * 100)) : 0;
    const totalCycles = this.sequenceConfig ? this.sequenceConfig.cycles : 1;
    const currentCycle = Math.min(this.sequenceCurrentCycle, totalCycles);

    return {
      state: this.sequenceState,
      testName: this.sequenceConfig ? this.sequenceConfig.name : '',
      currentCycle,
      totalCycles,
      currentStepIndex: this.sequenceCurrentStepIndex,
      totalSteps: this.sequenceConfig ? this.sequenceConfig.steps.length : 0,
      currentStep,
      currentMode: targetMode,
      currentSetpoints: {
        v: currentStep?.setpointV ?? this.setpoints.cv,
        i: currentStep?.setpointI ?? this.setpoints.iset,
        r: currentStep?.setpointR ?? this.setpoints.rset,
        p: currentStep?.setpointP ?? this.setpoints.pset
      },
      stepDurationSeconds: stepDuration,
      stepRemainingSeconds: stepRemaining,
      totalElapsedSeconds: this.sequenceTotalElapsedSeconds,
      totalProgrammedDurationSeconds: totalProg,
      overallProgressPercent: progressPct,
      sequenceStepsConfig: this.sequenceConfig ? this.sequenceConfig.steps : []
    };
  }

  private emitSequenceProgress() {
    if (this.sequenceCallback) {
      this.sequenceCallback(this.getSequenceProgress());
    }
  }

  public async startSequence(config: SequenceConfig): Promise<{ success: boolean; error?: string }> {
    if (this.sequenceState === 'RUNNING' || this.sequenceState === 'PAUSED') {
      return { success: false, error: 'A test sequence is already active! Stop or wait for it to complete first.' };
    }

    // 1. Validation
    if (!config || !config.name || !config.name.trim()) {
      return { success: false, error: 'Test Name is required!' };
    }
    if (!config.cycles || config.cycles < 1 || !Number.isInteger(config.cycles)) {
      return { success: false, error: 'Number of cycles must be a positive integer (at least 1)!' };
    }
    if (!config.steps || config.steps.length === 0) {
      return { success: false, error: 'At least one test step must be added to the sequence!' };
    }

    const targetMode = config.mode || 'CV';

    // Validate each step against safety limits
    for (let i = 0; i < config.steps.length; i++) {
      const step = config.steps[i];
      if (step.totalDurationSeconds <= 0) {
        return { success: false, error: `Step #${i + 1} duration must be greater than 0 seconds!` };
      }

      const modeToValidate = config.mode || step.mode || 'CV';

      if (modeToValidate === 'CV') {
        if (step.setpointV === undefined || isNaN(step.setpointV) || step.setpointV < 0) {
          return { success: false, error: `Step #${i + 1} (CV): Invalid Voltage setpoint!` };
        }
        if (step.setpointV > this.engSettings.vmax) {
          return { success: false, error: `Step #${i + 1} (CV): Voltage setpoint (${step.setpointV}V) exceeds Maximum Safety Limit (${this.engSettings.vmax}V)!` };
        }
      } else if (modeToValidate === 'CC') {
        if (step.setpointI === undefined || isNaN(step.setpointI) || step.setpointI < 0) {
          return { success: false, error: `Step #${i + 1} (CC): Invalid Current setpoint!` };
        }
        if (step.setpointI > this.engSettings.imax) {
          return { success: false, error: `Step #${i + 1} (CC): Current setpoint (${step.setpointI}A) exceeds Maximum Safety Limit (${this.engSettings.imax}A)!` };
        }
      } else if (modeToValidate === 'CR') {
        if (step.setpointR === undefined || isNaN(step.setpointR) || step.setpointR <= 0) {
          return { success: false, error: `Step #${i + 1} (CR): Resistance setpoint must be greater than 0 Ω!` };
        }
        if (step.setpointR > this.engSettings.rmax) {
          return { success: false, error: `Step #${i + 1} (CR): Resistance setpoint (${step.setpointR}Ω) exceeds Maximum Safety Limit (${this.engSettings.rmax}Ω)!` };
        }
      } else if (modeToValidate === 'CP') {
        if (step.setpointP === undefined || isNaN(step.setpointP) || step.setpointP < 0) {
          return { success: false, error: `Step #${i + 1} (CP): Invalid Power setpoint!` };
        }
        if (step.setpointP > this.engSettings.pmax) {
          return { success: false, error: `Step #${i + 1} (CP): Power setpoint (${step.setpointP}W) exceeds Maximum Safety Limit (${this.engSettings.pmax}W)!` };
        }
      }
    }

    // 2. Hardware connection and safety checks
    if (!this.settings.isSimulator && (this.isCommFault || !this.isHardwareConnected)) {
      return { success: false, error: 'COMMUNICATION FAULT: Cannot start sequence because RS485 serial connection is offline!' };
    }

    // Initialize sequence state
    this.sequenceConfig = config;
    this.sequenceState = 'STARTING';
    this.sequenceCurrentCycle = 1;
    this.sequenceCurrentStepIndex = 0;
    this.sequenceStepElapsedSeconds = 0;
    this.sequenceTotalElapsedSeconds = 0;
    this.emitSequenceProgress();

    // Enable Hardware Output
    const outputRes = await this.setOutput(true);
    if (!outputRes.success) {
      this.sequenceState = 'FAULT';
      this.emitSequenceProgress();
      return { success: false, error: outputRes.error || 'Failed to turn hardware output ON for sequence!' };
    }

    // Apply Step 1
    const applyRes = await this.applySequenceStep(config.steps[0]);
    if (!applyRes.success) {
      await this.stopSequence('FAULT');
      return { success: false, error: applyRes.error };
    }

    this.sequenceState = 'RUNNING';
    this.emitSequenceProgress();

    // Start monotonic timer tick (1 second intervals in main process)
    if (this.sequenceTimer) clearInterval(this.sequenceTimer);
    this.sequenceTimer = setInterval(() => {
      this.tickSequenceTimer();
    }, 1000);

    return { success: true };
  }

  private async applySequenceStep(step: SequenceStep): Promise<{ success: boolean; error?: string }> {
    const targetMode = (this.sequenceConfig && this.sequenceConfig.mode) ? this.sequenceConfig.mode : step.mode;

    // 1. Set mode (with force = true for sequence mode transitions)
    const modeRes = await this.setMode(targetMode, true);
    if (!modeRes.success) {
      return modeRes;
    }

    // 2. Write mode-specific setpoints
    const sp: Partial<SetpointValues> = {};
    if (targetMode === 'CV') {
      sp.cv = step.setpointV ?? 24.0;
      if (step.setpointI !== undefined) sp.iset = step.setpointI;
    } else if (targetMode === 'CC') {
      sp.iset = step.setpointI ?? 5.0;
    } else if (targetMode === 'CR') {
      sp.rset = step.setpointR ?? 10.0;
    } else if (targetMode === 'CP') {
      sp.pset = step.setpointP ?? 120.0;
    }

    const spRes = await this.writeSetpoints(sp);
    if (!spRes.success) {
      return spRes;
    }

    return { success: true };
  }

  private async tickSequenceTimer() {
    if (this.sequenceState !== 'RUNNING') return;
    if (!this.sequenceConfig) return;

    // Safety Interlock: if hardware comm fault or output turned OFF unexpectedly
    if (!this.outputState || (!this.settings.isSimulator && this.isCommFault)) {
      await this.stopSequence('FAULT');
      return;
    }

    this.sequenceStepElapsedSeconds++;
    this.sequenceTotalElapsedSeconds++;

    const currentStep = this.sequenceConfig.steps[this.sequenceCurrentStepIndex];
    if (this.sequenceStepElapsedSeconds >= currentStep.totalDurationSeconds) {
      // Step Completed -> Advance to Next Step
      this.sequenceCurrentStepIndex++;
      this.sequenceStepElapsedSeconds = 0;

      if (this.sequenceCurrentStepIndex >= this.sequenceConfig.steps.length) {
        // Cycle Completed -> Check remaining cycles
        if (this.sequenceCurrentCycle >= this.sequenceConfig.cycles) {
          // Entire Sequence Completed!
          await this.stopSequence('COMPLETED');
          return;
        }
        this.sequenceCurrentStepIndex = 0;
        this.sequenceCurrentCycle++;
      }

      // Apply next step setpoints
      const nextStep = this.sequenceConfig.steps[this.sequenceCurrentStepIndex];
      const applyRes = await this.applySequenceStep(nextStep);
      if (!applyRes.success) {
        await this.stopSequence('FAULT');
        return;
      }
    }

    this.emitSequenceProgress();
  }

  public pauseSequence(): { success: boolean; error?: string } {
    if (this.sequenceState !== 'RUNNING') {
      return { success: false, error: 'Sequence is not currently running!' };
    }
    this.sequenceState = 'PAUSED';
    this.emitSequenceProgress();
    return { success: true };
  }

  public resumeSequence(): { success: boolean; error?: string } {
    if (this.sequenceState !== 'PAUSED') {
      return { success: false, error: 'Sequence is not paused!' };
    }
    this.sequenceState = 'RUNNING';
    this.emitSequenceProgress();
    return { success: true };
  }

  public async stopSequence(reason: 'COMPLETED' | 'STOPPED' | 'ABORTED' | 'FAULT' = 'STOPPED'): Promise<{ success: boolean }> {
    if (this.sequenceTimer) {
      clearInterval(this.sequenceTimer);
      this.sequenceTimer = null;
    }

    this.sequenceState = reason === 'COMPLETED' ? 'COMPLETED' : (reason === 'FAULT' ? 'FAULT' : 'ABORTED');

    // Priority Emergency OFF Output Command
    await this.setOutput(false);

    this.emitSequenceProgress();
    return { success: true };
  }
}
