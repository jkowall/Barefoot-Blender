import { useState } from "react";

/**
 * Next list of emptied field keys after an input change. A key is added when the field is emptied
 * and removed as soon as it holds a number again.
 */
export const updateClearedKeys = <K extends string>(keys: K[], key: K, value: number | undefined): K[] => {
  const others = keys.filter((existing) => existing !== key);
  return value === undefined ? [...others, key] : others;
};

/** Next list of emptied field keys once the field loses focus. */
export const endClearedKeyEdit = <K extends string>(keys: K[], key: K): K[] =>
  keys.includes(key) ? keys.filter((existing) => existing !== key) : keys;

/** What a field shows: nothing while the user has it emptied, otherwise its resolved value. */
export const clearableDisplayValue = <K extends string>(
  keys: K[],
  key: K,
  resolvedValue: number | undefined
): number | undefined => (keys.includes(key) ? undefined : resolvedValue);

/**
 * Lets controlled number fields with an inherited default stay empty while being edited. Without it,
 * emptying a field (or typing a leading "-", which a number input reports as empty) stores undefined
 * and the field immediately refills with its default.
 *
 * An emptied field is a local draft: the saved value is kept (so results that use it stay on screen)
 * until a number is typed, which is saved, or focus leaves the field empty, which clears it.
 */
export const useClearableNumber = <K extends string>(): {
  display: (key: K, resolvedValue: number | undefined) => number | undefined;
  change: (key: K, value: number | undefined, save: (value: number | undefined) => void) => void;
  endEdit: (key: K, save: (value: number | undefined) => void) => void;
} => {
  const [clearedKeys, setClearedKeys] = useState<K[]>([]);
  return {
    display: (key, resolvedValue) => clearableDisplayValue(clearedKeys, key, resolvedValue),
    change: (key, value, save) => {
      setClearedKeys((keys) => updateClearedKeys(keys, key, value));
      if (value !== undefined) save(value);
    },
    endEdit: (key, save) => {
      if (!clearedKeys.includes(key)) return;
      setClearedKeys((keys) => endClearedKeyEdit(keys, key));
      save(undefined);
    }
  };
};
