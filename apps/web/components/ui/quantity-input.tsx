import * as React from "react";

import { Input } from "@/components/ui/input";
import {
  formatQuantity,
  getQuantityStep,
  isQuantityInputValue,
  normalizeQuantityInput,
  normalizeQuantityPrecision,
} from "@/lib/quantity";

type QuantityInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "onChange" | "step"
> & {
  value: string;
  precision: number;
  onValueChange: (value: string) => void;
};

export const QuantityInput = React.forwardRef<HTMLInputElement, QuantityInputProps>(
  function QuantityInput(
    { precision, value, onValueChange, inputMode, placeholder, onBlur, ...props },
    ref,
  ) {
    const normalizedPrecision = normalizeQuantityPrecision(precision);

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode={inputMode ?? (normalizedPrecision === 0 ? "numeric" : "decimal")}
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (isQuantityInputValue(nextValue, normalizedPrecision)) {
            onValueChange(nextValue);
          }
        }}
        onBlur={(event) => {
          if (event.currentTarget.value.trim()) {
            onValueChange(normalizeQuantityInput(event.currentTarget.value, normalizedPrecision));
          }
          onBlur?.(event);
        }}
        placeholder={placeholder ?? formatQuantity(0, normalizedPrecision)}
        step={getQuantityStep(normalizedPrecision)}
      />
    );
  },
);
