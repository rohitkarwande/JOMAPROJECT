import React from 'react';
import { EngineeringSettings, formatCurrent, formatVoltage, OperationMode, SetpointValues, TelemetryPoint } from '../types/scada';
import { Gauge, Sliders, Battery, Zap, Shield, Flame, AlertCircle } from 'lucide-react';
import { KeyboardNumericInput } from './KeyboardNumericInput';

interface MetricsGridProps {
  currentMode: OperationMode;
  telemetry: TelemetryPoint;
  setpoints: SetpointValues;
  engSettings?: EngineeringSettings;
  onUpdateSetpoint: (key: keyof SetpointValues, val: number) => void;
  onResetBatTest?: () => void;
  outputState: boolean;
  elapsedTimeSeconds: number;
  isSequenceRunning?: boolean;
}

export const MetricsGrid: React.FC<MetricsGridProps> = ({
  currentMode,
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

  const modeLabel = currentMode === 'BAT TEST' ? `BAT TEST (${setpoints.batTestSubMode} MODE)` : `${currentMode} MODE`;

  // Inline Safety Limit Exceeded Checks matching Diagnostic Panel conventions
  const vmax = engSettings?.vmax ?? 60.0;
  const imax = engSettings?.imax ?? 30.0;
  const rmax = engSettings?.rmax ?? 100.0;
  const pmax = engSettings?.pmax ?? 5000.0;

  const isCvExceeded = setpoints.cv > vmax;
  const isCcTargetExceeded = currentMode === 'CC' && (setpoints.iset > setpoints.imax || setpoints.iset > imax);
  const isRsetExceeded = setpoints.rset > rmax;
  const isPsetExceeded = setpoints.pset > pmax;
  const isIlimitExceeded = setpoints.iset > imax;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Active Mode Banner above Voltage Monitor */}
      <div style={{
        background: '#ffffff',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-green)', boxShadow: '0 0 6px var(--accent-green)' }}></span>
          <span>ACTIVE MODE:</span>
        </div>
        <div style={{
          fontSize: '0.85rem',
          fontWeight: 800,
          color: 'var(--accent-blue)',
          background: '#eff6ff',
          padding: '3px 10px',
          borderRadius: '4px',
          border: '1px solid #bfdbfe',
          letterSpacing: '0.3px'
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
        {/* CV MODE: CV SET (CV_VOLT, 4X 5) & I LIMIT (I_SET_ROW_CC, 4X 15 Monitored) */}
        {/* ========================================================================= */}
        {currentMode === 'CV' && (
          <>
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>CV SET (V):</span>
                <KeyboardNumericInput
                  step={0.1}
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
                  onCommit={(val) => onUpdateSetpoint('cv', val)}
                />
                <span className="setpoint-unit">V</span>
              </div>
              {isCvExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.75rem', fontWeight: 800, paddingLeft: '98px' }}>
                  <AlertCircle size={14} />
                  <span>⚠️ EXCEEDS VMAX LIMIT ({vmax.toFixed(2)} V)!</span>
                </div>
              )}
            </div>

            <div className="setpoint-input-wrapper">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>I LIMIT (A):</span>
                <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>HMI Monitored (4X 15)</span>
              </div>
              <div
                className="setpoint-input"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#f1f5f9',
                  color: '#0f172a',
                  border: '1.5px solid #cbd5e1',
                  cursor: 'not-allowed',
                  fontWeight: 800,
                  fontSize: '0.95rem'
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
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>I TARGET (A):</span>
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
                  onCommit={(val) => onUpdateSetpoint('iset', val)}
                />
                <span className="setpoint-unit">A</span>
              </div>
              {isCcTargetExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.75rem', fontWeight: 800, paddingLeft: '98px' }}>
                  <AlertCircle size={14} />
                  <span>⚠️ EXCEEDS {setpoints.iset > setpoints.imax ? `IMAX LIMIT (${setpoints.imax.toFixed(3)} A)` : `SAFETY IMAX LIMIT (${imax.toFixed(2)} A)`}!</span>
                </div>
              )}
            </div>

            <div className="setpoint-input-wrapper">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>I MAX (A):</span>
                <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>HMI Monitored (4X 13)</span>
              </div>
              <div
                className="setpoint-input"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#f1f5f9',
                  color: '#0f172a',
                  border: '1.5px solid #cbd5e1',
                  cursor: 'not-allowed',
                  fontWeight: 800,
                  fontSize: '0.95rem'
                }}
                title="I MAX (I_SET_RANGE_CC, 4X 13) is monitored from the physical HMI panel"
              >
                {setpoints.imax.toFixed(3)}
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
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>R (Ω):</span>
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
                  onCommit={(val) => onUpdateSetpoint('rset', val)}
                />
                <span className="setpoint-unit">Ω</span>
              </div>
              {isRsetExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.75rem', fontWeight: 800, paddingLeft: '98px' }}>
                  <AlertCircle size={14} />
                  <span>⚠️ EXCEEDS RMAX LIMIT ({rmax.toFixed(2)} Ω)!</span>
                </div>
              )}
            </div>
            <div className="setpoint-input-wrapper">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>I LIMIT (A):</span>
                <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>HMI Monitored (4X 15)</span>
              </div>
              <div
                className="setpoint-input"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#f1f5f9',
                  color: '#0f172a',
                  border: '1.5px solid #cbd5e1',
                  cursor: 'not-allowed',
                  fontWeight: 800,
                  fontSize: '0.95rem'
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
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>CP (W):</span>
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
                  onCommit={(val) => onUpdateSetpoint('pset', val)}
                />
                <span className="setpoint-unit">W</span>
              </div>
              {isPsetExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.75rem', fontWeight: 800, paddingLeft: '98px' }}>
                  <AlertCircle size={14} />
                  <span>⚠️ EXCEEDS PMAX LIMIT ({pmax.toFixed(1)} W)!</span>
                </div>
              )}
            </div>

            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>I LIMIT (A):</span>
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
                  onCommit={(val) => onUpdateSetpoint('iset', val)}
                />
                <span className="setpoint-unit">A</span>
              </div>
              {isIlimitExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.75rem', fontWeight: 800, paddingLeft: '98px' }}>
                  <AlertCircle size={14} />
                  <span>⚠️ EXCEEDS IMAX LIMIT ({imax.toFixed(2)} A)!</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* ========================================================================= */}
        {/* BAT TEST MODE: VCUTOFF, ISET/RSET, AH, HRS:MIN                            */}
        {/* ========================================================================= */}
        {currentMode === 'BAT TEST' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {/* Vcutoff Input Card */}
              <div style={{ background: '#e0f2fe', border: '1.5px solid #38bdf8', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0369a1' }}>Vcutoff (V):</div>
                <KeyboardNumericInput
                  step={0.1}
                  precision={3}
                  disabled={isFreezed}
                  commitOnEnterOnly={true}
                  showEnterButton={true}
                  style={{ width: '100%', background: '#ffffff', fontSize: '1.05rem', fontWeight: 800, color: '#0284c7', textAlign: 'center' }}
                  value={setpoints.cutoffV}
                  onChange={(val) => onUpdateSetpoint('cutoffV', val)}
                  onCommit={(val) => onUpdateSetpoint('cutoffV', val)}
                />
              </div>

              {/* Iset / Rset Input Card */}
              <div style={{ background: '#e0f2fe', border: '1.5px solid #38bdf8', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0369a1' }}>
                  {setpoints.batTestSubMode === 'CC' ? 'Iset (A):' : 'Rset (Ω):'}
                </div>
                <KeyboardNumericInput
                  step={0.1}
                  precision={setpoints.batTestSubMode === 'CC' ? 3 : 2}
                  disabled={isFreezed}
                  commitOnEnterOnly={true}
                  showEnterButton={true}
                  style={{ width: '100%', background: '#ffffff', fontSize: '1.05rem', fontWeight: 800, color: '#0284c7', textAlign: 'center' }}
                  value={setpoints.batTestSubMode === 'CC' ? setpoints.iset : setpoints.rset}
                  onChange={(val) => onUpdateSetpoint(setpoints.batTestSubMode === 'CC' ? 'iset' : 'rset', val)}
                  onCommit={(val) => onUpdateSetpoint(setpoints.batTestSubMode === 'CC' ? 'iset' : 'rset', val)}
                />
              </div>

              {/* AH Capacity Input Card */}
              <div style={{ background: '#e0f2fe', border: '1.5px solid #38bdf8', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0369a1' }}>AH :</div>
                <KeyboardNumericInput
                  step={0.1}
                  precision={1}
                  disabled={isFreezed}
                  commitOnEnterOnly={true}
                  showEnterButton={true}
                  style={{ width: '100%', background: '#ffffff', fontSize: '1.05rem', fontWeight: 800, color: '#0284c7', textAlign: 'center' }}
                  value={setpoints.ah ?? 0}
                  onChange={(val) => onUpdateSetpoint('ah', val)}
                  onCommit={(val) => onUpdateSetpoint('ah', val)}
                />
              </div>

              {/* HRS : MIN Input Card */}
              <div style={{ background: '#e0f2fe', border: '1.5px solid #38bdf8', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0369a1', textAlign: 'center' }}>HRS : MIN</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px', marginTop: '2px' }}>
                  <KeyboardNumericInput
                    step={1}
                    min={0}
                    precision={0}
                    disabled={isFreezed}
                    commitOnEnterOnly={true}
                    showEnterButton={true}
                    style={{ width: '45%', background: '#ffffff', fontSize: '0.95rem', fontWeight: 800, color: '#0284c7', textAlign: 'right' }}
                    value={setpoints.hrs ?? 0}
                    onChange={(val) => onUpdateSetpoint('hrs', val)}
                    onCommit={(val) => onUpdateSetpoint('hrs', val)}
                  />
                  <span style={{ fontWeight: 800, color: '#0284c7', fontSize: '1.15rem' }}>:</span>
                  <KeyboardNumericInput
                    step={1}
                    min={0}
                    max={59}
                    precision={0}
                    disabled={isFreezed}
                    commitOnEnterOnly={true}
                    showEnterButton={true}
                    style={{ width: '45%', background: '#ffffff', fontSize: '0.95rem', fontWeight: 800, color: '#0284c7', textAlign: 'left' }}
                    value={setpoints.min ?? 0}
                    onChange={(val) => onUpdateSetpoint('min', val)}
                    onCommit={(val) => onUpdateSetpoint('min', val)}
                  />
                </div>
              </div>
            </div>

            {/* Sub-mode Toggle (CC / CR) & Reset Battery Test */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  className={setpoints.batTestSubMode === 'CC' ? 'btn-primary' : 'btn-chart-action'}
                  style={{ padding: '6px 12px', fontSize: '0.75rem', fontWeight: 800 }}
                  onClick={() => onUpdateSetpoint('batTestSubMode' as any, 'CC' as any)}
                >
                  CC SUBMODE
                </button>
                <button
                  type="button"
                  className={setpoints.batTestSubMode === 'CR' ? 'btn-primary' : 'btn-chart-action'}
                  style={{ padding: '6px 12px', fontSize: '0.75rem', fontWeight: 800 }}
                  onClick={() => onUpdateSetpoint('batTestSubMode' as any, 'CR' as any)}
                >
                  CR SUBMODE
                </button>
              </div>

              {onResetBatTest && (
                <button
                  type="button"
                  className="btn-chart-action"
                  style={{ padding: '6px 12px', fontSize: '0.75rem', fontWeight: 800, color: '#dc2626', borderColor: '#fca5a5' }}
                  onClick={onResetBatTest}
                >
                  RESET TEST
                </button>
              )}
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
