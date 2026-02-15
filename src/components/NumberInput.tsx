import { useId, type ChangeEvent, type FocusEvent, type InputHTMLAttributes } from "react";

type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  label: string;
  onChange: (value: number | undefined) => void;
};

export const NumberInput = ({
  label,
  value,
  onChange,
  onFocus,
  ...props
}: NumberInputProps): JSX.Element => {
  const id = useId();

  const handleFocus = (event: FocusEvent<HTMLInputElement>): void => {
    // Select the content on focus for easier editing
    const target = event.target;
    requestAnimationFrame(() => {
      target.select();
    });
    if (onFocus) {
      onFocus(event);
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
        value={value ?? ""}
        onFocus={handleFocus}
        onChange={handleChange}
        {...props}
      />
    </div>
  );
};
