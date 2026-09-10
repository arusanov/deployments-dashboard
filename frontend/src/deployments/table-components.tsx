import {
  Table,
  TableBody,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import type { TableComponents } from "react-virtuoso";
import type { Deployment } from "@/api/client";

export const tableComponents: TableComponents<Deployment> = {
  Scroller: (props) => <TableContainer {...props} />,
  Table: (props) => (
    <Table
      {...props}
      stickyHeader
      sx={{
        tableLayout: "fixed",
        borderCollapse: "separate",
        minWidth: 1870,
        "& td": {
          height: 72,
          py: 0.5,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        },
      }}
    />
  ),
  TableHead: (props) => <TableHead {...props} />,
  TableBody: (props) => <TableBody {...props} />,
  TableRow: ({ item, ...props }) => (
    <TableRow {...props} data-deployment-id={item.deployment_id} />
  ),
};
