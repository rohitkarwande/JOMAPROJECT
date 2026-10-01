import React, { useEffect, useState } from 'react';
import { ConnectionSettings, CLIENT_CSV_REGISTERS, CLIENT_CSV_REGISTERS_BASE1, CLIENT_CSV_REGISTERS_BASE0 } from '../types/scada';
import { RefreshCw, Check, Activity, Power, Radio, Edit3, Cpu, AlertCircle, Layers, ChevronDown, ChevronUp } from 'lucide-react';
import { KeyboardNumericInput } from './KeyboardNumericInput';
import { RegisterDiagnosticsPanel } from './RegisterDiagnosticsPanel';

interface SettingsModalProps {
  settings: ConnectionSettings;
  onSaveSettings: (settings: ConnectionSettings) => Promise<boolean | void>;
  onDisconnect?: () => Promise<void>;
  connectionStatus?: 'CONNECTED' | 'DISCONNECTED';
}


export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onSaveSettings,
  onDisconnect,
  connectionStatus = 'DISCONNECTED'
}) => {
  const [localSettings, setLocalSettings] = useState<ConnectionSettings>({
    ...settings,
    selectedProfileId: 'CLIENT_CSV_PROFILE',
    isSimulator: false,
    registers: settings.registers || CLIENT_CSV_REGISTERS_BASE0
  });
  const [availablePorts, setAvailablePorts] = useState<{ path: string; manufacturer?: string }[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [connectionMode, setConnectionMode] = useState<'AUTO' | 'MANUAL'>('AUTO');

  const QUICK_PRESETS = ['COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'COM10', '/dev/ttyUSB0'];

  const currentAddressBase = localSettings.registers?.addressBase ?? 0;

  const handleApplySettings = async (override?: Partial<ConnectionSettings>) => {
    setIsConnecting(true);
    setConnectError(null);
    try {
      const updatedSettings: ConnectionSettings = {
        ...localSettings,
        ...override,
        selectedProfileId: 'CLIENT_CSV_PROFILE',
        isSimulator: false,
        registers: (override && override.registers) || localSettings.registers || CLIENT_CSV_REGISTERS_BASE0
      };
      const ok = await onSaveSettings(updatedSettings);
      if (ok === false) {
        setConnectError(`Failed to update settings.`);
      } else {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2500);
      }
    } catch (err: any) {
      setConnectError(err?.message || 'Error updating settings');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleBaseToggle = (base: 0 | 1) => {
    const newRegs = base === 1 ? CLIENT_CSV_REGISTERS_BASE1 : CLIENT_CSV_REGISTERS_BASE0;
    setLocalSettings((prev) => ({
      ...prev,
      registers: newRegs
    }));
    if (isConnected) {
      handleApplySettings({ registers: newRegs });
    }
  };

  const fetchPorts = async () => {
    setIsScanning(true);
    let ports: { path: string; manufacturer?: string }[] = [];
    
    if (window.electronAPI) {
      ports = await window.electronAPI.serial.getPorts();
    } else {
      ports = [
        { path: 'COM1', manufacturer: 'USB-SERIAL CH340 (COM1)' },
        { path: 'COM3', manufacturer: 'USB-SERIAL CH340 (COM3)' },
        { path: 'COM5', manufacturer: 'Serial Port (COM5)' },
        { path: 'COM6', manufacturer: 'Serial Port (COM6)' },
        { path: 'COM7', manufacturer: 'Serial Port (COM7)' }
      ];
    }

    setAvailablePorts(ports);

    // Keep current port if present in system, otherwise default to first available detected port
    setLocalSettings((prev) => {
      const portExists = ports.some((p) => p.path.toUpperCase() === (prev.port || '').toUpperCase());
      if ((!prev.port || !portExists) && ports.length > 0) {
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
    setLocalSettings((prev) => ({
      ...settings,
      selectedProfileId: 'CLIENT_CSV_PROFILE',
      isSimulator: false,
      registers: prev.registers || settings.registers || CLIENT_CSV_REGISTERS_BASE0
    }));
  }, [settings]);

  const handleChange = (key: keyof ConnectionSettings, val: any) => {
    setLocalSettings((prev) => ({ ...prev, [key]: val }));
  };

  const handleSelectPreset = (portName: string) => {
    setLocalSettings((prev) => ({ ...prev, port: portName }));
  };

  const handleConnectToggle = async () => {
    setIsConnecting(true);
    setConnectError(null);
    try {
      if (isConnected) {
        if (onDisconnect) {
          await onDisconnect();
        }
      } else {
        const updatedSettings: ConnectionSettings = {
          ...localSettings,
          selectedProfileId: 'CLIENT_CSV_PROFILE',
          isSimulator: false,
          registers: localSettings.registers || CLIENT_CSV_REGISTERS_BASE0
        };
        const ok = await onSaveSettings(updatedSettings);
        if (ok === false) {
          setConnectError(`Failed to open serial port ${localSettings.port}. Please ensure the device is plugged in, baud rate matches, and no other app is using it.`);
        } else {
          setSavedSuccess(true);
          setTimeout(() => setSavedSuccess(false), 2500);
        }
      }
    } catch (err: any) {
      setConnectError(err?.message || 'Connection error occurred.');
    } finally {
      setIsConnecting(false);
    }
  };

  const isConnected = connectionStatus === 'CONNECTED';
  const isDetected = availablePorts.some((p) => p.path.toUpperCase() === (localSettings.port || '').toUpperCase());

  return (
    <div className="content-page" style={{ alignItems: 'center' }}>
      <div className="card-panel" style={{ width: '100%', maxWidth: '1080px', padding: '0', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.15)' }}>
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
            <span>{isConnected ? `CONNECTED (${localSettings.port || 'COM3'})` : 'DISCONNECTED'}</span>
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
              <span>AUTO-DETECTED HARDWARE PORTS</span>
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
                  * Found {availablePorts.length} hardware COM ports on system. Select your USB-to-RS485 adapter (e.g. COM1).
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
                  Type exact port name (e.g. <code>COM1</code>, <code>COM7</code>, <code>/dev/ttyUSB0</code>, or <code>TCP:192.168.1.100</code>).
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
                <option value={57600}>57600 bps</option>
                <option value={115200}>115200 bps</option>
              </select>
            </div>

            {/* Slave ID */}
            <div className="setpoint-card" style={{ padding: '14px 16px' }}>
              <label className="setpoint-label" style={{ fontWeight: 800, marginBottom: '6px', display: 'block' }}>MODBUS SLAVE ID (1-247):</label>
              <KeyboardNumericInput
                min={1}
                max={247}
                step={1}
                precision={0}
                style={{ width: '100%', color: '#0f172a', background: '#ffffff', padding: '10px', borderRadius: '6px', fontSize: '1rem', fontWeight: 700, border: '1.5px solid #cbd5e1' }}
                value={localSettings.slaveId}
                onChange={(val) => handleChange('slaveId', Math.max(1, Math.min(247, Math.round(val))))}
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
              <KeyboardNumericInput
                min={100}
                max={5000}
                step={50}
                precision={0}
                style={{ width: '100%', color: '#0f172a', background: '#ffffff', padding: '10px', borderRadius: '6px', fontSize: '1rem', fontWeight: 700, border: '1.5px solid #cbd5e1' }}
                value={localSettings.pollingIntervalMs}
                onChange={(val) => {
                  const newInterval = Math.max(100, Math.round(val));
                  handleChange('pollingIntervalMs', newInterval);
                  if (isConnected) {
                    handleApplySettings({ pollingIntervalMs: newInterval });
                  }
                }}
              />
            </div>
          </div>

          {/* Register Mapping Card & Base Selector */}
          <div style={{
            background: '#ffffff',
            border: '1.5px solid #cbd5e1',
            borderRadius: '8px',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Layers size={20} style={{ color: '#0284c7' }} />
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.98rem', color: '#0f172a' }}>MODBUS REGISTER ADDRESS MAPPING</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Cross-checked with your CSV register specification</div>
                </div>
              </div>

              {/* Base Switcher Buttons */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => handleBaseToggle(1)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: currentAddressBase === 1 ? '2px solid #0284c7' : '1px solid #cbd5e1',
                    background: currentAddressBase === 1 ? '#e0f2fe' : '#f8fafc',
                    color: currentAddressBase === 1 ? '#0369a1' : '#475569',
                    fontWeight: 800,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  Base 1: CSV Exact (1, 3, 5...)
                </button>
                <button
                  type="button"
                  onClick={() => handleBaseToggle(0)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: currentAddressBase === 0 ? '2px solid #0284c7' : '1px solid #cbd5e1',
                    background: currentAddressBase === 0 ? '#e0f2fe' : '#f8fafc',
                    color: currentAddressBase === 0 ? '#0369a1' : '#475569',
                    fontWeight: 800,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  ✓ Base 0: Wire Offset (0, 2, 4...) [Hardware Standard]
                </button>
              </div>
            </div>

            <div style={{
              fontSize: '0.84rem',
              color: '#334155',
              background: '#f1f5f9',
              padding: '10px 14px',
              borderRadius: '6px',
              lineHeight: '1.45'
            }}>
              Currently using <strong>Base {currentAddressBase} ({currentAddressBase === 1 ? 'Direct CSV MainAddress' : 'Wire Protocol Offset'})</strong>.
              Live Voltage (V_MON) is at address <strong>{currentAddressBase === 1 ? '1' : '0'}</strong>, Current (I_MON) is at <strong>{currentAddressBase === 1 ? '3' : '2'}</strong>, Output START_STOP coil is at <strong>{currentAddressBase === 1 ? '1' : '0'}</strong>.
            </div>

            {/* Live Register Diagnostics & Hardware Verification Panel */}
            <RegisterDiagnosticsPanel
              isConnected={isConnected}
              currentAddressBase={currentAddressBase}
              wordSwap={localSettings.wordSwap !== false}
              onToggleWordSwap={(ws) => {
                setLocalSettings((prev) => ({ ...prev, wordSwap: ws }));
                if (isConnected) {
                  handleApplySettings({ wordSwap: ws });
                }
              }}
            />
          </div>
          <div style={{
            background: '#eff6ff',
            border: '1.5px solid #bfdbfe',
            borderRadius: '8px',
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            fontSize: '0.86rem',
            color: '#1e3a8a'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800 }}>
              <AlertCircle size={18} style={{ color: '#2563eb', flexShrink: 0 }} />
              <span>RS485 HARDWARE CONNECTION & TROUBLESHOOTING GUIDE</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.5', color: '#1e40af' }}>
              <li><strong>Wiring Polarity:</strong> If COM port shows Connected but Voltage/Current stays at 0.00V, <strong>swap the A+ and B- wires</strong> on your USB adapter. RS485 polarity inversion is the most common cause of no response.</li>
              <li><strong>Slave ID:</strong> Check your DC Power Supply / Load front panel menu to ensure its Modbus Address matches the <strong>SLAVE ID</strong> configured above (default: 1).</li>
              <li><strong>Baud Rate:</strong> Confirm the baud rate matches the device setting (default: 9600, 8 data bits, no parity, 1 stop bit).</li>
            </ul>
          </div>

          {/* Connection Error Alert */}
          {connectError && (
            <div style={{
              background: '#fee2e2',
              border: '1.5px solid #f87171',
              borderRadius: '6px',
              padding: '12px 16px',
              color: '#991b1b',
              fontWeight: 700,
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <AlertCircle size={20} style={{ color: '#dc2626', flexShrink: 0 }} />
              <span>{connectError}</span>
            </div>
          )}

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
                  <Check size={20} /> RS485 Connected ({localSettings.port} @ {localSettings.baudRate} bps)!
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {isConnected ? (
                <>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={isConnecting}
                    onClick={() => handleApplySettings()}
                    style={{
                      padding: '12px 24px',
                      fontSize: '0.98rem',
                      fontWeight: 800,
                      background: '#0284c7',
                      borderRadius: '6px',
                      boxShadow: '0 4px 12px rgba(2, 132, 199, 0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      opacity: isConnecting ? 0.7 : 1,
                      cursor: isConnecting ? 'not-allowed' : 'pointer',
                      border: 'none',
                      color: '#ffffff'
                    }}
                  >
                    <Check size={18} />
                    <span>UPDATE / APPLY SETTINGS</span>
                  </button>

                  <button
                    type="button"
                    disabled={isConnecting}
                    onClick={onDisconnect}
                    style={{
                      padding: '12px 24px',
                      fontSize: '0.98rem',
                      fontWeight: 800,
                      background: '#dc2626',
                      borderRadius: '6px',
                      boxShadow: '0 4px 12px rgba(220, 38, 38, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      opacity: isConnecting ? 0.7 : 1,
                      cursor: isConnecting ? 'not-allowed' : 'pointer',
                      border: 'none',
                      color: '#ffffff'
                    }}
                  >
                    <Power size={18} />
                    <span>DISCONNECT FROM RS485</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={isConnecting}
                  onClick={handleConnectToggle}
                  style={{
                    padding: '14px 36px',
                    fontSize: '1.1rem',
                    fontWeight: 800,
                    background: '#16a34a',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    opacity: isConnecting ? 0.7 : 1,
                    cursor: isConnecting ? 'not-allowed' : 'pointer',
                    border: 'none',
                    color: '#ffffff'
                  }}
                >
                  {isConnecting ? (
                    <>
                      <RefreshCw size={20} className="spin" />
                      <span>CONNECTING...</span>
                    </>
                  ) : (
                    <>
                      <Power size={20} />
                      <span>CONNECT TO RS485 HARDWARE</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
