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

  public reset(): void {
    this.queue = Promise.resolve();
  }

  public async runExclusive<T>(
    fn: () => Promise<T>,
    interDelayMs: number = 10,
    shouldCancel?: () => boolean
  ): Promise<T> {
    const execute = async (): Promise<T> => {
      if (shouldCancel && shouldCancel()) {
        throw new Error('OPERATION_CANCELLED_CONNECTION_CHANGED');
      }
      try {
        const result = await fn();
        if (interDelayMs > 0 && !(shouldCancel && shouldCancel())) {
          await new Promise((resolve) => setTimeout(resolve, interDelayMs));
        }
        return result;
      } catch (err) {
        if (interDelayMs > 0 && !(shouldCancel && shouldCancel())) {
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
    pollingIntervalMs: 200,
    isSimulator: false,
    selectedProfileId: 'CLIENT_CSV_PROFILE',
    registers: CLIENT_CSV_REGISTERS_BASE0,
    wordSwap: true, // Default: CDAB (Word-Swapped / Low Word First - Standard HMI)
    protocolType: 'RS485'
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
  private connectionSessionId: number = 0;

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
    // Stop ongoing polling first so serial port isn't busy when we try to close/reconnect!
    this.stopPolling();
    this.serialLock.reset();

    if (newSettings.baudRate !== undefined) {
      newSettings.baudRate = Number(newSettings.baudRate) || 9600;
    }
    if (newSettings.slaveId !== undefined) {
      newSettings.slaveId = Number(newSettings.slaveId) || 1;
    }
    if (newSettings.pollingIntervalMs !== undefined) {
      newSettings.pollingIntervalMs = Number(newSettings.pollingIntervalMs) || 200;
    }

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
    this.connectionSessionId++; // Invalidate all pending or queued operations from closed connection
    if (this.modbusClient) {
      try {
        const underlyingPort = (this.modbusClient as any)._port;
        const underlyingClient = underlyingPort?._client;

        // Flush leftover serial bytes before closing port
        try {
          if (underlyingClient && typeof underlyingClient.flush === 'function') {
            underlyingClient.flush(() => {});
          } else if (underlyingPort && typeof underlyingPort.flush === 'function') {
            underlyingPort.flush(() => {});
          }
        } catch (e) {}

        if (this.modbusClient.isOpen || (underlyingClient && underlyingClient.isOpen)) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
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
    // Waiting 600ms ensures the OS releases \\.\COMx so that subsequent connection attempts succeed.
    await new Promise((r) => setTimeout(r, 600));
  }

  public async disconnectHardware(): Promise<void> {
    this.stopPolling();
    this.serialLock.reset();
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
      const targetBaud = Number(this.settings.baudRate) || 9600;
      const targetSlaveId = Number(this.settings.slaveId) || 1;
      const targetPort = String(this.settings.port || 'COM4').trim();

      // 1. If already open on the exact same port and baud rate, reuse without closing/reopening!
      if (
        this.modbusClient &&
        this.modbusClient.isOpen &&
        this.currentOpenPort === targetPort &&
        this.currentOpenBaud === targetBaud
      ) {
        this.modbusClient.setID(targetSlaveId);
        this.modbusClient.setTimeout(800);
        this.isHardwareConnected = true;
        this.isCommFault = false;
        this.consecutiveErrors = 0;
        await this.syncHardwareSetpointsOnConnect();
        if (this.statusCallback) {
          this.statusCallback('CONNECTED');
        }
        return true;
      }

      await this.closeClient();
      this.serialLock.reset();

      this.modbusClient = new ModbusRTU();

      if (targetPort.startsWith('TCP:') || targetPort.includes('127.0.0.1') || targetPort.toLowerCase().includes('localhost')) {
        const ip = targetPort.replace(/^TCP:/i, '').trim() || '127.0.0.1';
        await this.modbusClient.connectTCP(ip, { port: 502 });
      } else {
        const serialOpts = {
          baudRate: targetBaud,
          dataBits: Number(this.settings.dataBits) || 8,
          stopBits: Number(this.settings.stopBits) || 1,
          parity: this.settings.parity || 'none'
        };
        await this.modbusClient.connectRTUBuffered(targetPort, serialOpts);
      }

      this.modbusClient.setID(targetSlaveId);
      this.modbusClient.setTimeout(800);

      // Flush any leftover hardware serial buffer bytes from prior sessions
      try {
        const underlyingPort = (this.modbusClient as any)?._port?._client || (this.modbusClient as any)?._port;
        if (underlyingPort && typeof underlyingPort.flush === 'function') {
          await new Promise<void>((resolve) => {
            underlyingPort.flush((err: any) => resolve());
          });
        }
      } catch (e) {}

      this.currentOpenPort = targetPort;
      this.currentOpenBaud = targetBaud;
      this.isHardwareConnected = true;
      this.isCommFault = false;
      this.consecutiveErrors = 0;

      // Instantly sync initial setpoints from physical HMI (CV_VOLT, I_SET_ROW_CC, V_MAX, etc.)
      await this.syncHardwareSetpointsOnConnect();

      if (this.statusCallback) {
        this.statusCallback('CONNECTED');
      }
      return true;
    } catch (err: any) {
      console.warn(`[RS485 Connection] Attempt ${retryCount + 1} failed to connect to ${this.settings.port}:`, err?.message || err);
      await this.closeClient();
      this.isHardwareConnected = false;
      this.currentOpenPort = null;
      this.currentOpenBaud = null;

      // Auto-retry up to 3 times on Windows COM handle busy / opening errors with backoff
      if (retryCount < 3) {
        const retryDelay = 700 * (retryCount + 1);
        console.log(`[RS485] Retrying COM connection in ${retryDelay}ms (retry ${retryCount + 1}/3)...`);
        await new Promise((r) => setTimeout(r, retryDelay));
        return this._executeConnectHardware(retryCount + 1);
      }

      if (this.statusCallback) {
        this.statusCallback('DISCONNECTED');
      }
      return false;
    }
  }

  private async syncHardwareSetpointsOnConnect(): Promise<void> {
    if (!this.modbusClient || !this.modbusClient.isOpen) return;

    try {
      this.modbusClient.setID(Number(this.settings.slaveId) || 1);
      const isBase1 = this.settings.registers.addressBase === 1 || this.settings.registers.vmon === 1;
      const baseH = isBase1 ? 1 : 0;

      // Read holding registers 0-16 for initial setpoint sync on connect
      const res1 = await this.modbusClient.readHoldingRegisters(baseH, 16);
      if (res1 && res1.data && res1.data.length >= 16) {
        const cvVolt = this.readFloatFromBuffer(res1.data, 4);    // 4X 5 (CV_VOLT)
        const vMax = this.readFloatFromBuffer(res1.data, 6);      // 4X 7 (V_MAX)
        const iMax = this.readFloatFromBuffer(res1.data, 8);      // 4X 9 (I_MAX)
        const pMax = this.readFloatFromBuffer(res1.data, 10);     // 4X 11 (P_MAX)
        const iRange = this.readFloatFromBuffer(res1.data, 12);   // 4X 13 (I_SET_RANGE_CC)
        const iRow = this.readFloatFromBuffer(res1.data, 14);     // 4X 15 (I_SET_ROW_CC)

        if (!isNaN(cvVolt) && cvVolt >= 0) this.setpoints.cv = cvVolt;
        if (!isNaN(iRow) && iRow >= 0) this.setpoints.iset = iRow;
        if (!isNaN(iRange) && iRange >= 0) this.setpoints.imax = iRange;
        if (!isNaN(vMax) && vMax > 0) this.engSettings.vmax = vMax;
        if (!isNaN(iMax) && iMax > 0) this.engSettings.imax = iMax;
        if (!isNaN(pMax) && pMax > 0) this.engSettings.pmax = pMax;
      }

      await new Promise((r) => setTimeout(r, 20));

      // Read holding registers 16-31 for CR / CP / BAT setpoints and R_MAX
      try {
        const res2 = await this.modbusClient.readHoldingRegisters(baseH + 16, 15);
        if (res2 && res2.data && res2.data.length >= 15) {
          const rCr = this.readFloatFromBuffer(res2.data, 0);       // 4X 17 (RESISTOR_CR_MODE)
          const pCp = this.readFloatFromBuffer(res2.data, 2);       // 4X 19 (POWER_CP_MODE)
          const vCut = this.readFloatFromBuffer(res2.data, 4);      // 4X 21 (VCUTOFF)
          const hrs = this.readFloatFromBuffer(res2.data, 6);       // 4X 23 (HRS)
          const min = this.readFloatFromBuffer(res2.data, 8);       // 4X 25 (MIN)
          const ah = this.readFloatFromBuffer(res2.data, 10);      // 4X 27 (AH)
          const rMax = this.readFloatFromBuffer(res2.data, 13);     // 4X 30 (R_MAX)

          if (!isNaN(rCr) && rCr >= 0) this.setpoints.rset = rCr;
          if (!isNaN(pCp) && pCp >= 0) this.setpoints.pset = pCp;
          if (!isNaN(vCut) && vCut >= 0) this.setpoints.cutoffV = vCut;
          if (!isNaN(hrs) && hrs >= 0) this.setpoints.hrs = hrs;
          if (!isNaN(min) && min >= 0) this.setpoints.min = min;
          if (!isNaN(ah) && ah >= 0) this.setpoints.ah = ah;
          if (!isNaN(rMax) && rMax > 0) this.engSettings.rmax = rMax;

          console.log(`[RS485 Connect Sync] Synced Setpoints: CV=${this.setpoints.cv}V, I=${this.setpoints.iset}A, R=${rCr}Ω, P=${pCp}W, CutV=${vCut}V, Ah=${ah}`);
        }
      } catch (e2) {}

      // Read coils for submode on connect
      try {
        const resC = await this.modbusClient.readCoils(baseH, 4);
        if (resC && resC.data && resC.data.length >= 2) {
          this.setpoints.batTestSubMode = resC.data[1] ? 'CR' : 'CC';
        }
      } catch (eC) {}
    } catch (err) {
      console.warn('[RS485 Connect Sync] Initial setpoint read warning:', err);
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
    this.modbusClient.setID(Number(this.settings.slaveId) || 1);
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

    const currentSession = this.connectionSessionId;
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      await this.serialLock.runExclusive(
        async () => {
          if (this.connectionSessionId !== currentSession || !this.modbusClient || !this.modbusClient.isOpen) return;
          try {
            this.modbusClient!.setID(Number(this.settings.slaveId) || 1);
            const regs = this.settings.registers;
            if (regs.hrs !== undefined) await this.writeFloatRegisters(regs.hrs, 0);
            if (regs.min !== undefined) await this.writeFloatRegisters(regs.min, 0);
            if (regs.ah !== undefined) await this.writeFloatRegisters(regs.ah, 0);
          } catch (err) {
            console.warn('RS485 Reset Bat Test Error:', err);
          }
        },
        5,
        () => this.connectionSessionId !== currentSession
      );
      this.scheduleNextPoll(10);
    }
    return { success: true };
  }

  public async setMode(mode: OperationMode, force: boolean = false): Promise<{ success: boolean; error?: string }> {
    this.currentMode = mode;
    if (mode === 'BAT TEST') {
      this.batTestStartTime = null;
      this.batTestAccumulatedAh = 0;
      this.simBatteryVoltage = 12.80;
    }

    const currentSession = this.connectionSessionId;
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      const res = await this.serialLock.runExclusive(
        async () => {
          if (this.connectionSessionId !== currentSession || !this.modbusClient || !this.modbusClient.isOpen) {
            return { success: false, error: 'Connection closed' };
          }
          try {
            this.modbusClient!.setID(Number(this.settings.slaveId) || 1);
            const modeMap: Record<OperationMode, number> = { CV: 6, CC: 7, CR: 8, CP: 9, 'BAT TEST': 14 };
            const modeVal = modeMap[mode] ?? 6;
            const modeAddr = this.settings.registers.mode ?? 28;
            console.log(`[RS485] Setting Mode ${mode} (Writing INT ${modeVal} to register ${modeAddr})...`);
            await this.modbusClient!.writeRegister(modeAddr, modeVal);

            // Immediate read-back to verify physical reflection on hardware (matching diagnostic panel convention)
            await new Promise((r) => setTimeout(r, 60));
            try {
              const modeReadRes = await this.modbusClient!.readHoldingRegisters(modeAddr, 1);
              if (modeReadRes && modeReadRes.data && modeReadRes.data.length >= 1) {
                const readModeVal = modeReadRes.data[0];
                console.log(`[RS485] Confirmed physical Mode readback from register ${modeAddr}: ${readModeVal}`);
                if (readModeVal === 6) this.currentMode = 'CV';
                else if (readModeVal === 7) this.currentMode = 'CC';
                else if (readModeVal === 8) this.currentMode = 'CR';
                else if (readModeVal === 9) this.currentMode = 'CP';
                else if (readModeVal === 14) this.currentMode = 'BAT TEST';
              }
            } catch (readErr) {
              console.warn('[RS485] Mode readback warning:', readErr);
            }

            return { success: true };
          } catch (err: any) {
            console.error('Error writing Mode over RS485:', err);
            return { success: false, error: this.formatModbusError('Mode Selection', err) };
          }
        },
        5,
        () => this.connectionSessionId !== currentSession
      );

      if (res.success) {
        this.scheduleNextPoll(10);
      }
      return res;
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

    const currentSession = this.connectionSessionId;
    return this.serialLock.runExclusive(
      async () => {
        if (this.connectionSessionId !== currentSession || !this.modbusClient || !this.modbusClient.isOpen) {
          return { success: false, error: 'Connection closed' };
        }
        try {
          this.modbusClient!.setID(Number(this.settings.slaveId) || 1);
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
      },
      5,
      () => this.connectionSessionId !== currentSession
    );
  }

  // Diagnostic Register Write for Live Hardware Verification
  public async diagWriteRegister(params: { type: 'FLOAT' | 'COIL' | 'INT'; address: number; value: number | boolean }): Promise<{ success: boolean; error?: string }> {
    if (!this.modbusClient || !this.modbusClient.isOpen) {
      const err = `RS485 Port ${this.settings.port} is not open!`;
      console.error(`[RS485 Diag Write Error] ${err}`);
      return { success: false, error: err };
    }

    const currentSession = this.connectionSessionId;
    return this.serialLock.runExclusive(
      async () => {
        if (this.connectionSessionId !== currentSession || !this.modbusClient || !this.modbusClient.isOpen) {
          return { success: false, error: 'Connection closed' };
        }
        try {
          this.modbusClient!.setID(Number(this.settings.slaveId) || 1);
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
      },
      5,
      () => this.connectionSessionId !== currentSession
    );
  }

  // Diagnostic Bulk Read for Instant HMI Reading & Real-Time Sync
  public async diagReadAllRegisters(): Promise<{
    success: boolean;
    registers?: Record<string, { value: number | boolean; formatted: string }>;
    error?: string;
  }> {
    if (this.settings.isSimulator || !this.modbusClient || !this.modbusClient.isOpen) {
      if (this.settings.isSimulator) {
        const modeMap: Record<OperationMode, number> = { CV: 6, CC: 7, CR: 8, CP: 9, 'BAT TEST': 14 };
        const modeSel = modeMap[this.currentMode] ?? 6;
        const result: Record<string, { value: number | boolean; formatted: string }> = {
          V_MON: { value: 0, formatted: '0.000 V' },
          I_MON: { value: 0, formatted: '0.000 A' },
          START_STOP: { value: this.outputState, formatted: this.outputState ? '1 (ON)' : '0 (OFF)' },
          CV_VOLT: { value: this.setpoints.cv, formatted: `${this.setpoints.cv.toFixed(3)} V` },
          V_MAX: { value: this.engSettings.vmax, formatted: `${this.engSettings.vmax.toFixed(2)} V` },
          I_MAX: { value: this.engSettings.imax, formatted: `${this.engSettings.imax.toFixed(2)} A` },
          P_MAX: { value: this.engSettings.pmax, formatted: `${this.engSettings.pmax.toFixed(1)} W` },
          I_SET_RANGE_CC: { value: this.setpoints.imax || 10.0, formatted: `${(this.setpoints.imax || 10.0).toFixed(3)} A` },
          I_SET_ROW_CC: { value: this.setpoints.iset, formatted: `${this.setpoints.iset.toFixed(3)} A` },
          RESISTOR_CR_MODE: { value: this.setpoints.rset, formatted: `${this.setpoints.rset.toFixed(2)} Ω` },
          POWER_CP_MODE: { value: this.setpoints.pset, formatted: `${this.setpoints.pset.toFixed(1)} W` },
          VCUTOFF: { value: this.setpoints.cutoffV, formatted: `${this.setpoints.cutoffV.toFixed(2)} V` },
          HRS: { value: this.setpoints.hrs ?? 0, formatted: `${Math.round(this.setpoints.hrs ?? 0)} Hrs` },
          MIN: { value: this.setpoints.min ?? 0, formatted: `${Math.round(this.setpoints.min ?? 0)} Min` },
          AH: { value: this.setpoints.ah ?? 0, formatted: `${(this.setpoints.ah ?? 0).toFixed(1)} Ah` },
          CC_CR_BAT_MODE: { value: this.setpoints.batTestSubMode === 'CR', formatted: this.setpoints.batTestSubMode === 'CR' ? '1 (CR)' : '0 (CC)' },
          POP_POWER_exceed: { value: false, formatted: '0 (NORMAL)' },
          POP_VOLT_exceed: { value: false, formatted: '0 (NORMAL)' },
          MODE_SELECTION: { value: modeSel, formatted: `${modeSel} (${this.currentMode})` },
          R_MAX: { value: this.engSettings.rmax, formatted: `${this.engSettings.rmax.toFixed(2)} Ω` }
        };
        return { success: true, registers: result };
      }
      const err = `RS485 Port ${this.settings.port} is not open!`;
      return { success: false, error: err };
    }

    const currentSession = this.connectionSessionId;
    return this.serialLock.runExclusive(
      async () => {
        if (this.connectionSessionId !== currentSession || !this.modbusClient || !this.modbusClient.isOpen) {
          return { success: false, error: 'Connection closed' };
        }
      try {
        this.modbusClient!.setID(Number(this.settings.slaveId) || 1);
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

        if (!isNaN(vCut) && vCut > 0) this.setpoints.cutoffV = vCut;
        if (!isNaN(hrs) && hrs >= 0) this.setpoints.hrs = hrs;
        if (!isNaN(min) && min >= 0) this.setpoints.min = min;
        if (!isNaN(ah) && ah >= 0) this.setpoints.ah = ah;
        this.setpoints.batTestSubMode = batSubMode ? 'CR' : 'CC';
        if (!isNaN(cvVolt) && cvVolt >= 0) this.setpoints.cv = cvVolt;
        if (!isNaN(rCr) && rCr >= 0) this.setpoints.rset = rCr;
        if (!isNaN(pCp) && pCp >= 0) this.setpoints.pset = pCp;
        if (!isNaN(iRow) && iRow >= 0) this.setpoints.iset = iRow;
        if (!isNaN(iRange) && iRange > 0) this.setpoints.imax = iRange;
        if (!isNaN(vMax) && vMax > 0) this.engSettings.vmax = vMax;
        if (!isNaN(iMax) && iMax > 0) this.engSettings.imax = iMax;
        if (!isNaN(pMax) && pMax > 0) this.engSettings.pmax = pMax;
        if (!isNaN(rMax) && rMax > 0) this.engSettings.rmax = rMax;

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
    }, 5, () => this.connectionSessionId !== currentSession);
  }

  // Backend Limit Enforcement & Setpoint Sanitization
  public async writeSetpoints(newSetpoints: Partial<SetpointValues>): Promise<{ success: boolean; error?: string }> {
    // 1. Enforce safety limits matching diagnostic panel conventions
    if (newSetpoints.iset !== undefined) {
      const iRangeLimit = this.setpoints.imax > 0 ? this.setpoints.imax : this.engSettings.imax;
      if (iRangeLimit > 0 && newSetpoints.iset > iRangeLimit) {
        const err = `⚠️ I_SET_ROW_CC (${newSetpoints.iset.toFixed(3)} A) exceeds I_SET_RANGE_CC limit (${iRangeLimit.toFixed(3)} A)! Write blocked.`;
        console.warn(`[RS485 Warning] ${err}`);
        return { success: false, error: err };
      }
    }
    if (newSetpoints.rset !== undefined && this.engSettings.rmax > 0 && newSetpoints.rset > this.engSettings.rmax) {
      const err = `⚠️ RESISTOR_CR_MODE (${newSetpoints.rset.toFixed(2)} Ω) exceeds R_MAX limit (${this.engSettings.rmax.toFixed(2)} Ω)! Write blocked.`;
      console.warn(`[RS485 Warning] ${err}`);
      return { success: false, error: err };
    }
    if (newSetpoints.cv !== undefined && this.engSettings.vmax > 0 && newSetpoints.cv > this.engSettings.vmax) {
      const err = `⚠️ CV_VOLT (${newSetpoints.cv.toFixed(3)} V) exceeds V_MAX limit (${this.engSettings.vmax.toFixed(2)} V)! Write blocked.`;
      console.warn(`[RS485 Warning] ${err}`);
      return { success: false, error: err };
    }
    if (newSetpoints.cutoffV !== undefined && this.engSettings.vmax > 0 && newSetpoints.cutoffV > this.engSettings.vmax) {
      const err = `⚠️ VCUTOFF (${newSetpoints.cutoffV.toFixed(2)} V) exceeds V_MAX limit (${this.engSettings.vmax.toFixed(2)} V)! Write blocked.`;
      console.warn(`[RS485 Warning] ${err}`);
      return { success: false, error: err };
    }
    if (newSetpoints.pset !== undefined && this.engSettings.pmax > 0 && newSetpoints.pset > this.engSettings.pmax) {
      const err = `⚠️ POWER_CP_MODE (${newSetpoints.pset.toFixed(1)} W) exceeds P_MAX limit (${this.engSettings.pmax.toFixed(1)} W)! Write blocked.`;
      console.warn(`[RS485 Warning] ${err}`);
      return { success: false, error: err };
    }

    const candidate = { ...this.setpoints, ...newSetpoints };
    this.setpoints = candidate;

    // Write Setpoints over Physical RS485 Modbus RTU Serial Port (32-bit IEEE 754 Floats)
    const currentSession = this.connectionSessionId;
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      const res = await this.serialLock.runExclusive(
        async () => {
          if (this.connectionSessionId !== currentSession || !this.modbusClient || !this.modbusClient.isOpen) {
            return { success: false, error: 'Connection closed' };
          }
          try {
            this.modbusClient!.setID(Number(this.settings.slaveId) || 1);
            const regs = this.settings.registers;
            const mode = this.currentMode;

          // 1. CV Mode: Write CV_VOLT (4X 5 / Wire 4)
          // In CV mode, I_SET_ROW_CC (register 14) is a READ-ONLY HMI monitoring register according to client CSV!
          // We MUST NOT write iset in CV mode!
          if (newSetpoints.cv !== undefined && regs.vset !== undefined) {
            console.log(`[RS485] Writing CV setpoint (CV_VOLT): ${newSetpoints.cv} to address ${regs.vset}`);
            await this.writeFloatRegisters(regs.vset, newSetpoints.cv);
            this.setpoints.cv = newSetpoints.cv;

            // Immediate read-back to verify physical reflection on hardware (matching diagnostic panel convention)
            await new Promise((r) => setTimeout(r, 60));
            try {
              const cvReadRes = await this.modbusClient!.readHoldingRegisters(regs.vset, 2);
              if (cvReadRes && cvReadRes.data && cvReadRes.data.length >= 2) {
                const verifiedCv = this.readFloatFromBuffer(cvReadRes.data, 0);
                if (!isNaN(verifiedCv) && verifiedCv >= 0) {
                  this.setpoints.cv = verifiedCv;
                  console.log(`[RS485] Confirmed physical CV_VOLT readback from address ${regs.vset}: ${verifiedCv} V`);
                }
              }
            } catch (readErr) {
              console.warn('[RS485] Readback of CV_VOLT after write warning:', readErr);
            }
          }

          // 2. CC / CP / BAT TEST Mode: Write I_SET_ROW_CC (4X 15 / Wire 14)
          if (newSetpoints.iset !== undefined && regs.iset !== undefined) {
            if (mode === 'CV' || mode === 'CR') {
              console.log(`[RS485] Mode is ${mode}: I Limit is monitored from HMI. Skipping physical write to address ${regs.iset}.`);
            } else {
              console.log(`[RS485] Writing I_SET_ROW_CC (I Target): ${newSetpoints.iset} to address ${regs.iset}`);
              await this.writeFloatRegisters(regs.iset, newSetpoints.iset);
              this.setpoints.iset = newSetpoints.iset;

              // Immediate read-back to verify physical reflection on hardware (matching diagnostic panel convention)
              await new Promise((r) => setTimeout(r, 60));
              try {
                const isetReadRes = await this.modbusClient!.readHoldingRegisters(regs.iset, 2);
                if (isetReadRes && isetReadRes.data && isetReadRes.data.length >= 2) {
                  const verifiedIset = this.readFloatFromBuffer(isetReadRes.data, 0);
                  if (!isNaN(verifiedIset) && verifiedIset >= 0) {
                    this.setpoints.iset = verifiedIset;
                    console.log(`[RS485] Confirmed physical I_SET_ROW_CC readback from address ${regs.iset}: ${verifiedIset} A`);
                  }
                }
              } catch (readErr) {
                console.warn('[RS485] Readback of I_SET_ROW_CC after write warning:', readErr);
              }
            }
          }

          // 3. CC Mode: I_SET_RANGE_CC (I MAX CC MODE, 4X 13 / Wire 12)
          // Per user specification: I_SET_RANGE_CC is controlled exclusively on the HMI and must never be written from the PC app.

          // 4. CR Mode or BAT TEST (CR): RESISTOR_CR_MODE (4X 17 / Wire 16)
          if (newSetpoints.rset !== undefined && regs.rset !== undefined && (mode === 'CR' || mode === 'BAT TEST')) {
            console.log(`[RS485] Writing Rset: ${newSetpoints.rset} to address ${regs.rset}`);
            await this.writeFloatRegisters(regs.rset, newSetpoints.rset);
            this.setpoints.rset = newSetpoints.rset;

            await new Promise((r) => setTimeout(r, 60));
            try {
              const rReadRes = await this.modbusClient!.readHoldingRegisters(regs.rset, 2);
              if (rReadRes && rReadRes.data && rReadRes.data.length >= 2) {
                const verifiedR = this.readFloatFromBuffer(rReadRes.data, 0);
                if (!isNaN(verifiedR) && verifiedR >= 0) this.setpoints.rset = verifiedR;
              }
            } catch (e) {}
          }

          // 5. CP Mode: POWER_CP_MODE (4X 19 / Wire 18)
          if (newSetpoints.pset !== undefined && regs.pset !== undefined && mode === 'CP') {
            console.log(`[RS485] Writing Pset: ${newSetpoints.pset} to address ${regs.pset}`);
            await this.writeFloatRegisters(regs.pset, newSetpoints.pset);
            this.setpoints.pset = newSetpoints.pset;

            await new Promise((r) => setTimeout(r, 60));
            try {
              const pReadRes = await this.modbusClient!.readHoldingRegisters(regs.pset, 2);
              if (pReadRes && pReadRes.data && pReadRes.data.length >= 2) {
                const verifiedP = this.readFloatFromBuffer(pReadRes.data, 0);
                if (!isNaN(verifiedP) && verifiedP >= 0) this.setpoints.pset = verifiedP;
              }
            } catch (e) {}
          }

          // 6. BAT TEST Mode: VCUTOFF, HRS, MIN, AH, SUBMODE
          if (newSetpoints.batTestSubMode !== undefined && regs.batSubModeCoil !== undefined) {
            const isCr = newSetpoints.batTestSubMode === 'CR';
            console.log(`[RS485] Writing CC_CR_BAT_MODE coil: ${isCr ? '1 (CR)' : '0 (CC)'} to address ${regs.batSubModeCoil}`);
            await this.modbusClient!.writeCoil(regs.batSubModeCoil, isCr);
            this.setpoints.batTestSubMode = newSetpoints.batTestSubMode;

            await new Promise((r) => setTimeout(r, 60));
            try {
              const coilRes = await this.modbusClient!.readCoils(regs.batSubModeCoil, 1);
              if (coilRes && coilRes.data && coilRes.data.length > 0) {
                const verifiedSub = coilRes.data[0] ? 'CR' : 'CC';
                this.setpoints.batTestSubMode = verifiedSub;
                console.log(`[RS485] Confirmed physical CC_CR_BAT_MODE readback from address ${regs.batSubModeCoil}: ${verifiedSub}`);
              }
            } catch (e) {}
          }

          if (newSetpoints.cutoffV !== undefined && regs.cutoffV !== undefined) {
            console.log(`[RS485] Writing VCUTOFF: ${newSetpoints.cutoffV} to address ${regs.cutoffV}`);
            await this.writeFloatRegisters(regs.cutoffV, newSetpoints.cutoffV);
            this.setpoints.cutoffV = newSetpoints.cutoffV;

            await new Promise((r) => setTimeout(r, 60));
            try {
              const cutReadRes = await this.modbusClient!.readHoldingRegisters(regs.cutoffV, 2);
              if (cutReadRes && cutReadRes.data && cutReadRes.data.length >= 2) {
                const verifiedCut = this.readFloatFromBuffer(cutReadRes.data, 0);
                if (!isNaN(verifiedCut) && verifiedCut >= 0) {
                  this.setpoints.cutoffV = verifiedCut;
                  console.log(`[RS485] Confirmed physical VCUTOFF readback from address ${regs.cutoffV}: ${verifiedCut} V`);
                }
              }
            } catch (e) {}
          }

          if (newSetpoints.hrs !== undefined && regs.hrs !== undefined) {
            console.log(`[RS485] Writing HRS: ${newSetpoints.hrs} to address ${regs.hrs}`);
            await this.writeFloatRegisters(regs.hrs, newSetpoints.hrs);
            this.setpoints.hrs = newSetpoints.hrs;

            await new Promise((r) => setTimeout(r, 60));
            try {
              const hRes = await this.modbusClient!.readHoldingRegisters(regs.hrs, 2);
              if (hRes && hRes.data && hRes.data.length >= 2) {
                const verifiedHrs = this.readFloatFromBuffer(hRes.data, 0);
                if (!isNaN(verifiedHrs) && verifiedHrs >= 0) this.setpoints.hrs = verifiedHrs;
              }
            } catch (e) {}
          }

          if (newSetpoints.min !== undefined && regs.min !== undefined) {
            console.log(`[RS485] Writing MIN: ${newSetpoints.min} to address ${regs.min}`);
            await this.writeFloatRegisters(regs.min, newSetpoints.min);
            this.setpoints.min = newSetpoints.min;

            await new Promise((r) => setTimeout(r, 60));
            try {
              const mRes = await this.modbusClient!.readHoldingRegisters(regs.min, 2);
              if (mRes && mRes.data && mRes.data.length >= 2) {
                const verifiedMin = this.readFloatFromBuffer(mRes.data, 0);
                if (!isNaN(verifiedMin) && verifiedMin >= 0) this.setpoints.min = verifiedMin;
              }
            } catch (e) {}
          }

          if (newSetpoints.ah !== undefined && regs.ah !== undefined) {
            console.log(`[RS485] Writing AH: ${newSetpoints.ah} to address ${regs.ah}`);
            await this.writeFloatRegisters(regs.ah, newSetpoints.ah);
            this.setpoints.ah = newSetpoints.ah;

            await new Promise((r) => setTimeout(r, 60));
            try {
              const aRes = await this.modbusClient!.readHoldingRegisters(regs.ah, 2);
              if (aRes && aRes.data && aRes.data.length >= 2) {
                const verifiedAh = this.readFloatFromBuffer(aRes.data, 0);
                if (!isNaN(verifiedAh) && verifiedAh >= 0) this.setpoints.ah = verifiedAh;
              }
            } catch (e) {}
          }

          return { success: true };
        } catch (err: any) {
          console.error('RS485 Setpoint Write Failure:', err);
          this.isCommFault = true;
          return { success: false, error: this.formatModbusError('RS485 Setpoint Write', err) };
        }
      }, 5, () => this.connectionSessionId !== currentSession);
      if (res.success) {
        this.scheduleNextPoll(10);
      }
      return res;
    }

    return { success: true };
  }

  public async writeEngSettings(newEng: Partial<EngineeringSettings>): Promise<{ success: boolean; error?: string }> {
    if (newEng.vmax !== undefined && newEng.vmax <= 0) {
      return { success: false, error: 'V_MAX must be greater than zero!' };
    }
    if (newEng.imax !== undefined && newEng.imax <= 0) {
      return { success: false, error: 'I_MAX must be greater than zero!' };
    }
    if (newEng.pmax !== undefined && newEng.pmax <= 0) {
      return { success: false, error: 'P_MAX must be greater than zero!' };
    }
    if (newEng.rmax !== undefined && newEng.rmax <= 0) {
      return { success: false, error: 'R_MAX must be greater than zero!' };
    }

    this.engSettings = { ...this.engSettings, ...newEng };

    // Write Safety Limits to Physical Hardware Registers (32-bit Floats)
    // Matches Diagnostic Panel: direct write followed by immediate hardware readback verification
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      const res = await this.serialLock.runExclusive(async () => {
        try {
          this.modbusClient!.setID(Number(this.settings.slaveId) || 1);
          const regs = this.settings.registers;

          if (newEng.vmax !== undefined && regs.vmaxLimit !== undefined) {
            console.log(`[RS485] Writing V_MAX (${newEng.vmax} V) to address ${regs.vmaxLimit}...`);
            try {
              await this.writeFloatRegisters(regs.vmaxLimit, newEng.vmax);
            } catch (vErr) {
              console.warn('[RS485] V_MAX write warning:', vErr);
            }
            await new Promise((r) => setTimeout(r, 40));
          }
          if (newEng.imax !== undefined && regs.imaxLimit !== undefined) {
            console.log(`[RS485] Writing I_MAX (${newEng.imax} A) to address ${regs.imaxLimit}...`);
            try {
              await this.writeFloatRegisters(regs.imaxLimit, newEng.imax);
            } catch (iErr) {
              console.warn('[RS485] I_MAX write warning:', iErr);
            }
            await new Promise((r) => setTimeout(r, 40));
          }
          if (newEng.pmax !== undefined && regs.pmaxLimit !== undefined) {
            console.log(`[RS485] Writing P_MAX (${newEng.pmax} W) to address ${regs.pmaxLimit}...`);
            try {
              await this.writeFloatRegisters(regs.pmaxLimit, newEng.pmax);
            } catch (pErr) {
              console.warn('[RS485] P_MAX write warning:', pErr);
            }
            await new Promise((r) => setTimeout(r, 40));
          }
          if (newEng.rmax !== undefined && regs.rmaxLimit !== undefined) {
            console.log(`[RS485] Writing R_MAX (${newEng.rmax} Ω) to address ${regs.rmaxLimit}...`);
            try {
              await this.writeFloatRegisters(regs.rmaxLimit, newEng.rmax);
            } catch (rErr) {
              console.warn('[RS485] R_MAX write warning:', rErr);
            }
            await new Promise((r) => setTimeout(r, 40));
          }

          // Immediate hardware readback verification (matching diagnostic panel convention)
          await new Promise((r) => setTimeout(r, 60));
          try {
            if (regs.vmaxLimit !== undefined) {
              const res = await this.modbusClient!.readHoldingRegisters(regs.vmaxLimit, 2);
              if (res && res.data && res.data.length >= 2) {
                const readVmax = this.readFloatFromBuffer(res.data, 0);
                if (!isNaN(readVmax) && readVmax > 0) {
                  this.engSettings.vmax = readVmax;
                  console.log(`[RS485] Confirmed physical V_MAX readback: ${readVmax} V`);
                }
              }
            }
            if (regs.imaxLimit !== undefined) {
              const res = await this.modbusClient!.readHoldingRegisters(regs.imaxLimit, 2);
              if (res && res.data && res.data.length >= 2) {
                const readImax = this.readFloatFromBuffer(res.data, 0);
                if (!isNaN(readImax) && readImax > 0) {
                  this.engSettings.imax = readImax;
                  console.log(`[RS485] Confirmed physical I_MAX readback: ${readImax} A`);
                }
              }
            }
            if (regs.pmaxLimit !== undefined) {
              const res = await this.modbusClient!.readHoldingRegisters(regs.pmaxLimit, 2);
              if (res && res.data && res.data.length >= 2) {
                const readPmax = this.readFloatFromBuffer(res.data, 0);
                if (!isNaN(readPmax) && readPmax > 0) {
                  this.engSettings.pmax = readPmax;
                  console.log(`[RS485] Confirmed physical P_MAX readback: ${readPmax} W`);
                }
              }
            }
            if (regs.rmaxLimit !== undefined) {
              const res = await this.modbusClient!.readHoldingRegisters(regs.rmaxLimit, 2);
              if (res && res.data && res.data.length >= 2) {
                const readRmax = this.readFloatFromBuffer(res.data, 0);
                if (!isNaN(readRmax) && readRmax > 0) {
                  this.engSettings.rmax = readRmax;
                  console.log(`[RS485] Confirmed physical R_MAX readback: ${readRmax} Ω`);
                }
              }
            }
          } catch (readbackErr) {
            console.warn('[RS485] Eng Settings readback warning:', readbackErr);
          }

          return { success: true };
        } catch (err: any) {
          console.error('RS485 Eng Settings Write Error:', err);
          return { success: false, error: this.formatModbusError('RS485 Eng Settings Write', err) };
        }
      });
      if (res.success) {
        this.scheduleNextPoll(10);
      }
      return res;
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
    const currentSession = this.connectionSessionId;
    if (!this.settings.isSimulator && this.modbusClient && this.modbusClient.isOpen) {
      const res = await this.serialLock.runExclusive(
        async () => {
          if (this.connectionSessionId !== currentSession || !this.modbusClient || !this.modbusClient.isOpen) {
            return { success: false, error: 'Connection closed' };
          }
          try {
            this.modbusClient!.setID(Number(this.settings.slaveId) || 1);
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
        },
        5,
        () => this.connectionSessionId !== currentSession
      );

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
      this.scheduleNextPoll(10);
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
      this.scheduleNextPoll(10);
      return { success: true };
    }
  }

  public startPolling() {
    this.stopPolling();

    if (!this.modbusClient || !this.modbusClient.isOpen) {
      return;
    }

    this.isHardwareConnected = true;
    this.scheduleNextPoll(50);
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
    const delay = delayMs !== undefined ? delayMs : Math.max(100, this.settings.pollingIntervalMs || 200);
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

    const currentSession = this.connectionSessionId;
    try {
      return await this.serialLock.runExclusive(
        async () => {
          if (this.connectionSessionId !== currentSession || !this.modbusClient || !this.modbusClient.isOpen) return null;

      try {
        const isBase1 = this.settings.registers.addressBase === 1 || this.settings.registers.vmon === 1;
        const baseH = isBase1 ? 1 : 0;
        const baseC = isBase1 ? 1 : 0;

        this.modbusClient.setID(Number(this.settings.slaveId) || 1);

        let b1: number[] = [];
        let b2: number[] = [];
        let c: boolean[] = [];

        try {
          // Block 1: Registers 0..15 (VMON, IMON, CV_VOLT, V_MAX, I_MAX, P_MAX, I_SET_RANGE_CC, I_SET_ROW_CC)
          const res1 = await this.modbusClient.readHoldingRegisters(baseH, 16);
          b1 = res1.data;
          await new Promise((r) => setTimeout(r, 15));

          // Block 2: Registers 16..30 (RESISTOR_CR_MODE, POWER_CP_MODE, VCUTOFF, HRS, MIN, AH, MODE_SELECTION, R_MAX)
          const res2 = await this.modbusClient.readHoldingRegisters(baseH + 16, 15);
          b2 = res2.data;
          await new Promise((r) => setTimeout(r, 15));

          // Block 3: Coils 0..3 (START_STOP, CC_CR_BAT_MODE, POP_POWER_EXCEED, POP_VOLT_EXCEED)
          const resC = await this.modbusClient.readCoils(baseC, 4);
          c = resC.data;
        } catch (blockErr) {
          // Safe individual fallback if 16-register block is rejected by firmware
          console.warn('[RS485 Telemetry] Block read failed, fallback to individual reads:', blockErr);
          const allHolding: number[] = [];
          for (let i = 0; i < 31; i++) {
            try {
              const single = await this.modbusClient.readHoldingRegisters(baseH + i, 1);
              allHolding.push(single.data[0]);
            } catch {
              allHolding.push(0);
            }
            await new Promise((r) => setTimeout(r, 5));
          }
          b1 = allHolding.slice(0, 16);
          b2 = allHolding.slice(16, 31);
          try {
            const resC = await this.modbusClient.readCoils(baseC, 4);
            c = resC.data;
          } catch {
            c = [false, false, false, false];
          }
        }

        if (!b1 || b1.length < 4) {
          throw new Error('No valid response from Modbus slave');
        }

        let vmon = this.readFloatFromBuffer(b1, 0);
        let imon = this.readFloatFromBuffer(b1, 2);
        const cvVolt = this.readFloatFromBuffer(b1, 4);
        const vMax = this.readFloatFromBuffer(b1, 6);
        const iMax = this.readFloatFromBuffer(b1, 8);
        const pMax = this.readFloatFromBuffer(b1, 10);
        const iRange = this.readFloatFromBuffer(b1, 12);
        const iRow = this.readFloatFromBuffer(b1, 14);

        const rCr = b2.length >= 2 ? this.readFloatFromBuffer(b2, 0) : 0;
        const pCp = b2.length >= 4 ? this.readFloatFromBuffer(b2, 2) : 0;
        const vCut = b2.length >= 6 ? this.readFloatFromBuffer(b2, 4) : 0;
        const hrs = b2.length >= 8 ? this.readFloatFromBuffer(b2, 6) : 0;
        const min = b2.length >= 10 ? this.readFloatFromBuffer(b2, 8) : 0;
        const ah = b2.length >= 12 ? this.readFloatFromBuffer(b2, 10) : 0;
        const modeSel = b2.length >= 13 ? b2[12] : undefined;
        const rMax = b2.length >= 15 ? this.readFloatFromBuffer(b2, 13) : undefined;

        const hwOutputState = Boolean(c && c.length >= 1 ? c[0] : false);
        const batSubMode: 'CC' | 'CR' = Boolean(c && c.length >= 2 ? c[1] : false) ? 'CR' : 'CC';
        const popPowerExceed = Boolean(c && c.length >= 3 ? c[2] : false);
        const popVoltExceed = Boolean(c && c.length >= 4 ? c[3] : false);

        // Sync Output state with physical HMI coil
        if (this.outputState !== hwOutputState) {
          console.log(`[RS485 HMI Sync] Hardware Output changed on HMI to: ${hwOutputState ? 'ON' : 'OFF'}`);
          this.outputState = hwOutputState;
          this.outputConfirmedState = hwOutputState ? 'ON' : 'OFF';
        }

        // Sync Submode
        this.setpoints.batTestSubMode = batSubMode;

        // Sync Mode
        let hardwareMode: OperationMode | undefined = undefined;
        if (typeof modeSel === 'number') {
          const modeMap: Record<number, OperationMode> = { 6: 'CV', 7: 'CC', 8: 'CR', 9: 'CP', 14: 'BAT TEST' };
          if (modeMap[modeSel]) {
            hardwareMode = modeMap[modeSel];
            this.currentMode = hardwareMode;
          }
        }

        // Sync Engineering limits
        let hardwareVmax: number | undefined = this.engSettings.vmax;
        let hardwareImax: number | undefined = this.engSettings.imax;
        let hardwarePmax: number | undefined = this.engSettings.pmax;
        let hardwareRmax: number | undefined = this.engSettings.rmax;
        if (!isNaN(vMax) && vMax > 0) { hardwareVmax = vMax; this.engSettings.vmax = vMax; }
        if (!isNaN(iMax) && iMax > 0) { hardwareImax = iMax; this.engSettings.imax = iMax; }
        if (!isNaN(pMax) && pMax > 0) { hardwarePmax = pMax; this.engSettings.pmax = pMax; }
        if (rMax !== undefined && !isNaN(rMax) && rMax > 0) { hardwareRmax = rMax; this.engSettings.rmax = rMax; }

        // Sync Setpoints from HMI
        let hardwareIrange: number | undefined = undefined;
        let hardwareIlimit: number | undefined = undefined;
        let hardwareCvSet: number | undefined = undefined;
        let hardwareRset: number | undefined = undefined;
        let hardwarePset: number | undefined = undefined;
        let hardwareCutoffV: number | undefined = undefined;
        let hardwareHrs: number | undefined = undefined;
        let hardwareMin: number | undefined = undefined;
        let hardwareAh: number | undefined = undefined;

        if (!isNaN(iRange) && iRange >= 0) { hardwareIrange = iRange; this.setpoints.imax = iRange; }
        if (!isNaN(iRow) && iRow >= 0) {
          hardwareIlimit = iRow;
          if (this.currentMode === 'CV' || this.currentMode === 'CR' || hardwareMode === 'CV' || hardwareMode === 'CR') {
            this.setpoints.iset = iRow;
          }
        }
        if (!isNaN(cvVolt) && cvVolt >= 0) { hardwareCvSet = cvVolt; this.setpoints.cv = cvVolt; }
        if (!isNaN(rCr) && rCr >= 0) { hardwareRset = rCr; this.setpoints.rset = rCr; }
        if (!isNaN(pCp) && pCp >= 0) { hardwarePset = pCp; this.setpoints.pset = pCp; }
        if (!isNaN(vCut) && vCut > 0) { hardwareCutoffV = vCut; this.setpoints.cutoffV = vCut; }
        if (!isNaN(hrs) && hrs >= 0) { hardwareHrs = hrs; this.setpoints.hrs = hrs; }
        if (!isNaN(min) && min >= 0) { hardwareMin = min; this.setpoints.min = min; }
        if (!isNaN(ah) && ah >= 0) { hardwareAh = ah; this.setpoints.ah = ah; }

        // Guarantee physical electrical readings are non-negative and filter tiny ADC baseline drift
        vmon = Math.max(0, isNaN(vmon) ? 0 : vmon);
        imon = Math.max(0, isNaN(imon) ? 0 : imon);
        if (imon < 0.002) imon = 0.00;
        if (vmon < 0.005) vmon = 0.00;

        // DO NOT force vmon/imon to 0.00 when output is OFF:
        // Terminal voltage (vmon) and current (imon) must reflect immediately upon connection!

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
          hrs: Math.round(hrs),
          min: Math.round(min),
          capacityAh: ah || (this.currentMode === 'BAT TEST' ? parseFloat(this.batTestAccumulatedAh.toFixed(3)) : undefined),
          isOutputOn: this.outputState,
          activeSetpoint: this.getActiveSetpointString(),
          popPowerExceed,
          popVoltExceed,
          hardwareMode,
          hardwareIlimit,
          hardwareIrange,
          hardwareCvSet,
          hardwareRset,
          hardwarePset,
          hardwareVmax,
          hardwareImax,
          hardwarePmax,
          hardwareRmax,
          hardwareCutoffV,
          hardwareAh,
          hardwareHrs,
          hardwareMin,
          hardwareBatSubMode: batSubMode,
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
    }, 5, () => this.connectionSessionId !== currentSession);
    } catch (err: any) {
      if (err?.message === 'OPERATION_CANCELLED_CONNECTION_CHANGED') return null;
      throw err;
    }
  }

  private generateSimulatedPoint(): TelemetryPoint {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const timeSec = Math.floor(now.getTime() / 1000);

    // If Output is OFF, simulate live terminal open-circuit voltage
    if (!this.outputState) {
      return {
        timestamp: timeStr,
        timeSeconds: timeSec,
        vmon: this.currentMode === 'BAT TEST' ? this.simBatteryVoltage : 12.00,
        imon: 0.00,
        pmon: 0.00,
        isOutputOn: false,
        activeSetpoint: this.getActiveSetpointString(),
        capacityAh: this.currentMode === 'BAT TEST' ? this.batTestAccumulatedAh : undefined,
        hardwareMode: this.currentMode,
        hardwareIlimit: this.setpoints.iset,
        hardwareIrange: this.setpoints.imax,
        hardwareCvSet: this.setpoints.cv,
        hardwareRset: this.setpoints.rset,
        hardwarePset: this.setpoints.pset,
        hardwareVmax: this.engSettings.vmax,
        hardwareImax: this.engSettings.imax,
        hardwarePmax: this.engSettings.pmax,
        hardwareRmax: this.engSettings.rmax,
        hardwareCutoffV: this.setpoints.cutoffV,
        hardwareAh: this.setpoints.ah,
        hardwareHrs: this.setpoints.hrs,
        hardwareMin: this.setpoints.min,
        hardwareBatSubMode: this.setpoints.batTestSubMode,
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
      hardwareIlimit: this.setpoints.iset,
      hardwareIrange: this.setpoints.imax,
      hardwareCvSet: this.setpoints.cv,
      hardwareRset: this.setpoints.rset,
      hardwarePset: this.setpoints.pset,
      hardwareVmax: this.engSettings.vmax,
      hardwareImax: this.engSettings.imax,
      hardwarePmax: this.engSettings.pmax,
      hardwareRmax: this.engSettings.rmax,
      hardwareCutoffV: this.setpoints.cutoffV,
      hardwareAh: this.setpoints.ah,
      hardwareHrs: hrs,
      hardwareMin: min,
      hardwareBatSubMode: this.setpoints.batTestSubMode,
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
