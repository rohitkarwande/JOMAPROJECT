import React, { useEffect, useState } from 'react';
import { EngineeringSettings } from '../types/scada';
import { ShieldAlert, Check, Save } from 'lucide-react';
import { JomaLogo } from './JomaLogo';
import { KeyboardNumericInput } from './KeyboardNumericInput';

interface EngSettingsProps {
  engSettings: EngineeringSettings;
  onSaveEngSettings: (settings: EngineeringSettings) => void;
}

export const EngSettings: React.FC<EngSettingsProps> = ({
  engSettings,
  onSaveEngSettings,
}) => {
  const [localEng, setLocalEng] = useState<EngineeringSettings>(engSettings);
  const [timeStr, setTimeStr] = useState<string>('');
  const [dateStr, setDateStr] = useState<string>('');
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  useEffect(() => {
    setLocalEng(engSettings);
  }, [engSettings]);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toTimeString().split(' ')[0]);

      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      setDateStr(`${day}/${month}/${year}`);
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleChange = (key: keyof EngineeringSettings, val: number) => {
    setLocalEng((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = () => {
    onSaveEngSettings(localEng);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="content-page" style={{ alignItems: 'center' }}>
      <div
        className="card-panel"
        style={{
          width: '100%',
          maxWidth: '960px',
          background: '#f8fafc',
          color: '#0f172a',
          border: '2px solid #0284c7',
          padding: '0',
          overflow: 'hidden',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.6)'
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            background: 'linear-gradient(90deg, #1e40af 0%, #3b82f6 50%, #1e40af 100%)',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '2px solid #1e3a8a'
          }}
        >
          {/* Title Banner */}
          <div
            style={{
              fontFamily: "'Times New Roman', serif",
              fontWeight: 700,
              fontSize: '2.2rem',
              color: '#ffffff',
              letterSpacing: '2px',
              textShadow: '0 2px 4px rgba(0,0,0,0.4)'
            }}
          >
            ENGINEERING SETTINGS & LOGGING CONFIGURATION
          </div>
        </div>

        {/* Retro LED Numeric Input Grid */}
        <div
          style={{
            padding: '40px 36px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '32px 48px',
            background: '#f8fafc'
          }}
        >
          {/* Vmax Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <span
              style={{
                fontFamily: "'Times New Roman', serif",
                fontWeight: 700,
                fontSize: '2.2rem',
                minWidth: '140px',
                color: '#000000'
              }}
            >
              Vmax :
            </span>
            <div
              style={{
                flex: 1,
                background: '#000000',
                borderRadius: '4px',
                padding: '12px 20px',
                boxShadow: 'inset 0 0 10px rgba(0,0,0,0.9)'
              }}
            >
              <KeyboardNumericInput
                step={0.1}
                precision={3}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  fontFamily: "'Times New Roman', serif",
                  fontSize: '2.4rem',
                  fontWeight: 700,
                  textAlign: 'center',
                  outline: 'none'
                }}
                value={localEng.vmax}
                onChange={(val) => handleChange('vmax', val)}
              />
            </div>
          </div>

          {/* Pmax Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <span
              style={{
                fontFamily: "'Times New Roman', serif",
                fontWeight: 700,
                fontSize: '2.2rem',
                minWidth: '140px',
                color: '#000000'
              }}
            >
              Pmax :
            </span>
            <div
              style={{
                flex: 1,
                background: '#000000',
                borderRadius: '4px',
                padding: '12px 20px',
                boxShadow: 'inset 0 0 10px rgba(0,0,0,0.9)'
              }}
            >
              <KeyboardNumericInput
                step={10}
                precision={1}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  fontFamily: "'Times New Roman', serif",
                  fontSize: '2.4rem',
                  fontWeight: 700,
                  textAlign: 'center',
                  outline: 'none'
                }}
                value={localEng.pmax}
                onChange={(val) => handleChange('pmax', val)}
              />
            </div>
          </div>

          {/* Imax Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <span
              style={{
                fontFamily: "'Times New Roman', serif",
                fontWeight: 700,
                fontSize: '2.2rem',
                minWidth: '140px',
                color: '#000000'
              }}
            >
              Imax :
            </span>
            <div
              style={{
                flex: 1,
                background: '#000000',
                borderRadius: '4px',
                padding: '12px 20px',
                boxShadow: 'inset 0 0 10px rgba(0,0,0,0.9)'
              }}
            >
              <KeyboardNumericInput
                step={0.1}
                precision={3}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  fontFamily: "'Times New Roman', serif",
                  fontSize: '2.4rem',
                  fontWeight: 700,
                  textAlign: 'center',
                  outline: 'none'
                }}
                value={localEng.imax}
                onChange={(val) => handleChange('imax', val)}
              />
            </div>
          </div>

          {/* Rmax Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <span
              style={{
                fontFamily: "'Times New Roman', serif",
                fontWeight: 700,
                fontSize: '2.2rem',
                minWidth: '140px',
                color: '#000000'
              }}
            >
              Rmax :
            </span>
            <div
              style={{
                flex: 1,
                background: '#000000',
                borderRadius: '4px',
                padding: '12px 20px',
                boxShadow: 'inset 0 0 10px rgba(0,0,0,0.9)'
              }}
            >
              <KeyboardNumericInput
                step={1}
                precision={2}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  fontFamily: "'Times New Roman', serif",
                  fontSize: '2.4rem',
                  fontWeight: 700,
                  textAlign: 'center',
                  outline: 'none'
                }}
                value={localEng.rmax}
                onChange={(val) => handleChange('rmax', val)}
              />
            </div>
          </div>

          {/* Log Interval Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', gridColumn: 'span 2', background: '#ecfdf5', padding: '16px 20px', borderRadius: '8px', border: '1.5px solid #10b981' }}>
            <span
              style={{
                fontFamily: "'Times New Roman', serif",
                fontWeight: 700,
                fontSize: '1.8rem',
                minWidth: '320px',
                color: '#064e3b'
              }}
            >
              Log Interval (mins) :
            </span>
            <div
              style={{
                flex: 1,
                background: '#000000',
                borderRadius: '4px',
                padding: '12px 20px',
                boxShadow: 'inset 0 0 10px rgba(0,0,0,0.9)'
              }}
            >
              <KeyboardNumericInput
                min={0.01}
                step={0.1}
                precision={3}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: '#4ade80',
                  fontFamily: "'Times New Roman', serif",
                  fontSize: '2.4rem',
                  fontWeight: 700,
                  textAlign: 'center',
                  outline: 'none'
                }}
                value={localEng.logIntervalMinutes ?? (localEng.logIntervalSeconds ? +(localEng.logIntervalSeconds / 60).toFixed(3) : 1)}
                onChange={(num) => {
                  setLocalEng((prev) => ({
                    ...prev,
                    logIntervalMinutes: num,
                    logIntervalSeconds: Math.max(0.1, parseFloat((num * 60).toFixed(3)))
                  }));
                }}
              />
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div
          style={{
            background: '#e2e8f0',
            padding: '16px 36px',
            borderTop: '2px solid #cbd5e1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
            <ShieldAlert size={18} style={{ color: '#0284c7' }} />
            <span>Note: Vmax, Imax, Pmax & Rmax set safety cutoff limits. Log Interval specifies the universal data sampling frequency for all modes & PDF reports.</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {savedSuccess && (
              <span style={{ color: '#16a34a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Check size={18} /> SETTINGS SAVED!
              </span>
            )}
            <button
              className="btn-primary"
              style={{ padding: '12px 32px', fontSize: '1.05rem' }}
              onClick={handleSave}
            >
              <Save size={20} />
              <span>SAVE ENG SETTINGS</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
