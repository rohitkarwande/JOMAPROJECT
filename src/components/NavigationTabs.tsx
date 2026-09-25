import React from 'react';
import { OperationMode } from '../types/scada';
import { LayoutDashboard, FileText, Settings, ShieldAlert, BatteryCharging, Zap, RefreshCw, Cpu, Lock } from 'lucide-react';

interface NavigationTabsProps {
  currentMode: OperationMode;
  onSelectMode: (mode: OperationMode) => void;
  activeView: 'dashboard' | 'history' | 'settings' | 'engSettings';
  onSelectView: (view: 'dashboard' | 'history' | 'settings' | 'engSettings') => void;
  isTestRunning?: boolean;
}

const MODES: { id: OperationMode; label: string; icon: React.ReactNode }[] = [
  { id: 'CV', label: 'CV MODE', icon: <Zap size={16} /> },
  { id: 'CC', label: 'CC MODE', icon: <RefreshCw size={16} /> },
  { id: 'CR', label: 'CR MODE', icon: <ShieldAlert size={16} /> },
  { id: 'CP', label: 'CP MODE', icon: <Zap size={16} /> },
  { id: 'BAT TEST', label: 'BAT TEST MODE', icon: <BatteryCharging size={16} /> },
];

export const NavigationTabs: React.FC<NavigationTabsProps> = ({
  currentMode,
  onSelectMode,
  activeView,
  onSelectView,
  isTestRunning = false,
}) => {
  return (
    <div className="mode-tabs-bar">
      {/* View Switchers */}
      <button
        className={`btn-nav-tab ${activeView === 'dashboard' ? 'active' : ''}`}
        onClick={() => onSelectView('dashboard')}
      >
        <LayoutDashboard size={18} />
        <span>Control Dashboard</span>
      </button>

      <button
        className={`btn-nav-tab ${activeView === 'engSettings' ? 'active' : ''}`}
        onClick={() => onSelectView('engSettings')}
      >
        <Cpu size={18} />
        <span>ENG SETTING</span>
      </button>

      <button
        className={`btn-nav-tab ${activeView === 'history' ? 'active' : ''}`}
        onClick={() => onSelectView('history')}
      >
        <FileText size={18} />
        <span>History & PDF Reports</span>
      </button>

      <button
        className={`btn-nav-tab ${activeView === 'settings' ? 'active' : ''}`}
        onClick={() => onSelectView('settings')}
      >
        <Settings size={18} />
        <span>RS485 Settings</span>
      </button>

      <div style={{ width: '1px', background: 'rgba(51, 65, 85, 0.6)', margin: '0 8px' }} />

      {/* 5 Hardware Mode Tabs */}
      {MODES.map((m) => {
        const isDisabled = isTestRunning && currentMode !== m.id;
        return (
          <button
            key={m.id}
            disabled={isDisabled}
            title={isDisabled ? 'Mode switching locked during active test. Turn Output OFF first.' : ''}
            className={`btn-mode-tab ${currentMode === m.id ? 'active' : ''}`}
            onClick={() => {
              if (isTestRunning) return;
              onSelectMode(m.id);
              if (activeView !== 'dashboard') onSelectView('dashboard');
            }}
          >
            {m.icon}
            <span>{m.label}</span>
            {isTestRunning && currentMode === m.id && (
              <Lock size={12} style={{ color: '#ffffff', marginLeft: '2px' }} />
            )}
          </button>
        );
      })}
    </div>
  );
};
