import React, { useEffect, useState } from 'react';
import { ConnectionSettings, CLIENT_CSV_REGISTERS } from '../types/scada';
import { RefreshCw, Check, Activity, Power, Radio, Edit3, Cpu } from 'lucide-react';

interface SettingsModalProps {
  settings: ConnectionSettings;
  onSaveSettings: (settings: ConnectionSettings) => void;
  connectionStatus?: 'CONNECTED' | 'DISCONNECTED' | 'SIMULATOR';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onSaveSettings,
  connectionStatus = 'DISCONNECTED'
}) => {
  const [localSettings, setLocalSettings] = useState<ConnectionSettings>({
    ...settings,
    selectedProfileId: 'CLIENT_CSV_PROFILE',
    isSimulator: false,
    registers: CLIENT_CSV_REGISTERS
  });
  const [availablePorts, setAvailablePorts] = useState<{ path: string; manufacturer?: string }[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [connectionMode, setConnectionMode] = useState<'AUTO' | 'MANUAL'>('AUTO');

  const QUICK_PRESETS = ['COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'COM10', '/dev/ttyUSB0'];

  const fetchPorts = async () => {
    setIsScanning(true);
    let ports: { path: string; manufacturer?: string }[] = [];
    
    if (window.electronAPI) {
      ports = await window.electronAPI.serial.getPorts();
    } else {
      ports = [
        { path: 'COM1', manufacturer: 'Standard Serial Port' },
        { path: 'COM3', manufacturer: 'USB-to-RS485 Converter (FTDI)' },
        { path: 'COM4', manufacturer: 'CH340 USB Serial' },
        { path: 'COM7', manufacturer: 'Hardware RS485 Interface' },
        { path: '/dev/ttyUSB0', manufacturer: 'Linux RS485 Interface' }
      ];
    }

    setAvailablePorts(ports);

    // Keep current port if user already selected/typed a port, otherwise default to first available port
    setLocalSettings((prev) => {
      if (!prev.port && ports.length > 0) {
        return { ...prev, port: ports[0].path };
      }
      return prev;
    });

    setIsScanning(false);
  };

  useEffect(() => {
    fetchPorts();
  }, []);

  useEffect(() => {
    setLocalSettings({
      ...settings,
      selectedProfileId: 'CLIENT_CSV_PROFILE',
      isSimulator: false,
      registers: CLIENT_CSV_REGISTERS
    });
  }, [settings]);

  const handleChange = (key: keyof ConnectionSettings, val: any) => {
    setLocalSettings((prev) => ({ ...prev, [key]: val }));
  };

  const handleSelectPreset = (portName: string) => {
    setLocalSettings((prev) => ({ ...prev, port: portName }));
  };

  const handleConnectToggle = async () => {
    setIsConnecting(true);
    const updatedSettings: ConnectionSettings = {
      ...localSettings,
      selectedProfileId: 'CLIENT_CSV_PROFILE',
      isSimulator: false,
      registers: CLIENT_CSV_REGISTERS
    };
    onSaveSettings(updatedSettings);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setIsConnecting(false);
    }, 1500);
  };

  const isConnected = connectionStatus === 'CONNECTED';
  const isDetected = availablePorts.some((p) => p.path.toUpperCase() === (localSettings.port || '').toUpperCase());

  return (
    <div className="content-page" style={{ alignItems: 'center' }}>
      <div className="card-panel" style={{ width: '100%', maxWidth: '720px', padding: '0', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.15)' }}>
        {/* Header Title */}
        <div style={{
          background: 'linear-gradient(90deg, #0f172a 0%, #1e293b 100%)',
          color: '#ffffff',
          padding: '18px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '2px solid #334155'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '0.5px' }}>
            <Radio size={22} style={{ color: '#38bdf8' }} />
            <span>RS485 SERIAL COM PORT CONNECTION</span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '0.85rem',
            fontWeight: 800,
            background: isConnected ? '#15803d' : '#991b1b',
            color: '#ffffff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}>
            <Activity size={16} />
            <span>{isConnected ? 'HARDWARE CONNECTED' : 'DISCONNECTED'}</span>
          </div>
        </div>

        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '20px', background: '#f8fafc' }}>
          
          {/* Connection Mode Selection Tabs */}
          <div style={{ display: 'flex', gap: '10px', background: '#e2e8f0', padding: '4px', borderRadius: '8px' }}>
            <button
              type="button"
              onClick={() => setConnectionMode('AUTO')}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: 800,
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                background: connectionMode === 'AUTO' ? '#ffffff' : 'transparent',
                color: connectionMode === 'AUTO' ? '#0f172a' : '#64748b',
                boxShadow: connectionMode === 'AUTO' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.2s ease'
              }}
            >
              <Cpu size={16} />
              <span>AUTO-DETECTED PORTS</span>
            </button>

            <button
              type="button"
              onClick={() => setConnectionMode('MANUAL')}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: 800,
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                background: connectionMode === 'MANUAL' ? '#ffffff' : 'transparent',
                color: connectionMode === 'MANUAL' ? '#0f172a' : '#64748b',
                boxShadow: connectionMode === 'MANUAL' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.2s ease'
              }}
            >
              <Edit3 size={16} />
              <span>MANUAL COM PORT ENTRY</span>
            </button>
          </div>

          {/* COM Port Selection Box */}
          <div className="setpoint-card" style={{ padding: '18px', width: '100%', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label className="setpoint-label" style={{ fontWeight: 800, fontSize: '0.9rem', margin: 0 }}>
                  ACTIVE SERIAL TARGET PORT:
                </label>
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: isDetected ? '#dcfce7' : '#fef3c7',
                  color: isDetected ? '#15803d' : '#b45309',
                  border: isDetected ? '1px solid #86efac' : '1px solid #fde68a'
                }}>
                  {isDetected ? 'DETECTED DEVICE' : 'MANUAL PORT'}
                </span>
              </div>

              <button
                type="button"
                className="btn-chart-action"
                style={{ padding: '6px 12px', fontWeight: 700 }}
                onClick={fetchPorts}
                disabled={isScanning}
              >
                <RefreshCw size={14} className={isScanning ? 'spin' : ''} />
                <span>RESCAN PORTS</span>
              </button>
            </div>

            {connectionMode === 'AUTO' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <select
                  style={{
                    width: '100%',
                    color: '#0f172a',
                    background: '#ffffff',
                    padding: '12px',
                    borderRadius: '6px',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    border: '1.5px solid #cbd5e1'
                  }}
                  value={localSettings.port}
                  onChange={(e) => handleChange('port', e.target.value)}
                >
                  {availablePorts.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.path} {p.manufacturer ? `— ${p.manufacturer}` : ''}
                    </option>
                  ))}
                  {!availablePorts.some((p) => p.path === localSettings.port) && (
                    <option value={localSettings.port}>
                      {localSettings.port} (Custom / Manual Port)
                    </option>
                  )}
                </select>

                <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                  * Found {availablePorts.length} hardware COM ports on system. If your device is not listed, switch to Manual Entry tab above.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Enter Port (e.g. COM1, COM7, /dev/ttyUSB0)"
                    style={{
                      flex: 1,
                      padding: '12px',
                      borderRadius: '6px',
                      border: '2px solid #0284c7',
                      fontWeight: 800,
                      fontSize: '1rem',
                      color: '#0f172a',
                      background: '#ffffff'
                    }}
                    value={localSettings.port}
                    onChange={(e) => handleChange('port', e.target.value.toUpperCase())}
                  />
                  <div style={{
                    padding: '12px 16px',
                    background: '#e0f2fe',
                    color: '#0369a1',
                    borderRadius: '6px',
                    fontWeight: 800,
                    fontSize: '0.9rem',
                    whiteSpace: 'nowrap'
                  }}>
                    MANUAL MODE
                  </div>
                </div>

                <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                  Type exact port name (e.g. <code>COM1</code>, <code>COM3</code>, <code>COM7</code>, <code>COM12</code>, <code>/dev/ttyUSB0</code>, or <code>TCP:192.168.1.100</code>).
                </div>
              </div>
            )}

            {/* Quick Presets row */}
            <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed #cbd5e1' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569', marginBottom: '8px', letterSpacing: '0.5px' }}>
                QUICK SELECT PRESETS:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {QUICK_PRESETS.map((preset) => {
                  const isActive = localSettings.port.toUpperCase() === preset.toUpperCase();
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      style={{
                        padding: '5px 12px',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        border: isActive ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                        background: isActive ? '#0284c7' : '#ffffff',
                        color: isActive ? '#ffffff' : '#334155',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Serial Communication Parameters Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Baud Rate */}
            <div className="setpoint-card" style={{ padding: '14px 16px' }}>
              <label className="setpoint-label" style={{ fontWeight: 800, marginBottom: '6px', display: 'block' }}>BAUD RATE:</label>
              <select
                style={{ width: '100%', color: '#0f172a', background: '#ffffff', padding: '10px', borderRadius: '6px', fontSize: '1rem', fontWeight: 700, border: '1.5px solid #cbd5e1' }}
                value={localSettings.baudRate}
                onChange={(e) => handleChange('baudRate', parseInt(e.target.value, 10))}
              >
                <option value={4800}>4800 bps</option>
                <option value={9600}>9600 bps (Standard)</option>
                <option value={19200}>19200 bps</option>
                <option value={38400}>38400 bps</option>
                <option value={115200}>115200 bps</option>
              </select>
            </div>

            {/* Slave ID */}
            <div className="setpoint-card" style={{ padding: '14px 16px' }}>
              <label className="setpoint-label" style={{ fontWeight: 800, marginBottom: '6px', display: 'block' }}>MODBUS SLAVE ID (1-247):</label>
              <input
                type="number"
                min={1}
                max={247}
                style={{ width: '100%', color: '#0f172a', background: '#ffffff', padding: '10px', borderRadius: '6px', fontSize: '1rem', fontWeight: 700, border: '1.5px solid #cbd5e1' }}
                value={localSettings.slaveId}
                onChange={(e) => handleChange('slaveId', parseInt(e.target.value, 10) || 1)}
              />
            </div>

            {/* Data Bits / Parity / Stop Bits info */}
            <div className="setpoint-card" style={{ padding: '14px 16px' }}>
              <label className="setpoint-label" style={{ fontWeight: 800, marginBottom: '6px', display: 'block' }}>SERIAL FORMAT:</label>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', background: '#e2e8f0', padding: '10px', borderRadius: '6px', textAlign: 'center' }}>
                8 Data Bits, None Parity, 1 Stop Bit (8-N-1)
              </div>
            </div>

            {/* Polling Interval */}
            <div className="setpoint-card" style={{ padding: '14px 16px' }}>
              <label className="setpoint-label" style={{ fontWeight: 800, marginBottom: '6px', display: 'block' }}>POLLING INTERVAL (MS):</label>
              <input
                type="number"
                min={100}
                max={2000}
                step={50}
                style={{ width: '100%', color: '#0f172a', background: '#ffffff', padding: '10px', borderRadius: '6px', fontSize: '1rem', fontWeight: 700, border: '1.5px solid #cbd5e1' }}
                value={localSettings.pollingIntervalMs}
                onChange={(e) => handleChange('pollingIntervalMs', parseInt(e.target.value, 10) || 500)}
              />
            </div>
          </div>

          {/* Main Action Footer */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '2px solid #e2e8f0',
            paddingTop: '20px',
            marginTop: '8px'
          }}>
            <div>
              {savedSuccess && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#16a34a', fontWeight: 800, fontSize: '0.95rem' }}>
                  <Check size={20} /> Serial Connection Settings Saved ({localSettings.port})!
                </div>
              )}
            </div>

            <button
              type="button"
              className="btn-primary"
              disabled={isConnecting}
              onClick={handleConnectToggle}
              style={{
                padding: '14px 36px',
                fontSize: '1.1rem',
                fontWeight: 800,
                background: isConnected ? '#dc2626' : '#16a34a',
                borderRadius: '6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
              }}
            >
              <Power size={20} />
              <span>{isConnected ? 'RECONNECT / UPDATE COM PORT' : 'CONNECT TO RS485 HARDWARE'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
