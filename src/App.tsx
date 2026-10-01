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
import { Zap, AlertTriangle } from 'lucide-react';
import './styles/index.css';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ActiveViewType>('dashboard');
  const [currentMode, setCurrentMode] = useState<OperationMode>('CV');
  const [outputState, setOutputState] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<'CONNECTED' | 'DISCONNECTED'>('DISCONNECTED');

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
    wordSwap: true
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
    } else {
      setTelemetry((prev) => ({
        ...prev,
        ah: 0.0,
        hrs: 0,
        min: 0,
        capacityAh: 0.0
      }));
    }
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

  // Listen to IPC Telemetry Streams & Sequence Engine Events
  useEffect(() => {
    if (window.electronAPI) {
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

        // Stream points into telemetry history graph when output is ON or point has active telemetry
        if (outputState || point.isOutputOn || point.vmon > 0 || point.imon > 0 || point.pmon > 0) {
          setTelemetryHistory((prev) => [...prev.slice(-80), point]);
          
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

  // Mode Selection Handler - Locked when output is ON
  const handleSelectMode = async (mode: OperationMode) => {
    if (outputState) return; // Mode locked during active test!
    setCurrentMode(mode);
    if (window.electronAPI) {
      await window.electronAPI.modbus.setMode(mode);
    }
  };

  // Setpoint Update Handler - Triggered on ENTER key or SET/ENTER button click
  const handleUpdateSetpoint = async (key: keyof SetpointValues, val: number) => {
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

    // Safety 3: I Target cannot exceed I_SET_RANGE_CC limit
    if (key === 'iset' && setpoints.imax > 0 && val > setpoints.imax) {
      alert(`⚠️ Safety Limit Warning: I Target (${val} A) exceeds I_SET_RANGE_CC limit (${setpoints.imax.toFixed(3)} A)!`);
      return;
    }

    // Safety 4: Resistance cannot exceed R_MAX limit
    if (key === 'rset' && engSettings.rmax > 0 && val > engSettings.rmax) {
      alert(`⚠️ Safety Limit Warning: Resistance (${val} Ω) exceeds R_MAX limit (${engSettings.rmax.toFixed(2)} Ω)!`);
      return;
    }

    // Safety 5: Cutoff Voltage cannot exceed V_MAX limit
    if (key === 'cutoffV' && engSettings.vmax > 0 && val > engSettings.vmax) {
      alert(`⚠️ Safety Limit Warning: Cutoff Voltage (${val} V) exceeds V_MAX limit (${engSettings.vmax.toFixed(2)} V)!`);
      return;
    }

    // Safety 6: Power cannot exceed P_MAX limit
    if (key === 'pset' && engSettings.pmax > 0 && val > engSettings.pmax) {
      alert(`⚠️ Safety Limit Warning: Power (${val} W) exceeds P_MAX limit (${engSettings.pmax.toFixed(1)} W)!`);
      return;
    }

    const updated = { ...setpoints, [key]: val };
    setSetpoints(updated);

    if (connectionStatus === 'CONNECTED' && window.electronAPI) {
      try {
        console.log(`[Setpoint Write] Writing ${key} = ${val} to RS485...`);
        // Crucial: Only pass the specific changed setpoint so Modbus writes only that register!
        await window.electronAPI.modbus.writeSetpoints({ [key]: val });
      } catch (e) {
        console.warn('RS485 write setpoint error:', e);
      }
    }
  };

  // Engineering Settings Update Handler
  const handleSaveEngSettings = async (newEng: EngineeringSettings) => {
    setEngSettings(newEng);
    if (window.electronAPI) {
      await window.electronAPI.modbus.writeEngSettings(newEng);
    }
  };

  // Output ON / OFF Toggle Handler with Hardware Compatibility Lock & State Verification
  const handleToggleOutput = async (state: boolean) => {
    if (state && !isAuthorized) {
      alert(`HARDWARE VALIDATION RESTRICTION: Physical hardware has not been tested for device profile "${activeProfile.name}". Output control is strictly disabled.`);
      return;
    }

    if (!state) {
      // User clicked OUTPUT OFF:
      // Immediately reset live telemetry display to 0.00 V / 0.00 A to suppress floating sensor noise
      const timeStr = new Date().toTimeString().split(' ')[0];
      const timeSec = Math.floor(Date.now() / 1000);
      const zeroPt: TelemetryPoint = { timestamp: timeStr, timeSeconds: timeSec, vmon: 0.00, imon: 0.00, pmon: 0.00, isOutputOn: false };
      setTelemetry(zeroPt);
      setTelemetryHistory([zeroPt]);
    }

    if (window.electronAPI) {
      const res: any = await window.electronAPI.modbus.setOutput(state);
      if (res && res.success === false) {
        alert(res.error || 'Failed to toggle output!');
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

      // Immediately reset live telemetry and graph history back flat to 0.00V and 0.00A
      const timeStr = new Date().toTimeString().split(' ')[0];
      const timeSec = Math.floor(Date.now() / 1000);
      const zeroPt = { timestamp: timeStr, timeSeconds: timeSec, vmon: 0.00, imon: 0.00, pmon: 0.00 };

      setTelemetry(zeroPt);
      setTelemetryHistory([zeroPt]);

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
      return typeof res === 'boolean' ? res : (res?.success ?? false);
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
      />

      <NavigationTabs
        currentMode={isSequenceRunning ? sequenceProgress.currentMode : currentMode}
        onSelectMode={handleSelectMode}
        activeView={activeView}
        onSelectView={setActiveView}
        isTestRunning={outputState || isSequenceRunning}
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
    </div>
  );
};
