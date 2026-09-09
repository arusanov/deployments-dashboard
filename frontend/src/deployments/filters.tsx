import { useSearch } from "./hooks/use-search";
import { Button, Stack, TextField } from "@mui/material";
import { deploymentOptions } from "@/api/options";
import { deploymentRules } from "@/config";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import type { BrowseState, SetBrowseState } from "./url-state";

export function DeploymentFilters({
  state,
  update,
  windowKey,
}: {
  windowKey: string;
  state: BrowseState;
  update: SetBrowseState;
}) {
  const search = useSearch(
    state.q,
    (q) => {
      void update({ q });
    },
    windowKey,
  );

  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 2 }}>
      <TextField
        label="Search deployments"
        placeholder="ID, creator or attribute value"
        value={search.value}
        onChange={(event) => {
          search.change(event.target.value);
        }}
        onCompositionStart={search.compositionStart}
        onCompositionEnd={(event) => {
          search.compositionEnd(
            event.currentTarget.querySelector("input")?.value ?? search.value,
          );
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.nativeEvent.isComposing &&
            !search.composing.current
          ) {
            search.commit();
          }
        }}
        slotProps={{
          htmlInput: { maxLength: deploymentRules.searchMaxLength },
        }}
        sx={{ flex: "2 1 280px" }}
      />
      <MultiSelectFilter
        label="Status"
        options={deploymentOptions.status}
        value={state.status}
        onChange={(status) => {
          void update({ status });
        }}
      />
      <MultiSelectFilter
        label="Type"
        options={deploymentOptions.type}
        value={state.type}
        onChange={(type) => {
          void update({ type });
        }}
      />
      <MultiSelectFilter
        label="Environment"
        options={deploymentOptions.environment}
        value={state.environment}
        onChange={(environment) => {
          void update({ environment });
        }}
      />
      <Button
        onClick={() => {
          search.change("");
          void update({
            q: "",
            status: [],
            type: [],
            environment: [],
          });
        }}
      >
        Clear filters
      </Button>
    </Stack>
  );
}
