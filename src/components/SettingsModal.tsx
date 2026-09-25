import React, { useEffect, useState } from 'react';
import { ConnectionSettings, BUILTIN_PROFILES } from '../types/scada';
import { Settings, Cpu, RefreshCw, Check, ShieldCheck, ShieldAlert, Info } from 'lucide-react';

interface SettingsModalProps {
  settings: ConnectionSettings;
  onSaveSettings: (settings: ConnectionSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onSaveSettings,
}) => {
  const [localSettings, setLocalSettings] = useState<ConnectionSettings>(settings);
  const [availablePorts, setAvailablePorts] = useState<{ path: string; manufacturer?: string }[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  const fetchPorts = async () => {
    setIsScanning(true);
    if (window.electronAPI) {
      const ports = await window.electronAPI.serial.getPorts();
      setAvailablePorts(ports);
    } else {
      setAvailablePorts([
        { path: 'COM1', manufacturer: 'Standard Serial' },
        { path: 'COM3', manufacturer: 'FTDI USB-to-RS485' },
        { path: '/dev/ttyUSB0', manufacturer: 'Linux RS485' }
      ]);
    }
    setIsScanning(false);
  };

  useEffect(() => {
    fetchPorts();
  }, []);

  const handleChange = (key: keyof ConnectionSettings, val: any) => {
    setLocalSettings((prev) => ({ ...prev, [key]: val }));
  };

  const selectedProfile = BUILTIN_PROFILES.find((p) => p.id === localSettings.selectedProfileId) || BUILTIN_PROFILES[0];

  const handleProfileSelect = (profileId: string) => {
    const found = BUILTIN_PROFILES.find((p) => p.id === profileId) || BUILTIN_PROFILES[0];
    setLocalSettings((prev) => ({
      ...prev,
      selectedProfileId: found.id,
      registers: found.registers,
      isSimulator: found.id === 'SIMULATOR_PROFILE' ? true : prev.isSimulator
    }));
  };

  const handleSave = () => {
    onSaveSettings(localSettings);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="content-page" style={{ alignItems: 'center' }}>
      <div className="card-panel" style={{ width: '100%', maxWidth: '720px' }}>
        <div className="panel-title">
          <Settings size={22} />
          <span>HARDWARE PROFILE & RS485 SERIAL COM CONFIGURATION</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Supported Device Profile Selector */}
          <div style={{
            background: '#ffffff',
            border: '1.5px solid var(--border-color)',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="setpoint-label" style={{ fontSize: '0.85rem' }}>SUPPORTED DEVICE HARDWARE PROFILE:</label>
              {selectedProfile.validationStatus === 'HARDWARE_VALIDATED' ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 800 }}>
                  <ShieldCheck size={14} />
                  <span>HARDWARE VALIDATED</span>
                </div>
              ) : selectedProfile.validationStatus === 'SIMULATOR_TESTED' ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 800 }}>
                  <ShieldCheck size={14} />
                  <span>SIMULATOR TESTED</span>
                </div>
              ) : (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#fffbe6', color: '#b45309', border: '1px solid #fde68a', padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 800 }}>
                  <ShieldAlert size={14} />
                  <span>VALIDATION PENDING (OUTPUT DISABLED)</span>
                </div>
              )}
            </div>

            <select
              style={{ color: '#0f172a', background: '#f8fafc', padding: '10px', borderRadius: '6px', fontSize: '0.95rem', fontWeight: 700, border: '1px solid var(--border-color)' }}
              value={localSettings.selectedProfileId}
              onChange={(e) => handleProfileSelect(e.target.value)}
            >
              {BUILTIN_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* Selected Profile Metadata Details */}
            <div style={{ background: '#f1f5f9', padding: '12px', borderRadius: '6px', fontSize: '0.8rem', color: '#334155', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div><strong>Manufacturer:</strong> {selectedProfile.manufacturer}</div>
              <div><strong>Model:</strong> {selectedProfile.model}</div>
              <div><strong>Validation Status:</strong> <span style={{ fontWeight: 700, color: selectedProfile.validationStatus === 'HARDWARE_VALIDATION_PENDING' ? '#b45309' : 'var(--accent-blue)' }}>{selectedProfile.validationStatus}</span></div>
              <div><strong>Instrument Type:</strong> {selectedProfile.deviceType === 'POWER_SUPPLY' ? 'DC Power Supply (Sourcing)' : 'Electronic Load (Sinking)'}</div>
              <div><strong>Output Control FC:</strong> FC {selectedProfile.outputControlFc === 5 ? '05 (Coil)' : '06 (Holding Reg)'}</div>
              <div><strong>Watchdog Support:</strong> {selectedProfile.watchdogSupported ? `Supported (Reg 0x${selectedProfile.watchdogRegisterAddress?.toString(16)})` : 'Unverified'}</div>
            </div>

            <div style={{ fontSize: '0.78rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Info size={14} style={{ color: 'var(--accent-blue)' }} />
              <span>{selectedProfile.notes}</span>
            </div>
          </div>

          {/* Serial Communication Settings */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Simulator Toggle */}
            <div style={{
              background: '#fffbe6',
              border: '1px solid #fde68a',
              borderRadius: '8px',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Cpu size={22} style={{ color: 'var(--accent-amber)' }} />
                <div>
                  <div style={{ fontFamily: 'var(--font-main)', fontWeight: 700, fontSize: '0.95rem', color: '#0f172a' }}>MODBUS RTU SIMULATOR MODE</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Generate realistic voltage & current signals without physical hardware</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={localSettings.isSimulator}
                onChange={(e) => handleChange('isSimulator', e.target.checked)}
                style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--accent-blue)' }}
              />
            </div>

            {/* Port Selector */}
            <div className="setpoint-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="setpoint-label">COM PORT:</label>
                <button
                  className="btn-chart-action"
                  onClick={fetchPorts}
                  disabled={isScanning}
                >
                  <RefreshCw size={12} className={isScanning ? 'spin' : ''} />
                  <span>Rescan Ports</span>
                </button>
              </div>
              <select
                className="setpoint-input-wrapper"
                style={{ color: '#0f172a', background: '#ffffff', width: '100%', padding: '10px', borderRadius: '6px', fontSize: '0.95rem', fontWeight: 600 }}
                value={localSettings.port}
                onChange={(e) => handleChange('port', e.target.value)}
                disabled={localSettings.isSimulator}
              >
                {availablePorts.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.path} {p.manufacturer ? `(${p.manufacturer})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Baud Rate & Slave ID */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="setpoint-card">
                <label className="setpoint-label">BAUD RATE:</label>
                <select
                  className="setpoint-input-wrapper"
                  style={{ color: '#0f172a', background: '#ffffff', padding: '10px', borderRadius: '6px', fontSize: '0.95rem', fontWeight: 600 }}
                  value={localSettings.baudRate}
                  onChange={(e) => handleChange('baudRate', parseInt(e.target.value, 10))}
                  disabled={localSettings.isSimulator}
                >
                  <option value={4800}>4800</option>
                  <option value={9600}>9600 (Default)</option>
                  <option value={19200}>19200</option>
                  <option value={38400}>38400</option>
                  <option value={115200}>115200</option>
                </select>
              </div>

              <div className="setpoint-card">
                <label className="setpoint-label">SLAVE ID (1-247):</label>
                <input
                  type="number"
                  min={1}
                  max={247}
                  className="setpoint-input-wrapper"
                  style={{ color: '#0f172a', background: '#ffffff', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.95rem', fontWeight: 600 }}
                  value={localSettings.slaveId}
                  onChange={(e) => handleChange('slaveId', parseInt(e.target.value, 10) || 1)}
                  disabled={localSettings.isSimulator}
                />
              </div>
            </div>

            {/* Polling Interval */}
            <div className="setpoint-card">
              <label className="setpoint-label">POLLING INTERVAL (MS):</label>
              <input
                type="number"
                min={100}
                max={2000}
                step={50}
                className="setpoint-input-wrapper"
                style={{ color: '#0f172a', background: '#ffffff', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.95rem', fontWeight: 600 }}
                value={localSettings.pollingIntervalMs}
                onChange={(e) => handleChange('pollingIntervalMs', parseInt(e.target.value, 10) || 500)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
            {savedSuccess && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-green)', fontFamily: 'var(--font-main)', fontWeight: 700 }}>
                <Check size={18} /> Settings Applied!
              </div>
            )}
            <button
              className="btn-primary"
              onClick={handleSave}
              style={{ padding: '12px 28px', fontSize: '0.95rem' }}
            >
              <Settings size={18} />
              <span>APPLY & SAVE SETTINGS</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
