import React, { useEffect, useState } from 'react';
import { Activity, Clock, Cpu } from 'lucide-react';
import { OperationMode } from '../types/scada';
import { JomaLogo } from './JomaLogo';

interface HeaderProps {
  activeMode: OperationMode;
  batTestSubMode?: 'CC' | 'CR';
  connectionStatus: 'CONNECTED' | 'DISCONNECTED' | 'SIMULATOR';
  activeTab: 'dashboard' | 'history' | 'settings' | 'engSettings';
}

export const Header: React.FC<HeaderProps> = ({
  activeMode,
  batTestSubMode = 'CC',
  connectionStatus,
}) => {
  const [timeStr, setTimeStr] = useState<string>('');
  const [dateStr, setDateStr] = useState<string>('');

  const modeLabel = activeMode === 'BAT TEST' ? `BAT TEST (${batTestSubMode} MODE)` : `${activeMode} MODE`;

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

  return (
    <header className="header-bar">
      <div className="brand-section">
        <div className="logo-badge" style={{ background: '#ffffff', border: '1px solid var(--border-color)', padding: '4px 10px', borderRadius: '6px' }}>
          <JomaLogo height={30} />
        </div>
        <div className="active-mode-tag">
          {modeLabel}
        </div>
      </div>

      <div className="header-center">
        <Clock size={16} className="text-cyan-400" />
        <span>{timeStr}</span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span>{dateStr}</span>
      </div>

      <div className="header-right">
        <div className={`status-badge ${connectionStatus.toLowerCase()}`}>
          <div className="status-dot"></div>
          {connectionStatus === 'SIMULATOR' && (
            <>
              <Cpu size={14} />
              <span>SIMULATOR MODE</span>
            </>
          )}
          {connectionStatus === 'CONNECTED' && (
            <>
              <Activity size={14} />
              <span>CONNECTED (RS485)</span>
            </>
          )}
          {connectionStatus === 'DISCONNECTED' && (
            <span>DISCONNECTED</span>
          )}
        </div>
      </div>
    </header>
  );
};
