import { memo, useMemo, type ChangeEvent } from "react";
import type { GasSourceInput } from "../state/session";
import { type GasSelection, clampPercent } from "../utils/calculations";
import { NumberInput } from "./NumberInput";
import { SelectInput } from "./SelectInput";

type Props = {
  source: GasSourceInput;
  index: number;
  baseOptions: GasSelection[];
  onUpdate: (index: number, patch: Partial<GasSourceInput>) => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
  showDivider: boolean;
};

const sanitizeCustomMix = (o2: number, he: number): { o2: number; he: number } => {
  const nextO2 = clampPercent(o2);
  const maxHe = 100 - nextO2;
  const nextHe = Math.min(maxHe, Math.max(0, he));
  return { o2: nextO2, he: nextHe };
};

export const GasSourceRow = memo(({
  source,
  index,
  baseOptions,
  onUpdate,
  onRemove,
  canRemove,
  showDivider
}: Props): JSX.Element => {
  const options = useMemo(() => {
    const custom: GasSelection = {
      id: "custom",
      name: `Custom (${(source.customO2 ?? 32).toFixed(1)} O2 / ${(source.customHe ?? 0).toFixed(1)} He)`,
      o2: source.customO2 ?? 32,
      he: source.customHe ?? 0
    };
    return [...baseOptions, custom];
  }, [baseOptions, source.customO2, source.customHe]);

  return (
    <div className="gas-source-row">
      <div className="grid two">
        <SelectInput
          label={`Gas ${index + 1}`}
          labelAction={
            canRemove && (
              <button
                type="button"
                className="remove-gas-btn"
                onClick={() => onRemove(index)}
                title="Remove gas source"
                aria-label={`Remove Gas ${index + 1}`}
              >
                ✕
              </button>
            )
          }
          value={source.id}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            onUpdate(index, { id: event.target.value })
          }
        >
          {options.map((option: GasSelection) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </SelectInput>
        <div className="field">
          <label>Enabled</label>
          <input
            type="checkbox"
            checked={source.enabled}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onUpdate(index, { enabled: event.target.checked })
            }
          />
        </div>
      </div>
      {source.id === "custom" && (
        <>
          <div className="grid two">
            <NumberInput
              label="Custom O2 %"
              min={0}
              max={100}
              step={0.1}
              value={source.customO2}
              onChange={(val) => {
                if (val === undefined) {
                  onUpdate(index, { customO2: undefined });
                } else {
                  const { o2, he } = sanitizeCustomMix(val, source.customHe ?? 0);
                  onUpdate(index, { customO2: o2, customHe: he });
                }
              }}
            />
            <NumberInput
              label="Custom He %"
              min={0}
              max={100}
              step={0.1}
              value={source.customHe}
              onChange={(val) => {
                if (val === undefined) {
                  onUpdate(index, { customHe: undefined });
                } else {
                  const { o2, he } = sanitizeCustomMix(source.customO2 ?? 32, val);
                  onUpdate(index, { customO2: o2, customHe: he });
                }
              }}
            />
          </div>
          <div className="table-note">N2 auto-balances remaining fraction.</div>
        </>
      )}
      {showDivider && <hr className="gas-source-divider" />}
    </div>
  );
});
