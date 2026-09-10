import { TableCell, TableRow, TableSortLabel } from "@mui/material";
import { deploymentOptions } from "@/api/options";
import { columns } from "./columns";
import type { BrowseState, SetBrowseState } from "./url-state";

export function TableHeader({
  state,
  update,
}: {
  state: BrowseState;
  update: SetBrowseState;
}) {
  return (
    <TableRow>
      {columns.map((column) => {
        const sort = deploymentOptions.sort.find(
          (field) => field === column.field,
        );

        return (
          <TableCell
            key={column.field}
            sx={{
              width: column.width,
              height: 56,
              bgcolor: "background.paper",
              fontWeight: 600,
            }}
            sortDirection={state.sort === sort ? state.order : false}
          >
            {sort ? (
              <TableSortLabel
                active={state.sort === sort}
                direction={state.sort === sort ? state.order : "asc"}
                onClick={() => {
                  void update({
                    sort,
                    order:
                      state.sort === sort && state.order === "asc"
                        ? "desc"
                        : "asc",
                  });
                }}
              >
                {column.label}
              </TableSortLabel>
            ) : (
              column.label
            )}
          </TableCell>
        );
      })}
    </TableRow>
  );
}
