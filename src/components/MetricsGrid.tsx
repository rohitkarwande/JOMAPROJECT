import React from 'react';
import { EngineeringSettings, formatCurrent, formatVoltage, OperationMode, SetpointValues, TelemetryPoint } from '../types/scada';
import { Gauge, Sliders, Battery, Zap, Shield, Flame, AlertCircle } from 'lucide-react';

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
  const isFreezed = outputState || isSequenceRunning;
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const modeLabel = currentMode === 'BAT TEST' ? `BAT TEST (${setpoints.batTestSubMode} MODE)` : `${currentMode} MODE`;

  const parseVal = (valStr: string) => {
    if (valStr === '') return 0;
    const num = parseFloat(valStr);
    return isNaN(num) ? 0 : num;
  };

  // Inline Safety Limit Exceeded Checks
  const vmax = engSettings?.vmax ?? 60.0;
  const imax = engSettings?.imax ?? 30.0;
  const rmax = engSettings?.rmax ?? 100.0;
  const pmax = engSettings?.pmax ?? 5000.0;

  const isCvExceeded = setpoints.cv > vmax;
  const isCcTargetExceeded = currentMode === 'CC' && (setpoints.iset > setpoints.imax || setpoints.iset > imax);
  const isCcImaxExceeded = currentMode === 'CC' && setpoints.imax > imax;
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

      {/* Retro LED Displays for Vmon and Imon */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className="led-card">
          <div className="led-label">
            <span>VOLTAGE (VMON)</span>
            <Gauge size={14} style={{ color: 'var(--accent-cyan)' }} />
          </div>
          <div className="led-value voltage">
            {outputState ? formatVoltage(telemetry.vmon) : '-1.00'}
            <span className="led-unit">V</span>
          </div>
        </div>

        <div className="led-card">
          <div className="led-label">
            <span>CURRENT (IMON)</span>
            <Gauge size={14} style={{ color: 'var(--accent-green)' }} />
          </div>
          <div className="led-value current">
            {outputState ? formatCurrent(telemetry.imon) : '-1.00'}
            <span className="led-unit">A</span>
          </div>
        </div>
      </div>

      {/* Mode-Specific Interactive Parameter Inputs */}
      <div className="setpoint-card">
        <div className="setpoint-label">
          <Sliders size={14} style={{ color: 'var(--accent-cyan)' }} />
          <span>{currentMode === 'BAT TEST' ? `BAT TEST (${setpoints.batTestSubMode} MODE)` : `${currentMode} MODE`} SETPOINTS & LIMITS</span>
        </div>

        {currentMode === 'CV' && (
          <>
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>CV SET (V):</span>
                <input
                  type="number"
                  step="0.001"
                  className="setpoint-input"
                  style={{ border: isCvExceeded ? '2px solid #ef4444' : undefined, background: isCvExceeded ? '#fef2f2' : undefined }}
                  value={setpoints.cv}
                  disabled={isFreezed}
                  onChange={(e) => onUpdateSetpoint('cv', parseVal(e.target.value))}
                />
                <span className="setpoint-unit">V</span>
              </div>
              {isCvExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.75rem', fontWeight: 800, paddingLeft: '98px' }}>
                  <AlertCircle size={14} />
                  <span>⚠️ EXCEEDS VMAX LIMIT ({vmax} V)!</span>
                </div>
              )}
            </div>
            <div className="setpoint-input-wrapper">
              <span className="setpoint-label" style={{ width: '90px' }}>I LIMIT (A):</span>
              <div
                className="setpoint-input"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#e2e8f0',
                  color: '#475569',
                  cursor: 'not-allowed',
                  fontWeight: 700
                }}
              >
                {setpoints.iset.toFixed(3)}
              </div>
              <span className="setpoint-unit">A</span>
            </div>
          </>
        )}

        {currentMode === 'CC' && (
          <>
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>I TARGET (A):</span>
                <input
                  type="number"
                  step="0.001"
                  className="setpoint-input"
                  style={{ border: isCcTargetExceeded ? '2px solid #ef4444' : undefined, background: isCcTargetExceeded ? '#fef2f2' : undefined }}
                  value={setpoints.iset}
                  disabled={isFreezed}
                  onChange={(e) => onUpdateSetpoint('iset', parseVal(e.target.value))}
                />
                <span className="setpoint-unit">A</span>
              </div>
              {isCcTargetExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.75rem', fontWeight: 800, paddingLeft: '98px' }}>
                  <AlertCircle size={14} />
                  <span>⚠️ EXCEEDS {setpoints.iset > setpoints.imax ? `IMAX LIMIT (${setpoints.imax} A)` : `SAFETY IMAX LIMIT (${imax} A)`}!</span>
                </div>
              )}
            </div>

            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>I MAX (A):</span>
                <input
                  type="number"
                  step="0.001"
                  className="setpoint-input"
                  style={{ border: isCcImaxExceeded ? '2px solid #ef4444' : undefined, background: isCcImaxExceeded ? '#fef2f2' : undefined }}
                  value={setpoints.imax}
                  disabled={isFreezed}
                  onChange={(e) => onUpdateSetpoint('imax', parseVal(e.target.value))}
                />
                <span className="setpoint-unit">A</span>
              </div>
              {isCcImaxExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.75rem', fontWeight: 800, paddingLeft: '98px' }}>
                  <AlertCircle size={14} />
                  <span>⚠️ EXCEEDS SAFETY IMAX LIMIT ({imax} A)!</span>
                </div>
              )}
            </div>
          </>
        )}

        {currentMode === 'CR' && (
          <>
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>R (Ω):</span>
                <input
                  type="number"
                  step="0.001"
                  className="setpoint-input"
                  style={{ border: isRsetExceeded ? '2px solid #ef4444' : undefined, background: isRsetExceeded ? '#fef2f2' : undefined }}
                  value={setpoints.rset}
                  disabled={isFreezed}
                  onChange={(e) => onUpdateSetpoint('rset', parseVal(e.target.value))}
                />
                <span className="setpoint-unit">Ω</span>
              </div>
              {isRsetExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.75rem', fontWeight: 800, paddingLeft: '98px' }}>
                  <AlertCircle size={14} />
                  <span>⚠️ EXCEEDS RMAX LIMIT ({rmax} Ω)!</span>
                </div>
              )}
            </div>
            <div className="setpoint-input-wrapper">
              <span className="setpoint-label" style={{ width: '90px' }}>I LIMIT (A):</span>
              <div
                className="setpoint-input"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#e2e8f0',
                  color: '#475569',
                  cursor: 'not-allowed',
                  fontWeight: 700
                }}
              >
                {setpoints.iset.toFixed(3)}
              </div>
              <span className="setpoint-unit">A</span>
            </div>
          </>
        )}

        {currentMode === 'CP' && (
          <>
            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>CP (W):</span>
                <input
                  type="number"
                  step="0.001"
                  className="setpoint-input"
                  style={{ border: isPsetExceeded ? '2px solid #ef4444' : undefined, background: isPsetExceeded ? '#fef2f2' : undefined }}
                  value={setpoints.pset}
                  disabled={isFreezed}
                  onChange={(e) => onUpdateSetpoint('pset', parseVal(e.target.value))}
                />
                <span className="setpoint-unit">W</span>
              </div>
              {isPsetExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.75rem', fontWeight: 800, paddingLeft: '98px' }}>
                  <AlertCircle size={14} />
                  <span>⚠️ EXCEEDS PMAX LIMIT ({pmax} W)!</span>
                </div>
              )}
            </div>

            <div className="setpoint-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="setpoint-label" style={{ width: '90px' }}>I LIMIT (A):</span>
                <input
                  type="number"
                  step="0.001"
                  className="setpoint-input"
                  style={{ border: isIlimitExceeded ? '2px solid #ef4444' : undefined, background: isIlimitExceeded ? '#fef2f2' : undefined }}
                  value={setpoints.iset}
                  disabled={isFreezed}
                  onChange={(e) => onUpdateSetpoint('iset', parseVal(e.target.value))}
                />
                <span className="setpoint-unit">A</span>
              </div>
              {isIlimitExceeded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '0.75rem', fontWeight: 800, paddingLeft: '98px' }}>
                  <AlertCircle size={14} />
                  <span>⚠️ EXCEEDS IMAX LIMIT ({imax} A)!</span>
                </div>
              )}
            </div>
          </>
        )}

        {currentMode === 'BAT TEST' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
            {/* Readout Grid matching Emulator Screenshot: Vcutoff, Iset/Rset, AH, HRS:MIN */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {/* Vcutoff Input Card */}
              <div style={{ background: '#e0f2fe', border: '1.5px solid #38bdf8', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0369a1' }}>Vcutoff (V):</div>
                <input
                  type="number"
                  step="0.001"
                  style={{ width: '100%', background: 'transparent', border: 'none', fontSize: '1.25rem', fontWeight: 800, color: '#0284c7', textAlign: 'center', outline: 'none' }}
                  value={setpoints.cutoffV}
                  disabled={isFreezed}
                  onChange={(e) => onUpdateSetpoint('cutoffV', parseFloat(e.target.value) || 0)}
                />
              </div>

              {/* Iset / Rset Input Card */}
              <div style={{ background: '#e0f2fe', border: '1.5px solid #38bdf8', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0369a1' }}>
                  {setpoints.batTestSubMode === 'CC' ? 'Iset (A):' : 'Rset (Ω):'}
                </div>
                <input
                  type="number"
                  step="0.001"
                  style={{ width: '100%', background: 'transparent', border: 'none', fontSize: '1.25rem', fontWeight: 800, color: '#0284c7', textAlign: 'center', outline: 'none' }}
                  value={setpoints.batTestSubMode === 'CC' ? setpoints.iset : setpoints.rset}
                  disabled={isFreezed}
                  onChange={(e) => onUpdateSetpoint(setpoints.batTestSubMode === 'CC' ? 'iset' : 'rset', parseFloat(e.target.value) || 0)}
                />
              </div>

              {/* AH Capacity Input Card */}
              <div style={{ background: '#e0f2fe', border: '1.5px solid #38bdf8', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0369a1' }}>AH :</div>
                <input
                  type="number"
                  step="0.001"
                  style={{ width: '100%', background: 'transparent', border: 'none', fontSize: '1.25rem', fontWeight: 800, color: '#0284c7', textAlign: 'center', outline: 'none' }}
                  value={setpoints.ah ?? 0}
                  disabled={isFreezed}
                  onChange={(e) => onUpdateSetpoint('ah', parseFloat(e.target.value) || 0)}
                />
              </div>

              {/* HRS : MIN Input Card */}
              <div style={{ background: '#e0f2fe', border: '1.5px solid #38bdf8', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0369a1', textAlign: 'center' }}>HRS : MIN</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px', marginTop: '2px' }}>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    style={{ width: '45%', background: 'transparent', border: 'none', fontSize: '1.15rem', fontWeight: 800, color: '#0284c7', textAlign: 'right', outline: 'none' }}
                    value={setpoints.hrs ?? 0}
                    disabled={isFreezed}
                    onChange={(e) => onUpdateSetpoint('hrs', parseInt(e.target.value, 10) || 0)}
                  />
                  <span style={{ fontWeight: 800, color: '#0284c7', fontSize: '1.15rem' }}>:</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="59"
                    style={{ width: '45%', background: 'transparent', border: 'none', fontSize: '1.15rem', fontWeight: 800, color: '#0284c7', textAlign: 'left', outline: 'none' }}
                    value={setpoints.min ?? 0}
                    disabled={isFreezed}
                    onChange={(e) => onUpdateSetpoint('min', parseInt(e.target.value, 10) || 0)}
                  />
                </div>
              </div>
            </div>

            {/* Sub-Mode Selector Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
              <button
                disabled={outputState && setpoints.batTestSubMode !== 'CC'}
                style={{
                  padding: '10px 4px',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  cursor: outputState && setpoints.batTestSubMode !== 'CC' ? 'not-allowed' : 'pointer',
                  border: '1.5px solid #16a34a',
                  background: setpoints.batTestSubMode === 'CC' ? '#22c55e' : '#ffffff',
                  color: setpoints.batTestSubMode === 'CC' ? '#ffffff' : '#15803d'
                }}
                onClick={() => {
                  if (outputState) return;
                  onUpdateSetpoint('batTestSubMode', 'CC' as any);
                }}
              >
                CC MODE
              </button>

              <button
                disabled={outputState && setpoints.batTestSubMode !== 'CR'}
                style={{
                  padding: '10px 4px',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  cursor: outputState && setpoints.batTestSubMode !== 'CR' ? 'not-allowed' : 'pointer',
                  border: '1.5px solid #2563eb',
                  background: setpoints.batTestSubMode === 'CR' ? '#3b82f6' : '#ffffff',
                  color: setpoints.batTestSubMode === 'CR' ? '#ffffff' : '#1d4ed8'
                }}
                onClick={() => {
                  if (outputState) return;
                  onUpdateSetpoint('batTestSubMode', 'CR' as any);
                }}
              >
                CR MODE
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
