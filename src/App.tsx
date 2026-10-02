import React, { useEffect, useRef, useState } from 'react';
import { BUILTIN_PROFILES, ConnectionSettings, EngineeringSettings, OperationMode, SequenceProgress, SetpointValues, TelemetryPoint, TestSession } from './types/scada';
import { Header } from './components/Header';
import { NavigationTabs, ActiveViewType } from './components/NavigationTabs';
import { MetricsGrid } from './components/MetricsGrid';
import { OutputControlPanel } from './components/OutputControlPanel';
import { LiveChart } from './components/LiveChart';
import { HistoryAndPdf } from './components/HistoryAndPdf';
import { SettingsModal } from './components/SettingsModal';
import { EngSettings } from './components/EngSettings';
import { SequenceBuilder } from './components/SequenceBuilder';
import { SafetyModal } from './components/SafetyModal';
import { Zap, AlertTriangle } from 'lucide-react';
import './styles/index.css';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ActiveViewType>('dashboard');
  const [currentMode, setCurrentMode] = useState<OperationMode>('CV');
  const [outputState, setOutputState] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<'CONNECTED' | 'DISCONNECTED'>('DISCONNECTED');
  const [safetyModal, setSafetyModal] = useState<{ title?: string; message: string } | null>(null);

  const [sequenceProgress, setSequenceProgress] = useState<SequenceProgress>({
    state: 'IDLE',
    testName: '',
    currentCycle: 1,
    totalCycles: 1,
    currentStepIndex: 0,
    totalSteps: 0,
    currentMode: 'CV',
    currentSetpoints: {},
    stepDurationSeconds: 0,
    stepRemainingSeconds: 0,
    totalElapsedSeconds: 0,
    totalProgrammedDurationSeconds: 0,
    overallProgressPercent: 0
  });

  const isSequenceRunning = sequenceProgress.state === 'STARTING' || sequenceProgress.state === 'RUNNING' || sequenceProgress.state === 'PAUSED';

  const [engSettings, setEngSettings] = useState<EngineeringSettings>({
    vmax: 60.0,
    imax: 30.0,
    pmax: 5000.0,
    rmax: 100.0,
    logIntervalMinutes: 1,
    logIntervalSeconds: 60
  });

  const [setpoints, setSetpoints] = useState<SetpointValues>({
    cv: 24.00,
    iset: 5.00,
    imax: 10.00,
    rset: 10.0,
    pset: 120.0,
    cutoffV: 10.50,
    dischgI: 2.50,
    batTestSubMode: 'CC',
    ah: 0.0,
    hrs: 0,
    min: 0
  });

  const [outputConfirmedState, setOutputConfirmedState] = useState<'ON' | 'OFF' | 'UNKNOWN'>('UNKNOWN');

  const [settings, setSettings] = useState<ConnectionSettings>({
    port: 'COM3',
    baudRate: 9600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    slaveId: 1,
    pollingIntervalMs: 500,
    isSimulator: false,
    selectedProfileId: 'CLIENT_CSV_PROFILE',
    registers: BUILTIN_PROFILES[0].registers,
    wordSwap: true,
    protocolType: 'RS485'
  });

  const activeProfile = BUILTIN_PROFILES.find((p) => p.id === settings.selectedProfileId) || BUILTIN_PROFILES[0];
  const isAuthorized = activeProfile.validationStatus === 'HARDWARE_VALIDATED' || activeProfile.validationStatus === 'SIMULATOR_TESTED';

  const [telemetry, setTelemetry] = useState<TelemetryPoint>({
    timestamp: '00:00:00',
    timeSeconds: 0,
    vmon: 0.00,
    imon: 0.00,
    pmon: 0.00
  });

  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryPoint[]>([]);
  const [sessions, setSessions] = useState<TestSession[]>([]);
  const [elapsedTimeSeconds, setElapsedTimeSeconds] = useState<number>(0);
  const [dismissedPowerAlarm, setDismissedPowerAlarm] = useState<boolean>(false);
  const [dismissedVoltAlarm, setDismissedVoltAlarm] = useState<boolean>(false);

  useEffect(() => {
    if (!telemetry.popPowerExceed) setDismissedPowerAlarm(false);
    if (!telemetry.popVoltExceed) setDismissedVoltAlarm(false);
  }, [telemetry.popPowerExceed, telemetry.popVoltExceed]);

  const handleResetBatTest = async () => {
    if (window.electronAPI) {
      await window.electronAPI.modbus.resetBatTest();
    }
    setSetpoints((prev) => ({
      ...prev,
      ah: 0.0,
      hrs: 0,
      min: 0
    }));
    setTelemetry((prev) => ({
      ...prev,
      ah: 0.0,
      hrs: 0,
      min: 0,
      capacityAh: 0.0
    }));
  };

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const currentSessionLogsRef = useRef<TelemetryPoint[]>([]);
  const writeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load Sessions from Database on Mount
  useEffect(() => {
    const loadSessions = async () => {
      if (window.electronAPI) {
        const list = await window.electronAPI.db.getSessions();
        setSessions(list);
      } else {
        // Mock Initial History for Dev Preview
        setSessions([
          {
            id: 'SES-9482',
            mode: 'CV',
            startTime: '23/09/2026 14:30:00',
            durationSeconds: 145,
            setpointV: 24.0,
            setpointI: 5.0,
            maxVoltage: 24.04,
            minVoltage: 23.96,
            maxCurrent: 4.82,
            avgCurrent: 4.75,
            avgPower: 114.0,
            status: 'COMPLETED',
            logs: []
          }
        ]);
      }
    };
    loadSessions();
  }, []);

  // Synchronization helper matching RegisterDiagnosticsPanel:
  // Converts live register values into UI state for immediate reflection
  const syncRegistersToState = (regs: Record<string, { value: number | boolean; formatted: string }>) => {
    setSetpoints((prev) => {
      let updated = { ...prev };
      if (typeof regs['VCUTOFF']?.value === 'number' && regs['VCUTOFF'].value > 0) {
        updated.cutoffV = regs['VCUTOFF'].value;
      }
      if (typeof regs['AH']?.value === 'number' && regs['AH'].value >= 0) {
        updated.ah = regs['AH'].value;
      }
      if (typeof regs['HRS']?.value === 'number' && regs['HRS'].value >= 0) {
        updated.hrs = regs['HRS'].value;
      }
      if (typeof regs['MIN']?.value === 'number' && regs['MIN'].value >= 0) {
        updated.min = regs['MIN'].value;
      }
      if (regs['CC_CR_BAT_MODE'] !== undefined) {
        updated.batTestSubMode = regs['CC_CR_BAT_MODE'].value ? 'CR' : 'CC';
      }
      if (typeof regs['CV_VOLT']?.value === 'number' && regs['CV_VOLT'].value >= 0) {
        updated.cv = regs['CV_VOLT'].value;
      }
      if (typeof regs['I_SET_ROW_CC']?.value === 'number' && regs['I_SET_ROW_CC'].value >= 0) {
        updated.iset = regs['I_SET_ROW_CC'].value;
      }
      if (typeof regs['I_SET_RANGE_CC']?.value === 'number' && regs['I_SET_RANGE_CC'].value > 0) {
        updated.imax = regs['I_SET_RANGE_CC'].value;
      }
      if (typeof regs['RESISTOR_CR_MODE']?.value === 'number' && regs['RESISTOR_CR_MODE'].value >= 0) {
        updated.rset = regs['RESISTOR_CR_MODE'].value;
      }
      if (typeof regs['POWER_CP_MODE']?.value === 'number' && regs['POWER_CP_MODE'].value >= 0) {
        updated.pset = regs['POWER_CP_MODE'].value;
      }
      return updated;
    });

    setEngSettings((prev) => {
      let updated = { ...prev };
      if (typeof regs['V_MAX']?.value === 'number' && regs['V_MAX'].value > 0) {
        updated.vmax = regs['V_MAX'].value;
      }
      if (typeof regs['I_MAX']?.value === 'number' && regs['I_MAX'].value > 0) {
        updated.imax = regs['I_MAX'].value;
      }
      if (typeof regs['P_MAX']?.value === 'number' && regs['P_MAX'].value > 0) {
        updated.pmax = regs['P_MAX'].value;
      }
      if (typeof regs['R_MAX']?.value === 'number' && regs['R_MAX'].value > 0) {
        updated.rmax = regs['R_MAX'].value;
      }
      return updated;
    });
  };

  // Listen to IPC Telemetry Streams & Sequence Engine Events
  useEffect(() => {
    if (window.electronAPI) {
      // 1. Instantly read all registers from HMI on startup / component mount
      window.electronAPI.modbus.diagReadAllRegisters().then((res) => {
        if (res && res.success && res.registers) {
          syncRegistersToState(res.registers);
        }
      }).catch(() => {});

      const unsubTelemetry = window.electronAPI.modbus.onTelemetry((point) => {
        setTelemetry(point);

        // HMI is final call: Automatically sync mode if changed on physical HMI
        if (point.hardwareMode) {
          setCurrentMode((prev) => (point.hardwareMode && point.hardwareMode !== prev ? point.hardwareMode : prev));
        }

        // In CV or CR mode, sync I LIMIT set on physical HMI into app setpoints state
        if (point.hardwareIlimit !== undefined && point.hardwareIlimit >= 0) {
          setSetpoints((prev) => {
            if (prev.iset !== point.hardwareIlimit) {
              return { ...prev, iset: point.hardwareIlimit! };
            }
            return prev;
          });
        }
        if (point.hardwareIrange !== undefined && point.hardwareIrange > 0) {
          setSetpoints((prev) => (prev.imax !== point.hardwareIrange ? { ...prev, imax: point.hardwareIrange! } : prev));
        }
        if (point.hardwareCvSet !== undefined && point.hardwareCvSet >= 0) {
          setSetpoints((prev) => (prev.cv !== point.hardwareCvSet ? { ...prev, cv: point.hardwareCvSet! } : prev));
        }
        if (point.hardwareRset !== undefined && point.hardwareRset >= 0) {
          setSetpoints((prev) => (prev.rset !== point.hardwareRset ? { ...prev, rset: point.hardwareRset! } : prev));
        }
        if (point.hardwarePset !== undefined && point.hardwarePset >= 0) {
          setSetpoints((prev) => (prev.pset !== point.hardwarePset ? { ...prev, pset: point.hardwarePset! } : prev));
        }

        // Battery Test Mode Synchronization from physical HMI (VCUTOFF, AH, HRS, MIN, SUBMODE)
        if (point.hardwareCutoffV !== undefined && point.hardwareCutoffV > 0) {
          setSetpoints((prev) => (prev.cutoffV !== point.hardwareCutoffV ? { ...prev, cutoffV: point.hardwareCutoffV! } : prev));
        }
        if (point.hardwareAh !== undefined && point.hardwareAh >= 0) {
          setSetpoints((prev) => (prev.ah !== point.hardwareAh ? { ...prev, ah: point.hardwareAh! } : prev));
        }
        if (point.hardwareHrs !== undefined && point.hardwareHrs >= 0) {
          setSetpoints((prev) => (prev.hrs !== point.hardwareHrs ? { ...prev, hrs: point.hardwareHrs! } : prev));
        }
        if (point.hardwareMin !== undefined && point.hardwareMin >= 0) {
          setSetpoints((prev) => (prev.min !== point.hardwareMin ? { ...prev, min: point.hardwareMin! } : prev));
        }
        if (point.hardwareBatSubMode !== undefined) {
          setSetpoints((prev) => (prev.batTestSubMode !== point.hardwareBatSubMode ? { ...prev, batTestSubMode: point.hardwareBatSubMode! } : prev));
        }

        if (point.hardwareVmax !== undefined && point.hardwareVmax > 0) {
          setEngSettings((prev) => (prev.vmax !== point.hardwareVmax ? { ...prev, vmax: point.hardwareVmax! } : prev));
        }
        if (point.hardwareImax !== undefined && point.hardwareImax > 0) {
          setEngSettings((prev) => (prev.imax !== point.hardwareImax ? { ...prev, imax: point.hardwareImax! } : prev));
        }
        if (point.hardwarePmax !== undefined && point.hardwarePmax > 0) {
          setEngSettings((prev) => (prev.pmax !== point.hardwarePmax ? { ...prev, pmax: point.hardwarePmax! } : prev));
        }
        if (point.hardwareRmax !== undefined && point.hardwareRmax > 0) {
          setEngSettings((prev) => (prev.rmax !== point.hardwareRmax ? { ...prev, rmax: point.hardwareRmax! } : prev));
        }

        // 2-way HMI synchronization: If Output ON/OFF changed on physical hardware panel, reflect in app!
        if (point.isOutputOn !== undefined) {
          const hwOn = Boolean(point.isOutputOn);
          setOutputState((prev) => {
            if (prev !== hwOn) {
              setOutputConfirmedState(hwOn ? 'ON' : 'OFF');
              if (hwOn) {
                if (!timerRef.current) {
                  setElapsedTimeSeconds(0);
                  currentSessionLogsRef.current = [];
                  timerRef.current = setInterval(() => {
                    setElapsedTimeSeconds((t) => t + 1);
                  }, 1000);
                }
              } else {
                if (timerRef.current) {
                  clearInterval(timerRef.current);
                  timerRef.current = null;
                }
              }
              return hwOn;
            }
            return prev;
          });
        }

        // Stream telemetry points into live graph whenever connected
        setTelemetryHistory((prev) => [...prev.slice(-80), point]);

        if (outputState || point.isOutputOn) {
          const logs = currentSessionLogsRef.current;
          const lastTime = logs.length > 0 ? logs[logs.length - 1].timeSeconds : 0;
          const targetInterval = Math.max(1, engSettings.logIntervalSeconds || 1);
          if (logs.length === 0 || Math.abs(point.timeSeconds - lastTime) >= targetInterval) {
            currentSessionLogsRef.current.push(point);
          }
        }
      });

      const unsubStatus = window.electronAPI.modbus.onStatusChange((status: any) => {
        setConnectionStatus(status);
        if (status && status.connected) {
          window.electronAPI?.modbus.diagReadAllRegisters().then((res) => {
            if (res && res.success && res.registers) {
              syncRegistersToState(res.registers);
            }
          }).catch(() => {});
        }
      });

      const unsubSequence = window.electronAPI.sequence.onProgress((prog) => {
        setSequenceProgress(prog);
        if (prog.state === 'STARTING') {
          setTelemetryHistory([]);
          currentSessionLogsRef.current = [];
          setOutputState(true);
          setOutputConfirmedState('ON');
        } else if (prog.state === 'COMPLETED' || prog.state === 'ABORTED') {
          setOutputState(false);
          setOutputConfirmedState('OFF');

          // 1. Immediately drop live telemetry and graph history line to 0.00V, 0.00A
          const nowStr = new Date().toTimeString().split(' ')[0];
          const nowSec = Math.floor(Date.now() / 1000);
          const zeroPoint: TelemetryPoint = {
            timestamp: nowStr,
            timeSeconds: nowSec,
            vmon: 0.00,
            imon: 0.00,
            pmon: 0.00,
            isOutputOn: false
          };
          setTelemetry(zeroPoint);
          setTelemetryHistory((prev) => [...prev.slice(-80), zeroPoint]);

          // 2. Save automated test sequence session & logs to SQLite Database
          const logs = [...currentSessionLogsRef.current];
          if (logs.length > 0) {
            const vVals = logs.map((l) => l.vmon);
            const iVals = logs.map((l) => l.imon);
            const pVals = logs.map((l) => l.pmon);

            const maxV = Math.max(...vVals);
            const minV = Math.min(...vVals);
            const maxI = Math.max(...iVals);
            const avgI = parseFloat((iVals.reduce((a, b) => a + b, 0) / iVals.length).toFixed(2));
            const avgP = parseFloat((pVals.reduce((a, b) => a + b, 0) / pVals.length).toFixed(2));

            const seqSession: TestSession = {
              id: `SEQ-${Math.floor(1000 + Math.random() * 9000)}`,
              mode: (prog.testName ? `${prog.currentMode} MODE (SEQ: ${prog.testName})` : `${prog.currentMode} MODE`) as any,
              startTime: new Date().toLocaleString(),
              durationSeconds: prog.totalElapsedSeconds || logs.length,
              setpointV: prog.currentSetpoints?.v || 0,
              setpointI: prog.currentSetpoints?.i || 0,
              setpointR: prog.currentSetpoints?.r,
              setpointP: prog.currentSetpoints?.p,
              maxVoltage: maxV,
              minVoltage: minV,
              maxCurrent: maxI,
              avgCurrent: avgI,
              avgPower: avgP,
              status: prog.state === 'COMPLETED' ? 'COMPLETED' : 'ABORTED',
              logs: logs,
              isSequenceTest: true,
              sequenceName: prog.testName,
              sequenceCycles: prog.totalCycles,
              sequenceStepsConfig: prog.sequenceStepsConfig
            };

            setSessions((prev) => [seqSession, ...prev]);
            if (window.electronAPI) {
              window.electronAPI.db.saveSession(seqSession);
            }
          }
          currentSessionLogsRef.current = [];
        } else if (prog.state === 'RUNNING' || prog.state === 'PAUSED') {
          setOutputState(true);
          setOutputConfirmedState('ON');
        }
      });

      return () => {
        unsubTelemetry();
        unsubStatus();
        unsubSequence();
      };
    } else {
      // Offline browser fallback simulator ticker - ONLY active when output is ON
      if (!outputState) {
        setTelemetry({ timestamp: '00:00:00', timeSeconds: 0, vmon: 0.00, imon: 0.00, pmon: 0.00 });
        return;
      }

      const timer = setInterval(() => {
        const timeStr = new Date().toTimeString().split(' ')[0];
        const timeSec = Math.floor(Date.now() / 1000);

        const timeMs = Date.now();
        const waveV = Math.sin(timeMs / 400) * 0.35 + Math.cos(timeMs / 850) * 0.20;
        const waveI = Math.cos(timeMs / 500) * 0.15 + Math.sin(timeMs / 950) * 0.10;
        const noiseV = (Math.random() - 0.5) * 0.25 + waveV;
        const noiseI = (Math.random() - 0.5) * 0.12 + waveI;

        const mode = isSequenceRunning ? sequenceProgress.currentMode : currentMode;
        let v = 0;
        let i = 0;

        if (mode === 'CC') {
          const targetI = isSequenceRunning ? (sequenceProgress.currentSetpoints.i ?? setpoints.iset) : setpoints.iset;
          i = Math.min(engSettings.imax, Math.max(0, targetI + noiseI));
          const rLoadCC = 2.5 + Math.sin(timeMs / 3000) * 0.5;
          v = Math.min(engSettings.vmax, Math.max(0.5, (i * rLoadCC) + noiseV));
        } else if (mode === 'CR') {
          const targetR = Math.max(0.1, isSequenceRunning ? (sequenceProgress.currentSetpoints.r ?? setpoints.rset) : setpoints.rset);
          v = Math.min(engSettings.vmax, Math.max(0, 24.0 + noiseV));
          i = Math.min(setpoints.iset, Math.max(0, (v / targetR) + noiseI));
        } else if (mode === 'CP') {
          const targetP = Math.max(0, isSequenceRunning ? (sequenceProgress.currentSetpoints.p ?? setpoints.pset) : setpoints.pset);
          v = Math.min(engSettings.vmax, Math.max(1.0, 24.0 + noiseV));
          i = v > 0 ? Math.min(setpoints.iset, Math.max(0, (targetP / v) + noiseI)) : 0;
        } else {
          // CV Mode
          const targetV = isSequenceRunning ? (sequenceProgress.currentSetpoints.v ?? setpoints.cv) : setpoints.cv;
          v = Math.min(engSettings.vmax, Math.max(0, targetV + noiseV));
          const rLoadCV = 4.8 + Math.cos(timeMs / 2500) * 0.4;
          i = Math.min(setpoints.iset, Math.max(0, (v / rLoadCV) + noiseI));
        }

        let activeSp = `${setpoints.cv.toFixed(3)} V`;
        if (mode === 'CC') activeSp = `${(isSequenceRunning ? (sequenceProgress.currentSetpoints.i ?? setpoints.iset) : setpoints.iset).toFixed(3)} A`;
        else if (mode === 'CR') activeSp = `${(isSequenceRunning ? (sequenceProgress.currentSetpoints.r ?? setpoints.rset) : setpoints.rset).toFixed(2)} Ω`;
        else if (mode === 'CP') activeSp = `${(isSequenceRunning ? (sequenceProgress.currentSetpoints.p ?? setpoints.pset) : setpoints.pset).toFixed(1)} W`;
        else if (mode === 'CV') activeSp = `${(isSequenceRunning ? (sequenceProgress.currentSetpoints.v ?? setpoints.cv) : setpoints.cv).toFixed(3)} V`;

        const p = Math.min(engSettings.pmax, v * i);
        const pt: TelemetryPoint = {
          timestamp: timeStr,
          timeSeconds: timeSec,
          vmon: parseFloat(v.toFixed(3)),
          imon: parseFloat(i.toFixed(3)),
          pmon: parseFloat(p.toFixed(2)),
          activeSetpoint: activeSp
        };

        currentSessionLogsRef.current.push(pt);
        setTelemetry(pt);
        setTelemetryHistory((prev) => [...prev.slice(-80), pt]);
      }, settings.pollingIntervalMs);

      return () => clearInterval(timer);
    }
  }, [outputState, setpoints, engSettings, settings.pollingIntervalMs]);

  // Prevent accidental tab/window close while test is running and save test as ABORTED
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (outputState) {
        const logs = [...currentSessionLogsRef.current];
        if (logs.length > 0) {
          const vVals = logs.map((l) => l.vmon);
          const iVals = logs.map((l) => l.imon);
          const pVals = logs.map((l) => l.pmon);

          const maxV = Math.max(...vVals);
          const minV = Math.min(...vVals);
          const maxI = Math.max(...iVals);
          const avgI = parseFloat((iVals.reduce((a, b) => a + b, 0) / iVals.length).toFixed(2));
          const avgP = parseFloat((pVals.reduce((a, b) => a + b, 0) / pVals.length).toFixed(2));
          const lastCapacity = logs[logs.length - 1].capacityAh;

          const abortedSession: TestSession = {
            id: `SES-${Math.floor(1000 + Math.random() * 9000)}`,
            mode: currentMode,
            startTime: new Date().toLocaleString(),
            durationSeconds: elapsedTimeSeconds,
            setpointV: setpoints.cv,
            setpointI: setpoints.iset,
            setpointR: setpoints.rset,
            setpointP: setpoints.pset,
            maxVoltage: maxV,
            minVoltage: minV,
            maxCurrent: maxI,
            avgCurrent: avgI,
            avgPower: avgP,
            capacityAh: lastCapacity,
            status: 'ABORTED',
            logs: logs
          };

          if (window.electronAPI) {
            window.electronAPI.db.saveSession(abortedSession);
            window.electronAPI.modbus.setOutput(false);
          }
        }

        e.preventDefault();
        e.returnValue = 'An active hardware test is running. Closing app will stop the test and save history status as ABORTED.';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [outputState, currentMode, elapsedTimeSeconds, setpoints]);

  // Mode Selection Handler - Real-time switching matching diagnostic panel
  const handleSelectMode = async (mode: OperationMode) => {
    setCurrentMode(mode);
    if (window.electronAPI) {
      try {
        const res = await window.electronAPI.modbus.setMode(mode, true);
        if (res && res.success === false) {
          console.warn('Set mode error:', res.error);
        }
        // Immediate sync matching diagnostic panel to reflect physical hardware setpoints for this mode
        const diagRes = await window.electronAPI.modbus.diagReadAllRegisters();
        if (diagRes && diagRes.success && diagRes.registers) {
          syncRegistersToState(diagRes.registers);
        }
      } catch (err) {
        console.error('Failed to set mode:', err);
      }
    }
  };

  // Setpoint Update Handler - Triggered on ENTER key or SET/ENTER button click
  const handleUpdateSetpoint = async (key: keyof SetpointValues, val: any) => {
    // Safety 1: I_SET_RANGE_CC (imax) cannot be set from PC (monitored from physical HMI only)
    if (key === 'imax') {
      console.warn('I_SET_RANGE_CC cannot be set from PC app (monitored from HMI only)');
      return;
    }

    // Safety 2: In CV mode, I Limit cannot be set from PC (monitored from physical HMI)
    if (currentMode === 'CV' && key === 'iset') {
      console.warn('I Limit cannot be set in CV mode (monitored from HMI)');
      return;
    }

    // Safety 3: I Target / Iset cannot exceed I_SET_RANGE_CC limit (CC mode, CP mode, BAT TEST CC mode)
    const iRangeLimit = (telemetry.hardwareIrange !== undefined && telemetry.hardwareIrange > 0)
      ? telemetry.hardwareIrange
      : ((setpoints.imax > 0 ? setpoints.imax : engSettings.imax) || 10.0);
    if (key === 'iset' && iRangeLimit > 0 && typeof val === 'number' && val > iRangeLimit) {
      setSafetyModal({
        title: '⚠️ Safety Limit Warning',
        message: `⚠️ I_SET_ROW_CC (${val.toFixed(3)} A) exceeds I_SET_RANGE_CC limit (${iRangeLimit.toFixed(3)} A)! Write blocked.`
      });
      setSetpoints((prev) => ({ ...prev }));
      return;
    }

    // Safety 4: Resistance cannot exceed R_MAX limit (CR mode, BAT TEST CR mode)
    const rMaxLimit = (telemetry.hardwareRmax !== undefined && telemetry.hardwareRmax > 0)
      ? telemetry.hardwareRmax
      : (engSettings.rmax || 100.0);
    if (key === 'rset' && rMaxLimit > 0 && typeof val === 'number' && val > rMaxLimit) {
      setSafetyModal({
        title: '⚠️ Safety Limit Warning',
        message: `⚠️ RESISTOR_CR_MODE (${val.toFixed(2)} Ω) exceeds R_MAX limit (${rMaxLimit.toFixed(2)} Ω)! Write blocked.`
      });
      setSetpoints((prev) => ({ ...prev }));
      return;
    }

    // Safety 5: Cutoff Voltage cannot exceed V_MAX limit (BAT TEST mode)
    const vMaxLimit = (telemetry.hardwareVmax !== undefined && telemetry.hardwareVmax > 0)
      ? telemetry.hardwareVmax
      : (engSettings.vmax || 60.0);
    if (key === 'cutoffV' && vMaxLimit > 0 && typeof val === 'number' && val > vMaxLimit) {
      setSafetyModal({
        title: '⚠️ Safety Limit Warning',
        message: `⚠️ VCUTOFF (${val.toFixed(2)} V) exceeds V_MAX limit (${vMaxLimit.toFixed(2)} V)! Write blocked.`
      });
      setSetpoints((prev) => ({ ...prev }));
      return;
    }

    // Safety 6: Power cannot exceed P_MAX limit
    const pMaxLimit = (telemetry.hardwarePmax !== undefined && telemetry.hardwarePmax > 0)
      ? telemetry.hardwarePmax
      : (engSettings.pmax || 5000.0);
    if (key === 'pset' && pMaxLimit > 0 && typeof val === 'number' && val > pMaxLimit) {
      setSafetyModal({
        title: '⚠️ Safety Limit Warning',
        message: `⚠️ POWER_CP_MODE (${val.toFixed(1)} W) exceeds P_MAX limit (${pMaxLimit.toFixed(1)} W)! Write blocked.`
      });
      setSetpoints((prev) => ({ ...prev }));
      return;
    }

    // Safety 7: CV Voltage cannot exceed V_MAX limit (matching diagnostic panel safety enforcement)
    if (key === 'cv' && vMaxLimit > 0 && typeof val === 'number' && val > vMaxLimit) {
      setSafetyModal({
        title: '⚠️ Safety Limit Warning',
        message: `⚠️ CV_VOLT (${val.toFixed(3)} V) exceeds V_MAX limit (${vMaxLimit.toFixed(2)} V)! Write blocked.`
      });
      setSetpoints((prev) => ({ ...prev }));
      return;
    }

    const updated = { ...setpoints, [key]: val };
    setSetpoints(updated);

    if (window.electronAPI) {
      try {
        console.log(`[Setpoint Write] Writing ${key} = ${val} to RS485...`);
        // Crucial: Only pass the specific changed setpoint so Modbus writes only that register!
        const res = await window.electronAPI.modbus.writeSetpoints({ [key]: val });
        if (res && res.success === false) {
          setSafetyModal({
            title: '⚠️ Setpoint Write Failed',
            message: res.error || 'Modbus communication error'
          });
        }
      } catch (e: any) {
        console.warn('RS485 write setpoint error:', e);
        setSafetyModal({
          title: '⚠️ Communication Error',
          message: e?.message || 'RS485 serial communication error'
        });
      }
    }
  };

  // Engineering Settings Update Handler
  const handleSaveEngSettings = async (newEng: EngineeringSettings) => {
    setEngSettings(newEng);
    if (window.electronAPI) {
      try {
        const res = await window.electronAPI.modbus.writeEngSettings(newEng);
        if (res && res.success === false) {
          setSafetyModal({
            title: '⚠️ Engineering Settings Write Failed',
            message: res.error || 'Failed to write engineering settings to hardware'
          });
        }
      } catch (err: any) {
        setSafetyModal({
          title: '⚠️ Communication Error',
          message: err?.message || 'RS485 serial communication error'
        });
      }
    }
  };

  // Output ON / OFF Toggle Handler with Hardware Compatibility Lock & State Verification
  const handleToggleOutput = async (state: boolean) => {
    if (state && !isAuthorized) {
      setSafetyModal({
        title: '⚠️ Hardware Validation Restriction',
        message: `HARDWARE VALIDATION RESTRICTION: Physical hardware has not been tested for device profile "${activeProfile.name}". Output control is strictly disabled.`
      });
      return;
    }



    if (window.electronAPI) {
      const res: any = await window.electronAPI.modbus.setOutput(state);
      if (res && res.success === false) {
        setSafetyModal({
          title: '⚠️ Output Command Failed',
          message: res.error || 'Failed to toggle output!'
        });
        return;
      }
    }

    setOutputState(state);
    setOutputConfirmedState(state ? 'ON' : 'OFF');

    if (state) {
      // STARTING TEST SESSION
      setElapsedTimeSeconds(0);
      setTelemetryHistory([]);
      currentSessionLogsRef.current = [];

      timerRef.current = setInterval(() => {
        setElapsedTimeSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      // STOPPING TEST SESSION & SAVING TO DATABASE
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }



      const logs = [...currentSessionLogsRef.current];
      if (logs.length > 0) {
        const vVals = logs.map((l) => l.vmon);
        const iVals = logs.map((l) => l.imon);
        const pVals = logs.map((l) => l.pmon);

        const maxV = Math.max(...vVals);
        const minV = Math.min(...vVals);
        const maxI = Math.max(...iVals);
        const avgI = parseFloat((iVals.reduce((a, b) => a + b, 0) / iVals.length).toFixed(2));
        const avgP = parseFloat((pVals.reduce((a, b) => a + b, 0) / pVals.length).toFixed(2));
        const lastCapacity = logs[logs.length - 1].capacityAh;

        const newSession: TestSession = {
          id: `SES-${Math.floor(1000 + Math.random() * 9000)}`,
          mode: currentMode,
          startTime: new Date().toLocaleString(),
          durationSeconds: elapsedTimeSeconds,
          setpointV: setpoints.cv,
          setpointI: setpoints.iset,
          setpointR: setpoints.rset,
          setpointP: setpoints.pset,
          maxVoltage: maxV,
          minVoltage: minV,
          maxCurrent: maxI,
          avgCurrent: avgI,
          avgPower: avgP,
          capacityAh: lastCapacity,
          status: 'COMPLETED',
          logs: logs
        };

        setSessions((prev) => [newSession, ...prev]);

        if (window.electronAPI) {
          await window.electronAPI.db.saveSession(newSession);
        }
      }
    }
  };

  // Delete Session
  const handleDeleteSession = async (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (window.electronAPI) {
      await window.electronAPI.db.deleteSession(id);
    }
  };

  // Save Settings & Connect
  const handleSaveSettings = async (newSettings: ConnectionSettings): Promise<boolean> => {
    setSettings(newSettings);
    if (window.electronAPI) {
      const res = await window.electronAPI.modbus.connect(newSettings);
      const isOk = typeof res === 'boolean' ? res : (res?.success ?? false);
      if (isOk) {
        setConnectionStatus('CONNECTED');
      }
      return isOk;
    } else {
      setConnectionStatus('CONNECTED');
      return true;
    }
  };

  // Disconnect from Hardware
  const handleDisconnect = async () => {
    if (window.electronAPI) {
      await window.electronAPI.modbus.disconnect();
    }
    setConnectionStatus('DISCONNECTED');
  };

  return (
    <div className="app-container">
      <Header
        activeMode={currentMode}
        batTestSubMode={setpoints.batTestSubMode}
        connectionStatus={connectionStatus}
        activeTab={activeView}
        protocolType={settings.protocolType || 'RS485'}
      />

      <NavigationTabs
        currentMode={isSequenceRunning ? sequenceProgress.currentMode : currentMode}
        onSelectMode={handleSelectMode}
        activeView={activeView}
        onSelectView={setActiveView}
        isTestRunning={isSequenceRunning}
        protocolType={settings.protocolType || 'RS485'}
      />

      {activeView === 'dashboard' && (
        <main className="dashboard-layout">
          <div className="sidebar-controls">
            {isSequenceRunning && (
              <div style={{
                background: '#ecfdf5',
                border: '1.5px solid #10b981',
                borderRadius: '6px',
                padding: '10px 14px',
                color: '#065f46',
                fontSize: '0.82rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                boxShadow: '0 2px 6px rgba(16, 185, 129, 0.15)'
              }}>
                <Zap size={18} style={{ color: '#059669', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 800, color: '#064e3b' }}>AUTOMATED TEST SEQUENCE RUNNING — CONTROLS FREEZED</div>
                  <div style={{ fontSize: '0.75rem', color: '#047857', marginTop: '2px' }}>
                    Test: <strong>{sequenceProgress.testName}</strong> | Step {sequenceProgress.currentStepIndex + 1} of {sequenceProgress.totalSteps || 1} | Cycle {Math.min(sequenceProgress.currentCycle, sequenceProgress.totalCycles || 1)} of {sequenceProgress.totalCycles} ({sequenceProgress.currentMode} Mode)
                  </div>
                </div>
              </div>
            )}

            <MetricsGrid
              currentMode={isSequenceRunning ? sequenceProgress.currentMode : currentMode}
              onSelectMode={handleSelectMode}
              telemetry={telemetry}
              setpoints={setpoints}
              engSettings={engSettings}
              onUpdateSetpoint={handleUpdateSetpoint}
              onResetBatTest={handleResetBatTest}
              outputState={outputState}
              elapsedTimeSeconds={elapsedTimeSeconds}
              isSequenceRunning={isSequenceRunning}
            />

            <OutputControlPanel
              outputState={outputState}
              outputConfirmedState={outputConfirmedState}
              validationStatus={activeProfile.validationStatus}
              isSimulator={settings.isSimulator}
              onToggleOutput={handleToggleOutput}
              disabled={isSequenceRunning}
            />
          </div>

          <LiveChart
            data={telemetryHistory}
            onClearData={() => setTelemetryHistory([])}
            chartRef={chartRef}
            currentMode={isSequenceRunning ? sequenceProgress.currentMode : currentMode}
            batTestSubMode={setpoints.batTestSubMode}
            setpoints={setpoints}
            hardwareIrange={telemetry.hardwareIrange}
          />
        </main>
      )}

      <div style={{ display: activeView === 'sequence' ? 'block' : 'none' }}>
        <SequenceBuilder
          engSettings={engSettings}
          telemetry={telemetry}
          connectionStatus={connectionStatus}
          isSimulator={settings.isSimulator}
        />
      </div>

      {activeView === 'engSettings' && (
        <EngSettings
          engSettings={engSettings}
          onSaveEngSettings={handleSaveEngSettings}
        />
      )}

      {activeView === 'history' && (
        <HistoryAndPdf
          sessions={sessions}
          onDeleteSession={handleDeleteSession}
          chartContainerRef={chartRef}
        />
      )}

      {activeView === 'settings' && (
        <SettingsModal
          settings={settings}
          onSaveSettings={handleSaveSettings}
          onDisconnect={handleDisconnect}
          connectionStatus={connectionStatus}
        />
      )}

      {/* POP_POWER_exceed Alarm Modal */}
      {telemetry.popPowerExceed && !dismissedPowerAlarm && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          zIndex: 99999,
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#dc2626', marginBottom: '16px' }}>
              <AlertTriangle size={36} />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>HIGH POWER</h3>
                <span style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 700 }}>REGISTER MAP COIL 0X 3 (POP_POWER_exceed)</span>
              </div>
            </div>
            <p style={{ fontSize: '0.95rem', color: '#374151', lineHeight: '1.5', margin: '0 0 20px 0', fontWeight: 700 }}>
              HIGH POWER: System power output has exceeded maximum safety limits ({engSettings.pmax} W). Immediate intervention recommended.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={async () => {
                  handleToggleOutput(false);
                  setDismissedPowerAlarm(true);
                  if (window.electronAPI) {
                    await window.electronAPI.modbus.clearAlarmCoil(2);
                  }
                }}
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px 18px',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                EMERGENCY STOP
              </button>
              <button
                onClick={async () => {
                  setDismissedPowerAlarm(true);
                  if (window.electronAPI) {
                    await window.electronAPI.modbus.clearAlarmCoil(2);
                  }
                }}
                style={{
                  background: '#f3f4f6',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  padding: '10px 18px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POP_VOLT_exceed Alarm Modal */}
      {telemetry.popVoltExceed && !dismissedVoltAlarm && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          zIndex: 99999,
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#dc2626', marginBottom: '16px' }}>
              <AlertTriangle size={36} />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>HIGH VOLTAGE</h3>
                <span style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 700 }}>REGISTER MAP COIL 0X 4 (POP_VOLT_exceed)</span>
              </div>
            </div>
            <p style={{ fontSize: '0.95rem', color: '#374151', lineHeight: '1.5', margin: '0 0 20px 0', fontWeight: 700 }}>
              HIGH VOLTAGE: Terminal voltage has exceeded maximum safety limits ({engSettings.vmax} V). Hardware protection engaged.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={async () => {
                  handleToggleOutput(false);
                  setDismissedVoltAlarm(true);
                  if (window.electronAPI) {
                    await window.electronAPI.modbus.clearAlarmCoil(3);
                  }
                }}
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px 18px',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                EMERGENCY STOP
              </button>
              <button
                onClick={async () => {
                  setDismissedVoltAlarm(true);
                  if (window.electronAPI) {
                    await window.electronAPI.modbus.clearAlarmCoil(3);
                  }
                }}
                style={{
                  background: '#f3f4f6',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  padding: '10px 18px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {safetyModal && (
        <SafetyModal
          title={safetyModal.title}
          message={safetyModal.message}
          onClose={() => setSafetyModal(null)}
        />
      )}
    </div>
  );
};
