import React, { useEffect, useState } from 'react';
import { EngineeringSettings } from '../types/scada';
import { ShieldAlert, Check, Save } from 'lucide-react';
import { JomaLogo } from './JomaLogo';

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
        {/* Header Bar matching Image */}
        <div
          style={{
            background: 'linear-gradient(90deg, #ffffff 0%, #3b82f6 50%, #1e40af 100%)',
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '2px solid #1e3a8a'
          }}
        >
          {/* Brand Logo Box */}
          <div
            style={{
              background: '#ffffff',
              padding: '6px 14px',
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <JomaLogo height={42} />
          </div>

          {/* Title Banner */}
          <div
            style={{
              fontFamily: "'Times New Roman', serif",
              fontWeight: 700,
              fontSize: '2.2rem',
              color: '#0f172a',
              letterSpacing: '2px',
              textShadow: '0 1px 2px rgba(255,255,255,0.8)'
            }}
          >
            ENG SETTING
          </div>

          {/* Live Date / Time */}
          <div
            style={{
              fontFamily: "'Times New Roman', serif",
              fontWeight: 700,
              fontSize: '1.4rem',
              color: '#0f172a',
              textAlign: 'right',
              lineHeight: 1.2
            }}
          >
            <div>{timeStr}</div>
            <div>{dateStr}</div>
          </div>
        </div>

        {/* 2x2 Retro LED Numeric Input Grid matching Image */}
        <div
          style={{
            padding: '48px 36px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '40px 48px',
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
              <input
                type="number"
                step="0.1"
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
                onChange={(e) => handleChange('vmax', parseFloat(e.target.value) || 0)}
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
              <input
                type="number"
                step="0.1"
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
                onChange={(e) => handleChange('pmax', parseFloat(e.target.value) || 0)}
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
              <input
                type="number"
                step="0.1"
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
                onChange={(e) => handleChange('imax', parseFloat(e.target.value) || 0)}
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
              <input
                type="number"
                step="0.1"
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
                onChange={(e) => handleChange('rmax', parseFloat(e.target.value) || 0)}
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
            <span>Note: These values specify global safety cutoff thresholds applicable across all 5 operation modes.</span>
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
