import React from 'react';
import { OperationMode } from '../types/scada';
import { LayoutDashboard, FileText, Settings, ShieldAlert, BatteryCharging, Zap, RefreshCw, Cpu, Lock, ListChecks } from 'lucide-react';

export type ActiveViewType = 'dashboard' | 'sequence' | 'history' | 'settings' | 'engSettings';

interface NavigationTabsProps {
  currentMode: OperationMode;
  onSelectMode: (mode: OperationMode) => void;
  activeView: ActiveViewType;
  onSelectView: (view: ActiveViewType) => void;
  isOutputOn?: boolean;
  isTestRunning?: boolean;
  protocolType?: 'RS485' | 'RS232';
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
  isOutputOn = false,
  isTestRunning = false,
  protocolType = 'RS485',
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
        onClick={() => {
          if (isOutputOn) return;
          onSelectView('engSettings');
        }}
        disabled={isOutputOn}
        title={isOutputOn ? 'Output is ON — Engineering Settings locked. Turn Output OFF first.' : ''}
        style={isOutputOn ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
      >
        <Cpu size={18} />
        <span>ENG SETTING</span>
        {isOutputOn && <Lock size={12} style={{ color: '#ef4444', marginLeft: '4px' }} />}
      </button>

      <button
        className={`btn-nav-tab ${activeView === 'history' ? 'active' : ''}`}
        onClick={() => {
          if (isOutputOn) return;
          onSelectView('history');
        }}
        disabled={isOutputOn}
        title={isOutputOn ? 'Output is ON — Screen navigation locked. Turn Output OFF first.' : ''}
        style={isOutputOn ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
      >
        <FileText size={18} />
        <span>History & PDF Reports</span>
        {isOutputOn && <Lock size={12} style={{ color: '#ef4444', marginLeft: '4px' }} />}
      </button>

      <button
        className={`btn-nav-tab ${activeView === 'settings' ? 'active' : ''}`}
        onClick={() => {
          if (isOutputOn) return;
          onSelectView('settings');
        }}
        disabled={isOutputOn}
        title={isOutputOn ? `Output is ON — ${protocolType} Settings locked. Turn Output OFF first.` : ''}
        style={isOutputOn ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
      >
        <Settings size={18} />
        <span>{protocolType} Settings</span>
        {isOutputOn && <Lock size={12} style={{ color: '#ef4444', marginLeft: '4px' }} />}
      </button>

      <div style={{ width: '1px', background: 'rgba(51, 65, 85, 0.6)', margin: '0 8px' }} />

      {/* 5 Hardware Mode Tabs */}
      {MODES.map((m) => {
        const isCurrent = currentMode === m.id;
        const isDisabled = (isTestRunning || isOutputOn) && !isCurrent;
        const tooltip = isOutputOn
          ? (isCurrent ? 'Current active mode (Output is ON)' : 'Output is ON — Mode locked. Turn Output OFF to switch modes.')
          : (isTestRunning ? 'Mode switching locked during active test. Turn Output OFF first.' : '');

        return (
          <button
            key={m.id}
            disabled={isDisabled}
            title={tooltip}
            className={`btn-mode-tab ${isCurrent ? 'active' : ''}`}
            style={isDisabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            onClick={() => {
              if (isTestRunning || isOutputOn) return;
              onSelectMode(m.id);
              if (activeView !== 'dashboard') onSelectView('dashboard');
            }}
          >
            {m.icon}
            <span>{m.label}</span>
            {(isTestRunning || isOutputOn) && isCurrent && (
              <Lock size={12} style={{ color: '#ffffff', marginLeft: '4px' }} />
            )}
          </button>
        );
      })}
    </div>
  );
};
