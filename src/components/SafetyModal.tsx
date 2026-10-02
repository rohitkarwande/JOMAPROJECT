import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface SafetyModalProps {
  title?: string;
  message: string;
  onClose: () => void;
}

export const SafetyModal: React.FC<SafetyModalProps> = ({
  title = '⚠️ Safety Limit Warning',
  message,
  onClose
}) => {
  const okButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Focus OK button upon opening
    if (okButtonRef.current) {
      okButtonRef.current.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        padding: '16px',
        animation: 'fadeIn 0.15s ease-out'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '8px',
          border: '2px solid #ef4444',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.5)',
          width: '100%',
          maxWidth: '520px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div
          style={{
            background: 'linear-gradient(90deg, #dc2626 0%, #b91c1c 100%)',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: '#ffffff'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle size={22} style={{ color: '#fef08a', flexShrink: 0 }} />
            <span style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '0.4px' }}>
              {title}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.8)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
              borderRadius: '4px'
            }}
            title="Close warning"
          >
            <X size={18} />
          </button>
        </div>

        {/* Message Body */}
        <div style={{ padding: '22px 24px', color: '#1e293b', fontSize: '0.96rem', lineHeight: '1.5' }}>
          <p style={{ margin: 0, fontWeight: 700, color: '#991b1b', wordBreak: 'break-word', whiteSpace: 'pre-line' }}>
            {message}
          </p>
        </div>

        {/* Action Button Footer */}
        <div
          style={{
            background: '#f8fafc',
            padding: '12px 20px',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px'
          }}
        >
          <button
            ref={okButtonRef}
            type="button"
            onClick={onClose}
            style={{
              background: '#dc2626',
              color: '#ffffff',
              border: 'none',
              padding: '8px 26px',
              borderRadius: '6px',
              fontWeight: 800,
              fontSize: '0.95rem',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(220, 38, 38, 0.4)',
              transition: 'all 0.15s ease'
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
