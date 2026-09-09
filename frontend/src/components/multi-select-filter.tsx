import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import { useId } from "react";

interface Props<T extends string> {
  label: string;
  options: readonly T[];
  value: T[];
  onChange: (value: T[]) => void;
}

export function MultiSelectFilter<T extends string>({
  label,
  options,
  value,
  onChange,
}: Props<T>) {
  const labelId = useId();

  return (
    <FormControl sx={{ flex: "1 1 165px" }}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        multiple
        labelId={labelId}
        label={label}
        value={value}
        onChange={(event) => {
          const selected =
            typeof event.target.value === "string"
              ? event.target.value.split(",")
              : event.target.value;

          onChange(options.filter((option) => selected.includes(option)));
        }}
      >
        {options.map((option) => (
          <MenuItem key={option} value={option}>
            {option.replaceAll("_", " ")}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
