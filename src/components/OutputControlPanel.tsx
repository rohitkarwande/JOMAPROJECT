import React from 'react';
import { Power, CheckCircle2, AlertTriangle, ShieldAlert, HelpCircle } from 'lucide-react';
import { ProfileValidationStatus } from '../types/scada';

interface OutputControlPanelProps {
  outputState: boolean;
  outputConfirmedState?: 'ON' | 'OFF' | 'UNKNOWN';
  validationStatus?: ProfileValidationStatus;
  isSimulator?: boolean;
  onToggleOutput: (state: boolean) => void;
  disabled?: boolean;
}

export const OutputControlPanel: React.FC<OutputControlPanelProps> = ({
  outputState,
  outputConfirmedState = 'OFF',
  validationStatus = 'HARDWARE_VALIDATED',
  isSimulator = false,
  onToggleOutput,
  disabled = false,
}) => {
  const isAuthorized = validationStatus === 'HARDWARE_VALIDATED' || validationStatus === 'SIMULATOR_TESTED' || isSimulator;

  const isOutputOn = outputState && outputConfirmedState === 'ON';

  return (
    <div className="output-control-card">
      {!isAuthorized && (
        <div style={{
          background: '#fffbe6',
          border: '1px solid #fde68a',
          borderRadius: '6px',
          padding: '10px 12px',
          marginBottom: '10px',
          fontSize: '0.78rem',
          fontWeight: 600,
          color: '#b45309',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, color: '#92400e' }}>
            <ShieldAlert size={16} />
            <span>HARDWARE VALIDATION PENDING — OUTPUT CONTROL DISABLED</span>
          </div>
          <p style={{ margin: 0, lineHeight: 1.35, opacity: 0.9 }}>
            Physical hardware has not been tested. Output control is disabled until the exact hardware model, firmware, register map, communication and safety behaviour have been verified.
          </p>
        </div>
      )}

      <div className="output-status-container">
        <div className={`indicator-led ${isOutputOn ? 'on' : 'off'}`} />
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.5px' }}>
            HARDWARE OUTPUT STATE
          </div>
          <div className={`output-status-text ${isOutputOn ? 'on' : 'off'}`}>
            {outputConfirmedState === 'UNKNOWN' ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#d97706' }}>
                <HelpCircle size={16} /> OUTPUT STATE UNKNOWN
              </span>
            ) : isOutputOn ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={16} /> OUTPUT ENABLED (ON)
              </span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle size={16} /> OUTPUT DISABLED (OFF)
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="output-btn-group">
        <button
          className="btn-output btn-output-on"
          onClick={() => onToggleOutput(true)}
          disabled={disabled || !isAuthorized || isOutputOn}
          title={!isAuthorized ? 'Physical hardware has not been tested. Output control is disabled until hardware is verified.' : ''}
        >
          <Power size={16} />
          <span>OUTPUT ON</span>
        </button>

        <button
          className="btn-output btn-output-off"
          onClick={() => onToggleOutput(false)}
          disabled={disabled || (!outputState && outputConfirmedState !== 'UNKNOWN')}
        >
          <Power size={16} />
          <span>OUTPUT OFF</span>
        </button>
      </div>
    </div>
  );
};
