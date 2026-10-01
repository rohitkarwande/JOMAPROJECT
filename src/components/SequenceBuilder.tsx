import React, { useEffect, useState } from 'react';
import { EngineeringSettings, formatCurrent, formatVoltage, SequenceConfig, SequencePreset, SequenceProgress, SequenceStep, SequenceStepMode, TelemetryPoint } from '../types/scada';
import { Power, PowerOff, Plus, Trash2, ArrowUp, ArrowDown, Save, FolderOpen, ShieldAlert, Check, Clock, RotateCcw, AlertTriangle, Activity, Zap, RefreshCw } from 'lucide-react';

interface SequenceBuilderProps {
  engSettings: EngineeringSettings;
  telemetry: TelemetryPoint;
  connectionStatus: 'CONNECTED' | 'DISCONNECTED' | 'SIMULATOR';
  isSimulator: boolean;
  onSaveSessionLog?: (session: any) => void;
}

const DEFAULT_STEPS: SequenceStep[] = [
  {
    id: 'STEP-1',
    stepNumber: 1,
    durationHours: 0,
    durationMinutes: 0,
    durationSeconds: 20,
    totalDurationSeconds: 20,
    mode: 'CV',
    setpointV: 20.0,
    setpointI: 8.0
  },
  {
    id: 'STEP-2',
    stepNumber: 2,
    durationHours: 0,
    durationMinutes: 0,
    durationSeconds: 35,
    totalDurationSeconds: 35,
    mode: 'CV',
    setpointV: 24.0,
    setpointI: 5.0
  }
];

