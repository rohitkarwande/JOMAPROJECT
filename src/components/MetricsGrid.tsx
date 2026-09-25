import React from 'react';
import { OperationMode, SetpointValues, TelemetryPoint } from '../types/scada';
import { Gauge, Sliders, Battery, Zap, Shield, Flame } from 'lucide-react';

interface MetricsGridProps {
  currentMode: OperationMode;
  telemetry: TelemetryPoint;
  setpoints: SetpointValues;
  onUpdateSetpoint: (key: keyof SetpointValues, val: number) => void;
  outputState: boolean;
  elapsedTimeSeconds: number;
}

export const MetricsGrid: React.FC<MetricsGridProps> = ({
  currentMode,
  telemetry,
  setpoints,
  onUpdateSetpoint,
  outputState,
  elapsedTimeSeconds
}) => {
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const modeLabel = currentMode === 'BAT TEST' ? `BAT TEST (${setpoints.batTestSubMode} MODE)` : `${currentMode} MODE`;

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
            <span>VOLTAGE MONITOR (VMON)</span>
            <Gauge size={14} style={{ color: 'var(--accent-cyan)' }} />
          </div>
          <div className="led-value voltage">
            {outputState ? telemetry.vmon.toFixed(2) : '-1.00'}
            <span className="led-unit">V</span>
          </div>
        </div>

        <div className="led-card">
          <div className="led-label">
            <span>CURRENT MONITOR (IMON)</span>
            <Gauge size={14} style={{ color: 'var(--accent-green)' }} />
          </div>
          <div className="led-value current">
            {outputState ? telemetry.imon.toFixed(2) : '-1.00'}
            <span className="led-unit">A</span>
          </div>
        </div>
      </div>

      {/* Monitored Power LED */}
      <div className="led-card" style={{ padding: '12px 18px' }}>
        <div className="led-label">
          <span>MONITORED POWER (PMON)</span>
          <Flame size={14} style={{ color: 'var(--accent-amber)' }} />
        </div>
        <div className="led-value power" style={{ fontSize: '2.1rem' }}>
          {outputState ? telemetry.pmon.toFixed(2) : '0.00'}
          <span className="led-unit">W</span>
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
            <div className="setpoint-input-wrapper">
              <span className="setpoint-label" style={{ width: '90px' }}>CV SET (V):</span>
              <input
                type="number"
                step="0.1"
                className="setpoint-input"
                value={setpoints.cv}
                onChange={(e) => onUpdateSetpoint('cv', parseFloat(e.target.value) || 0)}
              />
              <span className="setpoint-unit">V</span>
            </div>
            <div className="setpoint-input-wrapper">
              <span className="setpoint-label" style={{ width: '90px' }}>I LIMIT (A):</span>
              <input
                type="number"
                step="0.1"
                className="setpoint-input"
                value={setpoints.iset}
                onChange={(e) => onUpdateSetpoint('iset', parseFloat(e.target.value) || 0)}
              />
              <span className="setpoint-unit">A</span>
            </div>
          </>
        )}

        {currentMode === 'CC' && (
          <>
            <div className="setpoint-input-wrapper">
              <span className="setpoint-label" style={{ width: '90px' }}>I TARGET (A):</span>
              <input
                type="number"
                step="0.1"
                className="setpoint-input"
                value={setpoints.iset}
                onChange={(e) => onUpdateSetpoint('iset', parseFloat(e.target.value) || 0)}
              />
              <span className="setpoint-unit">A</span>
            </div>
            <div className="setpoint-input-wrapper">
              <span className="setpoint-label" style={{ width: '90px' }}>I MAX (A):</span>
              <input
                type="number"
                step="0.1"
                className="setpoint-input"
                value={setpoints.imax}
                onChange={(e) => onUpdateSetpoint('imax', parseFloat(e.target.value) || 0)}
              />
              <span className="setpoint-unit">A</span>
            </div>
          </>
        )}

        {currentMode === 'CR' && (
          <>
            <div className="setpoint-input-wrapper">
              <span className="setpoint-label" style={{ width: '90px' }}>R (Ω):</span>
              <input
                type="number"
                step="0.1"
                className="setpoint-input"
                value={setpoints.rset}
                onChange={(e) => onUpdateSetpoint('rset', parseFloat(e.target.value) || 0)}
              />
              <span className="setpoint-unit">Ω</span>
            </div>
            <div className="setpoint-input-wrapper">
              <span className="setpoint-label" style={{ width: '90px' }}>I LIMIT (A):</span>
              <input
                type="number"
                step="0.1"
                className="setpoint-input"
                value={setpoints.iset}
                onChange={(e) => onUpdateSetpoint('iset', parseFloat(e.target.value) || 0)}
              />
              <span className="setpoint-unit">A</span>
            </div>
          </>
        )}

        {currentMode === 'CP' && (
          <>
            <div className="setpoint-input-wrapper">
              <span className="setpoint-label" style={{ width: '90px' }}>CP (W):</span>
              <input
                type="number"
                step="1"
                className="setpoint-input"
                value={setpoints.pset}
                onChange={(e) => onUpdateSetpoint('pset', parseFloat(e.target.value) || 0)}
              />
              <span className="setpoint-unit">W</span>
            </div>
            <div className="setpoint-input-wrapper">
              <span className="setpoint-label" style={{ width: '90px' }}>I LIMIT (A):</span>
              <input
                type="number"
                step="0.1"
                className="setpoint-input"
                value={setpoints.iset}
                onChange={(e) => onUpdateSetpoint('iset', parseFloat(e.target.value) || 0)}
              />
              <span className="setpoint-unit">A</span>
            </div>
          </>
        )}

        {currentMode === 'BAT TEST' && (
          <>
            {/* Sub-mode selector for Battery Test: CC or CR */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
              <button
                disabled={outputState && setpoints.batTestSubMode !== 'CC'}
                title={outputState && setpoints.batTestSubMode !== 'CC' ? 'Sub-mode locked during active test. Turn Output OFF first.' : ''}
                style={{
                  flex: 1,
                  padding: '6px',
                  borderRadius: '4px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: outputState && setpoints.batTestSubMode !== 'CC' ? 'not-allowed' : 'pointer',
                  opacity: outputState && setpoints.batTestSubMode !== 'CC' ? 0.5 : 1,
                  border: '1px solid var(--border-color)',
                  background: setpoints.batTestSubMode === 'CC' ? 'var(--accent-blue)' : '#f8fafc',
                  color: setpoints.batTestSubMode === 'CC' ? '#ffffff' : 'var(--text-muted)'
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
                title={outputState && setpoints.batTestSubMode !== 'CR' ? 'Sub-mode locked during active test. Turn Output OFF first.' : ''}
                style={{
                  flex: 1,
                  padding: '6px',
                  borderRadius: '4px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: outputState && setpoints.batTestSubMode !== 'CR' ? 'not-allowed' : 'pointer',
                  opacity: outputState && setpoints.batTestSubMode !== 'CR' ? 0.5 : 1,
                  border: '1px solid var(--border-color)',
                  background: setpoints.batTestSubMode === 'CR' ? 'var(--accent-blue)' : '#f8fafc',
                  color: setpoints.batTestSubMode === 'CR' ? '#ffffff' : 'var(--text-muted)'
                }}
                onClick={() => {
                  if (outputState) return;
                  onUpdateSetpoint('batTestSubMode', 'CR' as any);
                }}
              >
                CR MODE
              </button>
            </div>

            {setpoints.batTestSubMode === 'CC' ? (
              <>
                <div className="setpoint-input-wrapper">
                  <span className="setpoint-label" style={{ width: '90px' }}>I SET (A):</span>
                  <input
                    type="number"
                    step="0.1"
                    className="setpoint-input"
                    value={setpoints.iset}
                    onChange={(e) => onUpdateSetpoint('iset', parseFloat(e.target.value) || 0)}
                  />
                  <span className="setpoint-unit">A</span>
                </div>
                <div className="setpoint-input-wrapper">
                  <span className="setpoint-label" style={{ width: '90px' }}>I MAX (A):</span>
                  <input
                    type="number"
                    step="0.1"
                    className="setpoint-input"
                    value={setpoints.imax}
                    onChange={(e) => onUpdateSetpoint('imax', parseFloat(e.target.value) || 0)}
                  />
                  <span className="setpoint-unit">A</span>
                </div>
              </>
            ) : (
              <>
                <div className="setpoint-input-wrapper">
                  <span className="setpoint-label" style={{ width: '90px' }}>R (Ω):</span>
                  <input
                    type="number"
                    step="0.1"
                    className="setpoint-input"
                    value={setpoints.rset}
                    onChange={(e) => onUpdateSetpoint('rset', parseFloat(e.target.value) || 0)}
                  />
                  <span className="setpoint-unit">Ω</span>
                </div>
                <div className="setpoint-input-wrapper">
                  <span className="setpoint-label" style={{ width: '90px' }}>I SET (A):</span>
                  <input
                    type="number"
                    step="0.1"
                    className="setpoint-input"
                    value={setpoints.iset}
                    onChange={(e) => onUpdateSetpoint('iset', parseFloat(e.target.value) || 0)}
                  />
                  <span className="setpoint-unit">A</span>
                </div>
              </>
            )}

            <div className="setpoint-input-wrapper">
              <span className="setpoint-label" style={{ width: '90px' }}>CUTOFF (V):</span>
              <input
                type="number"
                step="0.1"
                className="setpoint-input"
                value={setpoints.cutoffV}
                onChange={(e) => onUpdateSetpoint('cutoffV', parseFloat(e.target.value) || 0)}
              />
              <span className="setpoint-unit">V</span>
            </div>

            <div style={{ marginTop: '6px', paddingTop: '8px', borderTop: '1px dashed var(--border-color)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <div className="setpoint-label" style={{ fontSize: '0.75rem' }}>CAPACITY</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent-blue)' }}>
                  {(telemetry.capacityAh || 0).toFixed(3)} <span style={{ fontSize: '0.75rem' }}>Ah</span>
                </div>
              </div>
              <div>
                <div className="setpoint-label" style={{ fontSize: '0.75rem' }}>ELAPSED</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-main)' }}>
                  {formatTime(elapsedTimeSeconds)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
