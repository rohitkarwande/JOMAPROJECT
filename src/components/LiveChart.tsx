import React, { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { TelemetryPoint, OperationMode } from '../types/scada';
import { LineChart as ChartIcon, Pause, Play, Trash2, ZoomIn, ZoomOut } from 'lucide-react';

interface LiveChartProps {
  data: TelemetryPoint[];
  onClearData: () => void;
  chartRef?: React.RefObject<HTMLDivElement | null>;
  currentMode?: OperationMode;
  batTestSubMode?: 'CC' | 'CR';
}

export const LiveChart: React.FC<LiveChartProps> = ({
  data,
  onClearData,
  chartRef,
  currentMode = 'CV',
  batTestSubMode = 'CC'
}) => {
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [magnifyFluctuations, setMagnifyFluctuations] = useState<boolean>(true);

  const modeLabel = currentMode === 'BAT TEST' ? `BAT TEST (${batTestSubMode} MODE)` : `${currentMode} MODE`;

  // Take the last 60 data points when streaming
  const displayData = isPaused ? data : data.slice(-60);

  return (
    <div className="main-chart-area" ref={chartRef}>
      <div className="chart-header">
        <div className="chart-title" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <ChartIcon size={20} style={{ color: 'var(--accent-blue)' }} />
          <span>Real-Time V-I Telemetry Trend Graph</span>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: '#eff6ff',
            color: 'var(--accent-blue)',
            border: '1.5px solid #bfdbfe',
            padding: '3px 10px',
            borderRadius: '16px',
            fontSize: '0.8rem',
            fontWeight: 800,
            letterSpacing: '0.3px',
            boxShadow: '0 1px 3px rgba(37, 99, 235, 0.1)'
          }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent-green)', boxShadow: '0 0 6px var(--accent-green)' }}></span>
            <span>{modeLabel}</span>
          </div>
        </div>

        <div className="chart-controls">
          <button
            className="btn-chart-action"
            style={{
              borderColor: magnifyFluctuations ? 'var(--accent-blue)' : 'var(--border-color)',
              color: magnifyFluctuations ? 'var(--accent-blue)' : 'var(--text-muted)',
              background: magnifyFluctuations ? '#eff6ff' : '#f8fafc'
            }}
            onClick={() => setMagnifyFluctuations(!magnifyFluctuations)}
          >
            {magnifyFluctuations ? <ZoomIn size={14} /> : <ZoomOut size={14} />}
            <span>{magnifyFluctuations ? 'Magnified Waves' : 'Full Scale'}</span>
          </button>

          <button
            className="btn-chart-action"
            onClick={() => setIsPaused(!isPaused)}
          >
            {isPaused ? <Play size={14} /> : <Pause size={14} />}
            <span>{isPaused ? 'Resume Stream' : 'Pause View'}</span>
          </button>

          <button
            className="btn-chart-action"
            onClick={onClearData}
          >
            <Trash2 size={14} />
            <span>Clear Graph</span>
          </button>
        </div>
      </div>

      <div style={{ width: '100%', height: '360px', flex: 1, marginTop: '8px' }}>
        {data.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-light)', gap: '8px' }}>
            <ChartIcon size={48} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>
              Waiting for telemetry stream... (Turn Output ON to begin recording data)
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={displayData} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="timestamp"
                stroke="#64748b"
                tick={{ fill: '#475569', fontSize: 11 }}
              />
              <YAxis
                yAxisId="left"
                stroke="#0284c7"
                domain={
                  magnifyFluctuations
                    ? [(dataMin: number) => Math.max(0, Math.floor(dataMin - 1)), (dataMax: number) => Math.ceil(dataMax + 1)]
                    : [0, 'auto']
                }
                unit="V"
                tick={{ fill: '#0284c7', fontSize: 12, fontWeight: 700 }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#16a34a"
                domain={
                  magnifyFluctuations
                    ? [(dataMin: number) => Math.max(0, Math.floor(dataMin - 0.5)), (dataMax: number) => Math.ceil(dataMax + 0.5)]
                    : [0, 'auto']
                }
                unit="A"
                tick={{ fill: '#16a34a', fontSize: 12, fontWeight: 700 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderColor: '#cbd5e1',
                  borderRadius: '6px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  fontSize: '0.85rem'
                }}
                labelStyle={{ color: '#0f172a', fontWeight: 700 }}
              />
              <Legend
                wrapperStyle={{ fontSize: '0.85rem', paddingTop: '10px' }}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="vmon"
                name="Voltage (Vmon)"
                stroke="#0284c7"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="imon"
                name="Current (Imon)"
                stroke="#16a34a"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
