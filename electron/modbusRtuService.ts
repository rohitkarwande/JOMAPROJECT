import ModbusRTU from 'modbus-serial';
import {
  BUILTIN_PROFILES,
  CLIENT_CSV_REGISTERS_BASE1,
  CLIENT_CSV_REGISTERS_BASE0,
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

class SerialBusLock {
  private queue: Promise<any> = Promise.resolve();

  public async runExclusive<T>(fn: () => Promise<T>, interDelayMs: number = 35): Promise<T> {
    const execute = async () => {
      try {
        const result = await fn();
        if (interDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, interDelayMs));
        }
        return result;
      } catch (err) {
        if (interDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, interDelayMs));
        }
        throw err;
      }
    };

    const nextPromise = this.queue.then(execute, execute);
    this.queue = nextPromise.catch(() => {});
    return nextPromise;
  }
}

export interface CommandQueueItem {
  id: string;
  priority: number; // 0 = Priority Emergency OFF, 1 = Setpoint write / mode, 2 = Poll query
  action: () => Promise<boolean>;
}

export class ModbusRtuService {
  private serialLock = new SerialBusLock();
  private isBaseDetected: boolean = true;

  private settings: ConnectionSettings = {
    port: 'COM4',
    baudRate: 9600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    slaveId: 1,
    pollingIntervalMs: 500,
    isSimulator: false,
    selectedProfileId: 'CLIENT_CSV_PROFILE',
    registers: CLIENT_CSV_REGISTERS_BASE0,
    wordSwap: true // Default: CDAB (Word-Swapped / Low Word First - Standard HMI)
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
  private currentOpenPort: string | null = null;
  private currentOpenBaud: number | null = null;
  private connectLock: Promise<boolean> | null = null;
  private lastTelemetryWarnTime: number = 0;

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
  private isConnecting: boolean = false;
  private isPollingActive: boolean = false;

  constructor() {
    this.updateActiveProfile(this.settings.selectedProfileId);
    this.settings.registers = CLIENT_CSV_REGISTERS_BASE0;
    this.settings.isSimulator = false;
    this.isBaseDetected = true;
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
    this.settings.isSimulator = false;

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

    this.settings = { ...this.settings, ...newSettings, isSimulator: false };

    if (newSettings.customVoltageScale !== undefined) {
      this.activeProfile.voltageScale = newSettings.customVoltageScale;
    }
    if (newSettings.customCurrentScale !== undefined) {
      this.activeProfile.currentScale = newSettings.customCurrentScale;
    }
    if (newSettings.customOutputControlFc !== undefined) {
      this.activeProfile.outputControlFc = newSettings.customOutputControlFc;
    }

    // Connect physical hardware serial connection
    const connected = await this.connectHardware();

    if (this.statusCallback) {
      this.statusCallback(this.isHardwareConnected ? 'CONNECTED' : 'DISCONNECTED');
    }
    if (connected) {
      this.restartPolling();
    } else {
      this.stopPolling();
    }
    return connected;
  }

  public async closeClient(): Promise<void> {
    if (this.modbusClient) {
      try {
        if (typeof (this.modbusClient as any)._cancelPendingTransactions === 'function') {
          (this.modbusClient as any)._cancelPendingTransactions();
        }

        const underlyingPort = (this.modbusClient as any)._port;
        const underlyingClient = underlyingPort?._client;

        if (this.modbusClient.isOpen || (underlyingClient && underlyingClient.isOpen)) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              try {
                if (underlyingClient?.destroy) underlyingClient.destroy();
              } catch (e) {}
              resolve();
            }, 600);

            try {
              this.modbusClient?.close(() => {
                clearTimeout(timer);
                resolve();
              });
            } catch (e) {
              clearTimeout(timer);
              resolve();
            }
          });
        }

        // Remove listeners ONLY after close has resolved
        try {
          (this.modbusClient as any)?.removeAllListeners?.();
          if (underlyingPort?.removeAllListeners) underlyingPort.removeAllListeners();
          if (underlyingClient?.removeAllListeners) underlyingClient.removeAllListeners();
        } catch (e) {}
      } catch (e) {
        console.warn('[RS485] Error while closing port client:', e);
      }
      this.modbusClient = null;
    }
    this.currentOpenPort = null;
    this.currentOpenBaud = null;
    this.isHardwareConnected = false;
    // Essential for Windows USB-Serial drivers (CH340, CP2102, FTDI):
    // Windows kernel driver holds the COM port handle for a short period after close.
    // Waiting 1000ms ensures the OS releases \\.\COMx so that subsequent connection attempts succeed.
    await new Promise((r) => setTimeout(r, 1000));
  }

  public async disconnectHardware(): Promise<void> {
    this.stopPolling();
    await this.closeClient();
    this.isHardwareConnected = false;
    this.isCommFault = false;
    if (this.statusCallback) {
      this.statusCallback('DISCONNECTED');
    }
  }

  public async connectHardware(retryCount: number = 0): Promise<boolean> {
    if (this.settings.isSimulator) return true;

    if (this.connectLock) {
      return this.connectLock;
    }

    this.connectLock = this._executeConnectHardware(retryCount);
    try {
      return await this.connectLock;
    } finally {
      this.connectLock = null;
    }
  }

  private async _executeConnectHardware(retryCount: number = 0): Promise<boolean> {
    try {
      // 1. If already open on the exact same port and baud rate, reuse without closing/reopening!
      if (
        this.modbusClient &&
        this.modbusClient.isOpen &&
        this.currentOpenPort === this.settings.port &&
        this.currentOpenBaud === this.settings.baudRate
      ) {
        this.modbusClient.setID(this.settings.slaveId);
        this.modbusClient.setTimeout(1000);
        this.isHardwareConnected = true;
        this.isCommFault = false;
        this.consecutiveErrors = 0;
        if (this.statusCallback) {
          this.statusCallback('CONNECTED');
        }
        return true;
      }

      await this.closeClient();

      this.modbusClient = new ModbusRTU();

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
        await this.modbusClient.connectRTUBuffered(this.settings.port, serialOpts);
      }

      this.modbusClient.setID(this.settings.slaveId);
      this.modbusClient.setTimeout(1000);

      this.currentOpenPort = this.settings.port;
      this.currentOpenBaud = this.settings.baudRate;
      this.isHardwareConnected = true;
      this.isCommFault = false;
      this.consecutiveErrors = 0;

      if (this.statusCallback) {
        this.statusCallback('CONNECTED');
      }
      return true;
    } catch (err: any) {
      console.warn(`[RS485 Connection] Failed to connect to ${this.settings.port}:`, err?.message || err);
      await this.closeClient();
      this.isHardwareConnected = false;
      this.currentOpenPort = null;

      // Auto-retry up to 2 times on Windows Error 31 (SetCommState) or Access Denied
      const errStr = String(err?.message || err).toLowerCase();
      if (retryCount < 2 && (errStr.includes('31') || errStr.includes('access denied'))) {
        console.log(`[RS485] Windows COM handle busy (${errStr}). Waiting 1.5s for driver release (retry ${retryCount + 1}/2)...`);
        await new Promise((r) => setTimeout(r, 1500));
        return this._executeConnectHardware(retryCount + 1);
      }

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
      this.statusCallback(this.settings.isSimulator ? 'SIMULATOR' : (this.isHardwareConnected ? 'CONNECTED' : 'DISCONNECTED'));
    }
  }

  private readFloatFromBuffer(registers: number[], offsetIndex: number): number {
    if (!registers || registers.length <= offsetIndex) return 0;

    const reg0 = registers[offsetIndex] || 0;

    if (registers.length >= offsetIndex + 2) {
      const reg1 = registers[offsetIndex + 1] || 0;

      // Handle float 0.000 immediately when both registers are zero
      if (reg0 === 0 && reg1 === 0) {
        return 0.0;
      }

      // Calculate candidate 1: Standard IEEE 754 Big Endian (ABCD: High word reg0, Low word reg1)
      const bufBE = Buffer.alloc(4);
      bufBE.writeUInt16BE(reg0, 0);
      bufBE.writeUInt16BE(reg1, 2);
      const valBE = bufBE.readFloatBE(0);

      // Calculate candidate 2: Word-Swapped IEEE 754 (CDAB: Low word reg0, High word reg1)
      const bufLE = Buffer.alloc(4);
      bufLE.writeUInt16BE(reg1, 0);
      bufLE.writeUInt16BE(reg0, 2);
      const valLE = bufLE.readFloatBE(0);

      const isCandidateValid = (v: number) => !isNaN(v) && isFinite(v);
      const validBE = isCandidateValid(valBE);
      const validLE = isCandidateValid(valLE);

      const isWordSwap = this.settings.wordSwap !== false;

      // If wordSwap is TRUE (CDAB / Low Word First - default on most industrial HMIs and PLCs):
      if (isWordSwap) {
        if (validLE && valLE >= 0 && valLE < 100000) {
          return parseFloat(valLE.toFixed(3));
        }
        if (validBE && valBE >= 0 && valBE < 100000) {
          return parseFloat(valBE.toFixed(3));
        }
        if (validLE) return parseFloat(valLE.toFixed(3));
      } else {
        // If wordSwap is FALSE (ABCD / High Word First - Big Endian):
        if (validBE && valBE >= 0 && valBE < 100000) {
          return parseFloat(valBE.toFixed(3));
        }
        if (validLE && valLE >= 0 && valLE < 100000) {
          return parseFloat(valLE.toFixed(3));
        }
        if (validBE) return parseFloat(valBE.toFixed(3));
      }

      // 3. Fallback for ModSim32 integer word entry (e.g. user typed 24 or 2400 into 40001)
      if (reg0 > 0 && reg1 === 0) {
        return reg0 > 1000 ? parseFloat((reg0 / 100).toFixed(3)) : reg0;
      }
    }

    // 4. Single 16-bit register fallback
    if (reg0 > 0) {
      return reg0 > 1000 ? parseFloat((reg0 / 100).toFixed(3)) : reg0;
    }

    return 0.0;
  }

  private floatToRegisters(val: number): [number, number] {
    const buf = Buffer.alloc(4);
    buf.writeFloatBE(val || 0, 0);
    const highWord = buf.readUInt16BE(0);
    const lowWord = buf.readUInt16BE(2);

    // Default to true (CDAB / Low Word First - Standard for Modbus HMIs and PLCs)
    const isWordSwap = this.settings.wordSwap !== false;
    if (isWordSwap) {
      // CDAB: Register N receives Low Word, Register N+1 receives High Word
      return [lowWord, highWord];
    } else {
      // ABCD: Register N receives High Word, Register N+1 receives Low Word
      return [highWord, lowWord];
    }
  }

  private async writeFloatRegisters(addr: number, val: number): Promise<void> {
    if (!this.modbusClient || !this.modbusClient.isOpen) return;
    const regs = this.floatToRegisters(val);
    try {
      // Primary: Function Code 16 (Preset Multiple Registers)
      await this.modbusClient.writeRegisters(addr, regs);
    } catch (fc16Err: any) {
      console.warn(`[RS485] FC16 write failed at address ${addr} (${fc16Err?.message || fc16Err}). Trying FC06 single-register writes...`);
      // Fallback: Function Code 06 (Preset Single Register) written word by word
      try {
        await this.modbusClient.writeRegister(addr, regs[0]);
        await new Promise((r) => setTimeout(r, 20));
        await this.modbusClient.writeRegister(addr + 1, regs[1]);
      } catch (fc6Err) {
        throw fc16Err;
      }
    }
  }

  public async resetBatTest(): Promise<{ success: boolean }> {
    this.batTestStartTime = Date.now();
    this.batTestAccumulatedAh = 0;
    this.simBatteryVoltage = 12.80;

    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      await this.serialLock.runExclusive(async () => {
        try {
          const regs = this.settings.registers;
          if (regs.hrs !== undefined) await this.writeFloatRegisters(regs.hrs, 0);
          if (regs.min !== undefined) await this.writeFloatRegisters(regs.min, 0);
          if (regs.ah !== undefined) await this.writeFloatRegisters(regs.ah, 0);
        } catch (err) {
          console.warn('RS485 Reset Bat Test Error:', err);
        }
      });
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
      return this.serialLock.runExclusive(async () => {
        try {
          const modeMap: Record<OperationMode, number> = { CV: 6, CC: 7, CR: 8, CP: 9, 'BAT TEST': 14 };
          await this.modbusClient!.writeRegister(this.settings.registers.mode, modeMap[mode] ?? 6);
          return { success: true };
        } catch (err: any) {
          console.error('Error writing Mode over RS485:', err);
          return { success: false, error: this.formatModbusError('Mode Selection', err) };
        }
      });
    }

    return { success: true };
  }

  public async clearAlarmCoil(coilIndex: number): Promise<{ success: boolean }> {
    this.simForcePowerExceed = false;
    this.simForceVoltExceed = false;
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      await this.serialLock.runExclusive(async () => {
        try {
          await this.modbusClient!.writeCoil(coilIndex, false);
        } catch (err) {
          console.warn('RS485 Clear Alarm Coil Write Error:', err);
        }
      });
    }
    return { success: true };
  }

  // Diagnostic Register Read for Live Hardware Verification
  public async diagReadRegister(params: { type: 'FLOAT' | 'COIL' | 'INT'; address: number }): Promise<{ success: boolean; value?: number | boolean; error?: string }> {
    if (!this.modbusClient || !this.modbusClient.isOpen) {
      const err = `RS485 Port ${this.settings.port} is not open!`;
      console.error(`[RS485 Diag Read Error] ${err}`);
      return { success: false, error: err };
    }

    return this.serialLock.runExclusive(async () => {
      try {
        if (params.type === 'FLOAT') {
          const res = await this.modbusClient!.readHoldingRegisters(params.address, 2);
          if (!res || !res.data || res.data.length < 2) {
            throw new Error(`Insufficient registers returned from address ${params.address}`);
          }
          const val = this.readFloatFromBuffer(res.data, 0);
          console.log(`[RS485 Diag Read] Address ${params.address} (FLOAT): ${val} [Words: ${res.data[0]}, ${res.data[1]}]`);
          return { success: true, value: val };
        } else if (params.type === 'COIL') {
          const res = await this.modbusClient!.readCoils(params.address, 1);
          if (!res || !res.data || res.data.length < 1) {
            throw new Error(`Insufficient coil data returned from address ${params.address}`);
          }
          const val = Boolean(res.data[0]);
          console.log(`[RS485 Diag Read] Coil ${params.address}: ${val ? '1 (ON)' : '0 (OFF)'}`);
          return { success: true, value: val };
        } else {
          // INT (1 Register)
          const res = await this.modbusClient!.readHoldingRegisters(params.address, 1);
          if (!res || !res.data || res.data.length < 1) {
            throw new Error(`Insufficient register data returned from address ${params.address}`);
          }
          const val = res.data[0];
          console.log(`[RS485 Diag Read] Address ${params.address} (INT): ${val}`);
          return { success: true, value: val };
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        console.error(`[RS485 Diag Read Error] Failed reading address ${params.address} (${params.type}):`, errMsg);
        return { success: false, error: errMsg };
      }
    });
  }

  // Diagnostic Register Write for Live Hardware Verification
  public async diagWriteRegister(params: { type: 'FLOAT' | 'COIL' | 'INT'; address: number; value: number | boolean }): Promise<{ success: boolean; error?: string }> {
    if (!this.modbusClient || !this.modbusClient.isOpen) {
      const err = `RS485 Port ${this.settings.port} is not open!`;
      console.error(`[RS485 Diag Write Error] ${err}`);
      return { success: false, error: err };
    }

    return this.serialLock.runExclusive(async () => {
      try {
        if (params.type === 'FLOAT') {
          console.log(`[RS485 Diag Write] Writing FLOAT ${params.value} to address ${params.address}...`);
          await this.writeFloatRegisters(params.address, Number(params.value));
          console.log(`[RS485 Diag Write Success] Address ${params.address} (FLOAT) = ${params.value}`);
          return { success: true };
        } else if (params.type === 'COIL') {
          console.log(`[RS485 Diag Write] Writing COIL ${params.value ? '1' : '0'} to address ${params.address}...`);
          await this.modbusClient!.writeCoil(params.address, Boolean(params.value));
          console.log(`[RS485 Diag Write Success] Address ${params.address} (COIL) = ${params.value ? '1' : '0'}`);
          return { success: true };
        } else {
          // INT (1 Register)
          console.log(`[RS485 Diag Write] Writing INT ${params.value} to address ${params.address}...`);
          await this.modbusClient!.writeRegister(params.address, Number(params.value));
          console.log(`[RS485 Diag Write Success] Address ${params.address} (INT) = ${params.value}`);
          return { success: true };
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        console.error(`[RS485 Diag Write Error] Failed writing address ${params.address} (${params.type}) = ${params.value}:`, errMsg);
        return { success: false, error: errMsg };
      }
    });
  }

  // Diagnostic Bulk Read for Instant HMI Reading & Real-Time Sync
  public async diagReadAllRegisters(): Promise<{
    success: boolean;
    registers?: Record<string, { value: number | boolean; formatted: string }>;
    error?: string;
  }> {
    if (!this.modbusClient || !this.modbusClient.isOpen) {
      const err = `RS485 Port ${this.settings.port} is not open!`;
      return { success: false, error: err };
    }

    return this.serialLock.runExclusive(async () => {
      try {
        const isBase1 = this.settings.registers.addressBase === 1 || this.settings.registers.vmon === 1;
        const baseH = isBase1 ? 1 : 0;
        const baseC = isBase1 ? 1 : 0;

        let b1: number[] = [];
        let b2: number[] = [];
        let c: boolean[] = [];

        // Attempt block reads first (fastest, takes ~60ms total)
        try {
          const res1 = await this.modbusClient!.readHoldingRegisters(baseH, 16);
          b1 = res1.data;
          await new Promise((r) => setTimeout(r, 20));

          const res2 = await this.modbusClient!.readHoldingRegisters(baseH + 16, 15);
          b2 = res2.data;
          await new Promise((r) => setTimeout(r, 20));

          const resC = await this.modbusClient!.readCoils(baseC, 4);
          c = resC.data;
        } catch (blockErr) {
          // Fallback: Read in individual registers if slave controller does not support 16-register block reads
          console.warn('[RS485 Diag Read All] Block read failed, falling back to safe individual reads:', blockErr);
          const allHolding: number[] = [];
          for (let i = 0; i < 31; i++) {
            try {
              const single = await this.modbusClient!.readHoldingRegisters(baseH + i, 1);
              allHolding.push(single.data[0]);
            } catch {
              allHolding.push(0);
            }
            await new Promise((r) => setTimeout(r, 10));
          }
          b1 = allHolding.slice(0, 16);
          b2 = allHolding.slice(16, 31);
          try {
            const resC = await this.modbusClient!.readCoils(baseC, 4);
            c = resC.data;
          } catch {
            c = [false, false, false, false];
          }
        }

        const vmon = this.readFloatFromBuffer(b1, 0);
        const imon = this.readFloatFromBuffer(b1, 2);
        const cvVolt = this.readFloatFromBuffer(b1, 4);
        const vMax = this.readFloatFromBuffer(b1, 6);
        const iMax = this.readFloatFromBuffer(b1, 8);
        const pMax = this.readFloatFromBuffer(b1, 10);
        const iRange = this.readFloatFromBuffer(b1, 12);
        const iRow = this.readFloatFromBuffer(b1, 14);

        const rCr = this.readFloatFromBuffer(b2, 0);
        const pCp = this.readFloatFromBuffer(b2, 2);
        const vCut = this.readFloatFromBuffer(b2, 4);
        const hrs = this.readFloatFromBuffer(b2, 6);
        const min = this.readFloatFromBuffer(b2, 8);
        const ah = this.readFloatFromBuffer(b2, 10);
        const modeSel = b2[12] ?? 6;
        const rMax = this.readFloatFromBuffer(b2, 13);

        const startStop = Boolean(c[0]);
        const batSubMode = Boolean(c[1]);
        const popPower = Boolean(c[2]);
        const popVolt = Boolean(c[3]);

        const modeMap: Record<number, string> = { 6: '6 (CV)', 7: '7 (CC)', 8: '8 (CR)', 9: '9 (CP)', 14: '14 (BAT)' };

        // Two-way synchronization with app state if hardware changed on HMI:
        if (this.outputState !== startStop) {
          this.outputState = startStop;
          this.outputConfirmedState = startStop ? 'ON' : 'OFF';
        }
        if (modeSel === 6) this.currentMode = 'CV';
        else if (modeSel === 7) this.currentMode = 'CC';
        else if (modeSel === 8) this.currentMode = 'CR';
        else if (modeSel === 9) this.currentMode = 'CP';
        else if (modeSel === 14) this.currentMode = 'BAT TEST';

        const result: Record<string, { value: number | boolean; formatted: string }> = {
          V_MON: { value: vmon, formatted: `${vmon.toFixed(3)} V` },
          I_MON: { value: imon, formatted: `${imon.toFixed(3)} A` },
          START_STOP: { value: startStop, formatted: startStop ? '1 (ON)' : '0 (OFF)' },
          CV_VOLT: { value: cvVolt, formatted: `${cvVolt.toFixed(3)} V` },
          V_MAX: { value: vMax, formatted: `${vMax.toFixed(2)} V` },
          I_MAX: { value: iMax, formatted: `${iMax.toFixed(2)} A` },
          P_MAX: { value: pMax, formatted: `${pMax.toFixed(1)} W` },
          I_SET_RANGE_CC: { value: iRange, formatted: `${iRange.toFixed(3)} A` },
          I_SET_ROW_CC: { value: iRow, formatted: `${iRow.toFixed(3)} A` },
          RESISTOR_CR_MODE: { value: rCr, formatted: `${rCr.toFixed(2)} Ω` },
          POWER_CP_MODE: { value: pCp, formatted: `${pCp.toFixed(1)} W` },
          VCUTOFF: { value: vCut, formatted: `${vCut.toFixed(2)} V` },
          HRS: { value: hrs, formatted: `${Math.round(hrs)} Hrs` },
          MIN: { value: min, formatted: `${Math.round(min)} Min` },
          AH: { value: ah, formatted: `${ah.toFixed(1)} Ah` },
          CC_CR_BAT_MODE: { value: batSubMode, formatted: batSubMode ? '1 (CR)' : '0 (CC)' },
          POP_POWER_exceed: { value: popPower, formatted: popPower ? '1 (ALARM)' : '0 (NORMAL)' },
          POP_VOLT_exceed: { value: popVolt, formatted: popVolt ? '1 (ALARM)' : '0 (NORMAL)' },
          MODE_SELECTION: { value: modeSel, formatted: modeMap[modeSel] || String(modeSel) },
          R_MAX: { value: rMax, formatted: `${rMax.toFixed(2)} Ω` }
        };

        return { success: true, registers: result };
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        console.error('[RS485 Diag Read All Error]:', errMsg);
        return { success: false, error: errMsg };
      }
    });
  }

  // Backend Limit Enforcement & Setpoint Sanitization
  public async writeSetpoints(newSetpoints: Partial<SetpointValues>): Promise<{ success: boolean; error?: string }> {
    // 1. Enforce safety limits
    if (newSetpoints.iset !== undefined && this.setpoints.imax > 0 && newSetpoints.iset > this.setpoints.imax) {
      const err = `I Target (${newSetpoints.iset} A) exceeds I_SET_RANGE_CC limit (${this.setpoints.imax.toFixed(3)} A)!`;
      console.warn(`[RS485 Warning] ${err}`);
      return { success: false, error: err };
    }
    if (newSetpoints.rset !== undefined && this.engSettings.rmax > 0 && newSetpoints.rset > this.engSettings.rmax) {
      const err = `Resistance (${newSetpoints.rset} Ω) exceeds R_MAX limit (${this.engSettings.rmax.toFixed(2)} Ω)!`;
      console.warn(`[RS485 Warning] ${err}`);
      return { success: false, error: err };
    }
    if (newSetpoints.cv !== undefined && this.engSettings.vmax > 0 && newSetpoints.cv > this.engSettings.vmax) {
      const err = `CV Voltage (${newSetpoints.cv} V) exceeds V_MAX limit (${this.engSettings.vmax.toFixed(2)} V)!`;
      console.warn(`[RS485 Warning] ${err}`);
      return { success: false, error: err };
    }
    if (newSetpoints.cutoffV !== undefined && this.engSettings.vmax > 0 && newSetpoints.cutoffV > this.engSettings.vmax) {
      const err = `Cutoff Voltage (${newSetpoints.cutoffV} V) exceeds V_MAX limit (${this.engSettings.vmax.toFixed(2)} V)!`;
      console.warn(`[RS485 Warning] ${err}`);
      return { success: false, error: err };
    }
    if (newSetpoints.pset !== undefined && this.engSettings.pmax > 0 && newSetpoints.pset > this.engSettings.pmax) {
      const err = `Power (${newSetpoints.pset} W) exceeds P_MAX limit (${this.engSettings.pmax.toFixed(1)} W)!`;
      console.warn(`[RS485 Warning] ${err}`);
      return { success: false, error: err };
    }

    const candidate = { ...this.setpoints, ...newSetpoints };
    this.setpoints = candidate;

    // Write Setpoints over Physical RS485 Modbus RTU Serial Port (32-bit IEEE 754 Floats)
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      return this.serialLock.runExclusive(async () => {
        try {
          const regs = this.settings.registers;
          const mode = this.currentMode;

          // 1. CV Mode: Write CV_VOLT (4X 5 / Wire 4)
          // In CV mode, I_SET_ROW_CC (register 14) is a READ-ONLY HMI monitoring register according to client CSV!
          // We MUST NOT write iset in CV mode!
          if (newSetpoints.cv !== undefined && regs.vset !== undefined) {
            console.log(`[RS485] Writing CV setpoint: ${newSetpoints.cv} to address ${regs.vset}`);
            await this.writeFloatRegisters(regs.vset, newSetpoints.cv);
          }

          // 2. CC / CP / BAT TEST Mode: Write I_SET_ROW_CC (4X 15 / Wire 14)
          if (newSetpoints.iset !== undefined && regs.iset !== undefined) {
            if (mode === 'CV' || mode === 'CR') {
              console.log(`[RS485] Mode is ${mode}: I Limit is monitored from HMI. Skipping physical write to address ${regs.iset}.`);
            } else {
              console.log(`[RS485] Writing Iset: ${newSetpoints.iset} to address ${regs.iset}`);
              await this.writeFloatRegisters(regs.iset, newSetpoints.iset);
            }
          }

          // 3. CC Mode: I_SET_RANGE_CC (I MAX CC MODE, 4X 13 / Wire 12)
          // Per user specification: I_SET_RANGE_CC is controlled exclusively on the HMI and must never be written from the PC app.

          // 4. CR Mode or BAT TEST (CR): RESISTOR_CR_MODE (4X 17 / Wire 16)
          if (newSetpoints.rset !== undefined && regs.rset !== undefined && (mode === 'CR' || mode === 'BAT TEST')) {
            console.log(`[RS485] Writing Rset: ${newSetpoints.rset} to address ${regs.rset}`);
            await this.writeFloatRegisters(regs.rset, newSetpoints.rset);
          }

          // 5. CP Mode: POWER_CP_MODE (4X 19 / Wire 18)
          if (newSetpoints.pset !== undefined && regs.pset !== undefined && mode === 'CP') {
            console.log(`[RS485] Writing Pset: ${newSetpoints.pset} to address ${regs.pset}`);
            await this.writeFloatRegisters(regs.pset, newSetpoints.pset);
          }

          // 6. BAT TEST Mode: VCUTOFF, HRS, MIN, AH, SUBMODE
          if (mode === 'BAT TEST') {
            if (newSetpoints.cutoffV !== undefined && regs.cutoffV !== undefined) {
              await this.writeFloatRegisters(regs.cutoffV, newSetpoints.cutoffV);
            }
            if (newSetpoints.hrs !== undefined && regs.hrs !== undefined) {
              await this.writeFloatRegisters(regs.hrs, newSetpoints.hrs);
            }
            if (newSetpoints.min !== undefined && regs.min !== undefined) {
              await this.writeFloatRegisters(regs.min, newSetpoints.min);
            }
            if (newSetpoints.ah !== undefined && regs.ah !== undefined) {
              await this.writeFloatRegisters(regs.ah, newSetpoints.ah);
            }
            if (newSetpoints.batTestSubMode !== undefined && regs.batSubModeCoil !== undefined) {
              await this.modbusClient!.writeCoil(regs.batSubModeCoil, newSetpoints.batTestSubMode === 'CR');
            }
          }

          return { success: true };
        } catch (err: any) {
          console.error('RS485 Setpoint Write Failure:', err);
          this.isCommFault = true;
          return { success: false, error: this.formatModbusError('RS485 Setpoint Write', err) };
        }
      });
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
      return this.serialLock.runExclusive(async () => {
        try {
          const regs = this.settings.registers;

          if (newEng.vmax !== undefined && regs.vmaxLimit !== undefined) {
            await this.writeFloatRegisters(regs.vmaxLimit, newEng.vmax);
          }
          if (newEng.imax !== undefined && regs.imaxLimit !== undefined) {
            await this.writeFloatRegisters(regs.imaxLimit, newEng.imax);
          }
          if (newEng.pmax !== undefined && regs.pmaxLimit !== undefined) {
            await this.writeFloatRegisters(regs.pmaxLimit, newEng.pmax);
          }
          if (newEng.rmax !== undefined && regs.rmaxLimit !== undefined) {
            await this.writeFloatRegisters(regs.rmaxLimit, newEng.rmax);
          }
          return { success: true };
        } catch (err: any) {
          console.error('RS485 Eng Settings Write Error:', err);
          return { success: false, error: this.formatModbusError('RS485 Eng Settings Write', err) };
        }
      });
    }

    return { success: true };
  }

  private formatModbusError(action: string, err: any): string {
    const errMsg = String(err?.message || err);
    const isTimeout = /timed?\s*out|ETIMEDOUT|TransactionTimedOutError/i.test(errMsg);

    if (isTimeout) {
      return `${action} Failed: Hardware at Slave ID ${this.settings.slaveId} is not responding on ${this.settings.port} at ${this.settings.baudRate} bps (Timed Out).\n\nPlease verify:\n1. Baud Rate: Ensure the Baud Rate in RS485 Settings matches your device setting (e.g. 9600, 115200).\n2. Slave ID: Ensure Slave ID (${this.settings.slaveId}) matches the Modbus address in your hardware menu.\n3. RS485 Polarity: Try swapping A+ and B- wires on your USB adapter.\n4. Device Power: Ensure the DC power supply / electronic load is turned ON.`;
    }

    return `${action} Failed: ${errMsg}`;
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

    // 2. Reject OUTPUT ON if serial port is not open
    if (state && !this.settings.isSimulator && (!this.isHardwareConnected || !this.modbusClient || !this.modbusClient.isOpen)) {
      const reconnected = await this.connectHardware();
      if (!reconnected) {
        return {
          success: false,
          error: 'COMMUNICATION FAULT: RS485 serial connection is not open on port ' + this.settings.port + '. Please verify your USB-to-RS485 adapter and COM port settings in RS485 Settings.'
        };
      }
    }

    // 3. Physical Hardware Serial Command Execution protected by SerialBusLock
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      const res = await this.serialLock.runExclusive(async () => {
        try {
          const regs = this.settings.registers;
          const fc = this.activeProfile.outputControlFc || 5;

          if (fc === 5) {
            try {
              await this.modbusClient!.writeCoil(regs.outputCoil ?? 0, state);
            } catch (coilErr) {
              // Fallback: If device is holding register only (FC06), write to holding register
              await this.modbusClient!.writeRegister(regs.outputCoil ?? 0, state ? 1 : 0);
            }
          } else {
            await this.modbusClient!.writeRegister(regs.outputCoil ?? 0, state ? 1 : 0);
          }
          return { success: true };
        } catch (err: any) {
          console.error('RS485 Output Control Error:', err);
          return { success: false, error: this.formatModbusError('Hardware Output Command', err) };
        }
      });

      if (!res.success) {
        return res;
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
    this.stopPolling();

    if (!this.modbusClient || !this.modbusClient.isOpen) {
      return;
    }

    this.isHardwareConnected = true;
    this.scheduleNextPoll(100);
  }

  public stopPolling() {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private restartPolling() {
    this.startPolling();
  }

  private scheduleNextPoll(delayMs?: number) {
    if (this.pollingTimer) clearTimeout(this.pollingTimer);
    const delay = delayMs !== undefined ? delayMs : Math.max(150, this.settings.pollingIntervalMs);
    this.pollingTimer = setTimeout(async () => {
      await this.pollTelemetry();
      if (this.modbusClient && this.modbusClient.isOpen) {
        this.scheduleNextPoll();
      }
    }, delay);
  }

  private async pollTelemetry() {
    if (this.isPollingActive || !this.modbusClient || !this.modbusClient.isOpen) return;
    this.isPollingActive = true;

    try {
      let point: TelemetryPoint;

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
          isStale: true,
          deviceResponding: false
        };
      }

      if (this.telemetryCallback) {
        this.telemetryCallback(point);
      }
    } finally {
      this.isPollingActive = false;
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
    if (!this.modbusClient || !this.modbusClient.isOpen) {
      if (this.isHardwareConnected) {
        this.isHardwareConnected = false;
        this.currentOpenPort = null;
        if (this.statusCallback) this.statusCallback('DISCONNECTED');
      }
      return null;
    }

    return this.serialLock.runExclusive(async () => {
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

        // Primary read: 4 registers starting at vmon (vmon = 2 regs, imon = 2 regs)
        let readSuccess = false;
        const activeVmonAddr = regs.vmon ?? 0;

        try {
          const holdRes = await this.modbusClient.readHoldingRegisters(activeVmonAddr, 4);
          if (holdRes && holdRes.data && holdRes.data.length >= 4) {
            vmon = this.readFloatFromBuffer(holdRes.data, 0);
            imon = this.readFloatFromBuffer(holdRes.data, 2);
            readSuccess = true;
          }
        } catch (fc3Err: any) {
          // If first boot and base not fixed, check alternate base once
          if (!this.isBaseDetected) {
            const altAddr = activeVmonAddr === 1 ? 0 : 1;
            try {
              const altHoldRes = await this.modbusClient.readHoldingRegisters(altAddr, 4);
              if (altHoldRes && altHoldRes.data && altHoldRes.data.length >= 4) {
                vmon = this.readFloatFromBuffer(altHoldRes.data, 0);
                imon = this.readFloatFromBuffer(altHoldRes.data, 2);
                readSuccess = true;
                this.isBaseDetected = true;
                if (altAddr === 0) {
                  console.log('[RS485 Telemetry] Auto-detected Base 0 wire addressing.');
                  this.settings.registers = CLIENT_CSV_REGISTERS_BASE0;
                } else {
                  console.log('[RS485 Telemetry] Auto-detected Base 1 direct CSV addressing.');
                  this.settings.registers = CLIENT_CSV_REGISTERS_BASE1;
                }
              }
            } catch (altErr) {
              // Try FC04 Input Registers
              try {
                const inputRes = await this.modbusClient.readInputRegisters(activeVmonAddr, 4);
                if (inputRes && inputRes.data && inputRes.data.length >= 4) {
                  vmon = this.readFloatFromBuffer(inputRes.data, 0);
                  imon = this.readFloatFromBuffer(inputRes.data, 2);
                  readSuccess = true;
                }
              } catch (fc4Err) {
                throw fc3Err;
              }
            }
          } else {
            // Base is fixed; do not oscillate or flip addressing on transient timeout
            throw fc3Err;
          }
        }

        if (!readSuccess) {
          throw new Error('No valid response from Modbus slave');
        }

        // Small inter-query quiet delay
        await new Promise((r) => setTimeout(r, 25));

        // Read I_SET_ROW_CC (4X 15 / Wire 14) to monitor I LIMIT set on HMI
        let hardwareIlimit: number | undefined = undefined;
        try {
          const isetAddr = this.settings.registers.iset ?? 14;
          const isetRes = await this.modbusClient.readHoldingRegisters(isetAddr, 2);
          if (isetRes && isetRes.data && isetRes.data.length >= 2) {
            const parsedIlimit = this.readFloatFromBuffer(isetRes.data, 0);
            if (!isNaN(parsedIlimit) && isFinite(parsedIlimit) && parsedIlimit >= 0) {
              hardwareIlimit = parsedIlimit;
              if (this.currentMode === 'CV' || hardwareMode === 'CV') {
                this.setpoints.iset = parsedIlimit;
              }
            }
          }
        } catch (isetErr) {}

        await new Promise((r) => setTimeout(r, 25));

        // Read Mode register (4X 29 / Wire 28)
        try {
          const curRegs = this.settings.registers;
          if (curRegs.mode !== undefined) {
            const modeRes = await this.modbusClient.readHoldingRegisters(curRegs.mode, 1);
            if (modeRes && modeRes.data && modeRes.data.length >= 1) {
              modeRaw = modeRes.data[0];
              if (modeRaw === 6) hardwareMode = 'CV';
              else if (modeRaw === 7) hardwareMode = 'CC';
              else if (modeRaw === 8) hardwareMode = 'CR';
              else if (modeRaw === 9) hardwareMode = 'CP';
              else if (modeRaw === 14) hardwareMode = 'BAT TEST';
            }
          }
        } catch (e) {}

        await new Promise((r) => setTimeout(r, 25));

        // Read coils for 2-way physical HMI synchronization and alarm popup detection (4 coils)
        try {
          const coilAddr = this.settings.registers.outputCoil ?? 0;
          const coilRes = await this.modbusClient.readCoils(coilAddr, 4);
          if (coilRes && coilRes.data && coilRes.data.length >= 1) {
            const hwOutputState = Boolean(coilRes.data[0]);
            if (this.outputState !== hwOutputState) {
              console.log(`[RS485 HMI Sync] Hardware Output changed on HMI to: ${hwOutputState ? 'ON' : 'OFF'}`);
              this.outputState = hwOutputState;
              this.outputConfirmedState = hwOutputState ? 'ON' : 'OFF';
            }
            if (coilRes.data.length >= 4) {
              popPowerExceed = Boolean(coilRes.data[2]);
              popVoltExceed = Boolean(coilRes.data[3]);
            }
          }
        } catch (coilErr) {}

        // Read extra battery test registers ONLY when in BAT TEST mode to keep polling fast & lightweight
        if (this.currentMode === 'BAT TEST' || hardwareMode === 'BAT TEST') {
          try {
            const curRegs = this.settings.registers;
            if (curRegs.hrs !== undefined) {
              await new Promise((r) => setTimeout(r, 25));
              const extraRes = await this.modbusClient.readHoldingRegisters(curRegs.hrs, 6);
              if (extraRes && extraRes.data && extraRes.data.length >= 6) {
                hrs = this.readFloatFromBuffer(extraRes.data, 0);
                min = this.readFloatFromBuffer(extraRes.data, 2);
                ah = this.readFloatFromBuffer(extraRes.data, 4);
              }
            }
          } catch (e) {}
        }

        // Guarantee physical electrical readings are non-negative and filter tiny ADC baseline drift
        vmon = Math.max(0, isNaN(vmon) ? 0 : vmon);
        imon = Math.max(0, isNaN(imon) ? 0 : imon);
        if (imon < 0.002) imon = 0.00;
        if (vmon < 0.005) vmon = 0.00;

        // CRUCIAL HARDWARE FIX:
        // When hardware output is OFF, the internal disconnect relay is open and sensing lines float
        // with electromagnetic pickup (~440V AC induction). Strictly force 0.00 V / 0.00 A when Output is OFF!
        if (!this.outputState) {
          vmon = 0.00;
          imon = 0.00;
        } else {
          // If Output is ON, suppress stray floating noise that exceeds physical engineering limit
          const maxAllowedV = Math.max(120, (this.engSettings.vmax || 60) * 1.5);
          if (vmon > maxAllowedV) {
            vmon = 0.00;
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
          hardwareIlimit,
          isStale: false,
          deviceResponding: true
        };
      } catch (err: any) {
        this.consecutiveErrors++;

        const nowMs = Date.now();
        if (nowMs - this.lastTelemetryWarnTime > 5000) {
          this.lastTelemetryWarnTime = nowMs;
          console.warn(`[RS485 Telemetry] Device at Slave ID ${this.settings.slaveId} not responding on ${this.settings.port}. (Error: ${err?.message || err}). Port remains connected.`);
        }

        // If the serial port itself closed, drop connection
        if (!this.modbusClient || !this.modbusClient.isOpen) {
          this.isHardwareConnected = false;
          this.currentOpenPort = null;
          if (this.statusCallback) this.statusCallback('DISCONNECTED');
        }

        return null;
      }
    });
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
