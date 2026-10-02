import React, { useEffect, useState, useRef } from 'react';
import { CornerDownLeft, Check } from 'lucide-react';

interface KeyboardNumericInputProps {
  value: number;
  onChange: (val: number) => void;
  onCommit?: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  autoSelect?: boolean;
  showEnterButton?: boolean;
  commitOnEnterOnly?: boolean;
}

export const KeyboardNumericInput: React.FC<KeyboardNumericInputProps> = ({
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  precision,
  disabled = false,
  className,
  style,
  placeholder,
  autoSelect = true,
  showEnterButton = true,
  commitOnEnterOnly = true,
}) => {
  const [textValue, setTextValue] = useState<string>(
    value === undefined || value === null || isNaN(value) ? '' : String(value)
  );
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [isJustSaved, setIsJustSaved] = useState<boolean>(false);
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync from props whenever not actively typing (isDirty is false)
  useEffect(() => {
    if (!isDirty) {
      if (value === undefined || value === null || isNaN(value)) {
        setTextValue('');
      } else {
        setTextValue(precision !== undefined ? value.toFixed(precision) : String(value));
      }
    }
  }, [value, precision, isDirty]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;

    // Allow backspacing, empty string, minus sign, and partial decimal numbers like "12."
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
      setTextValue(raw);
      setIsDirty(true);
      return;
    }

    // Only accept valid number input patterns
    if (!/^-?\d*\.?\d*$/.test(raw)) {
      return;
    }

    setTextValue(raw);
    const parsed = parseFloat(raw);
    const isDifferent = !isNaN(parsed) && parsed !== value;
    setIsDirty(isDifferent);

    // If not commitOnEnterOnly, emit realtime
    if (!commitOnEnterOnly) {
      if (!isNaN(parsed) && isFinite(parsed)) {
        onChange(parsed);
      }
    }
  };

  const commitValue = () => {
    let parsed = parseFloat(textValue);
    if (isNaN(parsed) || !isFinite(parsed)) {
      parsed = value ?? (min ?? 0);
    }

    if (min !== undefined && parsed < min) parsed = min;
    if (max !== undefined && parsed > max) parsed = max;

    const formatted = precision !== undefined ? parseFloat(parsed.toFixed(precision)) : parsed;
    setTextValue(precision !== undefined ? formatted.toFixed(precision) : String(formatted));
    setIsDirty(false);
    setIsJustSaved(true);

    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => {
      setIsJustSaved(false);
    }, 1200);

    onChange(formatted);
    if (onCommit) {
      onCommit(formatted);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (!commitOnEnterOnly) {
      commitValue();
    } else if (isDirty) {
      // If dirty text was not confirmed on Enter, revert to confirmed prop value
      setIsDirty(false);
      setTextValue(precision !== undefined && value !== undefined ? value.toFixed(precision) : String(value ?? ''));
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    if (autoSelect) {
      e.target.select();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitValue();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsDirty(false);
      setTextValue(precision !== undefined && value !== undefined ? value.toFixed(precision) : String(value ?? ''));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const current = parseFloat(textValue) || (min ?? 0);
      const next = current + step;
      const clamped = max !== undefined ? Math.min(max, next) : next;
      const formatted = precision !== undefined ? parseFloat(clamped.toFixed(precision)) : clamped;
      setTextValue(precision !== undefined ? formatted.toFixed(precision) : String(formatted));
      setIsDirty(true);
      if (!commitOnEnterOnly) {
        onChange(formatted);
        if (onCommit) onCommit(formatted);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const current = parseFloat(textValue) || (min ?? 0);
      const next = current - step;
      const clamped = min !== undefined ? Math.max(min, next) : next;
      const formatted = precision !== undefined ? parseFloat(clamped.toFixed(precision)) : clamped;
      setTextValue(precision !== undefined ? formatted.toFixed(precision) : String(formatted));
      setIsDirty(true);
      if (!commitOnEnterOnly) {
        onChange(formatted);
        if (onCommit) onCommit(formatted);
      }
    }
  };

  const baseInputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    height: '44px',
    minHeight: '44px',
    padding: '6px 14px',
    fontSize: '1.25rem',
    fontWeight: 700,
    fontFamily: 'var(--font-mono, monospace)',
    background: disabled ? '#f1f5f9' : '#ffffff',
    color: disabled ? '#94a3b8' : '#0f172a',
    border: isFocused ? '2px solid #0284c7' : '1.5px solid #cbd5e1',
    borderRadius: '6px',
    outline: 'none',
    boxShadow: isFocused ? '0 0 0 3px rgba(2, 132, 199, 0.2)' : 'none',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    userSelect: 'text',
    WebkitUserSelect: 'text',
    boxSizing: 'border-box',
    ...style,
  };

  if (!showEnterButton) {
    return (
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        value={textValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={baseInputStyle}
      />
    );
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', flex: 1, minWidth: 0, width: '100%', boxSizing: 'border-box', position: 'relative' }}>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        value={textValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={{
          ...baseInputStyle,
          minWidth: 0,
          width: '100%',
        }}
      />
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          commitValue();
        }}
        disabled={disabled}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '3px',
          padding: '0 10px',
          marginLeft: '6px',
          height: '44px',
          borderRadius: '6px',
          border: isJustSaved ? '1.5px solid #16a34a' : isDirty ? '1.5px solid #0284c7' : '1.5px solid #cbd5e1',
          fontSize: '0.8rem',
          fontWeight: 800,
          letterSpacing: '0.3px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: isJustSaved ? '#16a34a' : isDirty ? '#0284c7' : '#f8fafc',
          color: isJustSaved || isDirty ? '#ffffff' : '#475569',
          boxShadow: isDirty ? '0 2px 6px rgba(2, 132, 199, 0.35)' : 'none',
          transition: 'all 0.15s ease',
          flexShrink: 0
        }}
        title="Click or press Enter key to apply value"
      >
        {isJustSaved ? (
          <>
            <Check size={14} />
            <span>SET</span>
          </>
        ) : (
          <>
            <CornerDownLeft size={14} />
            <span>ENTER</span>
          </>
        )}
      </button>
    </div>
  );
};
