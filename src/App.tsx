import React, { useEffect, useRef, useState } from 'react';
import { BUILTIN_PROFILES, ConnectionSettings, EngineeringSettings, OperationMode, SetpointValues, TelemetryPoint, TestSession } from './types/scada';
import { Header } from './components/Header';
import { NavigationTabs } from './components/NavigationTabs';
import { MetricsGrid } from './components/MetricsGrid';
import { OutputControlPanel } from './components/OutputControlPanel';
import { LiveChart } from './components/LiveChart';
import { HistoryAndPdf } from './components/HistoryAndPdf';
import { SettingsModal } from './components/SettingsModal';
import { EngSettings } from './components/EngSettings';
import './styles/index.css';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<'dashboard' | 'history' | 'settings' | 'engSettings'>('dashboard');
  const [currentMode, setCurrentMode] = useState<OperationMode>('CV');
  const [outputState, setOutputState] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'SIMULATOR'>('SIMULATOR');

  const [engSettings, setEngSettings] = useState<EngineeringSettings>({
    vmax: 60.0,
    imax: 30.0,
    pmax: 300.0,
    rmax: 100.0
  });

  const [setpoints, setSetpoints] = useState<SetpointValues>({
    cv: 24.00,
    iset: 5.00,
    imax: 10.00,
    rset: 10.0,
    pset: 120.0,
    cutoffV: 10.50,
    dischgI: 2.50,
    batTestSubMode: 'CC'
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
    isSimulator: true, // Default in Simulator Mode
    selectedProfileId: 'SIMULATOR_PROFILE',
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
    }
  });

  const activeProfile = BUILTIN_PROFILES.find((p) => p.id === settings.selectedProfileId) || BUILTIN_PROFILES[0];
  const isAuthorized = settings.isSimulator
    ? activeProfile.validationStatus === 'SIMULATOR_TESTED'
    : activeProfile.validationStatus === 'HARDWARE_VALIDATED';

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

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const currentSessionLogsRef = useRef<TelemetryPoint[]>([]);

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

  // Listen to IPC Telemetry Streams
  useEffect(() => {
    if (window.electronAPI) {
      const unsubTelemetry = window.electronAPI.modbus.onTelemetry((point) => {
        setTelemetry(point);

        // Fetch and stream points into graph ONLY when hardware output is ON
        if (outputState) {
          setTelemetryHistory((prev) => [...prev.slice(-80), point]);
          currentSessionLogsRef.current.push(point);
        }
      });

      const unsubStatus = window.electronAPI.modbus.onStatusChange((status: any) => {
        setConnectionStatus(status);
      });

      return () => {
        unsubTelemetry();
        unsubStatus();
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

        const v = Math.min(engSettings.vmax, Math.max(0, setpoints.cv + noiseV));
        const i = Math.min(engSettings.imax, Math.max(0, setpoints.iset + noiseI));
        const p = Math.min(engSettings.pmax, v * i);
        const pt: TelemetryPoint = {
          timestamp: timeStr,
          timeSeconds: timeSec,
          vmon: parseFloat(v.toFixed(2)),
          imon: parseFloat(i.toFixed(2)),
          pmon: parseFloat(p.toFixed(2))
        };

        currentSessionLogsRef.current.push(pt);
        setTelemetry(pt);
        setTelemetryHistory((prev) => [...prev.slice(-80), pt]);
      }, settings.pollingIntervalMs);

      return () => clearInterval(timer);
    }
  }, [outputState, setpoints, engSettings, settings.pollingIntervalMs]);

  // Prevent accidental tab/window close while test is running
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (outputState) {
        e.preventDefault();
        e.returnValue = 'An active hardware test is running. Are you sure you want to exit?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [outputState]);

  // Mode Selection Handler - Locked when output is ON
  const handleSelectMode = async (mode: OperationMode) => {
    if (outputState) return; // Mode locked during active test!
    setCurrentMode(mode);
    if (window.electronAPI) {
      await window.electronAPI.modbus.setMode(mode);
    }
  };

  // Setpoint Update Handler
  const handleUpdateSetpoint = async (key: keyof SetpointValues, val: number) => {
    const updated = { ...setpoints, [key]: val };
    setSetpoints(updated);
    if (window.electronAPI) {
      await window.electronAPI.modbus.writeSetpoints(updated);
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

  // Save Settings
  const handleSaveSettings = async (newSettings: ConnectionSettings) => {
    setSettings(newSettings);
    setConnectionStatus(newSettings.isSimulator ? 'SIMULATOR' : 'CONNECTED');
    if (window.electronAPI) {
      await window.electronAPI.modbus.connect(newSettings);
    }
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
        currentMode={currentMode}
        onSelectMode={handleSelectMode}
        activeView={activeView}
        onSelectView={setActiveView}
        isTestRunning={outputState}
      />

      {activeView === 'dashboard' && (
        <main className="dashboard-layout">
          <div className="sidebar-controls">
            <MetricsGrid
              currentMode={currentMode}
              telemetry={telemetry}
              setpoints={setpoints}
              onUpdateSetpoint={handleUpdateSetpoint}
              outputState={outputState}
              elapsedTimeSeconds={elapsedTimeSeconds}
            />

            <OutputControlPanel
              outputState={outputState}
              outputConfirmedState={outputConfirmedState}
              validationStatus={activeProfile.validationStatus}
              isSimulator={settings.isSimulator}
              onToggleOutput={handleToggleOutput}
            />
          </div>

          <LiveChart
            data={telemetryHistory}
            onClearData={() => setTelemetryHistory([])}
            chartRef={chartRef}
            currentMode={currentMode}
            batTestSubMode={setpoints.batTestSubMode}
          />
        </main>
      )}

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
        />
      )}
    </div>
  );
};
