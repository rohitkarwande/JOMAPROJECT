import React, { useEffect, useState, useRef } from 'react';
import { Activity, RefreshCw, Power, Check, AlertCircle, AlertTriangle, Play, Layers } from 'lucide-react';
import { KeyboardNumericInput } from './KeyboardNumericInput';

export interface DiagRegisterEntry {
  desc: string;
  regName: string;
  rawType: 'FLOAT' | 'COIL' | 'INT';
  typeLabel: string;
  modbus: string;
  mainAddr: number; // 1-indexed CSV MainAddress
  base0: number;    // 0-indexed Wire Address
  isWritable: boolean;
  unit?: string;
  step?: number;
  precision?: number;
  defaultVal: number;
  note: string;
}

export const CSV_REGISTER_ENTRIES: DiagRegisterEntry[] = [
  { desc: 'V MON', regName: 'V_MON', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 1, base0: 0, isWritable: false, unit: 'V', precision: 3, defaultVal: 0, note: 'Live Voltage Feedback (V)' },
  { desc: 'I MON', regName: 'I_MON', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 3, base0: 2, isWritable: false, unit: 'A', precision: 3, defaultVal: 0, note: 'Live Current Feedback (A)' },
  { desc: 'START_STOP', regName: 'START_STOP', rawType: 'COIL', typeLabel: 'Bit (1 Coil)', modbus: '0X Coil', mainAddr: 1, base0: 0, isWritable: true, defaultVal: 0, note: 'Hardware Output 1=ON, 0=OFF' },
  { desc: 'CV_VOLT', regName: 'CV_VOLT', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 5, base0: 4, isWritable: true, unit: 'V', step: 0.5, precision: 3, defaultVal: 24.0, note: 'CV Mode Target Voltage Setpoint' },
  { desc: 'V_MAX', regName: 'V_MAX', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 7, base0: 6, isWritable: true, unit: 'V', step: 1.0, precision: 2, defaultVal: 60.0, note: 'Maximum Voltage Safety Limit (ENG)' },
  { desc: 'I_MAX', regName: 'I_MAX', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 9, base0: 8, isWritable: true, unit: 'A', step: 1.0, precision: 2, defaultVal: 30.0, note: 'Maximum Current Safety Limit (ENG)' },
  { desc: 'P_MAX', regName: 'P_MAX', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 11, base0: 10, isWritable: true, unit: 'W', step: 50.0, precision: 1, defaultVal: 5000.0, note: 'Maximum Power Safety Limit (ENG)' },
  { desc: 'I_SET_RANGE_CC', regName: 'I_SET_RANGE_CC', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 13, base0: 12, isWritable: false, unit: 'A', precision: 3, defaultVal: 10.0, note: 'CC Mode Max Current Range (Imax) - Read-Only (HMI Controlled)' },
  { desc: 'I_SET_ROW_CC', regName: 'I_SET_ROW_CC', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 15, base0: 14, isWritable: true, unit: 'A', step: 0.1, precision: 3, defaultVal: 5.0, note: 'Target Current / Limit (Iset)' },
  { desc: 'RESISTOR_CR_MODE', regName: 'RESISTOR_CR_MODE', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 17, base0: 16, isWritable: true, unit: 'Ω', step: 0.5, precision: 2, defaultVal: 10.0, note: 'CR Mode Resistance Setpoint (Rset)' },
  { desc: 'POWER_CP_MODE', regName: 'POWER_CP_MODE', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 19, base0: 18, isWritable: true, unit: 'W', step: 5.0, precision: 1, defaultVal: 120.0, note: 'CP Mode Power Setpoint (Pset)' },
  { desc: 'VCUTOFF', regName: 'VCUTOFF', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 21, base0: 20, isWritable: true, unit: 'V', step: 0.5, precision: 2, defaultVal: 10.5, note: 'Battery Cutoff Voltage Threshold' },
  { desc: 'HRS', regName: 'HRS', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 23, base0: 22, isWritable: true, unit: 'Hrs', step: 1.0, precision: 0, defaultVal: 0, note: 'Elapsed Test Hours' },
  { desc: 'MIN', regName: 'MIN', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 25, base0: 24, isWritable: true, unit: 'Min', step: 1.0, precision: 0, defaultVal: 0, note: 'Elapsed Test Minutes' },
  { desc: 'AH', regName: 'AH', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 27, base0: 26, isWritable: true, unit: 'Ah', step: 0.1, precision: 1, defaultVal: 0, note: 'Battery Accumulated Capacity (Ah)' },
  { desc: 'CC_CR_BAT_MODE', regName: 'CC_CR_BAT_MODE', rawType: 'COIL', typeLabel: 'Bit (1 Coil)', modbus: '0X Coil', mainAddr: 2, base0: 1, isWritable: true, defaultVal: 0, note: 'Battery Mode Sub-type: 1=CR, 0=CC' },
  { desc: 'POP_POWER_exceed', regName: 'POP_POWER_exceed', rawType: 'COIL', typeLabel: 'Bit (1 Coil)', modbus: '0X Coil', mainAddr: 3, base0: 2, isWritable: true, defaultVal: 0, note: 'High Power Alarm Popup Bit' },
  { desc: 'POP_VOLT_exceed', regName: 'POP_VOLT_exceed', rawType: 'COIL', typeLabel: 'Bit (1 Coil)', modbus: '0X Coil', mainAddr: 4, base0: 3, isWritable: true, defaultVal: 0, note: 'High Voltage Alarm Popup Bit' },
  { desc: 'MODE_SELECTION', regName: 'MODE_SELECTION', rawType: 'INT', typeLabel: 'INT (1 Reg)', modbus: '4X Holding', mainAddr: 29, base0: 28, isWritable: true, defaultVal: 6, note: 'CV=6, CC=7, CR=8, CP=9, BAT=14' },
  { desc: 'R_MAX', regName: 'R_MAX', rawType: 'FLOAT', typeLabel: 'FLOAT (2 Regs)', modbus: '4X Holding', mainAddr: 30, base0: 29, isWritable: true, unit: 'Ω', step: 1.0, precision: 2, defaultVal: 100.0, note: 'Maximum Resistance Safety Limit (ENG)' }
];

