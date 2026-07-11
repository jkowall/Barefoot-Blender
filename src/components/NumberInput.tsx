import { useId, useRef, type KeyboardEventHandler } from "react";

type Props = {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onBlur?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  placeholder?: string;
  className?: string;
  selectOnClick?: boolean;
};

export const NumberInput = ({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  onBlur,
  onKeyDown,
  placeholder,
  className,
  selectOnClick
}: Props): JSX.Element => {
  const id = useId();
  const replaceOnNextKeyRef = useRef(false);
  const selectedValueRef = useRef("");

  const replaceValue = (target: HTMLInputElement, nextValue: string): void => {
    target.value = nextValue;
    onChange(nextValue === "" ? undefined : Number(nextValue));
    replaceOnNextKeyRef.current = false;
    selectedValueRef.current = "";
  };

  const markSelectedForReplacement = (target: HTMLInputElement): void => {
    target.select();
    replaceOnNextKeyRef.current = true;
    selectedValueRef.current = target.value;
  };

  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value ?? ""}
        onMouseDown={selectOnClick ? (e) => {
          if (document.activeElement !== e.currentTarget) {
            e.preventDefault();
            e.currentTarget.focus();
            markSelectedForReplacement(e.currentTarget);
          }
        } : undefined}
        onChange={(e) => {
          let val = e.target.value;
          if (selectOnClick && replaceOnNextKeyRef.current && selectedValueRef.current !== "") {
            const selectedValue = selectedValueRef.current;
            if (val.startsWith(selectedValue) && val !== selectedValue) {
              val = val.slice(selectedValue.length);
              e.target.value = val;
            }
          }
          replaceOnNextKeyRef.current = false;
          selectedValueRef.current = "";
          onChange(val === "" ? undefined : Number(val));
        }}
        onFocus={(e) => {
          const target = e.target;
          requestAnimationFrame(() => {
            if (selectOnClick) {
              markSelectedForReplacement(target);
            } else {
              target.select();
            }
          });
        }}
        onClick={selectOnClick ? (e) => {
          markSelectedForReplacement(e.currentTarget);
        } : undefined}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (selectOnClick && replaceOnNextKeyRef.current && !e.metaKey && !e.ctrlKey && !e.altKey) {
            if (/^[0-9]$/.test(e.key)) {
              e.preventDefault();
              replaceValue(e.currentTarget, e.key);
              return;
            }
            if (e.key === "Backspace" || e.key === "Delete") {
              e.preventDefault();
              replaceValue(e.currentTarget, "");
              return;
            }
          }
          onKeyDown?.(e);
        }}
        placeholder={placeholder}
      />
    </div>
  );
};
