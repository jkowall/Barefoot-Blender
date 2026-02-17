import { useId, type ChangeEvent, type FocusEvent, type ReactNode } from "react";

export type NumberInputProps = {
  label: ReactNode;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onBlur?: () => void;
  selectOnFocus?: boolean;
  className?: string;
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
  selectOnFocus = true,
  className,
}: NumberInputProps): JSX.Element => {
  const id = useId();

  const handleFocus = (event: FocusEvent<HTMLInputElement>): void => {
    if (selectOnFocus) {
      // delay selection to allow browser default behavior (setting cursor) to finish
      // so we can overwrite it with "select all"
      const target = event.target;
      requestAnimationFrame(() => {
        target.select();
      });
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const val = event.target.value;
    onChange(val === "" ? undefined : Number(val));
  };

  return (
    <div className={`field${className ? ` ${className}` : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value ?? ""}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={onBlur}
      />
    </div>
  );
};
