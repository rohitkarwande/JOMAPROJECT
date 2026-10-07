import React from 'react';
import { EngineeringSettings, formatCurrent, formatVoltage, OperationMode, SetpointValues, TelemetryPoint } from '../types/scada';
import { Gauge, Sliders, Battery, Zap, Shield, Flame, AlertCircle } from 'lucide-react';
import { KeyboardNumericInput } from './KeyboardNumericInput';

interface MetricsGridProps {
  currentMode: OperationMode;
  onSelectMode?: (mode: OperationMode) => void;
  telemetry: TelemetryPoint;
  setpoints: SetpointValues;
  engSettings?: EngineeringSettings;
  onUpdateSetpoint: (key: keyof SetpointValues, val: any) => void;
  onResetBatTest?: () => void;
  outputState: boolean;
  elapsedTimeSeconds: number;
  isSequenceRunning?: boolean;
}

export const MetricsGrid: React.FC<MetricsGridProps> = ({
  currentMode,
  onSelectMode,
  telemetry,
  setpoints,
  engSettings,
  onUpdateSetpoint,
  onResetBatTest,
  outputState,
  elapsedTimeSeconds,
  isSequenceRunning = false
}) => {
  // Allow live setpoint editing while hardware output is active; only freeze during automated test sequences
  const isFreezed = isSequenceRunning;
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const activeBatSubMode = telemetry.hardwareBatSubMode ?? setpoints.batTestSubMode;
  const modeLabel = currentMode === 'BAT TEST' ? `BAT TEST (${activeBatSubMode} MODE)` : `${currentMode} MODE`;

  // Inline Safety Limit Exceeded Checks matching Diagnostic Panel conventions
  const vmax = (telemetry.hardwareVmax !== undefined && telemetry.hardwareVmax > 0) ? telemetry.hardwareVmax : (engSettings?.vmax ?? 60.0);
  const imax = (telemetry.hardwareImax !== undefined && telemetry.hardwareImax > 0) ? telemetry.hardwareImax : (engSettings?.imax ?? 30.0);
  const rmax = (telemetry.hardwareRmax !== undefined && telemetry.hardwareRmax > 0) ? telemetry.hardwareRmax : (engSettings?.rmax ?? 100.0);
  const pmax = (telemetry.hardwarePmax !== undefined && telemetry.hardwarePmax > 0) ? telemetry.hardwarePmax : (engSettings?.pmax ?? 5000.0);

  const isCvExceeded = setpoints.cv > vmax;
  const activeIrange = (telemetry.hardwareIrange !== undefined && telemetry.hardwareIrange > 0) ? telemetry.hardwareIrange : (setpoints.imax > 0 ? setpoints.imax : imax);
  const isCcTargetExceeded = currentMode === 'CC' && setpoints.iset > activeIrange;
  const isRsetExceeded = setpoints.rset > rmax;
  const isPsetExceeded = setpoints.pset > pmax;
  const isIlimitExceeded = setpoints.iset > activeIrange;

  // Battery Test Mode Live Values & Safety Limit Checks
  const liveCutoff = (telemetry.hardwareCutoffV !== undefined && telemetry.hardwareCutoffV > 0) ? telemetry.hardwareCutoffV : setpoints.cutoffV;
  const isCutoffExceeded = liveCutoff > vmax;
  const liveBatIset = (telemetry.hardwareIlimit !== undefined ? telemetry.hardwareIlimit : setpoints.iset);
  const isBatIsetExceeded = activeBatSubMode === 'CC' && liveBatIset > activeIrange;
  const liveBatRset = (telemetry.hardwareRset !== undefined ? telemetry.hardwareRset : setpoints.rset);
  const isBatRsetExceeded = activeBatSubMode === 'CR' && liveBatRset > rmax;
  const liveAh = telemetry.hardwareAh !== undefined ? telemetry.hardwareAh : (telemetry.capacityAh !== undefined ? telemetry.capacityAh : (setpoints.ah ?? 0));
  const liveHrs = telemetry.hardwareHrs !== undefined ? Math.round(telemetry.hardwareHrs) : (telemetry.hrs !== undefined ? telemetry.hrs : (setpoints.hrs ?? 0));
  const liveMin = telemetry.hardwareMin !== undefined ? Math.round(telemetry.hardwareMin) : (telemetry.min !== undefined ? telemetry.min : (setpoints.min ?? 0));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Active Operating Mode Banner - Clean Display (Mode buttons removed per requirement - only active mode displayed) */}
      <div style={{
        background: '#ffffff',
        border: '1.5px solid var(--border-color)',
        borderRadius: '8px',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent-green)', boxShadow: '0 0 8px var(--accent-green)' }}></span>
          <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>ACTIVE MODE:</span>
        </div>
        <div style={{
          fontSize: '1.05rem',
          fontWeight: 800,
          color: 'var(--accent-blue)',
          background: '#eff6ff',
          padding: '4px 16px',
          borderRadius: '6px',
          border: '1.5px solid #bfdbfe',
          letterSpacing: '0.5px'
        }}>
          {modeLabel}
        </div>
      </div>

      {/* Retro LED Displays for Vmon (4X 1) and Imon (4X 3) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className="led-card">
          <div className="led-label">
            <span>VOLTAGE (VMON - 4X 1)</span>
            <Gauge size={14} style={{ color: 'var(--accent-cyan)' }} />
          </div>
          <div className="led-value voltage">
            {formatVoltage(telemetry.vmon ?? 0)}
            <span className="led-unit">V</span>
          </div>
        </div>

        <div className="led-card">
          <div className="led-label">
            <span>CURRENT (IMON - 4X 3)</span>
            <Gauge size={14} style={{ color: 'var(--accent-green)' }} />
          </div>
          <div className="led-value current">
            {formatCurrent(telemetry.imon ?? 0)}
            <span className="led-unit">A</span>
          </div>
        </div>
      </div>

      {telemetry.deviceResponding === false && (
        <div style={{
          background: '#fffbeb',
          border: '1.5px solid #f59e0b',
          borderRadius: '6px',
          padding: '8px 12px',
          color: '#92400e',
          fontSize: '0.8rem',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <AlertCircle size={16} style={{ color: '#d97706', flexShrink: 0 }} />
          <span>Device not responding on Modbus RS485. Please verify Baud Rate and Slave ID in RS485 Settings.</span>
        </div>
      )}

      {/* Mode-Specific Interactive Parameter Inputs */}
      <div className="setpoint-card">
        <div className="setpoint-label">
          <Sliders size={14} style={{ color: 'var(--accent-cyan)' }} />
          <span>{currentMode === 'BAT TEST' ? `BAT TEST (${setpoints.batTestSubMode} MODE)` : `${currentMode} MODE`} SETPOINTS & LIMITS</span>
        </div>

        {/* ========================================================================= */}
        {/* CV MODE: CV SET (CV_VOLT, 4X 5 / Wire 4) & I LIMIT (I_SET_ROW_CC, 4X 15) */}
        {/* ========================================================================= */}
        {currentMode === 'CV' && (
          <>
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                  <span className="setpoint-label">CV SET (V):</span>
                  <span style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700 }}>CV_VOLT (4X 5 / Wire 4)</span>
                </div>
                <KeyboardNumericInput
                  step={0.5}
                  precision={3}
                  disabled={isFreezed}
                  commitOnEnterOnly={true}
                  showEnterButton={true}
                  style={{
                    flex: 1,
                    border: isCvExceeded ? '2px solid #ef4444' : undefined,
                    background: isCvExceeded ? '#fef2f2' : undefined
                  }}
                  value={setpoints.cv}
                  onChange={(val) => onUpdateSetpoint('cv', val)}
                />
                <span className="setpoint-unit">V</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '4px', fontSize: '0.75rem', color: '#64748b' }}>
                <span>Limit: &le; V_MAX ({vmax.toFixed(2)} V)</span>
                <span style={{ fontWeight: 700, color: '#0369a1' }}>
                  Live HMI: {(telemetry.hardwareCvSet !== undefined ? telemetry.hardwareCvSet : setpoints.cv).toFixed(3)} V
                </span>
              </div>
              {isCvExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.78rem', fontWeight: 800 }}>
                  <AlertCircle size={14} />
                  <span>⚠️ EXCEEDS VMAX LIMIT ({vmax.toFixed(2)} V)!</span>
                </div>
              )}
            </div>

            <div className="setpoint-input-wrapper">
              <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                <span className="setpoint-label">I LIMIT (A):</span>
                <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>HMI Monitored (4X 15)</span>
              </div>
              <div
                className="setpoint-input"
                style={{
                  flex: 1,
                  height: '44px',
                  minHeight: '44px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  padding: '6px 14px',
                  background: '#f1f5f9',
                  color: '#0f172a',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '6px',
                  cursor: 'not-allowed',
                  fontWeight: 800,
                  fontSize: '1.25rem',
                  fontFamily: 'var(--font-mono)'
                }}
                title="I Limit in CV mode is monitored from physical register I_SET_ROW_CC (4X 15)"
              >
                {(telemetry.hardwareIlimit !== undefined ? telemetry.hardwareIlimit : setpoints.iset).toFixed(3)}
              </div>
              <span className="setpoint-unit">A</span>
            </div>
          </>
        )}

        {/* ========================================================================= */}
        {/* CC MODE: I TARGET (I_SET_ROW_CC, 4X 15) & I MAX (I_SET_RANGE_CC, 4X 13)  */}
        {/* ========================================================================= */}
        {currentMode === 'CC' && (
          <>
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                  <span className="setpoint-label">I TARGET (A):</span>
                  <span style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700 }}>I_SET_ROW_CC (4X 15)</span>
                </div>
                <KeyboardNumericInput
                  step={0.1}
                  precision={3}
                  disabled={isFreezed}
                  commitOnEnterOnly={true}
                  showEnterButton={true}
                  style={{
                    flex: 1,
                    border: isCcTargetExceeded ? '2px solid #ef4444' : undefined,
                    background: isCcTargetExceeded ? '#fef2f2' : undefined
                  }}
                  value={setpoints.iset}
                  onChange={(val) => onUpdateSetpoint('iset', val)}
                />
                <span className="setpoint-unit">A</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '4px', fontSize: '0.75rem', color: '#64748b' }}>
                <span>Limit: &le; I_SET_RANGE_CC ({((telemetry.hardwareIrange !== undefined && telemetry.hardwareIrange > 0) ? telemetry.hardwareIrange : setpoints.imax).toFixed(3)} A)</span>
                <span style={{ fontWeight: 700, color: '#0369a1' }}>
                  Live HMI: {(telemetry.hardwareIlimit !== undefined ? telemetry.hardwareIlimit : setpoints.iset).toFixed(3)} A
                </span>
              </div>
              {isCcTargetExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.78rem', fontWeight: 800 }}>
                  <AlertCircle size={14} />
                  <span>⚠️ I_SET_ROW_CC ({setpoints.iset.toFixed(3)} A) exceeds I_SET_RANGE_CC limit ({((telemetry.hardwareIrange !== undefined && telemetry.hardwareIrange > 0) ? telemetry.hardwareIrange : setpoints.imax).toFixed(3)} A)! Write blocked.</span>
                </div>
              )}
            </div>

            <div className="setpoint-input-wrapper">
              <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                <span className="setpoint-label">I MAX (A):</span>
                <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>I_SET_RANGE_CC (4X 13)</span>
              </div>
              <div
                className="setpoint-input"
                style={{
                  flex: 1,
                  height: '44px',
                  minHeight: '44px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  padding: '6px 14px',
                  background: '#f1f5f9',
                  color: '#0f172a',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '6px',
                  cursor: 'not-allowed',
                  fontWeight: 800,
                  fontSize: '1.25rem',
                  fontFamily: 'var(--font-mono)'
                }}
                title="I MAX (I_SET_RANGE_CC, 4X 13 / Wire 12) is monitored from the physical HMI panel"
              >
                {((telemetry.hardwareIrange !== undefined && telemetry.hardwareIrange > 0) ? telemetry.hardwareIrange : setpoints.imax).toFixed(3)}
              </div>
              <span className="setpoint-unit">A</span>
            </div>
          </>
        )}

        {/* ========================================================================= */}
        {/* CR MODE: R (RESISTOR_CR_MODE, 4X 17) & I LIMIT (I_SET_ROW_CC, 4X 15)     */}
        {/* ========================================================================= */}
        {currentMode === 'CR' && (
          <>
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                  <span className="setpoint-label">R (Ω):</span>
                  <span style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700 }}>RESISTOR_CR_MODE (4X 17)</span>
                </div>
                <KeyboardNumericInput
                  step={0.5}
                  precision={2}
                  disabled={isFreezed}
                  commitOnEnterOnly={true}
                  showEnterButton={true}
                  style={{
                    flex: 1,
                    border: isRsetExceeded ? '2px solid #ef4444' : undefined,
                    background: isRsetExceeded ? '#fef2f2' : undefined
                  }}
                  value={setpoints.rset}
                  onChange={(val) => onUpdateSetpoint('rset', val)}
                />
                <span className="setpoint-unit">Ω</span>
              </div>
              {isRsetExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.78rem', fontWeight: 800 }}>
                  <AlertCircle size={14} />
                  <span>⚠️ RESISTOR_CR_MODE ({setpoints.rset.toFixed(2)} Ω) exceeds R_MAX limit ({rmax.toFixed(2)} Ω)! Write blocked.</span>
                </div>
              )}
            </div>
            <div className="setpoint-input-wrapper">
              <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                <span className="setpoint-label">I LIMIT (A):</span>
                <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>HMI Monitored (4X 15)</span>
              </div>
              <div
                className="setpoint-input"
                style={{
                  flex: 1,
                  height: '44px',
                  minHeight: '44px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  padding: '6px 14px',
                  background: '#f1f5f9',
                  color: '#0f172a',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '6px',
                  cursor: 'not-allowed',
                  fontWeight: 800,
                  fontSize: '1.25rem',
                  fontFamily: 'var(--font-mono)'
                }}
                title="I Limit in CR mode is monitored from physical register I_SET_ROW_CC (4X 15)"
              >
                {(telemetry.hardwareIlimit !== undefined ? telemetry.hardwareIlimit : setpoints.iset).toFixed(3)}
              </div>
              <span className="setpoint-unit">A</span>
            </div>
          </>
        )}

        {/* ========================================================================= */}
        {/* CP MODE: POWER (POWER_CP_MODE, 4X 19) & I LIMIT (I_SET_ROW_CC, 4X 15)    */}
        {/* ========================================================================= */}
        {currentMode === 'CP' && (
          <>
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                  <span className="setpoint-label">CP (W):</span>
                  <span style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700 }}>POWER_CP_MODE (4X 19)</span>
                </div>
                <KeyboardNumericInput
                  step={5}
                  precision={1}
                  disabled={isFreezed}
                  commitOnEnterOnly={true}
                  showEnterButton={true}
                  style={{
                    flex: 1,
                    border: isPsetExceeded ? '2px solid #ef4444' : undefined,
                    background: isPsetExceeded ? '#fef2f2' : undefined
                  }}
                  value={setpoints.pset}
                  onChange={(val) => onUpdateSetpoint('pset', val)}
                />
                <span className="setpoint-unit">W</span>
              </div>
              {isPsetExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.78rem', fontWeight: 800 }}>
                  <AlertCircle size={14} />
                  <span>⚠️ POWER_CP_MODE ({setpoints.pset.toFixed(1)} W) exceeds P_MAX limit ({pmax.toFixed(1)} W)! Write blocked.</span>
                </div>
              )}
            </div>

            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                  <span className="setpoint-label">I LIMIT (A):</span>
                  <span style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700 }}>I_SET_ROW_CC (4X 15)</span>
                </div>
                <KeyboardNumericInput
                  step={0.1}
                  precision={3}
                  disabled={isFreezed}
                  commitOnEnterOnly={true}
                  showEnterButton={true}
                  style={{
                    flex: 1,
                    border: isIlimitExceeded ? '2px solid #ef4444' : undefined,
                    background: isIlimitExceeded ? '#fef2f2' : undefined
                  }}
                  value={setpoints.iset}
                  onChange={(val) => onUpdateSetpoint('iset', val)}
                />
                <span className="setpoint-unit">A</span>
              </div>

              {/* Warning message below I Limit box reflecting dynamic I_SET_RANGE_CC */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                borderRadius: '6px',
                background: isIlimitExceeded ? '#fef2f2' : '#fffbeb',
                border: `1px solid ${isIlimitExceeded ? '#fecaca' : '#fde68a'}`,
                color: isIlimitExceeded ? '#dc2626' : '#b45309',
                fontSize: '0.78rem',
                fontWeight: 700
              }}>
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>⚠️ I Limit can be set till I_SET_RANGE_CC value ({activeIrange.toFixed(3)} A).</span>
              </div>

              {isIlimitExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.78rem', fontWeight: 800, marginTop: '2px' }}>
                  <AlertCircle size={14} />
                  <span>⚠️ I_SET_ROW_CC ({setpoints.iset.toFixed(3)} A) exceeds I_SET_RANGE_CC limit ({activeIrange.toFixed(3)} A)! Write blocked.</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* ========================================================================= */}
        {/* BAT TEST MODE: VCUTOFF, ISET/RSET, AH, HRS, MIN (Full-Width Spacious UI)  */}
        {/* ========================================================================= */}
        {currentMode === 'BAT TEST' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
            {/* Sub-mode Toggle (CC / CR) Controls */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              background: '#f8fafc',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#475569' }}>SUBMODE:</span>
                <button
                  type="button"
                  disabled={isFreezed || outputState}
                  className={activeBatSubMode === 'CC' ? 'btn-primary' : 'btn-chart-action'}
                  style={{ padding: '6px 16px', fontSize: '0.82rem', fontWeight: 800, borderRadius: '6px', opacity: (isFreezed || outputState) && activeBatSubMode !== 'CC' ? 0.5 : 1, cursor: (isFreezed || outputState) ? 'not-allowed' : 'pointer' }}
                  onClick={() => onUpdateSetpoint('batTestSubMode' as any, 'CC')}
                  title={outputState ? 'Output is ON — Submode locked. Turn Output OFF to change submode.' : 'Battery Test CC Submode (CC_CR_BAT_MODE = 0)'}
                >
                  CC SUBMODE
                </button>
                <button
                  type="button"
                  disabled={isFreezed || outputState}
                  className={activeBatSubMode === 'CR' ? 'btn-primary' : 'btn-chart-action'}
                  style={{ padding: '6px 16px', fontSize: '0.82rem', fontWeight: 800, borderRadius: '6px', opacity: (isFreezed || outputState) && activeBatSubMode !== 'CR' ? 0.5 : 1, cursor: (isFreezed || outputState) ? 'not-allowed' : 'pointer' }}
                  onClick={() => onUpdateSetpoint('batTestSubMode' as any, 'CR')}
                  title={outputState ? 'Output is ON — Submode locked. Turn Output OFF to change submode.' : 'Battery Test CR Submode (CC_CR_BAT_MODE = 1)'}
                >
                  CR SUBMODE
                </button>
              </div>
            </div>

            {/* 1. Cutoff Voltage (VCUTOFF - 4X 21 / Wire 20) */}
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                  <span className="setpoint-label">VCUTOFF (V):</span>
                  <span style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700 }}>VCUTOFF (4X 21 / Wire 20)</span>
                </div>
                <KeyboardNumericInput
                  step={0.1}
                  precision={2}
                  disabled={isFreezed}
                  commitOnEnterOnly={true}
                  showEnterButton={true}
                  style={{
                    flex: 1,
                    border: isCutoffExceeded ? '2px solid #ef4444' : undefined,
                    background: isCutoffExceeded ? '#fef2f2' : undefined
                  }}
                  value={liveCutoff}
                  onChange={(val) => onUpdateSetpoint('cutoffV', val)}
                />
                <span className="setpoint-unit">V</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '4px', fontSize: '0.75rem', color: '#64748b' }}>
                <span>Limit: &le; V_MAX ({vmax.toFixed(2)} V)</span>
                <span style={{ fontWeight: 700, color: '#0369a1' }}>
                  Live HMI: {liveCutoff.toFixed(2)} V
                </span>
              </div>
              {isCutoffExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.78rem', fontWeight: 800 }}>
                  <AlertCircle size={14} />
                  <span>⚠️ VCUTOFF ({liveCutoff.toFixed(2)} V) exceeds V_MAX limit ({vmax.toFixed(2)} V)! Write blocked.</span>
                </div>
              )}
            </div>

            {/* 2. Iset (I_SET_ROW_CC - 4X 15 / Wire 14) or Rset (RESISTOR_CR_MODE - 4X 17 / Wire 16) */}
            {activeBatSubMode === 'CC' ? (
              <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                    <span className="setpoint-label">I SET (A):</span>
                    <span style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700 }}>I_SET_ROW_CC (4X 15)</span>
                  </div>
                  <KeyboardNumericInput
                    step={0.1}
                    precision={3}
                    disabled={isFreezed}
                    commitOnEnterOnly={true}
                    showEnterButton={true}
                    style={{
                      flex: 1,
                      border: isBatIsetExceeded ? '2px solid #ef4444' : undefined,
                      background: isBatIsetExceeded ? '#fef2f2' : undefined
                    }}
                    value={liveBatIset}
                    onChange={(val) => onUpdateSetpoint('iset', val)}
                  />
                  <span className="setpoint-unit">A</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '4px', fontSize: '0.75rem', color: '#64748b' }}>
                  <span>Limit: &le; I_SET_RANGE_CC ({activeIrange.toFixed(3)} A)</span>
                  <span style={{ fontWeight: 700, color: '#0369a1' }}>
                    Live HMI: {liveBatIset.toFixed(3)} A
                  </span>
                </div>
                {isBatIsetExceeded && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.78rem', fontWeight: 800 }}>
                    <AlertCircle size={14} />
                    <span>⚠️ I_SET_ROW_CC ({liveBatIset.toFixed(3)} A) exceeds I_SET_RANGE_CC limit ({activeIrange.toFixed(3)} A)! Write blocked.</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                    <span className="setpoint-label">R SET (Ω):</span>
                    <span style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700 }}>RESISTOR_CR_MODE (4X 17)</span>
                  </div>
                  <KeyboardNumericInput
                    step={0.5}
                    precision={2}
                    disabled={isFreezed}
                    commitOnEnterOnly={true}
                    showEnterButton={true}
                    style={{
                      flex: 1,
                      border: isBatRsetExceeded ? '2px solid #ef4444' : undefined,
                      background: isBatRsetExceeded ? '#fef2f2' : undefined
                    }}
                    value={liveBatRset}
                    onChange={(val) => onUpdateSetpoint('rset', val)}
                  />
                  <span className="setpoint-unit">Ω</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '4px', fontSize: '0.75rem', color: '#64748b' }}>
                  <span>Limit: &le; R_MAX ({rmax.toFixed(2)} Ω)</span>
                  <span style={{ fontWeight: 700, color: '#0369a1' }}>
                    Live HMI: {liveBatRset.toFixed(2)} Ω
                  </span>
                </div>
                {isBatRsetExceeded && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.78rem', fontWeight: 800 }}>
                    <AlertCircle size={14} />
                    <span>⚠️ RESISTOR_CR_MODE ({liveBatRset.toFixed(2)} Ω) exceeds R_MAX limit ({rmax.toFixed(2)} Ω)! Write blocked.</span>
                  </div>
                )}
              </div>
            )}

            {/* 3. Battery Capacity Limit (AH - 4X 27 / Wire 26) */}
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                  <span className="setpoint-label">AH:</span>
                  <span style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700 }}>AH (4X 27 / Wire 26)</span>
                </div>
                <KeyboardNumericInput
                  step={0.1}
                  precision={1}
                  disabled={isFreezed}
                  commitOnEnterOnly={true}
                  showEnterButton={true}
                  style={{ flex: 1 }}
                  value={liveAh}
                  onChange={(val) => onUpdateSetpoint('ah', val)}
                />
                <span className="setpoint-unit">AH</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '4px', fontSize: '0.75rem', color: '#64748b' }}>
                <span>Cutoff Capacity Threshold</span>
                <span style={{ fontWeight: 700, color: '#0369a1' }}>
                  Live HMI: {liveAh.toFixed(1)} AH
                </span>
              </div>
            </div>

            {/* 4. Test Duration Hours (HRS - 4X 23 / Wire 22) */}
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                  <span className="setpoint-label">HRS:</span>
                  <span style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700 }}>HRS (4X 23 / Wire 22)</span>
                </div>
                <KeyboardNumericInput
                  step={1}
                  min={0}
                  precision={0}
                  disabled={isFreezed}
                  commitOnEnterOnly={true}
                  showEnterButton={true}
                  style={{ flex: 1 }}
                  value={liveHrs}
                  onChange={(val) => onUpdateSetpoint('hrs', val)}
                />
                <span className="setpoint-unit">HRS</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '4px', fontSize: '0.75rem', color: '#64748b' }}>
                <span>Cutoff Test Hours</span>
                <span style={{ fontWeight: 700, color: '#0369a1' }}>
                  Live HMI: {liveHrs} HRS
                </span>
              </div>
            </div>

            {/* 5. Test Duration Minutes (MIN - 4X 25 / Wire 24) */}
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '120px', minWidth: '120px', flexShrink: 0 }}>
                  <span className="setpoint-label">MINS:</span>
                  <span style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700 }}>MINS (4X 25 / Wire 24)</span>
                </div>
                <KeyboardNumericInput
                  step={1}
                  min={0}
                  max={59}
                  precision={0}
                  disabled={isFreezed}
                  commitOnEnterOnly={true}
                  showEnterButton={true}
                  style={{ flex: 1 }}
                  value={liveMin}
                  onChange={(val) => onUpdateSetpoint('min', val)}
                />
                <span className="setpoint-unit">MINS</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '4px', fontSize: '0.75rem', color: '#64748b' }}>
                <span>Cutoff Test Minutes (0–59)</span>
                <span style={{ fontWeight: 700, color: '#0369a1' }}>
                  Live HMI: {liveMin} MINS
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Safety & Real-Time Status Card */}
      <div className="status-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, fontSize: '0.85rem' }}>
            <Shield size={16} style={{ color: 'var(--accent-blue)' }} />
            <span>HARDWARE SAFETY STATUS</span>
          </div>

          <div style={{
            fontSize: '0.75rem',
            fontWeight: 800,
            padding: '2px 8px',
            borderRadius: '12px',
            background: outputState ? '#dcfce7' : '#f1f5f9',
            color: outputState ? '#15803d' : '#64748b',
            border: outputState ? '1px solid #86efac' : '1px solid #cbd5e1'
          }}>
            {outputState ? 'OUTPUT ACTIVE (ON)' : 'OUTPUT IDLE (OFF)'}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.75rem', fontWeight: 700 }}>
          <div style={{ background: '#f8fafc', padding: '6px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
            <span style={{ color: '#64748b' }}>V_MAX LIMIT: </span>
            <span style={{ color: '#0f172a', fontWeight: 800 }}>{vmax.toFixed(2)} V</span>
          </div>
          <div style={{ background: '#f8fafc', padding: '6px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
            <span style={{ color: '#64748b' }}>I_MAX LIMIT: </span>
            <span style={{ color: '#0f172a', fontWeight: 800 }}>{imax.toFixed(2)} A</span>
          </div>
        </div>
      </div>
    </div>
  );
};