interface RegisterDiagnosticsPanelProps {
  isConnected: boolean;
  currentAddressBase: 0 | 1;
  wordSwap?: boolean;
  onToggleWordSwap?: (wordSwap: boolean) => void;
}

export const RegisterDiagnosticsPanel: React.FC<RegisterDiagnosticsPanelProps> = ({
  isConnected,
  currentAddressBase,
  wordSwap = true,
  onToggleWordSwap
}) => {
  const [diagReadState, setDiagReadState] = useState<Record<string, {
    value?: number | boolean | string;
    formatted?: string;
    status: 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';
    error?: string;
    timestamp?: string;
  }>>({});

  const [diagWriteInputs, setDiagWriteInputs] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    CSV_REGISTER_ENTRIES.forEach((e) => {
      initial[e.regName] = e.defaultVal;
    });
    return initial;
  });

  const [diagWriteState, setDiagWriteState] = useState<Record<string, {
    status: 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';
    error?: string;
    timestamp?: string;
  }>>({});

  const [isLiveSyncActive, setIsLiveSyncActive] = useState<boolean>(true);
  const [isBatchTesting, setIsBatchTesting] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  // Alarm popup state tracking per client CSV specification (POP_POWER_exceed & POP_VOLT_exceed)
  const [dismissedAlarms, setDismissedAlarms] = useState<Record<string, boolean>>({});

  const isPowerAlarm = Boolean(
    diagReadState['POP_POWER_exceed']?.value === true ||
    diagReadState['POP_POWER_exceed']?.value === 1 ||
    diagReadState['POP_POWER_exceed']?.value === '1'
  );

  const isVoltAlarm = Boolean(
    diagReadState['POP_VOLT_exceed']?.value === true ||
    diagReadState['POP_VOLT_exceed']?.value === 1 ||
    diagReadState['POP_VOLT_exceed']?.value === '1'
  );

  // Auto-reset dismissed state when physical coil resets to 0 (normal), so subsequent alarms pop up
  useEffect(() => {
    if (!isPowerAlarm && dismissedAlarms['POP_POWER_exceed']) {
      setDismissedAlarms((prev) => ({ ...prev, POP_POWER_exceed: false }));
    }
    if (!isVoltAlarm && dismissedAlarms['POP_VOLT_exceed']) {
      setDismissedAlarms((prev) => ({ ...prev, POP_VOLT_exceed: false }));
    }
  }, [isPowerAlarm, isVoltAlarm]);

  const showPowerPopup = isPowerAlarm && !dismissedAlarms['POP_POWER_exceed'];
  const showVoltPopup = isVoltAlarm && !dismissedAlarms['POP_VOLT_exceed'];

  const handleDismissAlarm = async (regName: 'POP_POWER_exceed' | 'POP_VOLT_exceed') => {
    setDismissedAlarms((prev) => ({ ...prev, [regName]: true }));
    const entry = CSV_REGISTER_ENTRIES.find((e) => e.regName === regName);
    if (entry) {
      // Writing 0 resets the physical alarm bit per client CSV specification
      await handleSingleWrite(entry, false);
    }
  };

  // Fast Bulk Read of all 20 CSV Registers directly from physical hardware
  const fetchAllRegistersInstant = async (isManualClick: boolean = false) => {
    if (!isConnected || !window.electronAPI || isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (isManualClick) setIsBatchTesting(true);

    try {
      const res = await window.electronAPI.modbus.diagReadAllRegisters();
      const now = new Date().toLocaleTimeString();

      if (res && res.success && res.registers) {
        setDiagReadState((prev) => {
          const next = { ...prev };
          Object.entries(res.registers!).forEach(([regName, info]) => {
            next[regName] = {
              value: info.value,
              formatted: info.formatted,
              status: 'SUCCESS',
              timestamp: now
            };
          });
          return next;
        });

        // Sync input boxes if they are not actively being focused/edited, keeping app setpoints matching physical HMI
        setDiagWriteInputs((prev) => {
          const next = { ...prev };
          Object.entries(res.registers!).forEach(([regName, info]) => {
            if (typeof info.value === 'number') {
              next[regName] = info.value;
            }
          });
          return next;
        });
      } else if (res && !res.success) {
        if (isManualClick) {
          console.error('[Register Diagnostics Panel Error]:', res.error);
        }
      }
    } catch (err: any) {
      if (isManualClick) {
        console.error('[Register Diagnostics Panel Exception]:', err);
      }
    } finally {
      isFetchingRef.current = false;
      if (isManualClick) setIsBatchTesting(false);
    }
  };

  // 1. Instantly read all registers from HMI when connected or on component mount
  useEffect(() => {
    if (isConnected) {
      fetchAllRegistersInstant();
    }
  }, [isConnected]);

  // 2. Real-time background sync interval (every 1.5 seconds) - immediately reflects HMI changes on the app
  useEffect(() => {
    if (!isConnected || !isLiveSyncActive) return;

    const timer = setInterval(() => {
      fetchAllRegistersInstant();
    }, 1500);

    return () => clearInterval(timer);
  }, [isConnected, isLiveSyncActive]);

  // Read a single register from physical hardware
  const handleSingleRead = async (entry: DiagRegisterEntry) => {
    if (!window.electronAPI) return;
    const activeAddr = currentAddressBase === 1 ? entry.mainAddr : entry.base0;

    setDiagReadState((prev) => ({
      ...prev,
      [entry.regName]: { status: 'LOADING' }
    }));

    try {
      const res = await window.electronAPI.modbus.diagReadRegister({
        type: entry.rawType,
        address: activeAddr
      });

      const now = new Date().toLocaleTimeString();
      if (res && res.success) {
        let fmt = String(res.value);
        if (entry.rawType === 'FLOAT' && typeof res.value === 'number') {
          if (entry.precision === 0) {
            fmt = `${Math.round(res.value)}${entry.unit ? ' ' + entry.unit : ''}`;
          } else {
            fmt = `${res.value.toFixed(entry.precision ?? 2)}${entry.unit ? ' ' + entry.unit : ''}`;
          }
        } else if (entry.rawType === 'COIL') {
          fmt = res.value ? '1 (ON)' : '0 (OFF)';
        } else if (entry.regName === 'MODE_SELECTION') {
          const modeMap: Record<number, string> = { 6: '6 (CV)', 7: '7 (CC)', 8: '8 (CR)', 9: '9 (CP)', 14: '14 (BAT)' };
          fmt = modeMap[Number(res.value)] || String(res.value);
        }

        setDiagReadState((prev) => ({
          ...prev,
          [entry.regName]: {
            value: res.value,
            formatted: fmt,
            status: 'SUCCESS',
            timestamp: now
          }
        }));

        if (typeof res.value === 'number') {
          setDiagWriteInputs((prev) => ({ ...prev, [entry.regName]: res.value as number }));
        }
      } else {
        setDiagReadState((prev) => ({
          ...prev,
          [entry.regName]: {
            status: 'ERROR',
            error: res.error || 'Read Failed',
            timestamp: now
          }
        }));
      }
    } catch (e: any) {
      setDiagReadState((prev) => ({
        ...prev,
        [entry.regName]: {
          status: 'ERROR',
          error: e?.message || 'Read exception',
          timestamp: new Date().toLocaleTimeString()
        }
      }));
    }
  };

  // Write a single value to physical hardware
  const handleSingleWrite = async (entry: DiagRegisterEntry, val: number | boolean) => {
    if (!window.electronAPI) return;
    const activeAddr = currentAddressBase === 1 ? entry.mainAddr : entry.base0;

    // Safety Limit Enforcement:
    if (typeof val === 'number') {
      if (entry.regName === 'CV_VOLT') {
        const vMaxVal = Number(diagReadState['V_MAX']?.value ?? diagWriteInputs['V_MAX'] ?? 60.0);
        if (vMaxVal > 0 && val > vMaxVal) {
          const warnMsg = `⚠️ CV_VOLT (${val} V) exceeds V_MAX limit (${vMaxVal.toFixed(2)} V)! Write blocked.`;
          console.warn(`[RS485 Warning] ${warnMsg}`);
          setDiagWriteState((prev) => ({
            ...prev,
            [entry.regName]: { status: 'ERROR', error: `⚠️ Exceeds V_MAX limit (${vMaxVal.toFixed(2)} V)!`, timestamp: new Date().toLocaleTimeString() }
          }));
          return;
        }
      } else if (entry.regName === 'I_SET_ROW_CC') {
        const iRangeVal = Number(diagReadState['I_SET_RANGE_CC']?.value ?? diagWriteInputs['I_SET_RANGE_CC'] ?? 10.0);
        if (iRangeVal > 0 && val > iRangeVal) {
          const warnMsg = `⚠️ I_SET_ROW_CC (${val} A) exceeds I_SET_RANGE_CC limit (${iRangeVal.toFixed(3)} A)! Write blocked.`;
          console.warn(`[RS485 Warning] ${warnMsg}`);
          setDiagWriteState((prev) => ({
            ...prev,
            [entry.regName]: { status: 'ERROR', error: `⚠️ Exceeds I_SET_RANGE_CC limit (${iRangeVal.toFixed(3)} A)!`, timestamp: new Date().toLocaleTimeString() }
          }));
          return;
        }
      } else if (entry.regName === 'RESISTOR_CR_MODE') {
        const rMaxVal = Number(diagReadState['R_MAX']?.value ?? diagWriteInputs['R_MAX'] ?? 100.0);
        if (rMaxVal > 0 && val > rMaxVal) {
          const warnMsg = `⚠️ RESISTOR_CR_MODE (${val} Ω) exceeds R_MAX limit (${rMaxVal.toFixed(2)} Ω)! Write blocked.`;
          console.warn(`[RS485 Warning] ${warnMsg}`);
          setDiagWriteState((prev) => ({
            ...prev,
            [entry.regName]: { status: 'ERROR', error: `⚠️ Exceeds R_MAX limit (${rMaxVal.toFixed(2)} Ω)!`, timestamp: new Date().toLocaleTimeString() }
          }));
          return;
        }
      } else if (entry.regName === 'VCUTOFF') {
        const vMaxVal = Number(diagReadState['V_MAX']?.value ?? diagWriteInputs['V_MAX'] ?? 60.0);
        if (vMaxVal > 0 && val > vMaxVal) {
          const warnMsg = `⚠️ VCUTOFF (${val} V) exceeds V_MAX limit (${vMaxVal.toFixed(2)} V)! Write blocked.`;
          console.warn(`[RS485 Warning] ${warnMsg}`);
          setDiagWriteState((prev) => ({
            ...prev,
            [entry.regName]: { status: 'ERROR', error: `⚠️ Exceeds V_MAX limit (${vMaxVal.toFixed(2)} V)!`, timestamp: new Date().toLocaleTimeString() }
          }));
          return;
        }
      } else if (entry.regName === 'POWER_CP_MODE') {
        const pMaxVal = Number(diagReadState['P_MAX']?.value ?? diagWriteInputs['P_MAX'] ?? 5000.0);
        if (pMaxVal > 0 && val > pMaxVal) {
          const warnMsg = `⚠️ POWER_CP_MODE (${val} W) exceeds P_MAX limit (${pMaxVal.toFixed(1)} W)! Write blocked.`;
          console.warn(`[RS485 Warning] ${warnMsg}`);
          setDiagWriteState((prev) => ({
            ...prev,
            [entry.regName]: { status: 'ERROR', error: `⚠️ Exceeds P_MAX limit (${pMaxVal.toFixed(1)} W)!`, timestamp: new Date().toLocaleTimeString() }
          }));
          return;
        }
      }
    }

    if (typeof val === 'boolean' && (entry.regName === 'POP_POWER_exceed' || entry.regName === 'POP_VOLT_exceed') && val === true) {
      setDismissedAlarms((prev) => ({ ...prev, [entry.regName]: false }));
    }

    setDiagWriteState((prev) => ({
      ...prev,
      [entry.regName]: { status: 'LOADING' }
    }));

    try {
      const res = await window.electronAPI.modbus.diagWriteRegister({
        type: entry.rawType,
        address: activeAddr,
        value: val
      });

      const now = new Date().toLocaleTimeString();
      if (res && res.success) {
        setDiagWriteState((prev) => ({
          ...prev,
          [entry.regName]: { status: 'SUCCESS', timestamp: now }
        }));
        // Auto-read back from hardware to immediately verify physical reflection!
        setTimeout(() => handleSingleRead(entry), 80);
        setTimeout(() => {
          setDiagWriteState((prev) => {
            if (prev[entry.regName]?.status === 'SUCCESS') {
              return { ...prev, [entry.regName]: { status: 'IDLE' } };
            }
            return prev;
          });
        }, 3500);
      } else {
        setDiagWriteState((prev) => ({
          ...prev,
          [entry.regName]: { status: 'ERROR', error: res.error || 'Write Failed', timestamp: now }
        }));
      }
    } catch (e: any) {
      setDiagWriteState((prev) => ({
        ...prev,
        [entry.regName]: {
          status: 'ERROR',
          error: e?.message || 'Write exception',
          timestamp: new Date().toLocaleTimeString()
        }
      }));
    }
  };

  return (
    <div style={{
      background: '#ffffff',
      border: '2px solid #0284c7',
      borderRadius: '8px',
      padding: '18px 22px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      boxShadow: '0 4px 14px rgba(2, 132, 199, 0.08)'
    }}>
      {/* Header bar with Action Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Activity size={24} style={{ color: '#0284c7' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
              LIVE REGISTER MAP DIAGNOSTICS & VERIFICATION (CSV ONE-BY-ONE TEST)
            </h3>
            <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
              Values auto-read instantly upon connect and synchronize in real time. Setpoints require clicking <strong>Enter</strong> to commit. Mode buttons write in real time.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          {/* Live Real-Time Sync Indicator & Toggle */}
          <button
            type="button"
            onClick={() => setIsLiveSyncActive(!isLiveSyncActive)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 12px',
              borderRadius: '6px',
              border: isLiveSyncActive ? '1.5px solid #16a34a' : '1.5px solid #cbd5e1',
              background: isLiveSyncActive ? '#f0fdf4' : '#f8fafc',
              color: isLiveSyncActive ? '#15803d' : '#64748b',
              fontWeight: 800,
              fontSize: '0.78rem',
              cursor: 'pointer'
            }}
            title="Toggle continuous real-time background synchronization with HMI"
          >
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isLiveSyncActive ? '#16a34a' : '#94a3b8',
              boxShadow: isLiveSyncActive ? '0 0 8px #16a34a' : 'none'
            }} />
            <span>{isLiveSyncActive ? 'LIVE HMI SYNC: ON (1.5s)' : 'LIVE HMI SYNC: PAUSED'}</span>
          </button>

          {/* Quick Refresh All */}
          <button
            type="button"
            disabled={!isConnected || isBatchTesting}
            onClick={() => fetchAllRegistersInstant(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '7px 16px',
              background: isConnected ? '#0284c7' : '#94a3b8',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 800,
              fontSize: '0.82rem',
              cursor: isConnected && !isBatchTesting ? 'pointer' : 'not-allowed',
              boxShadow: '0 2px 8px rgba(2, 132, 199, 0.25)'
            }}
            title="Perform instant full read of all 20 registers from HMI"
          >
            <RefreshCw size={14} className={isBatchTesting ? 'spin' : ''} />
            <span>{isBatchTesting ? 'Reading from HMI...' : 'Refresh All From HMI'}</span>
          </button>
        </div>
      </div>

      {/* Float Word Order (Endianness) Diagnostic Toolbar */}
      <div style={{
        background: '#f8fafc',
        border: '1.5px solid #e2e8f0',
        borderRadius: '6px',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#1e293b' }}>
          <span style={{ fontWeight: 800 }}>32-Bit Float Word Order:</span>
          <span style={{ color: '#64748b' }}>(Swapping solves HMI showing 0 or negative values)</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => onToggleWordSwap?.(true)}
            style={{
              padding: '5px 12px',
              borderRadius: '4px',
              fontSize: '0.78rem',
              fontWeight: 800,
              border: wordSwap ? '2px solid #0284c7' : '1px solid #cbd5e1',
              background: wordSwap ? '#e0f2fe' : '#ffffff',
              color: wordSwap ? '#0369a1' : '#475569',
              cursor: 'pointer'
            }}
          >
            {wordSwap ? '✓ ' : ''}CDAB (Word-Swapped / Low Word First - Standard HMI)
          </button>

          <button
            type="button"
            onClick={() => onToggleWordSwap?.(false)}
            style={{
              padding: '5px 12px',
              borderRadius: '4px',
              fontSize: '0.78rem',
              fontWeight: 800,
              border: !wordSwap ? '2px solid #0284c7' : '1px solid #cbd5e1',
              background: !wordSwap ? '#e0f2fe' : '#ffffff',
              color: !wordSwap ? '#0369a1' : '#475569',
              cursor: 'pointer'
            }}
          >
            {!wordSwap ? '✓ ' : ''}ABCD (High Word First - Big Endian)
          </button>
        </div>
      </div>

      {!isConnected && (
        <div style={{
          background: '#fffbeb',
          border: '1.5px solid #f59e0b',
          borderRadius: '6px',
          padding: '10px 14px',
          color: '#92400e',
          fontWeight: 700,
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <AlertCircle size={18} style={{ color: '#d97706', flexShrink: 0 }} />
          <span>RS485 Port is currently DISCONNECTED. Please connect to your hardware COM port above to perform live read/write tests.</span>
        </div>
      )}

      {/* Diagnostics Table */}
      <div style={{
        maxHeight: '440px',
        overflowY: 'auto',
        border: '1.5px solid #cbd5e1',
        borderRadius: '6px',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.02)'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
          <thead style={{ background: '#0f172a', color: '#ffffff', position: 'sticky', top: 0, zIndex: 3 }}>
            <tr>
              <th style={{ padding: '10px 12px', width: '26%' }}>REGISTER & ADDRESS</th>
              <th style={{ padding: '10px 12px', width: '24%' }}>LIVE HMI READ</th>
              <th style={{ padding: '10px 12px', width: '32%' }}>HARDWARE WRITE TEST</th>
              <th style={{ padding: '10px 12px', width: '18%' }}>STATUS / ERROR</th>
            </tr>
          </thead>
          <tbody>
            {CSV_REGISTER_ENTRIES.map((entry, idx) => {
              const activeWireAddr = currentAddressBase === 1 ? entry.mainAddr : entry.base0;
              const readInfo = diagReadState[entry.regName];
              const writeInfo = diagWriteState[entry.regName];

              let customMax: number | undefined = undefined;
              let maxLimitLabel: string | undefined = undefined;

              if (entry.regName === 'CV_VOLT') {
                const vMaxVal = Number(diagReadState['V_MAX']?.value ?? diagWriteInputs['V_MAX'] ?? 60.0);
                if (vMaxVal > 0) {
                  customMax = vMaxVal;
                  maxLimitLabel = `V_MAX (${vMaxVal.toFixed(2)} V)`;
                }
              } else if (entry.regName === 'I_SET_ROW_CC') {
                const iRangeVal = Number(diagReadState['I_SET_RANGE_CC']?.value ?? diagWriteInputs['I_SET_RANGE_CC'] ?? 10.0);
                if (iRangeVal > 0) {
                  customMax = iRangeVal;
                  maxLimitLabel = `I_SET_RANGE_CC (${iRangeVal.toFixed(3)} A)`;
                }
              } else if (entry.regName === 'RESISTOR_CR_MODE') {
                const rMaxVal = Number(diagReadState['R_MAX']?.value ?? diagWriteInputs['R_MAX'] ?? 100.0);
                if (rMaxVal > 0) {
                  customMax = rMaxVal;
                  maxLimitLabel = `R_MAX (${rMaxVal.toFixed(2)} Ω)`;
                }
              } else if (entry.regName === 'VCUTOFF') {
                const vMaxVal = Number(diagReadState['V_MAX']?.value ?? diagWriteInputs['V_MAX'] ?? 60.0);
                if (vMaxVal > 0) {
                  customMax = vMaxVal;
                  maxLimitLabel = `V_MAX (${vMaxVal.toFixed(2)} V)`;
                }
              } else if (entry.regName === 'POWER_CP_MODE') {
                const pMaxVal = Number(diagReadState['P_MAX']?.value ?? diagWriteInputs['P_MAX'] ?? 5000.0);
                if (pMaxVal > 0) {
                  customMax = pMaxVal;
                  maxLimitLabel = `P_MAX (${pMaxVal.toFixed(1)} W)`;
                }
              }

              const currentVal = diagWriteInputs[entry.regName] ?? entry.defaultVal;
              const isLimitExceeded = customMax !== undefined && currentVal > customMax;

              return (
                <tr
                  key={entry.regName}
                  style={{
                    background: idx % 2 === 0 ? '#ffffff' : '#f8fafc',
                    borderBottom: '1px solid #e2e8f0'
                  }}
                >
                  {/* Col 1: Register Info */}
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>{entry.desc}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0369a1', fontSize: '0.8rem' }}>
                        {entry.regName}
                      </span>
                      <span style={{
                        background: '#e0f2fe',
                        color: '#0369a1',
                        border: '1px solid #bae6fd',
                        borderRadius: '4px',
                        padding: '1px 6px',
                        fontSize: '0.72rem',
                        fontWeight: 800
                      }}>
                        {entry.modbus} {activeWireAddr} (CSV: {entry.mainAddr})
                      </span>
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '2px' }}>
                      {entry.typeLabel}
                    </div>
                  </td>

                  {/* Col 2: Live Hardware Read */}
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        disabled={!isConnected || readInfo?.status === 'LOADING'}
                        onClick={() => handleSingleRead(entry)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '6px 10px',
                          background: '#f1f5f9',
                          border: '1.5px solid #cbd5e1',
                          borderRadius: '4px',
                          fontWeight: 800,
                          fontSize: '0.78rem',
                          color: '#334155',
                          cursor: isConnected ? 'pointer' : 'not-allowed'
                        }}
                        title={`Read ${entry.regName} at wire address ${activeWireAddr}`}
                      >
                        <RefreshCw size={13} className={readInfo?.status === 'LOADING' ? 'spin' : ''} />
                        <span>Read</span>
                      </button>

                      <div style={{
                        flex: 1,
                        padding: '6px 10px',
                        background: (entry.regName === 'POP_POWER_exceed' || entry.regName === 'POP_VOLT_exceed') && (readInfo?.value === true || readInfo?.value === 1)
                          ? '#fef2f2'
                          : readInfo?.status === 'SUCCESS' ? '#f0fdf4' : readInfo?.status === 'ERROR' ? '#fef2f2' : '#f8fafc',
                        border: (entry.regName === 'POP_POWER_exceed' || entry.regName === 'POP_VOLT_exceed') && (readInfo?.value === true || readInfo?.value === 1)
                          ? '1.5px solid #ef4444'
                          : readInfo?.status === 'SUCCESS' ? '1.5px solid #86efac' : readInfo?.status === 'ERROR' ? '1.5px solid #fca5a5' : '1px solid #e2e8f0',
                        borderRadius: '4px',
                        fontFamily: 'monospace',
                        fontWeight: 800,
                        fontSize: '0.86rem',
                        color: (entry.regName === 'POP_POWER_exceed' || entry.regName === 'POP_VOLT_exceed') && (readInfo?.value === true || readInfo?.value === 1)
                          ? '#dc2626'
                          : readInfo?.status === 'SUCCESS' ? '#15803d' : readInfo?.status === 'ERROR' ? '#b91c1c' : '#64748b'
                      }}>
                        {readInfo?.status === 'LOADING'
                          ? 'Reading...'
                          : readInfo?.status === 'SUCCESS'
                          ? readInfo.formatted
                          : readInfo?.status === 'ERROR'
                          ? 'Read Error'
                          : '—'}
                      </div>
                    </div>
                    {readInfo?.timestamp && readInfo.status === 'SUCCESS' && (
                      <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '3px' }}>
                        Read at {readInfo.timestamp}
                      </div>
                    )}
                  </td>

                  {/* Col 3: Hardware Write Test */}
                  <td style={{ padding: '10px 12px' }}>
                    {!entry.isWritable ? (
                      <span style={{
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        padding: '4px 10px',
                        fontSize: '0.76rem',
                        color: '#475569',
                        fontWeight: 700,
                        display: 'inline-block'
                      }}>
                        {entry.regName === 'I_SET_RANGE_CC' ? '🔒 HMI Controlled (Read-Only)' : 'Read-Only Monitoring Register'}
                      </span>
                    ) : entry.regName === 'START_STOP' ? (
                      /* Output ON / OFF buttons matching actual mode convention */
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          disabled={!isConnected || writeInfo?.status === 'LOADING'}
                          onClick={() => handleSingleWrite(entry, true)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '4px',
                            border: 'none',
                            background: '#16a34a',
                            color: '#ffffff',
                            fontWeight: 800,
                            fontSize: '0.78rem',
                            cursor: isConnected ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Power size={13} />
                          <span>OUTPUT ON</span>
                        </button>
                        <button
                          type="button"
                          disabled={!isConnected || writeInfo?.status === 'LOADING'}
                          onClick={() => handleSingleWrite(entry, false)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '4px',
                            border: 'none',
                            background: '#dc2626',
                            color: '#ffffff',
                            fontWeight: 800,
                            fontSize: '0.78rem',
                            cursor: isConnected ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Power size={13} />
                          <span>OUTPUT OFF</span>
                        </button>
                      </div>
                    ) : entry.regName === 'MODE_SELECTION' ? (
                      /* Real-time Mode Select buttons without Enter button */
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {[
                          { label: 'CV (6)', val: 6 },
                          { label: 'CC (7)', val: 7 },
                          { label: 'CR (8)', val: 8 },
                          { label: 'CP (9)', val: 9 },
                          { label: 'BAT (14)', val: 14 }
                        ].map((m) => (
                          <button
                            key={m.val}
                            type="button"
                            disabled={!isConnected || writeInfo?.status === 'LOADING'}
                            onClick={() => handleSingleWrite(entry, m.val)}
                            style={{
                              padding: '5px 8px',
                              borderRadius: '4px',
                              border: '1.5px solid #0284c7',
                              background: '#e0f2fe',
                              color: '#0369a1',
                              fontWeight: 800,
                              fontSize: '0.75rem',
                              cursor: isConnected ? 'pointer' : 'not-allowed'
                            }}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    ) : entry.regName === 'CC_CR_BAT_MODE' ? (
                      /* Battery submode real-time toggle */
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          disabled={!isConnected || writeInfo?.status === 'LOADING'}
                          onClick={() => handleSingleWrite(entry, false)}
                          style={{
                            padding: '5px 10px',
                            borderRadius: '4px',
                            border: '1.5px solid #0284c7',
                            background: '#e0f2fe',
                            color: '#0369a1',
                            fontWeight: 800,
                            fontSize: '0.78rem',
                            cursor: isConnected ? 'pointer' : 'not-allowed'
                          }}
                        >
                          0: CC Submode
                        </button>
                        <button
                          type="button"
                          disabled={!isConnected || writeInfo?.status === 'LOADING'}
                          onClick={() => handleSingleWrite(entry, true)}
                          style={{
                            padding: '5px 10px',
                            borderRadius: '4px',
                            border: '1.5px solid #7c3aed',
                            background: '#f3e8ff',
                            color: '#6d28d9',
                            fontWeight: 800,
                            fontSize: '0.78rem',
                            cursor: isConnected ? 'pointer' : 'not-allowed'
                          }}
                        >
                          1: CR Submode
                        </button>
                      </div>
                    ) : entry.regName === 'POP_POWER_exceed' || entry.regName === 'POP_VOLT_exceed' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          disabled={!isConnected || writeInfo?.status === 'LOADING'}
                          onClick={() => {
                            setDismissedAlarms((prev) => ({ ...prev, [entry.regName]: false }));
                            handleSingleWrite(entry, true);
                          }}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '4px',
                            border: '1.5px solid #dc2626',
                            background: '#fef2f2',
                            color: '#b91c1c',
                            fontWeight: 800,
                            fontSize: '0.78rem',
                            cursor: isConnected ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          title="Trigger Alarm Popup (Writes 1 to physical coil)"
                        >
                          <AlertTriangle size={13} />
                          <span>Test Set (1)</span>
                        </button>
                        <button
                          type="button"
                          disabled={!isConnected || writeInfo?.status === 'LOADING'}
                          onClick={() => handleSingleWrite(entry, false)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '4px',
                            border: '1.5px solid #cbd5e1',
                            background: '#f1f5f9',
                            color: '#334155',
                            fontWeight: 800,
                            fontSize: '0.78rem',
                            cursor: isConnected ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          title="Reset Alarm (Writes 0 to physical coil)"
                        >
                          <Check size={13} />
                          <span>Reset (0)</span>
                        </button>
                      </div>
                    ) : (
                      /* Numeric Float input with Enter button commit convention & Limit warnings */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <KeyboardNumericInput
                            step={entry.step ?? 0.1}
                            precision={entry.precision ?? 2}
                            disabled={!isConnected || writeInfo?.status === 'LOADING'}
                            commitOnEnterOnly={true}
                            showEnterButton={true}
                            style={{
                              width: '135px',
                              padding: '5px 8px',
                              fontSize: '0.85rem',
                              fontWeight: 700,
                              border: isLimitExceeded ? '2px solid #ef4444' : undefined,
                              background: isLimitExceeded ? '#fef2f2' : undefined
                            }}
                            value={currentVal}
                            onChange={(val) => {
                              setDiagWriteInputs((prev) => ({ ...prev, [entry.regName]: val }));
                              handleSingleWrite(entry, val);
                            }}
                          />
                          {entry.unit && (
                            <span style={{ fontWeight: 800, color: '#64748b', fontSize: '0.8rem' }}>
                              {entry.unit}
                            </span>
                          )}
                        </div>
                        {isLimitExceeded && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.72rem', fontWeight: 800 }}>
                            <AlertCircle size={12} />
                            <span>⚠️ Exceeds {maxLimitLabel}!</span>
                          </div>
                        )}
                        {!isLimitExceeded && maxLimitLabel && (
                          <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>
                            Limit: &le; {maxLimitLabel}
                          </div>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Col 4: Status / Error */}
                  <td style={{ padding: '10px 12px' }}>
                    {writeInfo?.status === 'LOADING' ? (
                      <span style={{ color: '#0284c7', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem' }}>
                        <RefreshCw size={12} className="spin" /> Writing...
                      </span>
                    ) : writeInfo?.status === 'SUCCESS' ? (
                      <span style={{ color: '#16a34a', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem' }}>
                        <Check size={14} /> Written OK
                      </span>
                    ) : writeInfo?.status === 'ERROR' ? (
                      <div style={{ color: '#dc2626', fontWeight: 800, fontSize: '0.74rem', lineHeight: '1.2' }}>
                        ❌ Write Error:
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#991b1b', wordBreak: 'break-word', marginTop: '2px' }}>
                          {writeInfo.error}
                        </div>
                      </div>
                    ) : readInfo?.status === 'ERROR' ? (
                      <div style={{ color: '#dc2626', fontWeight: 800, fontSize: '0.74rem', lineHeight: '1.2' }}>
                        ❌ Read Error:
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#991b1b', wordBreak: 'break-word', marginTop: '2px' }}>
                          {readInfo.error}
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Ready</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Alarm Modal Popup for POP_POWER_exceed */}
      {showPowerPopup && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          zIndex: 100000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '12px',
            width: '460px',
            maxWidth: '92%',
            padding: '24px',
            border: '2px solid #ef4444',
            boxShadow: '0 20px 25px -5px rgba(239, 68, 68, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#dc2626', marginBottom: '14px' }}>
              <AlertTriangle size={38} />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 900, letterSpacing: '0.02em' }}>
                  HIGH POWER
                </h3>
                <span style={{ fontSize: '0.74rem', color: '#991b1b', fontWeight: 800 }}>
                  REGISTER MAP COIL 0X 3 (POP_POWER_exceed) = 1
                </span>
              </div>
            </div>
            <p style={{ fontSize: '0.92rem', color: '#334155', lineHeight: '1.5', margin: '0 0 20px 0', fontWeight: 600 }}>
              <strong>HIGH POWER</strong> alarm condition detected! Active power has exceeded safe limit.
              Clicking <strong>OK</strong> will acknowledge the warning and reset the register coil bit to 0.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => handleDismissAlarm('POP_POWER_exceed')}
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px 24px',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(220, 38, 38, 0.3)'
                }}
              >
                OK (Reset to 0)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alarm Modal Popup for POP_VOLT_exceed */}
      {showVoltPopup && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          zIndex: 100000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '12px',
            width: '460px',
            maxWidth: '92%',
            padding: '24px',
            border: '2px solid #ef4444',
            boxShadow: '0 20px 25px -5px rgba(239, 68, 68, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#dc2626', marginBottom: '14px' }}>
              <AlertTriangle size={38} />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 900, letterSpacing: '0.02em' }}>
                  HIGH VOLTAGE
                </h3>
                <span style={{ fontSize: '0.74rem', color: '#991b1b', fontWeight: 800 }}>
                  REGISTER MAP COIL 0X 4 (POP_VOLT_exceed) = 1
                </span>
              </div>
            </div>
            <p style={{ fontSize: '0.92rem', color: '#334155', lineHeight: '1.5', margin: '0 0 20px 0', fontWeight: 600 }}>
              <strong>HIGH VOLTAGE</strong> alarm condition detected! Active voltage has exceeded safe limit.
              Clicking <strong>OK</strong> will acknowledge the warning and reset the register coil bit to 0.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => handleDismissAlarm('POP_VOLT_exceed')}
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px 24px',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(220, 38, 38, 0.3)'
                }}
              >
                OK (Reset to 0)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
