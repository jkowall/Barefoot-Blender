import { useId, type ComponentProps, type FocusEvent } from "react";

type Props = ComponentProps<"input"> & {
  label: string;
};

export const NumberInput = ({ label, onFocus, className, ...props }: Props) => {
  const id = useId();

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    // delay selection to allow browser default behavior (setting cursor) to finish
    // so we can overwrite it with "select all"
    const target = event.target;
    requestAnimationFrame(() => {
      target.select();
    });
    onFocus?.(event);
  };

  return (
    <div className={`field ${className ?? ""}`.trim()}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        onFocus={handleFocus}
        {...props}
      />
    </div>
  );
};
