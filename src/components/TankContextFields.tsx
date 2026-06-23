import { NumberInput } from "./NumberInput";

type TankContextFieldsProps = {
  tankSizeCuFt?: number;
  tankRatedPressurePsi?: number;
  defaultTankSizeCuFt?: number;
  defaultTankRatedPressurePsi?: number;
  onChange: (patch: { tankSizeCuFt?: number; tankRatedPressurePsi?: number }) => void;
};

const TankContextFields = ({
  tankSizeCuFt,
  tankRatedPressurePsi,
  defaultTankSizeCuFt = 80,
  defaultTankRatedPressurePsi = 3000,
  onChange
}: TankContextFieldsProps): JSX.Element => (
  <div className="grid two">
    <NumberInput
      label="Tank Volume (cu ft)"
      min={1}
      step={1}
      value={tankSizeCuFt ?? defaultTankSizeCuFt}
      onChange={(val) => onChange({ tankSizeCuFt: val === undefined ? undefined : Math.max(1, val) })}
    />
    <NumberInput
      label="Rated Pressure (PSI)"
      min={1}
      step={100}
      value={tankRatedPressurePsi ?? defaultTankRatedPressurePsi}
      onChange={(val) => onChange({ tankRatedPressurePsi: val === undefined ? undefined : Math.max(1, val) })}
    />
  </div>
);

export default TankContextFields;
