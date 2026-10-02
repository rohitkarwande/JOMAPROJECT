import React, { useState } from 'react';
import { formatCurrent, formatVoltage, TelemetryPoint, TestSession } from '../types/scada';
import { FileText, Download, Eye, Trash2, Calendar } from 'lucide-react';
import { JomaLogo } from './JomaLogo';
import jsPDF from 'jspdf';

interface HistoryAndPdfProps {
  sessions: TestSession[];
  onDeleteSession: (id: string) => void;
  chartContainerRef: React.RefObject<HTMLDivElement | null>;
}

function getModeSetpointString(session: TestSession): string {
  if (session.isSequenceTest && session.sequenceStepsConfig && session.sequenceStepsConfig.length > 0) {
    return session.sequenceStepsConfig
      .map((s, idx) => {
        const mode = s.mode || session.mode;
        const val = (mode.includes('CV') || mode === 'CV') ? `${formatVoltage(s.setpointV ?? session.setpointV)} V` :
                    (mode.includes('CC') || mode === 'CC') ? `${formatCurrent(s.setpointI ?? session.setpointI)} A` :
                    (mode.includes('CR') || mode === 'CR') ? `${(s.setpointR ?? session.setpointR ?? 10.0).toFixed(2)} Ω` :
                    `${(s.setpointP ?? session.setpointP ?? 120.0).toFixed(2)} W`;
        return `Step ${idx + 1}: ${val}`;
      })
      .join(' | ');
  }

  const mode = String(session.mode).toUpperCase();
  if (mode.includes('CV')) return `${formatVoltage(session.setpointV)} V`;
  if (mode.includes('CC')) return `${formatCurrent(session.setpointI)} A`;
  if (mode.includes('CR')) return `${(session.setpointR || 10.0).toFixed(2)} Ω`;
  if (mode.includes('CP')) return `${(session.setpointP || 120.0).toFixed(2)} W`;
  if (mode.includes('BAT')) {
    if (session.setpointI && session.setpointI > 0) return `${formatCurrent(session.setpointI)} A (Cutoff: ${formatVoltage(session.cutoffV || 0)} V)`;
    if (session.setpointR && session.setpointR > 0) return `${session.setpointR.toFixed(2)} Ω (Cutoff: ${formatVoltage(session.cutoffV || 0)} V)`;
    return `Cutoff: ${formatVoltage(session.cutoffV || 0)} V`;
  }
  return `${formatVoltage(session.setpointV)} V`;
}

function getLogSetpoint(session: TestSession, log: TelemetryPoint, logIndex: number): string {
  if (log.activeSetpoint) {
    return log.activeSetpoint;
  }

  if (session.isSequenceTest && session.sequenceStepsConfig && session.sequenceStepsConfig.length > 0) {
    const steps = session.sequenceStepsConfig;
    const totalCycleSecs = steps.reduce((sum, s) => sum + (s.totalDurationSeconds || 0), 0);
    
    if (totalCycleSecs > 0 && session.logs && session.logs.length > 0) {
      const startSec = session.logs[0].timeSeconds || 0;
      const elapsed = Math.max(0, (log.timeSeconds || startSec) - startSec);
      const cycleElapsed = elapsed % totalCycleSecs;

      let accumulated = 0;
      for (const step of steps) {
        accumulated += (step.totalDurationSeconds || 0);
        if (cycleElapsed < accumulated) {
          const mode = step.mode || session.mode;
          if (mode.includes('CV') || mode === 'CV') return `${formatVoltage(step.setpointV ?? session.setpointV)} V`;
          if (mode.includes('CC') || mode === 'CC') return `${formatCurrent(step.setpointI ?? session.setpointI)} A`;
          if (mode.includes('CR') || mode === 'CR') return `${(step.setpointR ?? session.setpointR ?? 10.0).toFixed(2)} Ω`;
          if (mode.includes('CP') || mode === 'CP') return `${(step.setpointP ?? session.setpointP ?? 120.0).toFixed(2)} W`;
        }
      }
    }

    if (session.logs && session.logs.length > 0) {
      const logRatio = logIndex / Math.max(session.logs.length - 1, 1);
      const stepIdx = Math.min(steps.length - 1, Math.floor(logRatio * steps.length));
      const step = steps[stepIdx];
      if (step) {
        const mode = step.mode || session.mode;
        if (mode.includes('CV') || mode === 'CV') return `${formatVoltage(step.setpointV ?? session.setpointV)} V`;
        if (mode.includes('CC') || mode === 'CC') return `${formatCurrent(step.setpointI ?? session.setpointI)} A`;
        if (mode.includes('CR') || mode === 'CR') return `${(step.setpointR ?? session.setpointR ?? 10.0).toFixed(2)} Ω`;
        if (mode.includes('CP') || mode === 'CP') return `${(step.setpointP ?? session.setpointP ?? 120.0).toFixed(2)} W`;
      }
    }
  }

  return getModeSetpointString(session);
}

function renderJomaLogoDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 500;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#028bda';
  ctx.font = '900 110px "Segoe UI", Arial, sans-serif';
  ctx.fillText('JOMA', 10, 120);

  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(10, 138, 260, 8);
  ctx.fillStyle = '#028bda';
  ctx.fillRect(10, 152, 260, 8);

  ctx.fillStyle = '#475569';
  ctx.font = 'bold italic 34px "Segoe UI", Arial, sans-serif';
  ctx.fillText('Next Gen Power', 280, 155);

  return canvas.toDataURL('image/png');
}

// Offscreen canvas chart generator ensuring every session has a crisp, perfectly scaled V-I trend curve in PDF
function renderTelemetryChartCanvas(logs: TelemetryPoint[]): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Clean White Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const margin = { top: 60, right: 80, bottom: 60, left: 80 };
  const graphWidth = canvas.width - margin.left - margin.right;
  const graphHeight = canvas.height - margin.top - margin.bottom;

  // Compute Scales with 25% upper headroom so curves hover in center
  const vValues = logs && logs.length > 0 ? logs.map((l) => l.vmon) : [0];
  const iValues = logs && logs.length > 0 ? logs.map((l) => l.imon) : [0];
  const rawMaxV = Math.max(...vValues, 10);
  const rawMaxI = Math.max(...iValues, 5);

  const scaleMaxV = Math.ceil(rawMaxV * 1.25);
  const scaleMaxI = Math.ceil(rawMaxI * 1.25);

  // Outer Chart Box & Gridlines
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;

  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const y = margin.top + (graphHeight / steps) * i;
    const vTick = ((steps - i) / steps) * scaleMaxV;
    const iTick = ((steps - i) / steps) * scaleMaxI;

    // Horizontal Gridline
    ctx.beginPath();
    ctx.strokeStyle = '#f1f5f9';
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + graphWidth, y);
    ctx.stroke();

    // Left Y-Axis Tick Label (Voltage - Blue)
    ctx.fillStyle = '#0284c7';
    ctx.font = 'bold 13px Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${vTick.toFixed(1)}V`, margin.left - 12, y + 4);

    // Right Y-Axis Tick Label (Current - Green)
    ctx.fillStyle = '#16a34a';
    ctx.font = 'bold 13px Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${iTick.toFixed(1)}A`, margin.left + graphWidth + 12, y + 4);
  }

  // Draw Graph Boundary Box
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.strokeRect(margin.left, margin.top, graphWidth, graphHeight);

  if (!logs || logs.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 18px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No Telemetry Data Recorded For This Session', canvas.width / 2, canvas.height / 2);
    return canvas.toDataURL('image/png');
  }

  // Draw Voltage Curve (Blue #0284c7)
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  logs.forEach((log, index) => {
    const x = margin.left + (index / Math.max(logs.length - 1, 1)) * graphWidth;
    const y = margin.top + graphHeight - (log.vmon / scaleMaxV) * graphHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Draw Voltage Data Point Circles
  ctx.fillStyle = '#0284c7';
  logs.forEach((log, index) => {
    if (logs.length <= 30 || index % Math.ceil(logs.length / 20) === 0) {
      const x = margin.left + (index / Math.max(logs.length - 1, 1)) * graphWidth;
      const y = margin.top + graphHeight - (log.vmon / scaleMaxV) * graphHeight;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Draw Current Curve (Green #16a34a)
  ctx.strokeStyle = '#16a34a';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  logs.forEach((log, index) => {
    const x = margin.left + (index / Math.max(logs.length - 1, 1)) * graphWidth;
    const y = margin.top + graphHeight - (log.imon / scaleMaxI) * graphHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Draw Current Data Point Circles
  ctx.fillStyle = '#16a34a';
  logs.forEach((log, index) => {
    if (logs.length <= 30 || index % Math.ceil(logs.length / 20) === 0) {
      const x = margin.left + (index / Math.max(logs.length - 1, 1)) * graphWidth;
      const y = margin.top + graphHeight - (log.imon / scaleMaxI) * graphHeight;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Top Legends & Header Banner
  ctx.font = 'bold 15px Segoe UI, sans-serif';

  // Voltage Legend
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(margin.left, 18, 22, 12);
  ctx.fillText(`Voltage (Vmon) - Peak: ${formatVoltage(Math.max(...vValues, 0))}V`, margin.left + 32, 30);

  // Current Legend
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(margin.left + 360, 18, 22, 12);
  ctx.fillText(`Current (Imon) - Peak: ${formatCurrent(Math.max(...iValues, 0))}A`, margin.left + 392, 30);

  // X-Axis Timestamp Labels
  ctx.fillStyle = '#475569';
  ctx.font = 'bold 12px Segoe UI, sans-serif';

  const sampleCount = Math.min(5, logs.length);
  for (let k = 0; k < sampleCount; k++) {
    const logIndex = Math.floor((k / Math.max(sampleCount - 1, 1)) * (logs.length - 1));
    const logItem = logs[logIndex];
    const xPos = margin.left + (logIndex / Math.max(logs.length - 1, 1)) * graphWidth;

    ctx.textAlign = k === 0 ? 'left' : k === sampleCount - 1 ? 'right' : 'center';
    ctx.fillText(logItem.timestamp, xPos, canvas.height - 22);
  }

  return canvas.toDataURL('image/png');
}

export const HistoryAndPdf: React.FC<HistoryAndPdfProps> = ({
  sessions,
  onDeleteSession
}) => {
  const [selectedSession, setSelectedSession] = useState<TestSession | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  };

  const handleOpenPreview = (session: TestSession) => {
    setSelectedSession(session);
    setIsPreviewOpen(true);
  };

  const generatePdfBlob = async (session: TestSession): Promise<{ pdf: jsPDF; base64: string }> => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();

    // 1. Top Header Banner with JOMA Logo
    doc.setFillColor(15, 23, 42); // Dark Navy #0f172a
    doc.rect(0, 0, pageWidth, 32, 'F');

    const logoPng = renderJomaLogoDataUrl();
    if (logoPng) {
      doc.addImage(logoPng, 'PNG', 12, 4, 60, 22.5);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(56, 189, 248); // Cyan
    doc.text('TEST REPORT & TELEMETRY SUMMARY', 78, 16);

    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`TEST ID: ${session.id}`, 78, 24);
    doc.text(`DATE: ${session.startTime}`, pageWidth - 65, 24);

    // 2. Test Configuration Section
    let currentY = 42;
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.text('1. TEST CONFIGURATION & MODE PARAMETERS', 14, currentY);

    currentY += 7;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    const modeSetpoint = getModeSetpointString(session);

    doc.text(`Operation Mode: ${session.mode}`, 14, currentY);
    doc.text(`Mode Setpoint Target: ${modeSetpoint}`, 14, currentY + 6);
    doc.text(`Hardware Profile: ${session.deviceProfileName || 'JOMA Power Simulator'}`, 14, currentY + 12);
    doc.text(`Duration: ${formatDuration(session.durationSeconds)}`, pageWidth / 2 + 10, currentY);
    doc.text(`Status: ${session.status}`, pageWidth / 2 + 10, currentY + 6);

    currentY += 22;

    // 3. Real-Time Telemetry Trend Graph
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('2. REAL-TIME TELEMETRY GRAPH (V-I TREND)', 14, currentY);

    const graphImageData = renderTelemetryChartCanvas(session.logs);
    if (graphImageData) {
      doc.addImage(graphImageData, 'PNG', 14, currentY + 4, pageWidth - 28, 75);
      currentY += 86;
    } else {
      currentY += 10;
    }

    // 4. Timestamped Telemetry Log Table (Power Column Removed, Mode Setpoint Added)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('3. TIMESTAMPED TELEMETRY LOGS (SAMPLES)', 14, currentY);
    currentY += 6;

    // Table Headers
    doc.setFillColor(226, 232, 240);
    doc.rect(14, currentY, pageWidth - 28, 7, 'F');
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text('Timestamp', 18, currentY + 5);
    doc.text('Mode Setpoint', 68, currentY + 5);
    doc.text('Voltage (Vmon)', 118, currentY + 5);
    doc.text('Current (Imon)', 162, currentY + 5);
    currentY += 9;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    const logsToPrint = session.logs ? session.logs.slice(0, 15) : [];
    logsToPrint.forEach((log, logIdx) => {
      if (currentY > 265) {
        doc.addPage();
        currentY = 20;
      }
      doc.text(log.timestamp, 18, currentY);
      doc.text(getLogSetpoint(session, log, logIdx), 68, currentY);
      doc.text(`${formatVoltage(log.vmon)} V`, 118, currentY);
      doc.text(`${formatCurrent(log.imon)} A`, 162, currentY);
      currentY += 6;
    });

    // 5. Operator Signature Block
    const signY = 270;
    doc.setDrawColor(148, 163, 184);
    doc.line(14, signY, 70, signY);
    doc.line(pageWidth - 70, signY, pageWidth - 14, signY);

    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('OPERATOR SIGNATURE', 14, signY + 4);
    doc.text('QUALITY ASSURANCE STAMP', pageWidth - 70, signY + 4);

    const base64 = doc.output('datauristring').split(',')[1];
    return { pdf: doc, base64 };
  };

  const handleExportPdf = async (session: TestSession) => {
    try {
      setIsGenerating(true);
      const { pdf, base64 } = await generatePdfBlob(session);

      if (window.electronAPI) {
        const res = await window.electronAPI.pdf.savePdf(`JOMA_Report_${session.id}.pdf`, base64);
        if (res.success) {
          alert(`PDF Report saved successfully at:\n${res.filePath}`);
        }
      } else {
        pdf.save(`JOMA_Report_${session.id}.pdf`);
      }
    } catch (err: any) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="content-page">
      <div className="card-panel">
        <div className="panel-title">
          <FileText size={22} />
          <span>TEST SESSION HISTORY & PDF REPORT GENERATOR</span>
        </div>

        {sessions.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Calendar size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
            <p style={{ fontFamily: 'var(--font-main)', fontWeight: 600 }}>NO COMPLETED TEST SESSIONS RECORDED YET.</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: '4px' }}>
              Turn hardware output ON and execute a test in the Control Dashboard to record session logs.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Session ID</th>
                  <th>Date & Time</th>
                  <th>Mode</th>
                  <th>Duration</th>
                  <th>Max V</th>
                  <th>Max I</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-blue)' }}>{s.id}</td>
                    <td>{s.startTime}</td>
                    <td>
                      <span className="active-mode-tag" style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
                        {s.mode}
                      </span>
                    </td>
                    <td>{formatDuration(s.durationSeconds)}</td>
                    <td style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatVoltage(s.maxVoltage)} V</td>
                    <td style={{ color: 'var(--accent-green)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatCurrent(s.maxCurrent)} A</td>
                    <td>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        background: s.status === 'COMPLETED' ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                        color: s.status === 'COMPLETED' ? 'var(--accent-green)' : 'var(--accent-red)'
                      }}>
                        {s.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                          className="btn-secondary"
                          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                          onClick={() => handleOpenPreview(s)}
                        >
                          <Eye size={14} />
                          <span>Preview</span>
                        </button>

                        <button
                          className="btn-primary"
                          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                          onClick={() => handleExportPdf(s)}
                          disabled={isGenerating}
                        >
                          <Download size={14} />
                          <span>{isGenerating ? 'Generating...' : 'Save PDF'}</span>
                        </button>

                        <button
                          className="btn-secondary"
                          style={{ padding: '6px 10px', color: 'var(--accent-red)' }}
                          onClick={() => onDeleteSession(s.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inline PDF Document Preview Modal */}
      {isPreviewOpen && selectedSession && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <FileText size={20} style={{ color: 'var(--accent-blue)' }} />
                <span style={{ fontFamily: 'var(--font-main)', fontWeight: 700, fontSize: '1.05rem' }}>
                  PDF REPORT PREVIEW - {selectedSession.id}
                </span>
              </div>
              <button
                className="btn-secondary"
                style={{ padding: '4px 10px' }}
                onClick={() => setIsPreviewOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ background: '#ffffff', color: '#0f172a', borderRadius: '8px', padding: '32px' }}>
              {/* Document Mock Preview Header */}
              <div style={{ borderBottom: '2px solid #0284c7', paddingBottom: '16px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <JomaLogo height={40} />
                  <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '6px', fontWeight: 600 }}>TEST REPORT & TELEMETRY SUMMARY</p>
                </div>
                <div style={{ textAlign: 'right', fontSize: '0.85rem' }}>
                  <p><strong>TEST ID:</strong> {selectedSession.id}</p>
                  <p><strong>DATE:</strong> {selectedSession.startTime}</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px', background: '#f8fafc', padding: '16px', borderRadius: '8px' }}>
                <div>
                  <p><strong>Operation Mode:</strong> {selectedSession.mode}</p>
                  <p><strong>Mode Setpoint:</strong> {getModeSetpointString(selectedSession)}</p>
                  <p><strong>Hardware Profile:</strong> {selectedSession.deviceProfileName || 'JOMA Power Simulator'}</p>
                </div>
                <div>
                  <p><strong>Duration:</strong> {formatDuration(selectedSession.durationSeconds)}</p>
                  <p><strong>Status:</strong> {selectedSession.status}</p>
                  {selectedSession.isSequenceTest && <p><strong>Configured Cycles:</strong> {selectedSession.sequenceCycles || 1}</p>}
                </div>
              </div>

              {selectedSession.isSequenceTest && selectedSession.sequenceStepsConfig && selectedSession.sequenceStepsConfig.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ marginBottom: '8px', color: '#0f172a' }}>Configured Test Sequence Steps</h4>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9' }}>
                        <th style={{ padding: '6px 8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Step #</th>
                        <th style={{ padding: '6px 8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Duration</th>
                        <th style={{ padding: '6px 8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Mode</th>
                        <th style={{ padding: '6px 8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Setpoint</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSession.sequenceStepsConfig.map((step, idx) => (
                        <tr key={idx}>
                          <td style={{ padding: '6px 8px', border: '1px solid #cbd5e1' }}>Step {step.stepNumber}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #cbd5e1' }}>{step.totalDurationSeconds}s</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #cbd5e1', fontWeight: 700 }}>{step.mode}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #cbd5e1' }}>
                            {step.mode === 'CV' ? `${step.setpointV} V` : (step.mode === 'CC' ? `${step.setpointI} A` : (step.mode === 'CR' ? `${step.setpointR} Ω` : `${step.setpointP} W`))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h4 style={{ marginBottom: '10px', color: '#0f172a' }}>Real-Time Telemetry Graph (V-I Trend)</h4>
              <div style={{ border: '1px solid #cbd5e1', borderRadius: '6px', padding: '8px', marginBottom: '20px', textAlign: 'center', background: '#ffffff' }}>
                <img
                  src={renderTelemetryChartCanvas(selectedSession.logs)}
                  alt="V-I Trend Graph"
                  style={{ width: '100%', height: 'auto', borderRadius: '4px', display: 'block' }}
                />
              </div>

              <h4 style={{ marginBottom: '10px', color: '#0f172a' }}>Timestamped Telemetry Logs (Samples)</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#e2e8f0' }}>
                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Timestamp</th>
                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Mode Setpoint</th>
                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Voltage (Vmon)</th>
                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Current (Imon)</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedSession.logs ? selectedSession.logs.slice(0, 10) : []).map((log, idx) => (
                    <tr key={idx}>
                      <td style={{ padding: '6px 8px', border: '1px solid #cbd5e1' }}>{log.timestamp}</td>
                      <td style={{ padding: '6px 8px', border: '1px solid #cbd5e1', fontWeight: 600 }}>{getLogSetpoint(selectedSession, log, idx)}</td>
                      <td style={{ padding: '6px 8px', border: '1px solid #cbd5e1', color: '#0284c7', fontWeight: 700 }}>{formatVoltage(log.vmon)} V</td>
                      <td style={{ padding: '6px 8px', border: '1px solid #cbd5e1', color: '#16a34a', fontWeight: 700 }}>{formatCurrent(log.imon)} A</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: '40px', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #94a3b8', paddingTop: '8px', fontSize: '0.8rem', color: '#64748b' }}>
                <span>OPERATOR SIGNATURE</span>
                <span>QUALITY ASSURANCE STAMP</span>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setIsPreviewOpen(false)}
              >
                Close Preview
              </button>

              <button
                className="btn-primary"
                onClick={() => handleExportPdf(selectedSession)}
              >
                <Download size={16} />
                <span>Save as PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
