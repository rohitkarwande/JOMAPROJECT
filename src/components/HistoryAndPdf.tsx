import React, { useState } from 'react';
import { TelemetryPoint, TestSession } from '../types/scada';
import { FileText, Download, Eye, Trash2, Calendar } from 'lucide-react';
import { JomaLogo } from './JomaLogo';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface HistoryAndPdfProps {
  sessions: TestSession[];
  onDeleteSession: (id: string) => void;
  chartContainerRef: React.RefObject<HTMLDivElement | null>;
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
  ctx.fillText(`Voltage (Vmon) - Peak: ${Math.max(...vValues, 0).toFixed(2)}V`, margin.left + 32, 30);

  // Current Legend
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(margin.left + 360, 18, 22, 12);
  ctx.fillText(`Current (Imon) - Peak: ${Math.max(...iValues, 0).toFixed(2)}A`, margin.left + 392, 30);

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
  onDeleteSession,
  chartContainerRef
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

    // 1. Header Banner
    doc.setFillColor(9, 13, 20);
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(6, 182, 212);
    doc.text('JOMA NEXT GEN POWER - SCADA TEST REPORT', 14, 14);

    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(`TEST ID: ${session.id}`, 14, 21);
    doc.text(`DATE: ${session.startTime}`, pageWidth - 60, 21);

    // 2. Test Configuration Table
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('1. TEST CONFIGURATION & MODE METRICS', 14, 38);

    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.text(`Operation Mode: ${session.mode}`, 14, 46);
    doc.text(`Target Voltage: ${session.setpointV.toFixed(2)} V`, 14, 52);
    doc.text(`Target Current: ${session.setpointI.toFixed(2)} A`, 14, 58);
    doc.text(`Hardware Profile: ${session.deviceProfileName || 'JOMA SCADA Simulator'}`, 14, 64);
    doc.text(`Duration: ${formatDuration(session.durationSeconds)}`, pageWidth / 2, 46);
    doc.text(`Status: ${session.status}`, pageWidth / 2, 52);
    if (session.capacityAh) {
      doc.text(`Capacity (Ah): ${session.capacityAh.toFixed(3)} Ah`, pageWidth / 2, 58);
    }

    // 3. Performance Summary Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('2. PERFORMANCE TELEMETRY SUMMARY', 14, 70);

    // Draw Summary Table Box
    doc.setFillColor(241, 245, 249);
    doc.rect(14, 74, pageWidth - 28, 20, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.rect(14, 74, pageWidth - 28, 20, 'S');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text('Max Voltage', 20, 81);
    doc.text('Min Voltage', 60, 81);
    doc.text('Max Current', 100, 81);
    doc.text('Avg Current', 140, 81);
    doc.text('Avg Power', 170, 81);

    doc.setFont('helvetica', 'normal');
    doc.text(`${session.maxVoltage.toFixed(2)} V`, 20, 89);
    doc.text(`${session.minVoltage.toFixed(2)} V`, 60, 89);
    doc.text(`${session.maxCurrent.toFixed(2)} A`, 100, 89);
    doc.text(`${session.avgCurrent.toFixed(2)} A`, 140, 89);
    doc.text(`${session.avgPower.toFixed(2)} W`, 170, 89);

    let currentY = 102;

    // 4. Embedded Telemetry Trend Graph (Offscreen Canvas Renderer)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('3. REAL-TIME TELEMETRY GRAPH (V-I TREND)', 14, currentY);

    const graphImageData = renderTelemetryChartCanvas(session.logs);
    if (graphImageData) {
      doc.addImage(graphImageData, 'PNG', 14, currentY + 4, pageWidth - 28, 72);
      currentY += 83;
    } else {
      currentY += 10;
    }

    // 5. Sample Telemetry Log Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('4. TIMESTAMPED TELEMETRY LOGS (SAMPLES)', 14, currentY);
    currentY += 6;

    // Table Headers
    doc.setFillColor(226, 232, 240);
    doc.rect(14, currentY, pageWidth - 28, 7, 'F');
    doc.setFontSize(8.5);
    doc.text('Timestamp', 18, currentY + 5);
    doc.text('Voltage (Vmon)', 60, currentY + 5);
    doc.text('Current (Imon)', 110, currentY + 5);
    doc.text('Power (Pmon)', 160, currentY + 5);
    currentY += 9;

    doc.setFont('helvetica', 'normal');
    const logsToPrint = session.logs ? session.logs.slice(0, 10) : [];
    logsToPrint.forEach((log) => {
      if (currentY > 265) {
        doc.addPage();
        currentY = 20;
      }
      doc.text(log.timestamp, 18, currentY);
      doc.text(`${log.vmon.toFixed(2)} V`, 60, currentY);
      doc.text(`${log.imon.toFixed(2)} A`, 110, currentY);
      doc.text(`${log.pmon.toFixed(2)} W`, 160, currentY);
      currentY += 6;
    });

    // 6. Operator Signature Block
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
        const res = await window.electronAPI.pdf.savePdf(`JOMA_SCADA_Report_${session.id}.pdf`, base64);
        if (res.success) {
          alert(`PDF Report saved successfully at:\n${res.filePath}`);
        }
      } else {
        pdf.save(`JOMA_SCADA_Report_${session.id}.pdf`);
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
                    <td style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{s.maxVoltage.toFixed(2)} V</td>
                    <td style={{ color: 'var(--accent-green)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{s.maxCurrent.toFixed(2)} A</td>
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
                  <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '6px', fontWeight: 600 }}>SCADA TEST REPORT & TELEMETRY SUMMARY</p>
                </div>
                <div style={{ textAlign: 'right', fontSize: '0.85rem' }}>
                  <p><strong>TEST ID:</strong> {selectedSession.id}</p>
                  <p><strong>DATE:</strong> {selectedSession.startTime}</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px', background: '#f8fafc', padding: '16px', borderRadius: '8px' }}>
                <div>
                  <p><strong>Operation Mode:</strong> {selectedSession.mode}</p>
                  <p><strong>Target Voltage:</strong> {selectedSession.setpointV.toFixed(2)} V</p>
                  <p><strong>Target Current:</strong> {selectedSession.setpointI.toFixed(2)} A</p>
                  <p><strong>Hardware Profile:</strong> {selectedSession.deviceProfileName || 'JOMA SCADA Simulator'}</p>
                </div>
                <div>
                  <p><strong>Duration:</strong> {formatDuration(selectedSession.durationSeconds)}</p>
                  <p><strong>Status:</strong> {selectedSession.status}</p>
                  {selectedSession.capacityAh && <p><strong>Capacity (Ah):</strong> {selectedSession.capacityAh.toFixed(3)} Ah</p>}
                </div>
              </div>

              <h4 style={{ marginBottom: '10px', color: '#0f172a' }}>Performance Summary</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#e2e8f0' }}>
                    <th style={{ padding: '8px', border: '1px solid #cbd5e1' }}>Max V</th>
                    <th style={{ padding: '8px', border: '1px solid #cbd5e1' }}>Min V</th>
                    <th style={{ padding: '8px', border: '1px solid #cbd5e1' }}>Max I</th>
                    <th style={{ padding: '8px', border: '1px solid #cbd5e1' }}>Avg I</th>
                    <th style={{ padding: '8px', border: '1px solid #cbd5e1' }}>Avg P</th>
                  </tr>
                </thead>
                <tbody style={{ textAlign: 'center' }}>
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{selectedSession.maxVoltage.toFixed(2)} V</td>
                    <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{selectedSession.minVoltage.toFixed(2)} V</td>
                    <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{selectedSession.maxCurrent.toFixed(2)} A</td>
                    <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{selectedSession.avgCurrent.toFixed(2)} A</td>
                    <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{selectedSession.avgPower.toFixed(2)} W</td>
                  </tr>
                </tbody>
              </table>

              <h4 style={{ marginBottom: '10px', color: '#0f172a' }}>Real-Time Telemetry Graph (V-I Trend)</h4>
              <div style={{ border: '1px solid #cbd5e1', borderRadius: '6px', padding: '8px', marginBottom: '20px', textAlign: 'center', background: '#ffffff' }}>
                <img
                  src={renderTelemetryChartCanvas(selectedSession.logs)}
                  alt="V-I Trend Graph"
                  style={{ width: '100%', height: 'auto', borderRadius: '4px', display: 'block' }}
                />
              </div>

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
