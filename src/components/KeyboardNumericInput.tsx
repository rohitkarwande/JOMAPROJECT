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

  // Sync from props only when not actively typing/focused or dirty
  useEffect(() => {
    if (!isFocused && !isDirty) {
      if (value === undefined || value === null || isNaN(value)) {
        setTextValue('');
      } else {
        setTextValue(precision !== undefined ? value.toFixed(precision) : String(value));
      }
    }
  }, [value, precision, isFocused, isDirty]);

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
    // When blur happens, if not commitOnEnterOnly we commit.
    // If commitOnEnterOnly is true, we keep dirty state so user can still click the ENTER button!
    if (!commitOnEnterOnly) {
      commitValue();
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
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsDirty(false);
      setTextValue(precision !== undefined && value !== undefined ? value.toFixed(precision) : String(value ?? ''));
      (e.target as HTMLInputElement).blur();
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
        style={{
          userSelect: 'text',
          WebkitUserSelect: 'text',
          ...style,
        }}
      />
    );
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', flex: 1, minWidth: 0, position: 'relative' }}>
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
          flex: 1,
          minWidth: 0,
          userSelect: 'text',
          WebkitUserSelect: 'text',
          ...style,
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
          padding: '3px 8px',
          marginLeft: '6px',
          height: '28px',
          borderRadius: '4px',
          border: isJustSaved ? '1px solid #16a34a' : isDirty ? '1px solid #0284c7' : '1px solid #cbd5e1',
          fontSize: '0.74rem',
          fontWeight: 800,
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: isJustSaved ? '#16a34a' : isDirty ? '#0284c7' : '#f1f5f9',
          color: isJustSaved || isDirty ? '#ffffff' : '#64748b',
          boxShadow: isDirty ? '0 2px 6px rgba(2, 132, 199, 0.35)' : 'none',
          transition: 'all 0.15s ease',
          flexShrink: 0
        }}
        title="Click or press Enter key to apply value"
      >
        {isJustSaved ? (
          <>
            <Check size={12} />
            <span>SET</span>
          </>
        ) : (
          <>
            <CornerDownLeft size={12} />
            <span>ENTER</span>
          </>
        )}
      </button>
    </div>
  );
};
