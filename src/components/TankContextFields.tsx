import {
  calculatePsiPerCuFt,
  cuFtToLiters
} from "../utils/calculations";
import { formatNumber } from "../utils/format";
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
}: TankContextFieldsProps): JSX.Element => {
  const resolvedTankSizeCuFt = tankSizeCuFt ?? defaultTankSizeCuFt;
  const resolvedTankRatedPressurePsi = tankRatedPressurePsi ?? defaultTankRatedPressurePsi;
  const psiPerCuFt = calculatePsiPerCuFt(resolvedTankSizeCuFt, resolvedTankRatedPressurePsi);
  const freeGasLiters = cuFtToLiters(resolvedTankSizeCuFt);

  return (
    <>
      <div className="grid two">
        <NumberInput
          label="Tank Volume (cu ft)"
          min={1}
          step={1}
          value={resolvedTankSizeCuFt}
          onChange={(val) => onChange({ tankSizeCuFt: val === undefined ? undefined : Math.max(1, val) })}
        />
        <NumberInput
          label="Rated Pressure (PSI)"
          min={1}
          step={100}
          value={resolvedTankRatedPressurePsi}
          onChange={(val) => onChange({ tankRatedPressurePsi: val === undefined ? undefined : Math.max(1, val) })}
        />
      </div>
      <div className="tank-context-summary">
        <div className="stat">
          <div className="stat-label">PSI per cu ft</div>
          <div className="stat-value">{formatNumber(psiPerCuFt, 2)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Free gas liters</div>
          <div className="stat-value">{formatNumber(freeGasLiters, 2)} L</div>
        </div>
      </div>
      <div className="table-note">Liters are free gas liters at surface pressure, not cylinder water capacity.</div>
    </>
  );
};

export default TankContextFields;
