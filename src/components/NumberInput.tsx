import { useId, type ChangeEvent, type FocusEvent } from "react";

type Props = {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onBlur?: () => void;
  placeholder?: string;
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
  placeholder,
  className
}: Props): JSX.Element => {
  const id = useId();

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const val = event.target.value;
    onChange(val === "" ? undefined : Number(val));
  };

  const handleFocus = (event: FocusEvent<HTMLInputElement>): void => {
    // Select all text on focus for easier editing
    const target = event.target;
    requestAnimationFrame(() => {
      target.select();
    });
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
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={onBlur}
        placeholder={placeholder}
      />
    </div>
  );
};
