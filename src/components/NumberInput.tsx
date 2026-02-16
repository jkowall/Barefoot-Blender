import { useId, type ChangeEvent, type FocusEvent } from "react";

type NumberInputProps = {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  onBlur?: () => void;
  min?: number;
  max?: number;
  step?: number;
  selectOnFocus?: boolean;
};

export const NumberInput = ({
  label,
  value,
  onChange,
  onBlur,
  min,
  max,
  step,
  selectOnFocus = true,
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
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={onBlur}
      />
    </div>
  );
};
