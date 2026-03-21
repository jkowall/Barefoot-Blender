import { useId } from "react";

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
        onChange={(e) => {
          const val = e.target.value;
          onChange(val === "" ? undefined : Number(val));
        }}
        onFocus={(e) => {
          const target = e.target;
          requestAnimationFrame(() => {
            target.select();
          });
        }}
        onBlur={onBlur}
        placeholder={placeholder}
      />
    </div>
  );
};
