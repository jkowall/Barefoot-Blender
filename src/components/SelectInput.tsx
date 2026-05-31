import { useId, type ComponentProps, type ReactNode } from "react";

type Props = ComponentProps<"select"> & {
  label: string;
  labelAction?: ReactNode;
};

export const SelectInput = ({
  label,
  labelAction,
  className,
  id: externalId,
  ...props
}: Props): JSX.Element => {
  const generatedId = useId();
  const id = externalId ?? generatedId;

  return (
    <div className={`field ${className ?? ""}`}>
      <div className="flex-between">
        <label htmlFor={id}>{label}</label>
        {labelAction}
      </div>
      <select id={id} {...props} />
    </div>
  );
};