export const SequenceBuilder: React.FC<SequenceBuilderProps> = ({
  engSettings,
  telemetry,
  connectionStatus,
  isSimulator,
  onSaveSessionLog
}) => {
  // Test Configuration State
  const [testName, setTestName] = useState<string>('Automated Voltage Cycle Test');
  const [sequenceMode, setSequenceMode] = useState<SequenceStepMode>('CV');
  const [cycles, setCycles] = useState<number>(2);
  const [steps, setSteps] = useState<SequenceStep[]>(DEFAULT_STEPS);
  const [presetNameInput, setPresetNameInput] = useState<string>('');
  const [showPresetSaveModal, setShowPresetSaveModal] = useState<boolean>(false);

  // Presets State
  const [presets, setPresets] = useState<SequencePreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');

  // Live Progress & Engine State
  const [progress, setProgress] = useState<SequenceProgress>({
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

  const [validationError, setValidationError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Load Presets & Initial Progress on Mount
  useEffect(() => {
    const loadPresets = async () => {
      if (window.electronAPI) {
        const list = await window.electronAPI.db.getPresets();
        setPresets(list);

        const currentProg = await window.electronAPI.sequence.getProgress();
        if (currentProg) setProgress(currentProg);
      }
    };
    loadPresets();
  }, []);

  // Subscribe to IPC Sequence Progress updates
  useEffect(() => {
    if (window.electronAPI) {
      const unsub = window.electronAPI.sequence.onProgress((prog) => {
        setProgress(prog);

        // When sequence finishes or aborts, show feedback message
        if (prog.state === 'COMPLETED') {
          setActionMessage('Test Sequence Completed Successfully!');
          setTimeout(() => setActionMessage(null), 4000);
        } else if (prog.state === 'ABORTED' || prog.state === 'FAULT') {
          setActionMessage(prog.errorMessage || 'Test Sequence Stopped / Aborted.');
          setTimeout(() => setActionMessage(null), 5000);
        }
      });
      return () => unsub();
    }
  }, []);

  // Helper: Format seconds to HH:MM:SS
  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Recalculate step numbers & total duration
  const updateSteps = (newSteps: SequenceStep[], mode: SequenceStepMode = sequenceMode) => {
    const formatted = newSteps.map((step, idx) => {
      const h = Math.max(0, step.durationHours || 0);
      const m = Math.max(0, step.durationMinutes || 0);
      const s = Math.max(0, step.durationSeconds || 0);
      const totalSec = h * 3600 + m * 60 + s;
      return {
        ...step,
        stepNumber: idx + 1,
        durationHours: h,
        durationMinutes: m,
        durationSeconds: s,
        totalDurationSeconds: totalSec,
        mode: mode
      };
    });
    setSteps(formatted);
    validateSequence(testName, cycles, formatted, mode);
  };

  const handleSequenceModeChange = (newMode: SequenceStepMode) => {
    setSequenceMode(newMode);
    const updated = steps.map((step) => {
      const s = { ...step, mode: newMode };
      if (newMode === 'CV') {
        s.setpointV = s.setpointV ?? 24.0;
        s.setpointI = s.setpointI ?? 5.0;
      } else if (newMode === 'CC') {
        s.setpointI = s.setpointI ?? 5.0;
      } else if (newMode === 'CR') {
        s.setpointR = s.setpointR ?? 10.0;
      } else if (newMode === 'CP') {
        s.setpointP = s.setpointP ?? 120.0;
      }
      return s;
    });
    updateSteps(updated, newMode);
  };

  // Calculate Total Programmed Duration
  const singleCycleDuration = steps.reduce((sum, s) => sum + s.totalDurationSeconds, 0);
  const totalProgrammedDuration = singleCycleDuration * Math.max(1, cycles);

  // Validate entire sequence against safety limits
  const validateSequence = (name: string, c: number, sList: SequenceStep[], mode: SequenceStepMode = sequenceMode): boolean => {
    if (!name || !name.trim()) {
      setValidationError('Test Name is required.');
      return false;
    }
    if (!c || c < 1 || !Number.isInteger(c)) {
      setValidationError('Cycles must be a positive integer (at least 1).');
      return false;
    }
    if (sList.length === 0) {
      setValidationError('At least one step must be added.');
      return false;
    }

    for (let i = 0; i < sList.length; i++) {
      const step = sList[i];
      if (step.totalDurationSeconds <= 0) {
        setValidationError(`Step #${i + 1} duration must be greater than 0 seconds.`);
        return false;
      }

      if (mode === 'CV') {
        if (step.setpointV === undefined || isNaN(step.setpointV) || step.setpointV < 0) {
          setValidationError(`Step #${i + 1} (CV): Invalid Voltage setpoint.`);
          return false;
        }
        if (step.setpointV > engSettings.vmax) {
          setValidationError(`Step #${i + 1} (CV): Voltage (${step.setpointV}V) exceeds Maximum Safety Limit (${engSettings.vmax}V).`);
          return false;
        }
      } else if (mode === 'CC') {
        if (step.setpointI === undefined || isNaN(step.setpointI) || step.setpointI < 0) {
          setValidationError(`Step #${i + 1} (CC): Invalid Current setpoint.`);
          return false;
        }
        if (step.setpointI > engSettings.imax) {
          setValidationError(`Step #${i + 1} (CC): Current (${step.setpointI}A) exceeds Maximum Safety Limit (${engSettings.imax}A).`);
          return false;
        }
      } else if (mode === 'CR') {
        if (step.setpointR === undefined || isNaN(step.setpointR) || step.setpointR <= 0) {
          setValidationError(`Step #${i + 1} (CR): Resistance setpoint must be greater than 0 Ω.`);
          return false;
        }
        if (step.setpointR > engSettings.rmax) {
          setValidationError(`Step #${i + 1} (CR): Resistance (${step.setpointR}Ω) exceeds Maximum Safety Limit (${engSettings.rmax}Ω).`);
          return false;
        }
      } else if (mode === 'CP') {
        if (step.setpointP === undefined || isNaN(step.setpointP) || step.setpointP < 0) {
          setValidationError(`Step #${i + 1} (CP): Invalid Power setpoint.`);
          return false;
        }
        if (step.setpointP > engSettings.pmax) {
          setValidationError(`Step #${i + 1} (CP): Power (${step.setpointP}W) exceeds Maximum Safety Limit (${engSettings.pmax}W).`);
          return false;
        }
      }
    }

    setValidationError(null);
    return true;
  };

  // Add Step
  const handleAddStep = () => {
    const nextNum = steps.length + 1;
    const newStep: SequenceStep = {
      id: `STEP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      stepNumber: nextNum,
      durationHours: 0,
      durationMinutes: 0,
      durationSeconds: 15,
      totalDurationSeconds: 15,
      mode: sequenceMode,
      setpointV: 24.0,
      setpointI: 5.0,
      setpointR: 10.0,
      setpointP: 120.0
    };
    updateSteps([...steps, newStep], sequenceMode);
  };

  // Edit Step Field
  const handleEditStep = (index: number, key: keyof SequenceStep, val: any) => {
    if (key === 'mode') {
      handleSequenceModeChange(val as SequenceStepMode);
      return;
    }
    const updated = [...steps];
    const target = { ...updated[index], [key]: val };
    updated[index] = target;
    updateSteps(updated, sequenceMode);
  };

  // Move Step Up/Down
  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === steps.length - 1) return;

    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...steps];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    updateSteps(updated, sequenceMode);
  };

  // Remove Step
  const handleRemoveStep = (index: number) => {
    const updated = steps.filter((_, i) => i !== index);
    updateSteps(updated, sequenceMode);
  };

  // Preset Handlers
  const handleSavePreset = async () => {
    if (!presetNameInput.trim()) return;
    const config: SequenceConfig = {
      id: `SEQ-${Date.now()}`,
      name: testName,
      mode: sequenceMode,
      cycles,
      steps: steps.map((s) => ({ ...s, mode: sequenceMode })),
      totalProgrammedDurationSeconds: totalProgrammedDuration
    };
    const newPreset: SequencePreset = {
      id: `PRESET-${Date.now()}`,
      name: presetNameInput.trim(),
      config,
      createdAt: new Date().toLocaleString()
    };

    if (window.electronAPI) {
      await window.electronAPI.db.savePreset(newPreset);
      const list = await window.electronAPI.db.getPresets();
      setPresets(list);
    } else {
      setPresets((prev) => [newPreset, ...prev]);
    }
    setShowPresetSaveModal(false);
    setPresetNameInput('');
    setActionMessage('Preset Saved Successfully!');
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handleLoadPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const found = presets.find((p) => p.id === presetId);
    if (found && found.config) {
      setTestName(found.config.name);
      setCycles(found.config.cycles);
      const loadedMode = found.config.mode || found.config.steps[0]?.mode || 'CV';
      setSequenceMode(loadedMode);
      updateSteps(found.config.steps, loadedMode);
      setActionMessage(`Loaded Preset "${found.name}"!`);
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    if (window.electronAPI) {
      await window.electronAPI.db.deletePreset(presetId);
      const list = await window.electronAPI.db.getPresets();
      setPresets(list);
    } else {
      setPresets((prev) => prev.filter((p) => p.id !== presetId));
    }
    setSelectedPresetId('');
  };

  // Execution Handlers
  const handleStartSequence = async () => {
    if (!validateSequence(testName, cycles, steps, sequenceMode)) return;

    const config: SequenceConfig = {
      id: `SEQ-${Date.now()}`,
      name: testName,
      mode: sequenceMode,
      cycles,
      steps: steps.map((s) => ({ ...s, mode: sequenceMode })),
      totalProgrammedDurationSeconds: totalProgrammedDuration
    };

    if (window.electronAPI) {
      const res = await window.electronAPI.sequence.start(config);
      if (!res.success) {
        alert(res.error || 'Failed to start sequence execution!');
      }
    } else {
      // Mock Fallback for Browser Preview
      setProgress({
        state: 'RUNNING',
        testName,
        currentCycle: 1,
        totalCycles: cycles,
        currentStepIndex: 0,
        totalSteps: steps.length,
        currentStep: steps[0],
        currentMode: sequenceMode,
        currentSetpoints: { v: steps[0].setpointV, i: steps[0].setpointI, r: steps[0].setpointR, p: steps[0].setpointP },
        stepDurationSeconds: steps[0].totalDurationSeconds,
        stepRemainingSeconds: steps[0].totalDurationSeconds,
        totalElapsedSeconds: 0,
        totalProgrammedDurationSeconds: totalProgrammedDuration,
        overallProgressPercent: 0
      });
    }
  };

  const handlePauseResume = async () => {
    if (window.electronAPI) {
      if (progress.state === 'RUNNING') {
        await window.electronAPI.sequence.pause();
      } else if (progress.state === 'PAUSED') {
        await window.electronAPI.sequence.resume();
      }
    }
  };

  const handleStopSequence = async () => {
    if (window.electronAPI) {
      await window.electronAPI.sequence.stop();
    }
    setProgress({
      state: 'IDLE',
      testName: '',
      currentCycle: 1,
      totalCycles: cycles,
      currentStepIndex: 0,
      totalSteps: steps.length,
      currentMode: sequenceMode,
      currentSetpoints: {},
      stepDurationSeconds: steps[0]?.totalDurationSeconds || 0,
      stepRemainingSeconds: steps[0]?.totalDurationSeconds || 0,
      totalElapsedSeconds: 0,
      totalProgrammedDurationSeconds: singleCycleDuration * cycles,
      overallProgressPercent: 0
    });
    setActionMessage('Test sequence stopped and reset. Ready for a new test run.');
    setTimeout(() => setActionMessage(null), 4000);
  };

  const isExecuting = progress.state === 'STARTING' || progress.state === 'RUNNING' || progress.state === 'PAUSED';

  return (
    <div className="content-page" style={{ gap: '20px' }}>
      {/* Top Banner & Presets Management */}
      <div className="card-panel" style={{ background: '#f8fafc', border: '1.5px solid #0284c7', padding: '10px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-main)', fontWeight: 800, fontSize: '1.15rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={20} style={{ color: '#0284c7' }} />
              <span>AUTOMATED TEST SEQUENCE BUILDER</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Presets Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FolderOpen size={18} style={{ color: '#475569' }} />
              <select
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', fontWeight: 600, fontSize: '0.85rem', color: '#0f172a', background: '#ffffff' }}
                value={selectedPresetId}
                onChange={(e) => handleLoadPreset(e.target.value)}
                disabled={isExecuting}
              >
                <option value="">-- Load Saved Preset --</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.config.steps.length} Steps, {p.config.cycles} Cycles)
                  </option>
                ))}
              </select>
            </div>

            {selectedPresetId && (
              <button
                className="btn-chart-action"
                style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                onClick={() => handleDeletePreset(selectedPresetId)}
                disabled={isExecuting}
                title="Delete Selected Preset"
              >
                <Trash2 size={14} />
              </button>
            )}

            <button
              className="btn-chart-action"
              onClick={() => setShowPresetSaveModal(true)}
              disabled={isExecuting || !!validationError}
            >
              <Save size={16} />
              <span>Save Preset</span>
            </button>
          </div>
        </div>
      </div>

      {/* Preset Name Save Modal */}
      {showPresetSaveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card-panel" style={{ width: '400px', background: '#ffffff', padding: '24px' }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '12px' }}>SAVE SEQUENCE PRESET</div>
            <label className="setpoint-label">PRESET NAME:</label>
            <input
              type="text"
              className="setpoint-input-wrapper"
              style={{ width: '100%', padding: '10px', marginTop: '6px', marginBottom: '16px' }}
              placeholder="e.g. 24V Step Response Test"
              value={presetNameInput}
              onChange={(e) => setPresetNameInput(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn-chart-action" onClick={() => setShowPresetSaveModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSavePreset}>Save Preset</button>
            </div>
          </div>
        </div>
      )}

      {/* 2-Column Grid: Left = Builder Config, Right = Live Status & Telemetry Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '20px' }}>
        
        {/* LEFT COLUMN: Test Sequence Builder Form */}
        <div className="card-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="panel-title">
            <Clock size={18} />
            <span>SEQUENCE CONFIGURATION & STEP EDITOR</span>
          </div>

          {/* Test Name, Sequence Mode Dropdown & Cycles Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr', gap: '16px' }}>
            <div>
              <label className="setpoint-label">TEST NAME:</label>
              <input
                type="text"
                className="setpoint-input-wrapper"
                style={{ width: '100%', padding: '10px', fontWeight: 700, color: '#0f172a', background: '#ffffff' }}
                value={testName}
                onChange={(e) => {
                  setTestName(e.target.value);
                  validateSequence(e.target.value, cycles, steps, sequenceMode);
                }}
                disabled={isExecuting}
              />
            </div>

            <div>
              <label className="setpoint-label">SEQUENCE MODE (CONSTANT FOR ALL STEPS):</label>
              <select
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1.5px solid #0284c7', fontWeight: 800, fontSize: '0.85rem', color: '#0f172a', background: '#ffffff' }}
                value={sequenceMode}
                onChange={(e) => handleSequenceModeChange(e.target.value as SequenceStepMode)}
                disabled={isExecuting}
              >
                <option value="CV">CV Mode</option>
                <option value="CC">CC Mode</option>
                <option value="CR">CR Mode</option>
                <option value="CP">CP Mode</option>
              </select>
            </div>

            <div>
              <label className="setpoint-label">NUMBER OF CYCLES:</label>
              <input
                type="number"
                min={1}
                step={1}
                className="setpoint-input-wrapper"
                style={{ width: '100%', padding: '10px', fontWeight: 700, color: '#0f172a', background: '#ffffff' }}
                value={cycles}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10) || 1;
                  setCycles(val);
                  validateSequence(testName, val, steps, sequenceMode);
                }}
                disabled={isExecuting}
              />
            </div>
          </div>

          {/* Steps Table */}
          <div style={{ overflowX: 'auto', marginTop: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#0f172a', color: '#ffffff', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px' }}>#</th>
                  <th style={{ padding: '10px 12px' }}>DURATION (HH:MM:SS)</th>
                  <th style={{ padding: '10px 12px' }}>
                    SETPOINT ({sequenceMode === 'CV' ? 'V' : sequenceMode === 'CC' ? 'A' : sequenceMode === 'CR' ? 'Ω' : 'W'})
                  </th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step, idx) => (
                  <tr key={step.id} style={{ borderBottom: '1px solid var(--border-color)', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                    {/* Step Number */}
                    <td style={{ padding: '10px 12px', fontWeight: 800, color: '#0f172a' }}>
                      Step {step.stepNumber}
                    </td>

                    {/* Duration Inputs: H M S */}
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="number"
                          min={0}
                          style={{ width: '58px', padding: '6px 4px', textAlign: 'center', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: 700 }}
                          value={step.durationHours}
                          onChange={(e) => handleEditStep(idx, 'durationHours', parseInt(e.target.value, 10) || 0)}
                          disabled={isExecuting}
                        />
                        <span style={{ fontWeight: 700 }}>h</span>
                        <input
                          type="number"
                          min={0}
                          max={59}
                          style={{ width: '58px', padding: '6px 4px', textAlign: 'center', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: 700 }}
                          value={step.durationMinutes}
                          onChange={(e) => handleEditStep(idx, 'durationMinutes', parseInt(e.target.value, 10) || 0)}
                          disabled={isExecuting}
                        />
                        <span style={{ fontWeight: 700 }}>m</span>
                        <input
                          type="number"
                          min={0}
                          max={59}
                          style={{ width: '58px', padding: '6px 4px', textAlign: 'center', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: 700 }}
                          value={step.durationSeconds}
                          onChange={(e) => handleEditStep(idx, 'durationSeconds', parseInt(e.target.value, 10) || 0)}
                          disabled={isExecuting}
                        />
                        <span style={{ fontWeight: 700 }}>s</span>
                      </div>
                    </td>

                    {/* Mode-Specific Setpoint Field based on global sequenceMode */}
                    <td style={{ padding: '10px 12px' }}>
                      {sequenceMode === 'CV' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="number"
                            step="0.1"
                            style={{ width: '85px', padding: '6px', textAlign: 'center', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: 800, color: '#1d4ed8' }}
                            value={step.setpointV ?? 24.0}
                            onChange={(e) => handleEditStep(idx, 'setpointV', parseFloat(e.target.value) || 0)}
                            disabled={isExecuting}
                          />
                          <span style={{ fontWeight: 700 }}>V</span>
                        </div>
                      )}

                      {sequenceMode === 'CC' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="number"
                            step="0.1"
                            style={{ width: '85px', padding: '6px', textAlign: 'center', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: 800, color: '#047857' }}
                            value={step.setpointI ?? 5.0}
                            onChange={(e) => handleEditStep(idx, 'setpointI', parseFloat(e.target.value) || 0)}
                            disabled={isExecuting}
                          />
                          <span style={{ fontWeight: 700 }}>A</span>
                        </div>
                      )}

                      {sequenceMode === 'CR' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="number"
                            step="0.1"
                            style={{ width: '85px', padding: '6px', textAlign: 'center', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: 800, color: '#b45309' }}
                            value={step.setpointR ?? 10.0}
                            onChange={(e) => handleEditStep(idx, 'setpointR', parseFloat(e.target.value) || 0)}
                            disabled={isExecuting}
                          />
                          <span style={{ fontWeight: 700 }}>Ω</span>
                        </div>
                      )}

                      {sequenceMode === 'CP' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="number"
                            step="0.1"
                            style={{ width: '85px', padding: '6px', textAlign: 'center', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: 800, color: '#7c3aed' }}
                            value={step.setpointP ?? 120.0}
                            onChange={(e) => handleEditStep(idx, 'setpointP', parseFloat(e.target.value) || 0)}
                            disabled={isExecuting}
                          />
                          <span style={{ fontWeight: 700 }}>W</span>
                        </div>
                      )}
                    </td>

                    {/* Action Reorder & Delete Controls */}
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        <button
                          className="btn-chart-action"
                          style={{ padding: '4px 6px' }}
                          onClick={() => handleMoveStep(idx, 'up')}
                          disabled={isExecuting || idx === 0}
                          title="Move Step Up"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          className="btn-chart-action"
                          style={{ padding: '4px 6px' }}
                          onClick={() => handleMoveStep(idx, 'down')}
                          disabled={isExecuting || idx === steps.length - 1}
                          title="Move Step Down"
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          className="btn-chart-action"
                          style={{ padding: '4px 6px', color: '#ef4444', borderColor: '#fca5a5' }}
                          onClick={() => handleRemoveStep(idx)}
                          disabled={isExecuting || steps.length <= 1}
                          title="Delete Step"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add Step Button */}
          <button
            className="btn-chart-action"
            style={{ alignSelf: 'flex-start', padding: '8px 16px', border: '1.5px dashed #0284c7', color: '#0284c7', marginTop: '4px' }}
            onClick={handleAddStep}
            disabled={isExecuting}
          >
            <Plus size={16} />
            <span>ADD STEP TO SEQUENCE</span>
          </button>

          {/* Sequence Summary Bar */}
          <div style={{ background: '#f1f5f9', padding: '14px 18px', borderRadius: '8px', border: '1px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '24px', fontSize: '0.9rem' }}>
              <div><strong>Steps Count:</strong> {steps.length}</div>
              <div><strong>Cycles:</strong> {cycles}</div>
              <div><strong>Single Cycle Duration:</strong> {formatTime(singleCycleDuration)}</div>
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
              TOTAL PROGRAMMED DURATION: <span style={{ color: '#0284c7' }}>{formatTime(totalProgrammedDuration)}</span>
            </div>
          </div>

          {/* Validation Warning Box */}
          {validationError && (
            <div style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', color: '#991b1b', padding: '12px 16px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertTriangle size={18} />
              <span>{validationError}</span>
            </div>
          )}

          {actionMessage && (
            <div style={{ background: '#ecfdf5', border: '1.5px solid #a7f3d0', color: '#065f46', padding: '12px 16px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Check size={18} />
              <span>{actionMessage}</span>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Live Execution Panel & Telemetry */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Execution Controls Card */}
          <div className="card-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="panel-title" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Activity size={18} />
                <span>SEQUENCE EXECUTION MONITOR</span>
              </div>

              {/* State Badge */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 12px',
                  borderRadius: '14px',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  background: progress.state === 'RUNNING' ? '#ecfdf5' : (progress.state === 'PAUSED' ? '#fffbe6' : (progress.state === 'COMPLETED' ? '#eff6ff' : '#f1f5f9')),
                  color: progress.state === 'RUNNING' ? '#047857' : (progress.state === 'PAUSED' ? '#b45309' : (progress.state === 'COMPLETED' ? '#1d4ed8' : '#475569')),
                  border: '1px solid currentColor'
                }}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: progress.state === 'RUNNING' ? '#10b981' : (progress.state === 'PAUSED' ? '#f59e0b' : '#64748b') }} />
                <span>STATE: {progress.state}</span>
              </div>
            </div>

            {/* Overall Progress Bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                <span>OVERALL PROGRESS</span>
                <span>{progress.overallProgressPercent}%</span>
              </div>
              <div style={{ height: '12px', background: '#e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${progress.overallProgressPercent}%`,
                    background: 'linear-gradient(90deg, #0284c7 0%, #16a34a 100%)',
                    transition: 'width 0.4s ease'
                  }}
                />
              </div>
            </div>

            {/* Cycle & Step Status Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: '#f8fafc', border: '1px solid var(--border-color)', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>CYCLE STATUS</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                  Cycle {Math.min(progress.currentCycle, progress.totalCycles || cycles)} / {progress.totalCycles || cycles}
                </div>
              </div>

              <div style={{ background: '#f8fafc', border: '1px solid var(--border-color)', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>STEP STATUS</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0284c7', marginTop: '2px' }}>
                  Step {progress.currentStepIndex + 1} / {progress.totalSteps || steps.length}
                </div>
              </div>
            </div>

            {/* Active Step Details Readout */}
            {(() => {
              const activeDisplayMode = isExecuting ? progress.currentMode : sequenceMode;
              const firstStep = steps[0];
              const activeDisplaySetpoint = isExecuting
                ? (progress.currentSetpoints.v !== undefined ? `${progress.currentSetpoints.v} V` : (progress.currentSetpoints.i !== undefined ? `${progress.currentSetpoints.i} A` : (progress.currentSetpoints.r !== undefined ? `${progress.currentSetpoints.r} Ω` : `${progress.currentSetpoints.p} W`)))
                : (sequenceMode === 'CV' ? `${firstStep?.setpointV ?? 24.0} V` : sequenceMode === 'CC' ? `${firstStep?.setpointI ?? 5.0} A` : sequenceMode === 'CR' ? `${firstStep?.setpointR ?? 10.0} Ω` : `${firstStep?.setpointP ?? 120.0} W`);

              return (
                <div style={{ background: '#0f172a', color: '#ffffff', padding: '14px 16px', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 700 }}>ACTION STEP PARAMETERS:</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#38bdf8' }}>
                      MODE: {activeDisplayMode}
                    </span>
                    <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#4ade80' }}>
                      SETPOINT: {activeDisplaySetpoint}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#cbd5e1', paddingTop: '6px', borderTop: '1px solid #334155' }}>
                    <span>Step Time Remaining: <strong>{formatTime(progress.stepRemainingSeconds)}</strong></span>
                    <span>Elapsed: <strong>{formatTime(progress.totalElapsedSeconds)}</strong></span>
                  </div>
                </div>
              );
            })()}

            {/* Separate POWER ON & POWER OFF Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '4px' }}>
              <button
                className="btn-primary"
                style={{
                  padding: '14px',
                  fontSize: '1rem',
                  fontWeight: 800,
                  background: !isExecuting ? 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' : '#e2e8f0',
                  color: !isExecuting ? '#ffffff' : '#94a3b8',
                  borderColor: !isExecuting ? '#15803d' : '#cbd5e1',
                  cursor: !isExecuting && !validationError ? 'pointer' : 'not-allowed',
                  boxShadow: !isExecuting ? '0 4px 14px rgba(22, 163, 74, 0.4)' : 'none'
                }}
                onClick={handleStartSequence}
                disabled={isExecuting || !!validationError}
              >
                <Power size={18} />
                <span>POWER ON</span>
              </button>

              <button
                className="btn-primary"
                style={{
                  padding: '14px',
                  fontSize: '1rem',
                  fontWeight: 800,
                  background: isExecuting ? 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)' : '#f1f5f9',
                  color: isExecuting ? '#ffffff' : '#94a3b8',
                  borderColor: isExecuting ? '#b91c1c' : '#cbd5e1',
                  cursor: isExecuting ? 'pointer' : 'not-allowed',
                  boxShadow: isExecuting ? '0 4px 14px rgba(220, 38, 38, 0.4)' : 'none'
                }}
                onClick={handleStopSequence}
                disabled={!isExecuting}
              >
                <PowerOff size={18} />
                <span>POWER OFF</span>
              </button>
            </div>
          </div>

          {/* Live Telemetry Display Gauges */}
          <div className="card-panel" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="panel-title">
              <Activity size={18} />
              <span>LIVE TELEMETRY MONITOR</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: '#000000', borderRadius: '6px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700 }}>VOLTAGE</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#38bdf8', fontFamily: "'Times New Roman', serif" }}>
                  {formatVoltage(telemetry.vmon)} V
                </div>
              </div>

              <div style={{ background: '#000000', borderRadius: '6px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700 }}>CURRENT</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#4ade80', fontFamily: "'Times New Roman', serif" }}>
                  {formatCurrent(telemetry.imon)} A
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
